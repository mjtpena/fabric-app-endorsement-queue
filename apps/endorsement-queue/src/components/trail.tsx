import { formatDateTime } from '@x10/shared/lib';
import { cx, toneVar } from '@x10/shared/ui';

import { EVENT_LABEL, EVENT_TONE, LEVEL_LABEL } from '../labels';
import type { EndorsementEvent, Level } from '../model';

/**
 * The decision trail, oldest first. Append-only, so this is the full history of the request.
 * `ignored` events (written by someone not allowed to write them) are struck through and marked "Not counted".
 */
export function EventTrail({ events, ignored }: { events: EndorsementEvent[]; ignored?: ReadonlySet<string> }) {
  if (!events.length) return <p className="m-0 text-ui text-muted">No events yet.</p>;
  return (
    <ol className="m-0 list-none p-0" data-testid="event-trail" aria-label="Decision trail, oldest first">
      {events.map((e, i) => {
        const bad = ignored?.has(e.id);
        const last = i === events.length - 1;
        return (
          <li key={e.id} className="relative grid grid-cols-[14px_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0" data-testid="trail-event" data-type={e.type}>
            <span aria-hidden="true" className="relative flex justify-center">
              <span
                className={cx('relative z-[1] mt-1 size-2.5 rounded-full ring-4 ring-[var(--surface)]', last && 'size-3')}
                style={{ background: bad ? 'var(--gray-8)' : toneVar[EVENT_TONE[e.type]] }}
              />
              {!last && <span className="absolute top-4 bottom-[-6px] w-px bg-[var(--line-strong)]" />}
            </span>
            <div className="min-w-0">
              <div className={cx('flex flex-wrap items-baseline gap-x-2', bad && 'line-through opacity-70')}>
                <span className="text-sm font-medium text-fg">{EVENT_LABEL[e.type]}</span>
                <span className="text-ui text-muted">{e.byName}</span>
              </div>
              {bad && (
                <div className="mt-1 text-xs font-medium text-bad-text" data-testid="event-not-counted">
                  Not counted: written by someone not allowed to
                </div>
              )}
              <time dateTime={e.at} className="mt-0.5 block font-mono text-[11px] text-faint num">
                {formatDateTime(e.at)}
              </time>
              {e.note && <p className="m-0 mt-1.5 text-ui leading-5 break-words text-fg/90">{e.note}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Scope reminder: the app records the review; the reviewer still applies the badge in Fabric. */
export function BadgeReminder({ level, compact }: { level: Level; compact?: boolean }) {
  return (
    <div role="note" data-testid="badge-reminder" className={cx('rounded-lg border border-line bg-surface-sunken text-ui leading-5', compact ? 'px-3 py-2.5' : 'px-4 py-3')}>
      <div className="font-medium text-fg">Next step in Fabric: the reviewer applies the {LEVEL_LABEL[level]} badge.</div>
      <p className="m-0 mt-1 text-muted">
        Open the semantic model in Fabric, go to <strong className="font-medium text-fg">Settings → Endorsement</strong>, choose{' '}
        <strong className="font-medium text-fg">{LEVEL_LABEL[level]}</strong> and apply. This app records the review and the seal; it does not set the badge.
      </p>
    </div>
  );
}
