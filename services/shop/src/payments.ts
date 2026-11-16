import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { ChargeRequest, ChargeResponse } from './paymock.js';

export interface PaymentClient {
  charge(req: ChargeRequest): Promise<ChargeResponse>;
}

/** Calls the PayMock function with a synchronous Lambda invoke. */
export function lambdaPaymentClient(functionName: string, client = new LambdaClient({})): PaymentClient {
  return {
    async charge(req) {
      const out = await client.send(
        new InvokeCommand({ FunctionName: functionName, Payload: new TextEncoder().encode(JSON.stringify(req)) }),
      );
      if (out.FunctionError) throw new Error(`PayMock invocation failed: ${out.FunctionError}`);
      return JSON.parse(new TextDecoder().decode(out.Payload)) as ChargeResponse;
    },
  };
}
