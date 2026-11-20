/**
 * The register of endorsed models, expiry and renewals. Expiry state is computed on read from expiresAt; the
 * register also cross-checks each approval against the append-only decision trail.
 */
import { latestBy, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { DAY, formatDate, isHttpUrl, toCsv, toMs, tokens } from '@x10/shared/lib';

import { rules } from '../config/rules';
import type { EndorsementEvent, EndorsementRequest, Schema } from '../model';
import { addMonths, daysUntil } from './dates';
import { checkIntegrity } from './integrity';
import { isOpen, listAdminSubs, listRequests, modelKey } from './requests';
import { recordEvent } from './workflow';

type ExpiryRules = { renewalDueDays: number };

export type ExpiryKind = 'none' | 'valid' | 'due' | 'expired';

export interface ExpiryState {
  kind: ExpiryKind;
  /** Days until expiry (negative once expired); null when there is no expiry. */
  days: number | null;
}

/** Rule 5: "renewal due" within `renewalDueDays` of expiry, "expired" once past it. Promoted never expires. */
export function expiryState(req: Pick<EndorsementRequest, 'expiresAt'>, now: Date, r: ExpiryRules = rules): ExpiryState {
  if (!req.expiresAt) return { kind: 'none', days: null };
  const left = toMs(req.expiresAt) - now.getTime();
  const days = daysUntil(req.expiresAt, now);
  if (left <= 0) return { kind: 'expired', days };
  if (left <= r.renewalDueDays * DAY) return { kind: 'due', days };
  return { kind: 'valid', days };
}

export function expiryLabel(s: ExpiryState, expiresAt: string | null): string {
  switch (s.kind) {
    case 'none':
      return 'No expiry';
    case 'expired':
      return s.days === 0 ? 'Expired today' : `Expired ${Math.abs(s.days ?? 0)} d ago`;
    case 'due':
      return `Renewal due · ${s.days} d left`;
    default:
      return `Valid to ${formatDate(expiresAt)}`;
  }
}

export interface Verification {
  ok: boolean;
  reason: string | null;
}

/**
 * Check an approved request against its decision trail. Events are append-only and stamped with the author's sub,
 * and Person.isAdmin can only be set with SQL, so a row edited directly through the API shows up here.
 */
export function verifyApproval(
  req: EndorsementRequest,
  events: EndorsementEvent[],
  adminSubs: ReadonlySet<string>,
  months: number = rules.certifiedValidityMonths,
): Verification {
  const approvals = events.filter((e) => e.requestId === req.id && e.type === 'approved');
  if (!approvals.length) return { ok: false, reason: 'No approval in the decision trail.' };
  const ev = approvals.reduce((a, b) => (b.at >= a.at ? b : a));
  if (ev.bySub === req.ownerSub) return { ok: false, reason: 'Approved by its own owner.' };
  if (!adminSubs.has(ev.bySub)) return { ok: false, reason: 'Approved by someone who is not a reviewer.' };
  if (req.reviewerSub && ev.bySub !== req.reviewerSub) return { ok: false, reason: 'The approval does not match the claiming reviewer.' };
  const integrity = checkIntegrity(req, events, adminSubs);
  if (!integrity.ok) return { ok: false, reason: integrity.issues[0] };
  if (req.requestedLevel === 'certified') {
    if (!req.expiresAt) return { ok: false, reason: 'A certified approval has no expiry.' };
    if (toMs(req.expiresAt) > toMs(addMonths(ev.at, months)) + DAY)
      return { ok: false, reason: 'The expiry is later than the approval allows.' };
  }
  return { ok: true, reason: null };
}

export interface RegisterEntry {
  request: EndorsementRequest;
  expiry: ExpiryState;
  verification: Verification;
}

/** Approved models, newest approval per model and workspace (a renewal supersedes the old approval). */
export function latestApprovals(requests: EndorsementRequest[]): EndorsementRequest[] {
  return latestBy(
    requests.filter((r) => r.status === 'approved'),
    modelKey,
    (r) => r.decidedAt ?? r.submittedAt,
  );
}

export function registerEntries(
  requests: EndorsementRequest[],
  events: EndorsementEvent[],
  people: Pick<Person, 'sub' | 'isAdmin'>[],
  now: Date,
  r: ExpiryRules = rules,
): RegisterEntry[] {
  const admins = new Set(people.filter((p) => p.isAdmin === true).map((p) => p.sub));
  return latestApprovals(requests)
    .map((request) => ({ request, expiry: expiryState(request, now, r), verification: verifyApproval(request, events, admins) }))
    .sort((a, b) => a.request.modelName.localeCompare(b.request.modelName));
}

/** Every search word must appear in the model, workspace, owner or reviewer. */
export function searchRegister(entries: RegisterEntry[], query: string): RegisterEntry[] {
  const words = tokens(query);
  if (!words.length) return entries;
  return entries.filter(({ request: q }) => {
    const hay = tokens([q.modelName, q.workspace, q.ownerName, q.reviewerName ?? ''].join(' ')).join(' ');
    return words.every((w) => hay.includes(w));
  });
}

const EXPIRY_WORDS: Record<ExpiryKind, string> = { none: 'no expiry', valid: 'valid', due: 'renewal due', expired: 'expired' };

export function registerCsv(entries: RegisterEntry[]): string {
  return toCsv(
    ['Model', 'Workspace', 'Level', 'Owner', 'Reviewer', 'Decided (UTC)', 'Expires (UTC)', 'Expiry status', 'Trail check', 'Model link'],
    entries.map(({ request: q, expiry, verification }) => [
      q.modelName,
      q.workspace,
      q.requestedLevel,
      q.ownerName,
      q.reviewerName ?? '',
      q.decidedAt ?? '',
      q.expiresAt ?? '',
      EXPIRY_WORDS[expiry.kind],
      verification.ok ? 'ok' : `check: ${verification.reason}`,
      q.modelUrl && isHttpUrl(q.modelUrl) ? q.modelUrl : '',
    ]),
  );
}

export interface RenewalRow {
  request: EndorsementRequest;
  expiry: ExpiryState;
  /** An open request for the same model submitted after this approval (the renewal in progress). */
  renewal: EndorsementRequest | null;
}

/** Certified models whose latest approval expires within the window, or has expired, soonest first. */
export function renewalRows(
  requests: EndorsementRequest[],
  now: Date,
  r: { renewalDueDays: number; renewalsWindowDays: number } = rules,
): RenewalRow[] {
  const horizon = now.getTime() + r.renewalsWindowDays * DAY;
  return latestApprovals(requests)
    .filter((q) => q.requestedLevel === 'certified' && q.expiresAt && toMs(q.expiresAt) <= horizon)
    .map((q) => ({
      request: q,
      expiry: expiryState(q, now, r),
      renewal:
        requests.find(
          (x) => x.id !== q.id && isOpen(x.status) && modelKey(x) === modelKey(q) && x.submittedAt >= (q.decidedAt ?? q.submittedAt),
        ) ?? null,
    }))
    .sort((a, b) => (a.request.expiresAt ?? '').localeCompare(b.request.expiresAt ?? ''));
}

/**
 * Rule 5: the first time an admin opens Renewals after a model's renewal date has passed (due or expired), write
 * one renewal_due event for that approval. Idempotent: a request that already has one written by an admin is
 * skipped. Events written by anyone else (any signed-in user can append events in their own name through the API)
 * do not count, so they cannot suppress the real one. Returns the number of events written. Non-admin visits write
 * nothing.
 */
export async function ensureRenewalDueEvents(
  store: DataStore<Schema>,
  me: Person,
  now = new Date(),
  r: ExpiryRules = rules,
): Promise<number> {
  if (me.isAdmin !== true) return 0;
  const [requests, existing, admins] = await Promise.all([
    listRequests(store),
    store.repo('EndorsementEvent').list({ where: { type: 'renewal_due' } }),
    listAdminSubs(store),
  ]);
  const done = new Set(existing.filter((e) => admins.has(e.bySub)).map((e) => e.requestId));
  let written = 0;
  for (const q of latestApprovals(requests)) {
    if (done.has(q.id)) continue;
    const s = expiryState(q, now, r);
    if (s.kind !== 'due' && s.kind !== 'expired') continue;
    const note =
      s.kind === 'expired'
        ? `Certification expired on ${q.expiresAt?.slice(0, 10)}. Start a renewal to keep it in the register as current.`
        : `Certification expires on ${q.expiresAt?.slice(0, 10)}. Renewal is due.`;
    await recordEvent(store, me, q.id, 'renewal_due', note, now);
    done.add(q.id);
    written++;
  }
  return written;
}

/* ------------------------------------------------------------------ loaders */

export async function loadRegister(store: DataStore<Schema>, now = new Date()): Promise<RegisterEntry[]> {
  const [requests, events, people] = await Promise.all([
    listRequests(store),
    store.repo('EndorsementEvent').list(),
    store.repo('Person').list(),
  ]);
  return registerEntries(requests, events, people, now);
}

export async function loadRenewals(
  store: DataStore<Schema>,
  me: Person,
  now = new Date(),
): Promise<{ rows: RenewalRow[]; eventsWritten: number }> {
  const eventsWritten = await ensureRenewalDueEvents(store, me, now);
  return { rows: renewalRows(await listRequests(store), now), eventsWritten };
}
