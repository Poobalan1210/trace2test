// Generates statemachine/pipeline.asl.json. The definition is written as code
// so the shared retry and catch blocks stay identical on every task.
import { writeFileSync } from 'node:fs';

const RETRY = [{
  ErrorEquals: ['Lambda.ServiceException', 'Lambda.TooManyRequestsException', 'States.Timeout'],
  IntervalSeconds: 2, MaxAttempts: 2, BackoffRate: 2,
}];
const CATCH = [{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'MarkPipelineFailed' }];
const incidentKey = { pk: { 'S.$': "States.Format('INC#{}', $.incidentId)" }, sk: { S: 'META' } };
const now = { 'S.$': '$$.State.EnteredTime' };

const lambda = (fn, resultPath, selector, next, extraRetry = []) => ({
  Type: 'Task',
  Resource: 'arn:aws:states:::lambda:invoke',
  Parameters: { FunctionName: `\${${fn}}`, Payload: { 'incidentId.$': '$.incidentId', 'mode.$': '$.mode' } },
  ResultSelector: selector,
  ResultPath: resultPath,
  TimeoutSeconds: 30,
  Retry: [...RETRY, ...extraRetry],
  Catch: CATCH,
  Next: next,
});

// Every attribute in an expression is written as #name, so none can collide with
// one of DynamoDB's reserved words (status, fixed, ...). The names map follows from it.
const names = (...exprs) => Object.fromEntries([...new Set(exprs.join(' ').match(/#\w+/g))].map((n) => [n, n.slice(1)]));

const update = (params, next, extra = {}) => ({
  Type: 'Task',
  Resource: 'arn:aws:states:::dynamodb:updateItem',
  Parameters: {
    TableName: '${TableName}',
    ...params,
    ExpressionAttributeNames: names(params.UpdateExpression, params.ConditionExpression ?? ''),
  },
  ResultPath: null,
  Catch: CATCH,
  ...(next ? { Next: next } : { End: true }),
  ...extra,
});

const num = (path) => ({ 'N.$': `States.Format('{}', ${path})` });
const alreadyDone = (next) => [
  { ErrorEquals: ['DynamoDB.ConditionalCheckFailedException'], ResultPath: null, Next: next },
  ...CATCH,
];

const definition = {
  Comment: 'Trace2Test: sanitize, replay on staging, compare, generate a regression test and deliver it. Two modes: capture and verify.',
  StartAt: 'ModeChoice',
  States: {
    ModeChoice: {
      Type: 'Choice',
      Choices: [{ Variable: '$.mode', StringEquals: 'verify', Next: 'Replay' }],
      Default: 'Sanitize',
    },
    Sanitize: lambda('SanitizeFunctionArn', '$.sanitize',
      { 'leakCount.$': '$.Payload.leakCount', 'redactionCount.$': '$.Payload.redactionCount' }, 'Validate'),
    Validate: lambda('ValidateFunctionArn', '$.validate',
      { 'replayable.$': '$.Payload.replayable', 'testable.$': '$.Payload.testable', 'reason.$': '$.Payload.reason' }, 'ReplayableChoice'),
    // No staging copy to replay on: the request still gets a test, marked unverified.
    ReplayableChoice: {
      Type: 'Choice',
      Choices: [
        { Variable: '$.validate.replayable', BooleanEquals: true, Next: 'Replay' },
        { Variable: '$.validate.testable', BooleanEquals: true, Next: 'GenerateTest' },
      ],
      Default: 'MarkNotReplayable',
    },
    MarkNotReplayable: update({
      Key: incidentKey,
      UpdateExpression: 'SET #status = :s, #reason = :r, #resultSavedAt = :now',
      ExpressionAttributeValues: { ':s': { S: 'NOT_REPLAYABLE' }, ':r': { 'S.$': '$.validate.reason' }, ':now': now },
    }, null),
    Replay: lambda('ReplayFunctionArn', '$.replay', { 'stagingStatus.$': '$.Payload.stagingStatus' }, 'Compare',
      [{ ErrorEquals: ['NetworkError'], IntervalSeconds: 2, MaxAttempts: 1 }]),
    Compare: lambda('CompareFunctionArn', '$.compare', {
      'verdict.$': '$.Payload.verdict', 'reason.$': '$.Payload.reason',
      'stagingStatus.$': '$.Payload.stagingStatus', 'reproduced.$': '$.Payload.reproduced',
    }, 'AfterCompare'),
    AfterCompare: {
      Type: 'Choice',
      Choices: [{ Variable: '$.mode', StringEquals: 'verify', Next: 'SaveVerifyResult' }],
      Default: 'VerdictChoice',
    },
    VerdictChoice: {
      Type: 'Choice',
      Choices: [{ Variable: '$.compare.verdict', StringEquals: 'REPRODUCED', Next: 'GenerateTest' }],
      Default: 'NoTest',
    },
    GenerateTest: lambda('GenerateTestFunctionArn', '$.test', {
      'testKey.$': '$.Payload.testKey', 'captureToTestMs.$': '$.Payload.captureToTestMs',
      'generated.$': '$.Payload.generated', 'finalStatus.$': '$.Payload.finalStatus',
      'replayable.$': '$.Payload.replayable', 'reproduced.$': '$.Payload.reproduced',
    }, 'Deliver'),
    // Opens a pull request with the test. It records its own GitHub errors, so only a broken task fails here.
    Deliver: lambda('DeliverFunctionArn', '$.deliver', { 'delivered.$': '$.Payload.delivered' }, 'SaveResult'),
    NoTest: {
      Type: 'Pass',
      Result: { testKey: '', captureToTestMs: 0, generated: 0, finalStatus: 'NOT_REPRODUCED', replayable: 1, reproduced: 0 },
      ResultPath: '$.test',
      Next: 'SaveResult',
    },
    // Conditional, so a re-run of this state cannot count the same incident twice.
    SaveResult: update({
      Key: incidentKey,
      UpdateExpression: 'SET #status = :s, #resultSavedAt = :now',
      ConditionExpression: 'attribute_not_exists(#resultSavedAt)',
      ExpressionAttributeValues: { ':s': { 'S.$': '$.test.finalStatus' }, ':now': now },
    }, 'SaveMetrics', { Catch: alreadyDone('Done') }),
    SaveMetrics: update({
      Key: { pk: { S: 'METRICS' }, sk: { S: 'TOTALS' } },
      UpdateExpression: 'ADD #replayable :replayable, #reproduced :rep, #testsGenerated :gen, #leaks :leaks, #redactions :leaks, #pipelineMsTotal :ms',
      ExpressionAttributeValues: {
        ':replayable': num('$.test.replayable'), ':rep': num('$.test.reproduced'), ':gen': num('$.test.generated'),
        ':leaks': num('$.sanitize.leakCount'), ':ms': num('$.test.captureToTestMs'),
      },
    }, 'Done'),
    SaveVerifyResult: update({
      Key: incidentKey,
      UpdateExpression: 'SET #status = :s, #verifiedAt = :now, #stagingStatus = :st',
      ExpressionAttributeValues: { ':s': { 'S.$': '$.compare.verdict' }, ':now': now, ':st': num('$.compare.stagingStatus') },
    }, 'FixedChoice'),
    FixedChoice: {
      Type: 'Choice',
      Choices: [{ Variable: '$.compare.verdict', StringEquals: 'FIXED', Next: 'MarkFirstFix' }],
      Default: 'Done',
    },
    MarkFirstFix: update({
      Key: incidentKey,
      UpdateExpression: 'SET #fixedAt = :now',
      ConditionExpression: 'attribute_not_exists(#fixedAt)',
      ExpressionAttributeValues: { ':now': now },
    }, 'CountFix', { Catch: alreadyDone('Done') }),
    CountFix: update({
      Key: { pk: { S: 'METRICS' }, sk: { S: 'TOTALS' } },
      UpdateExpression: 'ADD #fixed :one',
      ExpressionAttributeValues: { ':one': { N: '1' } },
    }, 'NotifyFix'),
    // Comments on the pull request, once, when the fix is first confirmed.
    NotifyFix: lambda('DeliverFunctionArn', '$.deliver', { 'delivered.$': '$.Payload.delivered' }, 'Done'),
    Done: { Type: 'Succeed' },
    MarkPipelineFailed: {
      Type: 'Task',
      Resource: 'arn:aws:states:::dynamodb:updateItem',
      Parameters: {
        TableName: '${TableName}',
        Key: incidentKey,
        UpdateExpression: 'SET #status = :s, #failure = :f',
        ExpressionAttributeNames: { '#status': 'status', '#failure': 'failure' },
        ExpressionAttributeValues: {
          ':s': { S: 'PIPELINE_FAILED' },
          ':f': { M: { error: { 'S.$': '$.error.Error' }, cause: { 'S.$': '$.error.Cause' } } },
        },
      },
      ResultPath: null,
      Next: 'PipelineFailed',
    },
    PipelineFailed: { Type: 'Fail', Error: 'PipelineFailed', Cause: 'A pipeline step failed; see the incident for details.' },
  },
};

writeFileSync(new URL('../statemachine/pipeline.asl.json', import.meta.url), JSON.stringify(definition, null, 2) + '\n');
console.log('wrote statemachine/pipeline.asl.json');
