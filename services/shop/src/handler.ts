import { withTrace2Test } from '@trace2tests/sdk';
import { createCheckoutHandler } from './checkout.js';
import { lambdaPaymentClient } from './payments.js';
import { trace2testConfig } from './config.js';
import { STOCK } from './catalog.js';

const realHandler = createCheckoutHandler({
  payments: lambdaPaymentClient(process.env.PAYMOCK_FUNCTION!),
  apiKey: process.env.API_KEY,
  inventory: STOCK[process.env.STAGE === 'prod' ? 'prod' : 'staging'],
  fixUpiRounding: process.env.FIX_UPI_ROUNDING === 'true',
  fixAddressLine2: process.env.FIX_ADDRESS_LINE2 === 'true',
});

export const handler = withTrace2Test(realHandler, trace2testConfig());
