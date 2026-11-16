import { Check, X, Minus } from 'lucide-react';
import type { Incident, StepTiming } from '../api/types';
import { duration } from '../lib/format';

type State = 'done' | 'active' | 'failed' | 'stopped' | 'pending' | 'skipped';

interface Step {
  label: string;
  hint?: string;
  state: State;
  timing?: StepTiming;
  note?: string;
}

const failedAt = (i: Incident, name: string) => i.steps[name] && !i.steps[name].ok;

/** Derives the six user-facing steps from the incident's status and its steps map. */
export function deriveSteps(i: Incident): Step[] {
  const s = i.steps;
  const pipelineFailed = i.status === 'PIPELINE_FAILED';
  const failure = i.failure?.error;

  const sanitized: Step = { label: 'Sanitized', timing: s.Sanitize, state: s.Sanitize?.ok ? 'done' : failedAt(i, 'Sanitize') ? 'failed' : 'pending' };
  if (sanitized.state === 'pending' && i.status === 'RECEIVED') sanitized.state = 'active';

  const replayTiming = s.Replay;
  const replayed: Step = { label: 'Replayed', timing: replayTiming, state: replayTiming?.ok ? 'done' : failedAt(i, 'Replay') ? 'failed' : 'pending' };
  if (i.status === 'NOT_REPLAYABLE') Object.assign(replayed, { state: 'stopped', note: i.reason });
  else if (i.replayable === false) Object.assign(replayed, { state: 'skipped', note: i.reason });
  else if (replayed.state === 'pending' && (i.status === 'SANITIZED' || i.status === 'REPLAYING')) replayed.state = 'active';

  const reproduced: Step = { label: 'Reproduced', timing: s.Compare, state: 'pending' };
  if (i.verdict === 'REPRODUCED') reproduced.state = 'done';
  else if (i.verdict === 'NOT_REPRODUCED') Object.assign(reproduced, { state: 'stopped', note: 'No: staging behaved differently' });
  else if (failedAt(i, 'Compare')) reproduced.state = 'failed';
  else if (replayed.state === 'done') reproduced.state = 'active';
  if (i.status === 'NOT_REPLAYABLE' || i.replayable === false) reproduced.state = 'skipped';

  const generated: Step = { label: 'Test generated', timing: s.GenerateTest, state: i.testKey ? 'done' : 'pending' };
  if (!i.testKey) {
    if (failedAt(i, 'GenerateTest')) generated.state = 'failed';
    else if (i.status === 'REPRODUCED') generated.state = 'active';
    else if (['failed', 'stopped', 'skipped'].includes(reproduced.state)) generated.state = 'skipped';
  }

  const verifyTiming = s.VerifyCompare ?? s.VerifyReplay;
  const verified: Step = { label: 'Fix verified', timing: i.status === 'VERIFYING' ? undefined : verifyTiming, state: 'pending' };
  if (i.status === 'FIXED') verified.state = 'done';
  else if (i.status === 'VERIFYING') verified.state = 'active';
  else if (i.status === 'STILL_FAILING') Object.assign(verified, { state: 'failed', note: i.stagingStatus ? `staging still returns ${i.stagingStatus}` : undefined });
  else if (generated.state === 'skipped' || generated.state === 'failed' || i.replayable === false) verified.state = 'skipped';

  const steps: Step[] = [{ label: 'Captured', timing: s.Captured, state: 'done' }, sanitized, replayed, reproduced, generated, verified];
  const hints = ['Failed request recorded', 'Private data removed', 'Sent to staging', 'Same failure on staging', 'Jest file written', 'Staging passes after a fix'];
  steps.forEach((st, n) => (st.hint = hints[n]));

  if (pipelineFailed) {
    const first = steps.find((st) => st.state === 'active' || st.state === 'pending' || st.state === 'failed');
    if (first) Object.assign(first, { state: 'failed', note: failure ? `failed with ${failure}` : 'the pipeline failed here' });
    for (const st of steps) if (st.state === 'active') st.state = 'pending';
  }
  return steps;
}

const DOT: Record<State, string> = {
  done: 'border-ok/50 bg-ok-soft text-ok',
  active: 'border-amber bg-amber-soft text-amber',
  failed: 'border-danger bg-danger-soft text-danger',
  stopped: 'border-muted bg-panel text-muted',
  pending: 'border-line bg-panel text-muted',
  skipped: 'border-line bg-panel text-muted',
};

const STATE_TEXT: Record<State, string> = { done: 'done', active: 'in progress', failed: 'failed', stopped: 'stopped here', pending: 'waiting', skipped: 'skipped' };

export function Stepper({ incident }: { incident: Incident }) {
  const steps = deriveSteps(incident);
  return (
    <ol aria-label="Pipeline progress" className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-0">
      {steps.map((st, idx) => {
        const fixedDone = st.label === 'Fix verified' && st.state === 'done';
        return (
          <li key={st.label} className="flex min-w-0 gap-2.5 lg:flex-col lg:gap-2">
            <div className="flex items-center">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-state ${
                  fixedDone ? 'border-ok bg-ok-soft text-ok' : DOT[st.state]
                }`}
              >
                {st.state === 'done' && <Check size={12} strokeWidth={3} aria-hidden="true" />}
                {st.state === 'failed' && <X size={12} strokeWidth={3} aria-hidden="true" />}
                {(st.state === 'skipped' || st.state === 'stopped') && <Minus size={12} strokeWidth={3} aria-hidden="true" />}
                {st.state === 'active' && <span aria-hidden="true" className="h-2 w-2 animate-pulsedot rounded-full bg-amber" />}
              </span>
              {idx < steps.length - 1 && (
                <span aria-hidden="true" className={`mx-2 hidden h-px flex-1 transition-state lg:block ${st.state === 'done' ? 'bg-ok/40' : 'bg-line'}`} />
              )}
            </div>
            <div className="min-w-0 lg:pr-4">
              <div className={`text-[13px] font-medium ${st.state === 'pending' || st.state === 'skipped' ? 'text-muted' : 'text-ink'}`}>
                {st.label}
                <span className="sr-only">, {STATE_TEXT[st.state]}</span>
              </div>
              <div className="text-[12px] leading-[16px] text-muted">{st.hint}</div>
              <div className="font-mono text-[12px] text-muted tnum">
                {st.timing ? duration(st.timing.ms) : st.state === 'active' ? 'running' : st.state === 'skipped' ? 'skipped' : '–'}
              </div>
              {st.note && <div className={`mt-0.5 text-[12px] ${st.state === 'failed' ? 'text-danger' : 'text-muted'}`}>{st.note}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
