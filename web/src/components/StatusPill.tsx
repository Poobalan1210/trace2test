import { CircleCheck, CircleDashed, CircleSlash, FileCheck2, Loader, OctagonAlert, type LucideIcon } from 'lucide-react';
import type { IncidentStatus } from '../api/types';

type Tone = 'amber' | 'green' | 'red' | 'muted';

const STATUS: Record<IncidentStatus, { label: string; tone: Tone; icon: LucideIcon; live?: boolean }> = {
  RECEIVED: { label: 'Captured', tone: 'amber', icon: Loader, live: true },
  SANITIZED: { label: 'Sanitized', tone: 'amber', icon: Loader, live: true },
  REPLAYING: { label: 'Replaying', tone: 'amber', icon: Loader, live: true },
  REPRODUCED: { label: 'Reproduced', tone: 'amber', icon: Loader, live: true },
  VERIFYING: { label: 'Verifying', tone: 'amber', icon: Loader, live: true },
  TEST_READY: { label: 'Test ready', tone: 'amber', icon: FileCheck2 },
  TEST_UNVERIFIED: { label: 'Test, unverified', tone: 'amber', icon: FileCheck2 },
  FIXED: { label: 'Fixed', tone: 'green', icon: CircleCheck },
  NOT_REPRODUCED: { label: 'Not reproduced', tone: 'muted', icon: CircleDashed },
  NOT_REPLAYABLE: { label: 'Not replayable', tone: 'muted', icon: CircleSlash },
  STILL_FAILING: { label: 'Still failing', tone: 'red', icon: OctagonAlert },
  PIPELINE_FAILED: { label: 'Pipeline failed', tone: 'red', icon: OctagonAlert },
};

const TONE: Record<Tone, string> = {
  amber: 'text-amber border-amber/30 bg-amber-soft',
  green: 'text-ok border-ok/30 bg-ok-soft',
  red: 'text-danger border-danger/30 bg-danger-soft',
  muted: 'text-muted border-line bg-panel',
};

export const isLive = (s: IncidentStatus) => !!STATUS[s]?.live;
export const statusLabel = (s: IncidentStatus) => STATUS[s]?.label ?? s;

/** What each status means for the person reading, in a few words. */
export const STATUS_MEANING: Record<IncidentStatus, string> = {
  RECEIVED: 'Working on it…',
  SANITIZED: 'Working on it…',
  REPLAYING: 'Trying it on staging…',
  REPRODUCED: 'Writing the test…',
  VERIFYING: 'Checking the fix…',
  TEST_READY: 'Bug reproduced. A test is ready.',
  TEST_UNVERIFIED: 'No staging copy to check on. A test is ready to run yourself.',
  FIXED: 'Fix confirmed on staging.',
  NOT_REPRODUCED: 'Staging did not fail, so no test.',
  NOT_REPLAYABLE: 'Not safe to replay.',
  STILL_FAILING: 'Fix checked: staging still fails.',
  PIPELINE_FAILED: 'Trace2Test hit an error.',
};

/** Status is never colour alone: every pill has an icon and a text label. */
export function StatusPill({ status, size = 'sm' }: { status: IncidentStatus; size?: 'sm' | 'md' }) {
  const s = STATUS[status] ?? { label: status, tone: 'muted' as Tone, icon: CircleDashed };
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium transition-state ${TONE[s.tone]} ${
        size === 'md' ? 'px-2.5 py-1 text-[13px]' : 'px-2 py-0.5 text-[12px]'
      }`}
    >
      <Icon aria-hidden="true" size={size === 'md' ? 14 : 12} strokeWidth={2.2} className={s.live ? 'animate-[spin_2.4s_linear_infinite]' : ''} />
      {s.label}
    </span>
  );
}
