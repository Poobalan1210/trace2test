import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface State { Type: string; Resource?: string; Next?: string; Default?: string; Choices?: { Next: string }[]; Retry?: { ErrorEquals: string[]; MaxAttempts: number }[]; Catch?: { ErrorEquals: string[]; Next: string }[]; End?: boolean }
const asl = JSON.parse(readFileSync(resolve(__dirname, '../../../statemachine/pipeline.asl.json'), 'utf8')) as { StartAt: string; States: Record<string, State> };
const states = Object.entries(asl.States);

test('every transition points at a state that exists', () => {
  const names = new Set(Object.keys(asl.States));
  expect(names.has(asl.StartAt)).toBe(true);
  for (const [, s] of states) {
    for (const next of [s.Next, s.Default, ...(s.Choices ?? []).map((c) => c.Next), ...(s.Catch ?? []).map((c) => c.Next)]) {
      if (next) expect(names.has(next), next).toBe(true);
    }
  }
});

test('every task except the failure handler routes any error to MarkPipelineFailed', () => {
  for (const [name, s] of states) {
    if (s.Type !== 'Task' || name === 'MarkPipelineFailed') continue;
    const all = s.Catch?.find((c) => c.ErrorEquals.includes('States.ALL'));
    expect(all?.Next, name).toBe('MarkPipelineFailed');
  }
});

test('Lambda tasks retry service errors twice; Replay also retries NetworkError once', () => {
  const lambdas = states.filter(([, s]) => s.Resource === 'arn:aws:states:::lambda:invoke');
  expect(lambdas.map(([n]) => n).sort()).toEqual(['Compare', 'Deliver', 'GenerateTest', 'NotifyFix', 'Replay', 'Sanitize', 'Validate']);
  for (const [name, s] of lambdas) {
    expect(s.Retry![0], name).toMatchObject({
      ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException', 'States.Timeout'], MaxAttempts: 2,
    });
  }
  expect(asl.States.Replay.Retry![1]).toMatchObject({ ErrorEquals: ['NetworkError'], MaxAttempts: 1 });
});

test('results are saved with direct DynamoDB integrations', () => {
  for (const name of ['SaveResult', 'SaveMetrics', 'SaveVerifyResult', 'MarkNotReplayable', 'MarkPipelineFailed']) {
    expect(asl.States[name].Resource, name).toBe('arn:aws:states:::dynamodb:updateItem');
  }
});

test('DynamoDB expressions name every attribute through an alias, so reserved words cannot break them', () => {
  // Bare names like `fixed` or `status` pass locally but fail on DynamoDB with a ValidationException.
  const keywords = new Set(['SET', 'ADD', 'REMOVE', 'DELETE', 'attribute_not_exists', 'attribute_exists']);
  for (const [name, s] of states.filter(([, s]) => s.Resource === 'arn:aws:states:::dynamodb:updateItem')) {
    const p = (s as unknown as { Parameters: Record<string, unknown> }).Parameters;
    const exprs = [p.UpdateExpression, p.ConditionExpression].filter(Boolean).join(' ') as string;
    const bare = exprs.match(/(?<![#:\w])[A-Za-z_]\w*/g)!.filter((w) => !keywords.has(w));
    expect(bare, name).toEqual([]);
    for (const alias of exprs.match(/#\w+/g)!) expect(p.ExpressionAttributeNames, name).toHaveProperty([alias]);
  }
});

test('a request without a staging target still gets a test, then delivery, before the result is saved', () => {
  const choice = asl.States.ReplayableChoice.Choices!.map((c) => c.Next);
  expect(choice).toEqual(['Replay', 'GenerateTest']);
  expect(asl.States.GenerateTest.Next).toBe('Deliver');
  expect(asl.States.Deliver.Next).toBe('SaveResult');
  expect(asl.States.CountFix.Next).toBe('NotifyFix');
});
