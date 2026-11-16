import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { expiresAt, fingerprintKey, GSI1_PK, incidentKey, METRICS_KEY, type Incident, type Metrics } from '@t2t/shared';
import { ZERO_METRICS, type IncidentStore, type ListQuery } from './stores.js';

const isConditionFailure = (err: unknown) => (err as { name?: string })?.name === 'ConditionalCheckFailedException';

function toIncident(item: Record<string, unknown>): Incident {
  const { pk: _pk, sk: _sk, gsi1pk: _g1, gsi1sk: _g2, expiresAt: _e, ...rest } = item;
  return rest as unknown as Incident;
}

const encodeCursor = (key: Record<string, unknown> | undefined) =>
  key ? Buffer.from(JSON.stringify(key)).toString('base64url') : undefined;
function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    // Only accept the shape the GSI hands out, so a cursor cannot address other items.
    if (key && key.gsi1pk === GSI1_PK && typeof key.gsi1sk === 'string' && typeof key.pk === 'string' && key.sk === 'META') return key;
  } catch {
    // fall through
  }
  return undefined;
}

export function dynamoIncidentStore(
  table: string,
  doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }),
): IncidentStore {
  return {
    async claimFingerprint(fp, incidentId, now) {
      const out = await doc.send(new UpdateCommand({
        TableName: table,
        Key: fingerprintKey(fp),
        UpdateExpression:
          'ADD #count :one SET incidentId = if_not_exists(incidentId, :id), firstSeenAt = if_not_exists(firstSeenAt, :now), lastSeenAt = :now, expiresAt = :exp',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':one': 1, ':id': incidentId, ':now': now, ':exp': expiresAt() },
        ReturnValues: 'ALL_NEW',
      }));
      return { ownerId: out.Attributes!.incidentId as string, count: out.Attributes!.count as number };
    },

    async reassignFingerprint(fp, fromId, toId) {
      try {
        await doc.send(new UpdateCommand({
          TableName: table,
          Key: fingerprintKey(fp),
          UpdateExpression: 'SET incidentId = :to',
          ConditionExpression: 'incidentId = :from',
          ExpressionAttributeValues: { ':to': toId, ':from': fromId },
        }));
        return true;
      } catch (err) {
        if (isConditionFailure(err)) return false;
        throw err;
      }
    },

    async get(id) {
      const out = await doc.send(new GetCommand({ TableName: table, Key: incidentKey(id), ConsistentRead: true }));
      return out.Item ? toIncident(out.Item) : undefined;
    },

    async create(incident) {
      try {
        await doc.send(new PutCommand({
          TableName: table,
          Item: { ...incidentKey(incident.id), ...incident, gsi1pk: GSI1_PK, gsi1sk: incident.createdAt, expiresAt: expiresAt() },
          ConditionExpression: 'attribute_not_exists(pk)',
        }));
      } catch (err) {
        if (!isConditionFailure(err)) throw err;
      }
    },

    async update(id, fields) {
      const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
      if (entries.length === 0) return;
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets = entries.map(([k, v], i) => {
        names[`#f${i}`] = k;
        values[`:v${i}`] = v;
        return `#f${i} = :v${i}`;
      });
      await doc.send(new UpdateCommand({
        TableName: table,
        Key: incidentKey(id),
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
    },

    async recordStep(id, name, timing) {
      await doc.send(new UpdateCommand({
        TableName: table,
        Key: incidentKey(id),
        UpdateExpression: 'SET steps.#name = :t',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: { '#name': name },
        ExpressionAttributeValues: { ':t': timing },
      }));
    },

    async bumpOccurrence(id, now) {
      await doc.send(new UpdateCommand({
        TableName: table,
        Key: incidentKey(id),
        UpdateExpression: 'ADD occurrences :one SET lastSeenAt = :now',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':one': 1, ':now': now },
      }));
    },

    async addMetrics(deltas) {
      const entries = Object.entries(deltas).filter(([, v]) => typeof v === 'number' && v !== 0);
      if (entries.length === 0) return;
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const adds = entries.map(([k, v], i) => {
        names[`#m${i}`] = k;
        values[`:m${i}`] = v;
        return `#m${i} :m${i}`;
      });
      await doc.send(new UpdateCommand({
        TableName: table,
        Key: METRICS_KEY,
        UpdateExpression: `ADD ${adds.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
    },

    async getMetrics() {
      const out = await doc.send(new GetCommand({ TableName: table, Key: METRICS_KEY }));
      const m: Metrics = { ...ZERO_METRICS };
      for (const k of Object.keys(m) as (keyof Metrics)[]) {
        if (typeof out.Item?.[k] === 'number') m[k] = out.Item[k] as number;
      }
      return m;
    },

    async list(q: ListQuery) {
      const items: Incident[] = [];
      let startKey = decodeCursor(q.cursor);
      // A status filter can leave pages short, so read a few pages to fill one.
      for (let page = 0; page < 5 && items.length < q.limit; page++) {
        const filter = q.statuses?.length
          ? {
              FilterExpression: `#s IN (${q.statuses.map((_, i) => `:s${i}`).join(', ')})`,
              ExpressionAttributeNames: { '#s': 'status' },
            }
          : {};
        const out = await doc.send(new QueryCommand({
          TableName: table,
          IndexName: 'gsi1',
          KeyConditionExpression: 'gsi1pk = :pk',
          ExpressionAttributeValues: { ':pk': GSI1_PK, ...Object.fromEntries((q.statuses ?? []).map((s, i) => [`:s${i}`, s])) },
          ScanIndexForward: false,
          Limit: q.limit - items.length,
          ExclusiveStartKey: startKey,
          ...filter,
        }));
        items.push(...(out.Items ?? []).map(toIncident));
        startKey = out.LastEvaluatedKey;
        if (!startKey) break;
      }
      return { items, cursor: encodeCursor(startKey) };
    },

    async recent(limit) {
      const out = await doc.send(new QueryCommand({
        TableName: table,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: { ':pk': GSI1_PK },
        ScanIndexForward: false,
        Limit: limit,
      }));
      return (out.Items ?? []).map(toIncident);
    },
  };
}
