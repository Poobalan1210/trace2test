export interface CartItem {
  sku: string;
  price: number; // rupees, as the storefront shows them
  qty: number;
}

export interface ShippingAddress {
  name: string;
  line1: string;
  /** Flat, floor or landmark. Optional on the form. */
  line2?: string;
  city: string;
  pin: string;
}

export interface CheckoutRequest {
  items: CartItem[];
  coupon?: string;
  paymentMethod: 'card' | 'upi';
  customer: { email: string };
  shipping?: ShippingAddress;
  giftNote?: string;
}

/** Copies on the shelf, by SKU. Books not listed have plenty. */
export type Inventory = Record<string, number>;

/**
 * Demo device: production and staging keep separate stock data, as real
 * environments do. "The Quiet Harbour" has sold out in production only.
 */
export const STOCK: Record<'prod' | 'staging', Inventory> = {
  prod: { 'BK-3301': 0 },
  staging: { 'BK-3301': 12 },
};
export const DEFAULT_STOCK = 50;

/** Percentage coupons, as a fraction off the subtotal. */
export const COUPONS: Record<string, number> = {
  READ15: 0.15,
  WELCOME10: 0.1,
};

export function subtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

/** Order total in rupees after any coupon. May carry fractional paise. */
export function orderTotal(items: CartItem[], coupon?: string): number {
  const discount = coupon ? COUPONS[coupon.toUpperCase()] ?? 0 : 0;
  return subtotal(items) * (1 - discount);
}

/** Returns an error message, or null when the request is well formed. */
export function validateCheckout(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const b = body as Partial<CheckoutRequest>;
  if (!Array.isArray(b.items) || b.items.length === 0) return 'items must be a non-empty array';
  for (const item of b.items) {
    if (!item || typeof item.sku !== 'string') return 'each item needs a sku';
    if (typeof item.price !== 'number' || !(item.price > 0)) return 'each item needs a positive price';
    if (!Number.isInteger(item.qty) || item.qty < 1) return 'each item needs a whole qty of at least 1';
  }
  if (b.coupon !== undefined && (typeof b.coupon !== 'string' || !(b.coupon.toUpperCase() in COUPONS))) {
    return 'unknown coupon';
  }
  if (b.paymentMethod !== 'card' && b.paymentMethod !== 'upi') return 'paymentMethod must be card or upi';
  if (!b.customer || typeof b.customer.email !== 'string' || !b.customer.email.includes('@')) {
    return 'customer.email is required';
  }
  if (b.shipping !== undefined) {
    const s = b.shipping;
    if (!s || typeof s !== 'object') return 'shipping must be an address';
    for (const field of ['name', 'line1', 'city', 'pin'] as const) {
      if (typeof s[field] !== 'string' || !s[field].trim()) return `shipping.${field} is required`;
    }
    if (s.line2 !== undefined && typeof s.line2 !== 'string') return 'shipping.line2 must be text';
  }
  if (b.giftNote !== undefined && (typeof b.giftNote !== 'string' || b.giftNote.length > 300)) {
    return 'giftNote must be text of at most 300 characters';
  }
  return null;
}
