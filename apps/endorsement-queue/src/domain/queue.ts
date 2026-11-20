/** Review queue helpers (pure). */
import { daysBetween } from '@x10/shared/lib';

import { rules } from '../config/rules';
import type { EndorsementRequest, Level, Status } from '../model';
import { OPEN_STATUSES } from './requests';

/** Calendar days the request has been waiting since it was submitted. */
export function ageDays(req: Pick<EndorsementRequest, 'submittedAt'>, now: Date): number {
  return Math.max(0, daysBetween(req.submittedAt, now));
}

/** Age chip tone: amber once `ageAmberDays` have passed, red once `ageRedDays` have passed. */
export function ageTone(days: number, r: { ageAmberDays: number; ageRedDays: number } = rules): 'neutral' | 'warn' | 'bad' {
  if (days >= r.ageRedDays) return 'bad';
  if (days >= r.ageAmberDays) return 'warn';
  return 'neutral';
}

export type LevelFilter = 'all' | Level;
export type StatusFilter = 'open' | 'all' | Status;

export interface QueueFilter {
  level: LevelFilter;
  status: StatusFilter;
  /** Only requests claimed by this sub. */
  mineSub?: string | null;
}

/** Filter and sort the queue: oldest submission first. */
export function queueView(requests: EndorsementRequest[], f: QueueFilter): EndorsementRequest[] {
  return requests
    .filter((r) => f.level === 'all' || r.requestedLevel === f.level)
    .filter((r) =>
      f.status === 'all' ? true : f.status === 'open' ? OPEN_STATUSES.includes(r.status) : r.status === f.status,
    )
    .filter((r) => !f.mineSub || r.reviewerSub === f.mineSub)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}
