/**
 * The demo scenarios: what a customer reports, the exact request behind it,
 * and what Trace2Test should make of it. Plain data with no imports, so the
 * tests, the local scripts and the dashboard all share one definition.
 */

export type ExpectedOutcome = 'TEST_READY' | 'NOT_REPRODUCED' | 'DUPLICATE' | 'SUCCESS';

export interface Scenario {
  id: string;
  title: string;
  /** What the customer writes to support. */
  complaint: string;
  /** What is really going on, for the person running the demo. */
  cause: string;
  /** What Trace2Test does with it, in one sentence. */
  expect: string;
  outcome: ExpectedOutcome;
  /** Part of the error message this scenario produces, so the dashboard can tell which complaint an incident came from. */
  errorIncludes?: string;
  /** How many times to send the request (a failure storm sends several). */
  repeat?: number;
  cart: {
    items: { sku: string; price: number; qty: number }[];
    coupon?: string;
    paymentMethod: 'card' | 'upi';
    customer: { email: string };
    shipping?: { name: string; line1: string; line2?: string; city: string; pin: string };
    giftNote?: string;
  };
}

export const BOOKS: Record<string, { title: string; author: string; price: number; cover: string }> = {
  'BK-1042': { title: 'The Lamplighter’s Atlas', author: 'Meera Kandaswamy', price: 1299, cover: '#2F4858' },
  'BK-2210': { title: 'Small Hours', author: 'Tomas Ilves', price: 349.5, cover: '#8A4B14' },
  'BK-3301': { title: 'The Quiet Harbour', author: 'Noor Al-Rashid', price: 599, cover: '#4A5D3A' },
};

const ASHA = { email: 'asha.k@example.com' };

export const SCENARIOS: Scenario[] = [
  {
    id: 'upi-coupon',
    title: 'Coupon + UPI',
    complaint: 'Checkout fails when I use my coupon and pay by UPI.',
    cause: 'READ15 leaves a total of ₹1,401.225. The UPI path sends 140122.5 paise unrounded, and the payment provider only accepts whole paise.',
    expect: 'Reproduced on staging. A regression test is generated, and the fix can be verified.',
    outcome: 'TEST_READY',
    errorIncludes: 'amount must be an integer',
    cart: {
      items: [
        { sku: 'BK-1042', price: 1299, qty: 1 },
        { sku: 'BK-2210', price: 349.5, qty: 1 },
      ],
      coupon: 'READ15',
      paymentMethod: 'upi',
      customer: ASHA,
    },
  },
  {
    id: 'no-flat-number',
    title: 'Address without a flat number',
    complaint: 'I can’t order a gift for my brother. It just says something went wrong.',
    cause: 'Address line 2 (flat or floor) is optional on the form, but the shipping-label code calls .trim() on it unconditionally.',
    expect: 'Reproduced on staging. The email inside the gift note is redacted before it leaves the service.',
    outcome: 'TEST_READY',
    errorIncludes: "(reading 'trim')",
    cart: {
      items: [{ sku: 'BK-1042', price: 1299, qty: 1 }],
      paymentMethod: 'card',
      customer: ASHA,
      shipping: { name: 'Ravi Kumar', line1: '14 Lake View Road', city: 'Chennai', pin: '600041' },
      giftNote: 'Happy birthday Ravi! Any problem with delivery, write to asha.k@example.com',
    },
  },
  {
    id: 'sold-out-in-prod',
    title: 'Sold out in production only',
    complaint: 'The Quiet Harbour shows on the site, but checkout fails every time.',
    cause: 'The book is sold out in production’s stock data but not in staging’s. The stock code assumes a reservation always exists.',
    expect: 'Not reproduced: staging has the book in stock and returns 200. Trace2Test says so instead of guessing.',
    outcome: 'NOT_REPRODUCED',
    errorIncludes: "(reading 'id')",
    cart: {
      items: [{ sku: 'BK-3301', price: 599, qty: 1 }],
      paymentMethod: 'card',
      customer: ASHA,
      shipping: { name: 'Asha K', line1: '2 Temple Street', line2: 'Flat 3B', city: 'Madurai', pin: '625001' },
    },
  },
  {
    id: 'failure-storm',
    title: 'Failure storm',
    complaint: 'Lots of customers hit the coupon + UPI bug at once.',
    cause: 'The same failure, five times in a row.',
    expect: 'No new incident. The existing one counts the extra occurrences.',
    outcome: 'DUPLICATE',
    errorIncludes: 'amount must be an integer',
    repeat: 5,
    cart: {
      items: [
        { sku: 'BK-1042', price: 1299, qty: 1 },
        { sku: 'BK-2210', price: 349.5, qty: 1 },
      ],
      coupon: 'READ15',
      paymentMethod: 'upi',
      customer: ASHA,
    },
  },
  {
    id: 'happy-path',
    title: 'A normal order',
    complaint: 'Nothing; this order works.',
    cause: 'Card payment with no coupon.',
    expect: 'Checkout succeeds, and Trace2Test records nothing: successful requests are never captured.',
    outcome: 'SUCCESS',
    cart: {
      items: [{ sku: 'BK-2210', price: 349.5, qty: 2 }],
      paymentMethod: 'card',
      customer: ASHA,
      shipping: { name: 'Asha K', line1: '2 Temple Street', line2: 'Flat 3B', city: 'Madurai', pin: '625001' },
    },
  },
];

/** The first scenario whose failure matches this error message (the storm shares the coupon + UPI bug, which comes first). */
export const scenarioForError = (message: string) => SCENARIOS.find((s) => s.errorIncludes && message.includes(s.errorIncludes));

export const scenario = (id: string) => {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
};
