import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BOOKS, SCENARIOS, type Scenario } from '@shop/scenarios';
import { useApi } from '../api/context';
import { rupees } from '../lib/format';

/**
 * Lantern Books: the customer's side of each bug. A deliberately plain, light
 * storefront so the demo video clearly shows two different products. The dark
 * strip on top is for the person running the demo, not part of the shop.
 */

const COUPONS: Record<string, number> = { READ15: 0.15, WELCOME10: 0.1 };
const PLAYABLE = SCENARIOS.filter((s) => s.id !== 'failure-storm');

type Result = { kind: 'paid'; orderId: string } | { kind: 'failed' } | null;

interface Address { name: string; line1: string; line2: string; city: string; pin: string }
const EMPTY_ADDRESS: Address = { name: '', line1: '', line2: '', city: '', pin: '' };

function fromScenario(s: Scenario) {
  return {
    items: s.cart.items.map((i) => ({ sku: i.sku, qty: i.qty })),
    coupon: s.cart.coupon ?? '',
    method: s.cart.paymentMethod,
    ship: !!s.cart.shipping,
    address: { ...EMPTY_ADDRESS, ...(s.cart.shipping ?? {}) },
    note: s.cart.giftNote ?? '',
  };
}

const field = 'mt-1 w-full rounded border border-[#D8CFC2] bg-white px-3 py-2 text-[14px] text-bookink outline-none focus:border-bookaccent focus-visible:outline-bookaccent';

export function ShopPage() {
  const api = useApi();
  const [scenarioId, setScenarioId] = useState(PLAYABLE[0].id);
  const [form, setForm] = useState(() => fromScenario(PLAYABLE[0]));
  const [result, setResult] = useState<Result>(null);

  useEffect(() => {
    document.title = 'Lantern Books · Checkout';
    return () => { document.title = 'Trace2Test'; };
  }, []);

  const pick = (s: Scenario) => {
    setScenarioId(s.id);
    setForm(fromScenario(s));
    setResult(null);
  };

  const code = form.coupon.trim().toUpperCase();
  const discountRate = COUPONS[code] ?? 0;
  const lines = form.items.map((i) => ({ ...i, book: BOOKS[i.sku] }));
  const subtotal = lines.reduce((s, l) => s + l.book.price * l.qty, 0);
  const discount = subtotal * discountRate;
  const total = subtotal - discount;
  const addressIncomplete = form.ship && (['name', 'line1', 'city', 'pin'] as const).some((k) => !form.address[k].trim());

  const pay = useMutation({
    mutationFn: () => {
      const { line2, ...rest } = form.address;
      return api.trigger({
        items: lines.map((l) => ({ sku: l.sku, price: l.book.price, qty: l.qty })),
        ...(code ? { coupon: code } : {}),
        paymentMethod: form.method,
        customer: { email: 'asha.k@example.com' },
        // An empty optional field is left out, as the real form does.
        ...(form.ship ? { shipping: line2.trim() ? { ...rest, line2 } : rest } : {}),
        ...(form.note.trim() ? { giftNote: form.note } : {}),
      });
    },
    onMutate: () => setResult(null),
    onSuccess: (r) => {
      const body = r.body as { orderId?: string } | null;
      setResult(r.status === 200 && body?.orderId ? { kind: 'paid', orderId: body.orderId } : { kind: 'failed' });
    },
    onError: () => setResult({ kind: 'failed' }),
  });

  const current = SCENARIOS.find((s) => s.id === scenarioId);

  return (
    <div className="min-h-screen bg-paper font-serif text-bookink [color-scheme:light]">
      <div className="bg-[#0B0E14] font-sans text-[12.5px] text-[#E6E9EF]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <span className="text-[#8B93A3]">Demo scenario:</span>
          <div role="group" aria-label="Demo scenario" className="flex flex-wrap gap-1.5">
            {PLAYABLE.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === scenarioId}
                onClick={() => pick(s)}
                className={`rounded-full border px-2.5 py-0.5 ${s.id === scenarioId ? 'border-[#F5A524] text-[#F5A524]' : 'border-[#1F2633] text-[#C3CAD8] hover:border-[#8B93A3]'}`}
              >
                {s.title}
              </button>
            ))}
          </div>
          <a href="/" className="ml-auto text-[#8B93A3] underline-offset-2 hover:text-[#E6E9EF] hover:underline">Open Trace2Test</a>
        </div>
        {current && (
          <p className="mx-auto max-w-4xl px-4 pb-2 text-[#8B93A3]">
            <span className="text-[#E6E9EF]">Customer says:</span> “{current.complaint}” <span className="text-[#E6E9EF]">Expect:</span> {current.expect}
          </p>
        )}
      </div>

      <header className="border-b border-[#E7E0D5] bg-white">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <span className="text-[20px] tracking-tight">Lantern <span className="italic text-bookaccent">Books</span></span>
          <span className="font-sans text-[13px] text-bookmuted">Checkout</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl gap-8 px-4 py-8 md:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          <section aria-labelledby="cart-title">
            <h1 id="cart-title" className="text-[24px]">Your basket</h1>
            <ul className="mt-4 divide-y divide-[#E7E0D5] border-y border-[#E7E0D5]">
              {lines.map((l) => (
                <li key={l.sku} className="flex gap-4 py-4">
                  <div aria-hidden="true" className="flex h-24 w-16 shrink-0 items-end rounded-sm p-1.5 text-[9px] leading-tight text-white/90 shadow-sm" style={{ background: l.book.cover }}>
                    {l.book.title}
                  </div>
                  <div className="flex-1">
                    <div className="text-[16px]">{l.book.title}</div>
                    <div className="font-sans text-[13px] text-bookmuted">{l.book.author} · Paperback · Qty {l.qty}</div>
                  </div>
                  <div className="font-sans text-[15px] tnum">{rupees(l.book.price * l.qty)}</div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="ship-title" className="font-sans">
            <div className="flex items-center justify-between">
              <h2 id="ship-title" className="font-serif text-[18px]">Delivery</h2>
              <label className="flex items-center gap-2 text-[13px] text-bookmuted">
                <input type="checkbox" checked={form.ship} onChange={(e) => setForm({ ...form, ship: e.target.checked })} className="accent-[#8A4B14]" />
                Ship to an address
              </label>
            </div>
            {form.ship ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {([
                  ['name', 'Full name', true],
                  ['line1', 'Address line 1', true],
                  ['line2', 'Flat, floor or landmark (optional)', false],
                  ['city', 'City', true],
                  ['pin', 'PIN code', true],
                ] as const).map(([k, label]) => (
                  <label key={k} className={`block text-[13px] text-bookmuted ${k === 'line1' || k === 'line2' ? 'sm:col-span-2' : ''}`}>
                    {label}
                    <input value={form.address[k]} onChange={(e) => setForm({ ...form, address: { ...form.address, [k]: e.target.value } })} className={field} />
                  </label>
                ))}
                <label className="block text-[13px] text-bookmuted sm:col-span-2">
                  Gift note (optional)
                  <textarea rows={2} maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={`${field} resize-none`} />
                </label>
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-bookmuted">Collect from the Lantern Books counter. No address needed.</p>
            )}
          </section>
        </div>

        <aside aria-labelledby="summary-title" className="h-fit rounded-md border border-[#E7E0D5] bg-white p-5 font-sans">
          <h2 id="summary-title" className="font-serif text-[18px]">Order summary</h2>
          <dl className="mt-4 space-y-2 text-[14px] tnum">
            <div className="flex justify-between"><dt className="text-bookmuted">Subtotal</dt><dd>{rupees(subtotal)}</dd></div>
            {discountRate > 0 && (
              <div className="flex justify-between"><dt className="text-bookmuted">Coupon {code} ({discountRate * 100}% off)</dt><dd>−{rupees(discount)}</dd></div>
            )}
            <div className="flex justify-between border-t border-[#E7E0D5] pt-2 text-[16px] font-semibold"><dt>Total</dt><dd>{rupees(total)}</dd></div>
          </dl>

          <label htmlFor="coupon" className="mt-5 block text-[13px] text-bookmuted">Coupon code</label>
          <input id="coupon" value={form.coupon} onChange={(e) => setForm({ ...form, coupon: e.target.value })} className={`${field} uppercase tracking-wide`} />
          {code && !discountRate && <p className="mt-1 text-[12px] text-bookerr">That code is not valid.</p>}

          <fieldset className="mt-5">
            <legend className="text-[13px] text-bookmuted">Pay with</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['card', 'upi'] as const).map((m) => (
                <label key={m} className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-[14px] ${form.method === m ? 'border-bookaccent bg-[#FBF3EA]' : 'border-[#D8CFC2]'}`}>
                  <input type="radio" name="method" value={m} checked={form.method === m} onChange={() => setForm({ ...form, method: m })} className="accent-[#8A4B14]" />
                  {m === 'card' ? 'Card' : 'UPI'}
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            onClick={() => pay.mutate()}
            disabled={pay.isPending || (!!code && !discountRate) || addressIncomplete}
            className="mt-5 w-full rounded bg-bookink py-2.5 text-[15px] font-medium text-white hover:bg-black focus-visible:outline-bookaccent disabled:opacity-60"
          >
            {pay.isPending ? 'Processing…' : `Pay ${rupees(total)}`}
          </button>
          {addressIncomplete && <p className="mt-1 text-[12px] text-bookmuted">Fill in the required address fields.</p>}

          <div aria-live="polite" className="mt-4">
            {result?.kind === 'paid' && (
              <div className="rounded border border-[#B7D7C2] bg-[#F1FAF4] p-3 text-[14px]">
                <p className="font-medium">Thank you. Your order is confirmed.</p>
                <p className="mt-0.5 text-[13px] text-bookmuted">Order <span className="font-mono">{result.orderId}</span></p>
              </div>
            )}
            {result?.kind === 'failed' && (
              <div className="rounded border border-[#F0C7C2] bg-[#FDF3F2] p-3 text-[14px]">
                <p className="text-bookerr">Something went wrong. Please try again.</p>
              </div>
            )}
          </div>
          {result?.kind === 'failed' && (
            <p className="mt-3 rounded bg-[#0B0E14] px-3 py-2 text-[12.5px] text-[#C3CAD8]">
              Demo note: the customer only sees this message. Trace2Test kept the failed request.{' '}
              <a href="/incidents" className="text-[#F5A524] underline underline-offset-2">See what it found</a>
            </p>
          )}
        </aside>
      </main>
      <footer className="mx-auto max-w-4xl px-4 pb-8 font-sans text-[12px] text-bookmuted">
        Lantern Books is a fictional shop used to demonstrate Trace2Test. Payments go to PayMock; no money moves.
      </footer>
    </div>
  );
}
