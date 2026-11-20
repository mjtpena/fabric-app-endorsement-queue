/**
 * Consistency checks between a request row and its append-only trail (pure).
 *
 * The database stamps every event with its author and never lets anyone edit or delete one, but it cannot check
 * that the author is a reviewer (there is no admin claim), and an unclaimed "submitted" request row can be updated
 * by any signed-in user through the API. These checks catch both: events written by someone not allowed to write
 * them are not counted, and a row whose status does not match the trail is flagged and cannot be decided.
 */
import type { EndorsementEvent, EndorsementRequest, EventType, Status } from '../model';
import { STATUS_LABEL } from '../labels';

/** Events only the owner writes. */
export const OWNER_EVENTS: readonly EventType[] = ['submitted', 'resubmitted', 'withdrawn'];
/** Events only a reviewer (admin, never the owner) writes. */
export const REVIEWER_EVENTS: readonly EventType[] = ['claimed', 'changes_requested', 'approved', 'rejected', 'renewal_due'];
/** Decisions: only the claiming reviewer writes these. */
const DECISION_EVENTS: readonly EventType[] = ['changes_requested', 'approved', 'rejected'];

/** The status each transition event leads to. */
export const STATUS_AFTER: Readonly<Partial<Record<EventType, Status>>> = {
  submitted: 'submitted',
  claimed: 'in_review',
  changes_requested: 'changes_requested',
  resubmitted: 'in_review',
  approved: 'approved',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
};

type Req = Pick<EndorsementRequest, 'id' | 'ownerSub' | 'reviewerSub' | 'status'>;

/** Why an event does not count, or null when it is valid for this request. */
export function eventProblem(e: EndorsementEvent, req: Req, adminSubs: ReadonlySet<string>): string | null {
  if (e.requestId !== req.id) return 'Belongs to another request.';
  if (OWNER_EVENTS.includes(e.type) && e.bySub !== req.ownerSub) return 'Not written by the owner.';
  if (REVIEWER_EVENTS.includes(e.type)) {
    if (!adminSubs.has(e.bySub)) return 'Not written by a reviewer.';
    if (e.bySub === req.ownerSub) return 'Written by the owner, who cannot review their own request.';
    if (DECISION_EVENTS.includes(e.type) && e.bySub !== req.reviewerSub) return 'Not written by the claiming reviewer.';
  }
  return null;
}

/** Only the events that count, in their original order. */
export function validEvents(req: Req, events: EndorsementEvent[], adminSubs: ReadonlySet<string>): EndorsementEvent[] {
  return events.filter((e) => e.requestId === req.id && eventProblem(e, req, adminSubs) === null);
}

/** The status the valid trail leads to (null when the trail has no transition at all). */
export function trailStatus(req: Req, events: EndorsementEvent[], adminSubs: ReadonlySet<string>): Status | null {
  let status: Status | null = null;
  for (const e of [...validEvents(req, events, adminSubs)].sort((a, b) => a.at.localeCompare(b.at))) {
    status = STATUS_AFTER[e.type] ?? status;
  }
  return status;
}

export interface Integrity {
  ok: boolean;
  issues: string[];
  /** Event ids that are shown in the trail but not counted. */
  ignored: Set<string>;
}

export function checkIntegrity(req: Req, events: EndorsementEvent[], adminSubs: ReadonlySet<string>): Integrity {
  const issues: string[] = [];
  const ignored = new Set(
    events.filter((e) => e.requestId === req.id && eventProblem(e, req, adminSubs) !== null).map((e) => e.id),
  );
  if (ignored.size) {
    issues.push(`${ignored.size} trail ${ignored.size === 1 ? 'event was' : 'events were'} written by someone not allowed to and ${ignored.size === 1 ? 'is' : 'are'} not counted.`);
  }
  const expected = trailStatus(req, events, adminSubs);
  if (expected && expected !== req.status) {
    issues.push(`The status says "${STATUS_LABEL[req.status]}" but the trail says "${STATUS_LABEL[expected]}": the row was changed outside the app.`);
  }
  if (req.reviewerSub) {
    if (req.status === 'submitted') issues.push('A reviewer is recorded on a request nobody has claimed.');
    else if (!adminSubs.has(req.reviewerSub) || req.reviewerSub === req.ownerSub)
      issues.push('The recorded reviewer is not an eligible reviewer.');
  } else if (req.status !== 'submitted' && req.status !== 'withdrawn') {
    issues.push('No reviewer is recorded for a request that was reviewed.');
  }
  return { ok: issues.length === 0, issues, ignored };
}
