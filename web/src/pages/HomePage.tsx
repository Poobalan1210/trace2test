import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, Check, ChevronDown, Code2, Download, FileCode2, Headset, Lock, MessageSquareWarning, PackageCheck,
  RotateCcw, ShieldCheck, ShoppingCart, Users, Wrench, X, type LucideIcon,
} from 'lucide-react';
import { BOOKS, SCENARIOS, type Scenario } from '@shop/scenarios';
import { useApi, useIsLocal } from '../api/context';
import type { Incident, IncidentDetail } from '../api/types';
import { isLive } from '../components/StatusPill';
import { CodeView } from '../components/CodeView';
import { CopyButton } from '../components/CopyButton';
import { errorMessage } from '../components/ErrorState';
import { REDACTION_NOUN, placeholdersIn, valueAt } from '../lib/narrate';
import { rupees } from '../lib/format';

/**
 * The home page, read top to bottom: what Trace2Test is, the problem it
 * solves, a live demo that runs by itself once you press Pay, and how to
 * add it to your own service. Every result in the demo is real.
 */

const CHOICES = SCENARIOS.filter((s) => s.outcome === 'TEST_READY' || s.outcome === 'NOT_REPRODUCED');

export function HomePage() {
  return (
    <div className="space-y-24 pb-12 sm:space-y-28">
      <Hero />
      <Problem />
      <LiveDemo />
      <Reuse />
      <WhoItHelps />
    </div>
  );
}

/* ---------- 1. What it is ---------- */

function Hero() {
  return (
    <section className="grid items-center gap-12 pt-2 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14 lg:pt-8">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-2 rounded-full border border-amber/30 bg-amber-soft px-3 py-1 text-[12.5px] font-medium text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden="true" /> Production failure in, regression test out
        </p>
        <h1 className="mt-5 text-[34px] font-semibold leading-[1.12] tracking-[-0.02em] sm:text-[46px]">
          When a customer hits a bug, get the exact request that broke, <span className="text-amber">and a test that proves the fix.</span>
        </h1>
        <p className="mt-5 max-w-[560px] text-[17px] leading-[28px] text-body">
          A small add-on for your backend. It keeps every request that fails, hides the customer’s private data,
          checks the failure on a safe test copy of your service, and writes the test for you. Automatically, in about a second.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#demo" className="btn-primary px-5 py-2.5 text-[15px]">
            See it live <ArrowDown size={16} aria-hidden="true" />
          </a>
          <a href="#reuse" className="btn-ghost px-5 py-2.5 text-[15px]">Use it in your service</a>
        </div>
        <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-muted">
          {['One-line wrapper', 'Private data never leaves your service', 'Only replays on staging'].map((t) => (
            <li key={t} className="flex items-center gap-1.5"><Check size={14} aria-hidden="true" className="text-ok" />{t}</li>
          ))}
        </ul>
      </div>
      <HeroFlow />
    </section>
  );
}

/** A still picture of one run through the pipeline, using the demo's first bug. */
function HeroFlow() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[520px] select-none">
      <div className="absolute -inset-y-8 inset-x-0 -z-10 rounded-[40px] sm:-inset-x-8 bg-[radial-gradient(closest-side,rgba(245,165,36,0.13),transparent)]" />
      <div className="space-y-3">
        <div className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-paper px-4 py-3 text-[14.5px] text-bookink shadow-panel">
          “Checkout fails when I use my coupon and pay by UPI.”
          <span className="mt-1 block text-[12px] text-bookmuted">Customer, via support</span>
        </div>
        <FlowCard icon={MessageSquareWarning} tone="danger" title="Captured" meta="POST /checkout · 500">
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[19px] text-body">{`{ "coupon": "READ15",
  "paymentMethod": "upi",
  "email": `}<span className="rounded bg-ok-soft px-1 text-ok">"user_520f@redacted.example"</span>{` }`}</pre>
        </FlowCard>
        <FlowCard icon={RotateCcw} tone="danger" title="Replayed on staging" meta="500 again">
          <p className="text-[13px] text-body">Same request, same failure. The bug is real.</p>
        </FlowCard>
        <FlowCard icon={FileCode2} tone="ok" title="Regression test written" meta="Jest">
          <p className="text-[13px] text-body"><span className="text-danger">Fails today</span> · <span className="text-ok">passes after the fix</span></p>
        </FlowCard>
      </div>
    </div>
  );
}

function FlowCard({ icon: Icon, tone, title, meta, children }: { icon: LucideIcon; tone: 'danger' | 'ok'; title: string; meta: string; children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-panel p-4">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
          <Icon size={15} />
        </span>
        <span className="text-[14px] font-medium text-ink">{title}</span>
        <span className={`ml-auto font-mono text-[12px] ${tone === 'ok' ? 'text-ok' : 'text-danger'}`}>{meta}</span>
      </div>
      <div className="mt-2.5 pl-[38px]">{children}</div>
    </div>
  );
}

/* ---------- 2. The problem, before and after ---------- */

function Problem() {
  const before = [
    ['Customer', '“It said something went wrong.”'],
    ['Logs', '“Error 500.” Nothing about what they bought or how they paid.'],
    ['Developer', 'Tries their own carts for hours. “Works on my machine.”'],
    ['Result', 'Bug closed as “can’t reproduce”. It happens again next week.'],
  ];
  const after = [
    ['Customer', 'Same complaint, same error message.'],
    ['Trace2Test', 'Already has their exact request, with email and keys hidden.'],
    ['Developer', 'Gets a confirmed bug and a test that fails until it is fixed.'],
    ['Result', 'Fix is proven with the customer’s own request, and the test keeps it fixed.'],
  ];
  return (
    <section aria-labelledby="problem-title">
      <SectionHead id="problem-title" kicker="The problem" title="The bug only happens with one exact request, and nobody has it" />
      <div className="grid overflow-hidden rounded-panel border border-line bg-panel md:grid-cols-2">
        <Column tone="danger" title="Without Trace2Test" rows={before} />
        <Column tone="ok" title="With Trace2Test" rows={after} />
      </div>
    </section>
  );
}

function Column({ tone, title, rows }: { tone: 'danger' | 'ok'; title: string; rows: string[][] }) {
  const Icon = tone === 'ok' ? Check : X;
  return (
    <div className={`p-6 sm:p-7 ${tone === 'ok' ? 'bg-gradient-to-b from-ok/[0.06] to-transparent max-md:border-t md:border-l border-line' : ''}`}>
      <h3 className={`flex items-center gap-2.5 text-[16px] font-semibold ${tone === 'ok' ? 'text-ok' : 'text-danger'}`}>
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ${tone === 'ok' ? 'bg-ok-soft' : 'bg-danger-soft'}`}><Icon size={14} strokeWidth={2.5} aria-hidden="true" /></span>
        {title}
      </h3>
      <dl className="mt-5 divide-y divide-line/70">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[100px_1fr] gap-3 py-3 text-[15px] leading-[23px] first:pt-0 last:pb-0">
            <dt className="text-muted">{k}</dt>
            <dd className={tone === 'ok' ? 'text-ink' : 'text-body'}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SectionHead({ id, kicker, title, sub }: { id: string; kicker: string; title: string; sub?: string }) {
  return (
    <div className="mb-8 max-w-[760px]">
      <p className="kicker">{kicker}</p>
      <h2 id={id} className="mt-2 text-[26px] font-semibold leading-[1.25] tracking-[-0.015em] sm:text-[30px]">{title}</h2>
      {sub && <p className="mt-3 text-[16px] leading-[26px] text-body">{sub}</p>}
    </div>
  );
}

/* ---------- 3. Live demo ---------- */

function LiveDemo() {
  const api = useApi();
  const local = useIsLocal();
  const qc = useQueryClient();
  const [scenario, setScenario] = useState<Scenario>(CHOICES[0]);
  const [sent, setSent] = useState<{ at: number; status: number } | null>(null);

  const pay = useMutation({
    mutationFn: async () => {
      // The demo starts from the bug, so make sure staging does not already have the fix.
      if (local) await api.setStagingFix(false).catch(() => {});
      const at = Date.now();
      const { status } = await api.trigger(scenario.cart);
      return { at, status };
    },
    onMutate: () => setSent(null),
    onSuccess: (r) => {
      setSent(r);
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['stagingFix'] });
    },
  });

  const list = useQuery({
    queryKey: ['incidents', []],
    queryFn: () => api.listIncidents([]),
    enabled: !!sent && sent.status >= 500,
    refetchInterval: (q) => (findIncident(q.state.data?.items, scenario, sent) ? false : 800),
  });
  const found = findIncident(list.data?.items, scenario, sent);
  const detail = useQuery({
    queryKey: ['incident', found?.id],
    queryFn: () => api.getIncident(found!.id),
    enabled: !!found,
    refetchInterval: (q) => (q.state.data && !isLive(q.state.data.incident.status) ? false : 800),
  });

  const pick = (s: Scenario) => {
    setScenario(s);
    setSent(null);
    pay.reset();
  };

  return (
    <section id="demo" aria-labelledby="demo-title" className="scroll-mt-20">
      <SectionHead
        id="demo-title"
        kicker="See it live"
        title="Be the customer. Watch what Trace2Test does."
        sub="This is a real (pretend) bookshop, Lantern Books, with real bugs in its code. Pick a complaint and press Pay. Everything on the right happens on its own, from real results."
      />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr] lg:items-start">
        <div className="space-y-4 lg:sticky lg:top-20">
          <div role="radiogroup" aria-label="Customer complaints" className="space-y-2">
            {CHOICES.map((s) => {
              const on = s.id === scenario.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pick(s)}
                  className={`flex w-full items-start gap-3 rounded-panel border p-3.5 text-left transition-state ${on ? 'border-amber/70 bg-raised shadow-glow' : 'border-line bg-panel hover:border-muted hover:bg-raised/50'}`}
                >
                  <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? 'border-amber' : 'border-muted'}`}>
                    {on && <span className="h-2 w-2 rounded-full bg-amber" />}
                  </span>
                  <span>
                    <span className={`block text-[14.5px] italic leading-[21px] ${on ? 'text-ink' : 'text-body'}`}>“{s.complaint}”</span>
                    <span className="mt-1 block text-[12.5px] text-muted">{s.title}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <Basket scenario={scenario} pending={pay.isPending} sent={sent} onPay={() => pay.mutate()} />
          {pay.isError && <p role="alert" className="text-[13px] text-danger">Could not reach the shop: {errorMessage(pay.error)}</p>}
        </div>

        <Timeline sent={sent} d={detail.data} scenario={scenario} />
      </div>
    </section>
  );
}

function findIncident(items: Incident[] | undefined, s: Scenario, sent: { at: number } | null): Incident | undefined {
  if (!items || !sent || !s.errorIncludes) return undefined;
  // Allow for clock differences between this browser and the API.
  return items.find((i) => i.errorMessage.includes(s.errorIncludes!) && Date.parse(i.lastSeenAt) >= sent.at - 60_000);
}

const isFixedSince = (d: IncidentDetail, at: number) =>
  d.incident.status === 'FIXED' && !!d.incident.verifiedAt && Date.parse(d.incident.verifiedAt) >= at - 5_000;

function Basket({ scenario, pending, sent, onPay }: { scenario: Scenario; pending: boolean; sent: { status: number } | null; onPay: () => void }) {
  const c = scenario.cart;
  const subtotal = c.items.reduce((s, i) => s + i.price * i.qty, 0);
  const total = c.coupon === 'READ15' ? subtotal * 0.85 : subtotal;
  const failed = !!sent && sent.status >= 500;
  return (
    <div className="rounded-panel bg-paper p-5 font-sans text-bookink shadow-panel [color-scheme:light]">
      <p className="font-serif text-[17px]">Lantern <span className="italic text-bookaccent">Books</span> <span className="font-sans text-[12px] text-bookmuted">· checkout</span></p>
      <ul className="mt-2.5 space-y-1 text-[13.5px]">
        {c.items.map((i) => (
          <li key={i.sku} className="flex justify-between gap-3"><span>{BOOKS[i.sku]?.title ?? i.sku}</span><span className="tnum">{rupees(i.price * i.qty)}</span></li>
        ))}
        {c.coupon && <li className="flex justify-between text-bookmuted"><span>Coupon {c.coupon}</span><span>15% off</span></li>}
        <li className="flex justify-between text-bookmuted"><span>Pay with</span><span>{c.paymentMethod === 'upi' ? 'UPI' : 'Card'}</span></li>
        {c.shipping && (
          <li className="text-bookmuted">
            Ship to {c.shipping.name}, {c.shipping.line1}, {c.shipping.city}
            {!c.shipping.line2 && <span className="text-bookink"> (no flat number)</span>}
          </li>
        )}
      </ul>
      <button
        type="button"
        onClick={onPay}
        disabled={pending}
        className="mt-4 w-full rounded-lg bg-bookink py-3 text-[15px] font-medium text-white transition-state hover:bg-black disabled:opacity-60"
      >
        {pending ? 'Processing…' : sent ? `Pay ${rupees(total)} again` : `Pay ${rupees(total)}`}
      </button>
      <div aria-live="polite">
        {failed && <div className="mt-3 rounded border border-[#F0C7C2] bg-[#FDF3F2] p-2.5 text-[14px] text-bookerr">Something went wrong. Please try again.</div>}
        {sent && !failed && <div className="mt-3 rounded border border-[#B7D7C2] bg-[#F1FAF4] p-2.5 text-[14px]">Order confirmed.</div>}
      </div>
    </div>
  );
}

type RowState = 'wait' | 'run' | 'done' | 'bad';

function Timeline({ sent, d, scenario }: { sent: { at: number; status: number } | null; d?: IncidentDetail; scenario: Scenario }) {
  const failed = !!sent && sent.status >= 500;
  const inc = d?.incident;
  const replayed = !!d?.replay && inc?.status !== 'REPLAYING';
  const reproduced = d?.replay?.verdict === 'REPRODUCED';
  const fixed = !!d && !!sent && isFixedSince(d, sent.at);

  const s1: RowState = !sent ? 'wait' : failed ? (d ? 'done' : 'run') : 'wait';
  const s2: RowState = d?.request ? 'done' : d ? 'run' : 'wait';
  const s3: RowState = replayed ? (reproduced ? 'bad' : 'done') : d?.request ? 'run' : 'wait';
  const s4: RowState = inc?.testKey ? 'done' : replayed && !reproduced ? 'done' : replayed ? 'run' : 'wait';
  const s5: RowState = fixed || (replayed && !reproduced) ? 'done' : inc?.testKey ? 'run' : 'wait';

  return (
    <ol aria-label="What Trace2Test does" aria-live="polite" className="overflow-hidden rounded-panel border border-line bg-panel">
      <li className="flex items-center gap-2.5 border-b border-line bg-raised/40 px-5 py-3.5 text-[13.5px]">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${!sent ? 'bg-muted' : failed ? (fixed || (replayed && !reproduced) ? 'bg-ok' : 'animate-pulsedot bg-amber') : 'bg-ok'}`} />
        <span className={sent ? 'text-ink' : 'text-muted'}>
          {!sent ? 'Waiting for you to press Pay…' : failed ? 'The checkout failed. Trace2Test takes over:' : 'The order went through, so Trace2Test does nothing. It only steps in when something fails.'}
        </span>
      </li>
      <Row n={1} icon={MessageSquareWarning} state={s1} title="Keeps the failed request" waiting="Happens the moment a checkout fails.">
        The customer only saw “Something went wrong”. Trace2Test kept their exact order: the books, the coupon, the payment method and the address.
      </Row>
      <Row n={2} icon={ShieldCheck} state={s2} title="Hides private details first" waiting="Before anything leaves the shop.">
        {d?.request && <Privacy d={d} scenario={scenario} />}
      </Row>
      <Row n={3} icon={RotateCcw} state={s3} title="Tries it on a safe test copy" waiting="Never on the real shop.">
        {d && replayed && <Replay d={d} />}
      </Row>
      <Row n={4} icon={FileCode2} state={s4} title={replayed && !reproduced ? 'No test, and that’s correct' : 'Writes a test'} waiting="Only if the test copy fails too.">
        {d && replayed && <TestPart d={d} />}
      </Row>
      <Row n={5} icon={Wrench} state={s5} title={replayed && !reproduced ? 'Nothing to fix in the code' : 'Proves the fix'} waiting="Once there is a test." last>
        {d?.incident.testKey && sent && <FixPart d={d} since={sent.at} />}
        {replayed && !reproduced && <p className="text-muted">The team gets the exact failed order and knows to look at the real shop’s data instead of the code.</p>}
      </Row>
      {d && (
        <li className="border-t border-line px-5 py-3.5 text-[13.5px]">
          <Link to={`/incidents/${d.incident.id}`} className="inline-flex items-center gap-1 text-amber hover:underline hover:underline-offset-2">Open the full technical details →</Link>
        </li>
      )}
    </ol>
  );
}

function Row({ n, icon: Icon, state, title, waiting, last, children }: { n: number; icon: LucideIcon; state: RowState; title: string; waiting: string; last?: boolean; children?: ReactNode }) {
  const dot =
    state === 'done' ? 'border-ok/40 bg-ok-soft text-ok'
    : state === 'bad' ? 'border-danger/40 bg-danger-soft text-danger'
    : state === 'run' ? 'border-amber/50 bg-amber-soft text-amber'
    : 'border-line bg-bg text-muted';
  const rail = state === 'done' ? 'bg-ok/30' : state === 'bad' ? 'bg-danger/30' : 'bg-line';
  return (
    <li className="relative flex gap-4 px-5 pt-5 last:pb-5">
      {/* The rail joins this step to the next one. */}
      {!last && <span aria-hidden="true" className={`absolute bottom-[-16px] left-[38px] top-[60px] w-px transition-state ${rail}`} />}
      <span className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-state ${dot}`}>
        {state === 'run' ? <span className="h-2.5 w-2.5 animate-pulsedot rounded-full bg-amber" aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
      </span>
      <div className={`min-w-0 flex-1 pb-1 pt-1.5 transition-state ${state === 'wait' ? 'opacity-60' : ''}`}>
        <h3 className="flex items-baseline gap-2 text-[15.5px] font-semibold text-ink">
          <span className="font-mono text-[12px] font-normal text-muted">0{n}</span>{title}
          <span className="sr-only">: {state === 'wait' ? 'waiting' : state === 'run' ? 'in progress' : 'done'}</span>
        </h3>
        <div className="mt-1.5 space-y-3 text-[14.5px] leading-[22px] text-body">
          {state === 'wait' ? <p className="text-muted">{waiting}</p> : state === 'run' && !children ? <p className="text-muted">Working…</p> : children}
        </div>
      </div>
    </li>
  );
}

function Privacy({ d, scenario }: { d: IncidentDetail; scenario: Scenario }) {
  const req = d.request!;
  return (
    <ul className="space-y-1.5">
      {req.redactions.map((r, i) => {
        const raw = valueAt(req as unknown as Record<string, unknown>, r.path);
        const kept = typeof raw === 'string' ? (placeholdersIn(raw)[0] ?? raw) : '–';
        const original = r.type === 'email' ? scenario.cart.customer.email : r.type === 'key' ? 'secret key' : 'real value';
        return (
          <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px]">
            <span className="w-[150px] shrink-0 text-muted">{REDACTION_NOUN[r.type] ?? r.type}{r.path.endsWith('giftNote') && ' (gift note)'}</span>
            <span className="text-danger line-through decoration-danger/60">{original}</span>
            <span className="text-muted">→</span>
            <span className="font-mono text-[12.5px] text-ok">{kept}</span>
          </li>
        );
      })}
      <li className="pt-1 text-[13px] text-muted">The real values never leave the shop. Everything else is kept exactly, so the order can be tried again.</li>
    </ul>
  );
}

function Replay({ d }: { d: IncidentDetail }) {
  const staging = d.replay && 'status' in d.replay.staging ? d.replay.staging : null;
  const same = d.replay?.verdict === 'REPRODUCED';
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <Outcome label="Real shop (the customer)" ok={false} code={d.production?.status} />
        <Outcome label="Test copy (the retry)" ok={!same} code={staging?.status} />
      </div>
      <p className={same ? 'font-medium text-danger' : 'font-medium text-ok'}>
        {same ? 'Same order, same failure: the bug is real and confirmed.' : 'It works on the test copy, so the code is fine.'}
      </p>
      {!same && <p className="text-muted">The real shop has different data: the book is sold out only there. Trace2Test says so instead of guessing.</p>}
      <p className="text-[12.5px] text-muted">The test copy is what developers call staging: a private copy of the service with no real customers.</p>
    </>
  );
}

function Outcome({ label, ok, code }: { label: string; ok: boolean; code?: number }) {
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 ${ok ? 'border-ok/30 bg-ok-soft' : 'border-danger/30 bg-danger-soft'}`}>
      <p className="text-[12px] text-muted">{label}</p>
      <p className={`flex items-center gap-1.5 text-[15px] font-medium ${ok ? 'text-ok' : 'text-danger'}`}>
        {ok ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
        {ok ? 'Order worked' : 'Order failed'}
        {code !== undefined && <span className="font-mono text-[11.5px] font-normal text-muted">({code})</span>}
      </p>
    </div>
  );
}

function TestPart({ d }: { d: IncidentDetail }) {
  const api = useApi();
  const inc = d.incident;
  const q = useQuery({ queryKey: ['test', inc.id], queryFn: () => api.getTest(inc.id), enabled: !!inc.testKey, staleTime: Infinity });

  if (!inc.testKey) {
    return <p className="text-muted">A test only helps if it fails while the bug is there. This order already works on the test copy, so a test would catch nothing.</p>;
  }
  if (!q.data) return <p className="text-muted">Writing…</p>;

  const download = () => {
    const url = URL.createObjectURL(new Blob([q.data.source], { type: 'text/javascript' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = q.data.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <p>
        A small program that repeats this exact order and checks it goes through.{' '}
        <b className="font-medium text-danger">Fails today</b> (the bug is there), <b className="font-medium text-ok">passes after the fix</b>, and keeps the bug from coming back.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={download} className="btn-ghost px-3 py-1.5 text-[13px] font-normal">
          <Download size={14} aria-hidden="true" /> Download {q.data.filename}
        </button>
      </div>
      <details className="group rounded border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[13px] text-muted hover:text-ink">
          <ChevronDown size={14} aria-hidden="true" className="transition-transform group-open:rotate-180" /> Show the code
        </summary>
        <div className="max-h-[320px] overflow-auto border-t border-line bg-bg">
          <CodeView code={q.data.source} label={`Generated test ${q.data.filename}`} />
        </div>
      </details>
    </>
  );
}

function FixPart({ d, since }: { d: IncidentDetail; since: number }) {
  const api = useApi();
  const local = useIsLocal();
  const qc = useQueryClient();
  const inc = d.incident;
  const fix = useQuery({ queryKey: ['stagingFix'], queryFn: () => api.stagingFix(), enabled: local, retry: false });
  const applyFix = useMutation({
    mutationFn: () => api.setStagingFix(true),
    onSuccess: (v) => qc.setQueryData(['stagingFix'], v),
  });
  const check = useMutation({
    mutationFn: () => api.verify(inc.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incident', inc.id] }),
  });
  // Fixed in this run of the demo, not left over from an earlier one.
  const fixed = isFixedSince(d, since);
  const checking = inc.status === 'VERIFYING' || check.isPending;
  const hasFix = !local || !!fix.data;
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-state disabled:cursor-not-allowed disabled:opacity-40';

  if (fixed) {
    return (
      <p className="rounded border border-ok/40 bg-ok-soft px-3 py-2">
        <b className="font-medium text-ok">Fixed and proven.</b> The customer’s own order now goes through on the test copy, and the test passes. Safe to release.
      </p>
    );
  }
  return (
    <>
      <p>A developer fixes the code and puts it on the test copy. Trace2Test then retries the customer’s order.</p>
      <div className="flex flex-wrap items-center gap-2">
        {local ? (
          fix.isError ? (
            <span className="text-[13px] text-danger">Restart <code className="font-mono">npm run dev</code> to enable the demo fix.</span>
          ) : (
            <button type="button" onClick={() => applyFix.mutate()} disabled={hasFix || applyFix.isPending} className={`${btn} border border-line bg-bg text-ink hover:border-muted`}>
              {hasFix ? <><Check size={13} aria-hidden="true" /> Fix applied</> : <><Wrench size={13} aria-hidden="true" /> 1. Apply the fix (demo)</>}
            </button>
          )
        ) : (
          <span className="text-[13px] text-muted">Deploy your fix to staging (here: redeploy with StagingHasFix=true), then:</span>
        )}
        <button type="button" onClick={() => check.mutate()} disabled={!hasFix || checking} className={`${btn} bg-amber font-medium text-bg hover:brightness-110`}>
          <RotateCcw size={13} aria-hidden="true" /> {checking ? 'Checking…' : '2. Check again'}
        </button>
      </div>
      {inc.status === 'STILL_FAILING' && <p className="text-danger">Still failing: the fix is not on the test copy yet.</p>}
      {check.isError && <p role="alert" className="text-[13px] text-danger">{errorMessage(check.error)}</p>}
    </>
  );
}

/* ---------- 4. Reuse ---------- */

const WRAP = `import { withTrace2Test } from '@trace2test/sdk';

// Your existing Lambda handler stays exactly as it is.
export const handler = withTrace2Test(myHandler, {
  service: 'my-service',
  stage: process.env.STAGE,          // only 'prod' captures
  ingestUrl: process.env.T2T_INGEST_URL,
  ingestKey: process.env.T2T_INGEST_KEY,
});`;

const TARGETS = `ReplayTargets:   {"my-service": {"baseUrl": "https://staging.my-service.example.com",
                  "routes": {"POST": ["/orders"]}}}
DeliveryTargets: {"my-service": {"repo": "acme/my-service"}}`;

function Reuse() {
  return (
    <section id="reuse" aria-labelledby="reuse-title" className="scroll-mt-20">
      <SectionHead
        id="reuse-title"
        kicker="Use it in your own service"
        title="Not just for this bookshop: any API can use it, in three steps"
        sub="Lantern Books is only the example. Trace2Test is a separate stack plus a small SDK for Node.js services on Lambda, Express or Fastify, so a team can add it without changing their code."
      />
      <ol className="overflow-hidden rounded-panel border border-line bg-panel">
        <Step n={1} icon={Code2} title="Wrap your handler" text="npm install @trace2test/sdk, then one line around your Lambda handler (or a middleware for Express and Fastify). Successful requests are never recorded.">
          <Snippet code={WRAP} />
        </Step>
        <Step n={2} icon={RotateCcw} title="Point it at staging and your repo" text="Where your staging service is and which routes are safe to retry, and which repository gets a pull request with each new test. Both optional.">
          <Snippet code={TARGETS} />
        </Step>
        <Step n={3} icon={PackageCheck} title="Deploy" text="One command sets up everything on your AWS account. It costs nothing while nothing fails.">
          <Snippet code={'sam build && sam deploy'} />
        </Step>
      </ol>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Fit
          ok
          title="Works well for"
          items={['Node.js APIs on AWS Lambda, Express or Fastify', 'JSON requests that fail the same way every time (most code bugs)', 'Teams that cannot copy customer data into tickets or logs']}
        />
        <Fit
          title="Not built for"
          items={['Failures that only depend on timing or production-only data (it reports these honestly as “not reproduced”)', 'Other languages, yet', 'Requests over 256 KB or not JSON']}
        />
      </div>
    </section>
  );
}

function Step({ n, icon: Icon, title, text, children }: { n: number; icon: LucideIcon; title: string; text: string; children: ReactNode }) {
  return (
    <li className="grid min-w-0 gap-4 border-line p-5 sm:p-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-8 [&:not(:first-child)]:border-t">
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber/25 bg-amber-soft text-amber"><Icon size={17} aria-hidden="true" /></span>
          <h3 className="text-[16px] font-semibold"><span className="mr-1.5 font-mono text-[13px] font-normal text-muted">0{n}</span>{title}</h3>
        </div>
        <p className="mt-3 text-[14.5px] leading-[22px] text-body">{text}</p>
      </div>
      <div className="min-w-0 self-center">{children}</div>
    </li>
  );
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="relative rounded-lg border border-line bg-bg">
      <pre className="overflow-x-auto p-4 pr-24 font-mono text-[12.5px] leading-[20px] text-ink/90">{code}</pre>
      <div className="absolute right-2 top-2"><CopyButton text={code} label="Copy" /></div>
    </div>
  );
}

function Fit({ ok, title, items }: { ok?: boolean; title: string; items: string[] }) {
  const Icon = ok ? Check : X;
  return (
    <div className="rounded-panel border border-line bg-panel p-5">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2.5">
        {items.map((t) => (
          <li key={t} className="flex gap-2.5 text-[14.5px] leading-[22px] text-body">
            <Icon size={16} aria-hidden="true" className={`mt-[3px] shrink-0 ${ok ? 'text-ok' : 'text-muted'}`} />{t}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- 5. Who it helps ---------- */

function WhoItHelps() {
  const cards: { icon: LucideIcon; who: string; text: string }[] = [
    { icon: Headset, who: 'Support', text: 'No more asking customers for screenshots or steps. The failed request is already captured.' },
    { icon: Code2, who: 'Developers', text: 'Start from a confirmed bug and a failing test, not a guess. Minutes instead of hours.' },
    { icon: Lock, who: 'Privacy and security', text: 'Emails, cards and keys are hidden inside your service, before anything is sent or stored.' },
    { icon: Users, who: 'Product and managers', text: '“Fixed” means proven with the customer’s own request, and the test stops it coming back.' },
  ];
  return (
    <section aria-labelledby="who-title">
      <SectionHead id="who-title" kicker="Who it helps" title="One captured request, useful to everyone involved" />
      <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.who} className="border-t border-line pt-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber/25 bg-amber-soft text-amber"><c.icon size={17} aria-hidden="true" /></span>
            <h3 className="mt-4 text-[16px] font-semibold">{c.who}</h3>
            <p className="mt-1.5 text-[14.5px] leading-[22px] text-body">{c.text}</p>
          </div>
        ))}
      </div>
      <div className="mt-16 flex flex-col items-center gap-5 rounded-panel border border-line bg-panel bg-gradient-to-br from-amber/[0.08] via-transparent to-transparent px-6 py-10 text-center">
        <p className="max-w-[560px] text-[22px] font-semibold leading-[30px] tracking-[-0.01em]">Stop closing bugs as “can’t reproduce”.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <a href="#demo" className="btn-primary"><ShoppingCart size={15} aria-hidden="true" /> Try another complaint</a>
          <Link to="/incidents" className="btn-ghost">See every captured failure</Link>
        </div>
      </div>
    </section>
  );
}
