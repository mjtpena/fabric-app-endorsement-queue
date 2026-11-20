import { Badge, Chip, cx } from '@x10/shared/ui';

import { rules } from '../config/rules';
import { expiryLabel, type ExpiryState } from '../domain/register';
import { ageTone } from '../domain/queue';
import { LEVEL_LABEL, RESULT_LABEL, RESULT_TONE, STATUS_LABEL, STATUS_TONE } from '../labels';
import type { Level, Result, Status } from '../model';

export function StatusChip({ status }: { status: Status }) {
  return (
    <span data-testid="status-chip" className="inline-flex">
      <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
    </span>
  );
}

/** The level as its metal: a small gold (Certified) or slate (Promoted) ring and the word. */
export function LevelMark({ level, className }: { level: Level; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap text-ui font-medium', className)}>
      <span
        aria-hidden="true"
        className="inline-block size-2.5 shrink-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 35% 30%, color-mix(in oklab, var(--seal-${level === 'certified' ? 'gold' : 'slate'}) 45%, white), var(--seal-${level === 'certified' ? 'gold' : 'slate'}))`,
          boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.15)',
        }}
      />
      <span className={level === 'certified' ? 'text-brand-text' : 'text-fg'}>{LEVEL_LABEL[level]}</span>
    </span>
  );
}

export function LevelChip({ level }: { level: Level }) {
  return (
    <span className="inline-flex h-[22px] items-center rounded-md bg-surface px-1.5 ring-1 ring-inset ring-line">
      <LevelMark level={level} className="text-xs" />
    </span>
  );
}

export function ResultChip({ result }: { result: Result | null | undefined }) {
  if (!result)
    return (
      <Badge tone="neutral" className="text-muted">
        Not answered
      </Badge>
    );
  return <Badge tone={RESULT_TONE[result]}>{RESULT_LABEL[result]}</Badge>;
}

export function ExpiryChip({ state, expiresAt }: { state: ExpiryState; expiresAt: string | null }) {
  const tone = state.kind === 'expired' ? 'bad' : state.kind === 'due' ? 'warn' : state.kind === 'valid' ? 'ok' : 'neutral';
  return (
    <span data-testid="expiry-chip" data-kind={state.kind} className="inline-flex">
      <Badge tone={tone}>{expiryLabel(state, expiresAt)}</Badge>
    </span>
  );
}

export function AgeChip({ days }: { days: number }) {
  const tone = ageTone(days, rules);
  const label = days === 0 ? 'Today' : `${days} d`;
  const why =
    tone === 'bad' ? ` (over ${rules.ageRedDays} days)` : tone === 'warn' ? ` (over ${rules.ageAmberDays} days)` : '';
  return (
    <span data-testid="age-chip" data-tone={tone} title={`Submitted ${days} days ago${why}`} className="inline-flex items-center justify-end gap-1.5 font-mono text-ui num">
      {tone !== 'neutral' && <span aria-hidden="true" className={cx('size-1.5 rounded-full', tone === 'bad' ? 'bg-bad-solid' : 'bg-warn-solid')} />}
      <span className={tone === 'bad' ? 'text-bad-text' : tone === 'warn' ? 'text-warn-text' : 'text-muted'}>{label}</span>
    </span>
  );
}
