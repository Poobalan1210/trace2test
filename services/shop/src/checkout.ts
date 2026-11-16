import { randomUUID } from 'node:crypto';
import { json, header, parseJsonBody, secretsEqual, serverError, type HttpEvent, type HttpResult } from '@t2t/shared';
import { DEFAULT_STOCK, orderTotal, validateCheckout, type CartItem, type CheckoutRequest, type Inventory, type ShippingAddress } from './catalog.js';
import type { PaymentClient } from './payments.js';

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly providerStatus: number,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export interface CheckoutDeps {
  payments: PaymentClient;
  apiKey: string | undefined;
  /** Stock data for this environment. Production and staging differ. */
  inventory: Inventory;
  /** Demo devices: staging can be deployed with the fixes while prod keeps the bugs. */
  fixUpiRounding: boolean;
  fixAddressLine2: boolean;
}

// Assumes every book that is listed is on the shelf. A sold-out book has no
// reservation, and reading its id is the seeded bug that only production data triggers.
function reserveStock(inventory: Inventory, items: CartItem[]): string[] {
  return items.map((item) => {
    const reservation = takeFromShelf(inventory, item.sku, item.qty);
    return reservation!.id;
  });
}

function takeFromShelf(inventory: Inventory, sku: string, qty: number): { id: string } | undefined {
  const onShelf = inventory[sku] ?? DEFAULT_STOCK;
  return onShelf >= qty ? { id: `rsv_${sku}_${qty}` } : undefined;
}

// The label printer wants every line in capitals. Line 2 is optional on the
// address form, but this code assumes it is always there: the seeded bug.
function formatShippingLabel(address: ShippingAddress, fixed: boolean): string {
  const line2 = fixed ? (address.line2 ?? '').trim() : address.line2!.trim();
  return [address.name, address.line1, line2, `${address.city} ${address.pin}`].filter(Boolean).join('\n').toUpperCase();
}

// Written first, by the original team.
async function chargeCard(deps: CheckoutDeps, total: number, reference: string) {
  const res = await deps.payments.charge({ amount: Math.round(total * 100), currency: 'INR', method: 'card', reference });
  if (res.status !== 200) throw new PaymentProviderError(errorText(res.body), res.status);
  return { ...res.body, amountPaise: Math.round(total * 100) };
}

// Added later. The unrounded conversion is the seeded bug.
async function chargeUpi(deps: CheckoutDeps, total: number, reference: string) {
  const amount = deps.fixUpiRounding ? Math.round(total * 100) : total * 100;
  const res = await deps.payments.charge({ amount, currency: 'INR', method: 'upi', reference });
  if (res.status !== 200) throw new PaymentProviderError(errorText(res.body), res.status);
  return { ...res.body, amountPaise: amount };
}

function errorText(body: unknown): string {
  return body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : 'payment failed';
}

/**
 * POST /checkout. Client errors are answered with 4xx. Anything unexpected
 * becomes a generic 500, with the error attached for Trace2Test to read.
 */
export function createCheckoutHandler(deps: CheckoutDeps) {
  return async (event: HttpEvent): Promise<HttpResult> => {
    if (!secretsEqual(header(event, 'x-api-key'), deps.apiKey)) return json(401, { error: 'unauthorized' });

    const body = parseJsonBody(event);
    const invalid = validateCheckout(body);
    if (invalid) return json(400, { error: invalid });
    const order = body as CheckoutRequest;

    const total = orderTotal(order.items, order.coupon);
    const orderId = 'ord_' + randomUUID().slice(0, 8);
    let payment;
    let label: string | undefined;
    try {
      reserveStock(deps.inventory, order.items);
      label = order.shipping ? formatShippingLabel(order.shipping, deps.fixAddressLine2) : undefined;
      payment = order.paymentMethod === 'upi'
        ? await chargeUpi(deps, total, orderId)
        : await chargeCard(deps, total, orderId);
    } catch (err) {
      console.error('checkout failed', { orderId, error: (err as Error).name });
      return serverError(err);
    }

    return json(200, {
      orderId,
      status: 'paid',
      amountPaise: payment.amountPaise,
      chargeId: 'chargeId' in payment ? payment.chargeId : undefined,
      shippingLabel: label,
      // Replayed requests are labelled so staging orders can be told apart.
      replay: header(event, 'x-t2t-replay') ? true : undefined,
    });
  };
}
