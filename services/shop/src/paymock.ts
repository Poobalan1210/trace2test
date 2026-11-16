import { createHash } from 'node:crypto';

/**
 * PayMock: a fictional payment provider. Like real providers it only accepts
 * whole minor units (paise), and rejects anything else with a 400.
 */
export interface ChargeRequest {
  amount: number; // paise
  currency: 'INR';
  method: 'card' | 'upi';
  reference: string;
}

export interface ChargeResponse {
  status: number;
  body: { chargeId: string; state: 'captured' } | { error: string };
}

export function charge(req: Partial<ChargeRequest>): ChargeResponse {
  if (typeof req.amount !== 'number' || !Number.isInteger(req.amount)) {
    return { status: 400, body: { error: 'amount must be an integer' } };
  }
  if (req.amount <= 0) return { status: 400, body: { error: 'amount must be positive' } };
  if (req.currency !== 'INR') return { status: 400, body: { error: 'unsupported currency' } };
  if (req.method !== 'card' && req.method !== 'upi') return { status: 400, body: { error: 'unsupported method' } };
  const chargeId = 'ch_' + createHash('sha256').update(`${req.reference}:${req.amount}`).digest('hex').slice(0, 16);
  return { status: 200, body: { chargeId, state: 'captured' } };
}

/** Lambda entry point. Checkout invokes this function directly with a ChargeRequest payload. */
export const handler = async (event: Partial<ChargeRequest>): Promise<ChargeResponse> => charge(event);
