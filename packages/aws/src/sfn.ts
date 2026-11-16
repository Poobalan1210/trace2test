import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { Workflow } from './stores.js';

export function stepFunctionsWorkflow(stateMachineArn: string, sfn = new SFNClient({})): Workflow {
  return {
    async start(name, input) {
      try {
        const out = await sfn.send(new StartExecutionCommand({ stateMachineArn, name, input: JSON.stringify(input) }));
        return out.executionArn!;
      } catch (err) {
        // Same name and input within 90 days is idempotent; a different input raises this.
        if ((err as { name?: string }).name === 'ExecutionAlreadyExists') {
          const arn = stateMachineArn.replace(':stateMachine:', ':execution:') + ':' + name;
          await sfn.send(new DescribeExecutionCommand({ executionArn: arn }));
          return arn;
        }
        throw err;
      }
    },
  };
}
