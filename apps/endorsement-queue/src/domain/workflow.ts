/**
 * The endorsement workflow: the status machine, who may do what, and every write that changes a request.
 * Every status transition writes exactly one EndorsementEvent, so the trail always shows each step in order.
 *
 * Admin-only rules (claiming and deciding) live here because the database has no admin claim; see policies.ts for
 * what the database itself enforces.
 */
import { PermissionError, RuleError, type CreateInput, type DataStore, type UpdateInput } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { checkText } from '@x10/shared/lib';

import { CURRENT_CHECKLIST_VERSION, getChecklist, neededItems } from '../config/checklist';
import { rules } from '../config/rules';
import {
  limits,
  type ChecklistAnswer,
  type EndorsementEvent,
  type EndorsementRequest,
  type EventType,
  type Level,
  type Result,
  type Schema,
  type Stage,
  type Status,
} from '../model';
import { approvalCheck, currentAnswers, describeCheck, validateAnswer } from './approval';
import { addMonths } from './dates';
import { checkIntegrity, validEvents } from './integrity';
import {
  DuplicateRequestError,
  findOpenDuplicate,
  getRequest,
  isOpen,
  listAdminSubs,
  listAnswers,
  listEvents,
  listRequests,
  validateRequestInput,
  type RequestInput,
} from './requests';

/* ------------------------------------------------------------------ status machine */

export type Action = 'claim' | 'request_changes' | 'resubmit' | 'approve' | 'reject' | 'withdraw';
export type Decision = 'approve' | 'request_changes' | 'reject';

export const TRANSITIONS: Readonly<Record<Action, { from: readonly Status[]; to: Status; event: EventType }>> = {
  claim: { from: ['submitted'], to: 'in_review', event: 'claimed' },
  request_changes: { from: ['in_review'], to: 'changes_requested', event: 'changes_requested' },
  // A resubmission goes straight back to the reviewer who asked for the changes.
  resubmit: { from: ['changes_requested'], to: 'in_review', event: 'resubmitted' },
  approve: { from: ['in_review'], to: 'approved', event: 'approved' },
  reject: { from: ['in_review'], to: 'rejected', event: 'rejected' },
  withdraw: { from: ['submitted', 'in_review', 'changes_requested'], to: 'withdrawn', event: 'withdrawn' },
};

const STATUS_WORDS: Record<Status, string> = {
  submitted: 'waiting for a reviewer',
  in_review: 'in review',
  changes_requested: 'waiting for the owner',
  approved: 'approved',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
};

/** The status after `action`, or a RuleError when the action is not allowed from `status`. */
export function nextStatus(status: Status, action: Action): Status {
  const t = TRANSITIONS[action];
  if (!t.from.includes(status)) {
    throw new RuleError(`This request is ${STATUS_WORDS[status]}, so it cannot be ${actionPast(action)} now.`);
  }
  return t.to;
}

function actionPast(a: Action): string {
  return { claim: 'claimed', request_changes: 'sent back', resubmit: 'resubmitted', approve: 'approved', reject: 'rejected', withdraw: 'withdrawn' }[a];
}

/** Expiry for an approval: certified expires after the configured months, promoted never. */
export function expiryFor(level: Level, decidedAt: string, months: number = rules.certifiedValidityMonths): string | null {
  return level === 'certified' ? addMonths(decidedAt, months) : null;
}

/* ------------------------------------------------------------------ who may do what (pure) */

type Viewer = Pick<Person, 'sub' | 'isAdmin'>;
type Req = Pick<EndorsementRequest, 'status' | 'ownerSub' | 'reviewerSub' | 'reviewerName'>;

/** Why the viewer cannot claim the request, or null when they can (rule 2: the reviewer is never the owner). */
export function claimBlocker(req: Req, me: Viewer): string | null {
  if (me.isAdmin !== true) return 'Only reviewers can claim requests.';
  if (req.ownerSub === me.sub) return 'You own this request, so another reviewer must review it.';
  if (req.status !== 'submitted') return `This request is ${STATUS_WORDS[req.status]}, so it cannot be claimed.`;
  return null;
}

/** Why the viewer cannot review or decide the request, or null when they can (only the claiming reviewer decides). */
export function decideBlocker(req: Req, me: Viewer): string | null {
  if (me.isAdmin !== true) return 'Only reviewers can decide requests.';
  if (req.ownerSub === me.sub) return 'You own this request, so another reviewer must decide it.';
  if (req.status !== 'in_review') return `This request is ${STATUS_WORDS[req.status]}, so it cannot be decided now.`;
  if (req.reviewerSub !== me.sub) return `Only ${req.reviewerName ?? 'the reviewer who claimed it'} can decide this request.`;
  return null;
}

export function ownerBlocker(req: Req, me: Viewer, what: string): string | null {
  return req.ownerSub === me.sub ? null : `Only the owner can ${what}.`;
}

/** Actions the viewer can take on the request right now (drives which buttons show). */
export function availableActions(req: Req, me: Viewer): Action[] {
  const out: Action[] = [];
  if (!claimBlocker(req, me)) out.push('claim');
  if (!decideBlocker(req, me)) out.push('approve', 'request_changes', 'reject');
  if (req.ownerSub === me.sub && req.status === 'changes_requested') out.push('resubmit');
  if (req.ownerSub === me.sub && isOpen(req.status)) out.push('withdraw');
  return out;
}

/* ------------------------------------------------------------------ writes */

function deny(reason: string | null) {
  if (reason) throw new PermissionError(reason);
}

const cleanNote = (note: string | null | undefined) => {
  const v = (note ?? '').trim();
  return v ? v : null;
};

function checkNote(note: string | null | undefined, required: boolean, label = 'Note') {
  const msg = checkText(note, { ...(required ? limits.decisionNote : limits.note), optional: !required, label });
  if (msg) throw new RuleError(msg);
}

/** Append one event to the trail, stamped with the actor. */
export async function recordEvent(
  store: DataStore<Schema>,
  me: Person,
  requestId: string,
  type: EventType,
  note: string | null,
  now: Date,
): Promise<EndorsementEvent> {
  return store.repo('EndorsementEvent').create({
    requestId,
    type,
    bySub: me.sub,
    byName: me.displayName,
    note: cleanNote(note),
    at: now.toISOString(),
  });
}

export interface AnswerInput {
  itemKey: string;
  result: Result | null;
  evidence: string;
}

/** Validate answers for the items a level needs. Returns messages keyed by item. */
export function validateAnswers(level: Level, version: number, answers: AnswerInput[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of neededItems(level, version)) {
    const a = answers.find((x) => x.itemKey === item.key);
    const msg = validateAnswer(item, a?.result, a?.evidence ?? null);
    if (msg) out[item.key] = msg;
  }
  return out;
}

async function appendAnswers(
  store: DataStore<Schema>,
  me: Person,
  requestId: string,
  stage: Stage,
  answers: AnswerInput[],
  now: Date,
) {
  for (const a of answers) {
    if (!a.result) continue;
    await store.repo('ChecklistAnswer').create({
      requestId,
      itemKey: a.itemKey,
      stage,
      result: a.result,
      evidence: cleanNote(a.evidence),
      answeredBySub: me.sub,
      answeredByName: me.displayName,
      answeredAt: now.toISOString(),
    });
  }
}

/**
 * Submit a new request as the viewer, with a self-assessment for every item the level needs.
 * Blocks a duplicate when an open request exists for the same model and workspace.
 */
export async function submitRequest(
  store: DataStore<Schema>,
  me: Person,
  input: RequestInput,
  selfAnswers: AnswerInput[],
  opts: { renewalOfId?: string | null; now?: Date } = {},
): Promise<EndorsementRequest> {
  const now = opts.now ?? new Date();
  const errors = validateRequestInput(input);
  const first = Object.values(errors)[0];
  if (first) throw new RuleError(first);
  const level = input.requestedLevel as Level;
  const answerErrors = validateAnswers(level, CURRENT_CHECKLIST_VERSION, selfAnswers);
  if (Object.keys(answerErrors).length) throw new RuleError('Answer every checklist item (N/A needs evidence).');

  const dup = findOpenDuplicate(await listRequests(store), input);
  if (dup) throw new DuplicateRequestError(dup);

  // Optional and reviewer-only fields are left out entirely: the create permission excludes them.
  const row = {
    modelName: input.modelName.trim(),
    workspace: input.workspace.trim(),
    ...(input.modelUrl.trim() ? { modelUrl: input.modelUrl.trim() } : {}),
    ownerSub: me.sub,
    ownerName: me.displayName,
    requestedLevel: level,
    justification: input.justification.trim(),
    status: 'submitted' as const,
    submittedAt: now.toISOString(),
    checklistVersion: CURRENT_CHECKLIST_VERSION,
    ...(opts.renewalOfId ? { renewalOfId: opts.renewalOfId } : {}),
  };
  const created = await store.repo('EndorsementRequest').create(row as CreateInput<EndorsementRequest>);
  const needed = new Set(neededItems(level, CURRENT_CHECKLIST_VERSION).map((i) => i.key));
  await appendAnswers(store, me, created.id, 'self', selfAnswers.filter((a) => needed.has(a.itemKey)), now);
  await recordEvent(store, me, created.id, 'submitted', opts.renewalOfId ? 'Renewal request.' : null, now);
  return created;
}

/** Refuse to claim or decide a request whose row does not match its trail (changed outside the app). */
async function assertConsistent(store: DataStore<Schema>, req: EndorsementRequest) {
  const [events, admins] = await Promise.all([listEvents(store, req.id), listAdminSubs(store)]);
  const integrity = checkIntegrity(req, events, admins);
  if (!integrity.ok) {
    throw new RuleError(`This request's record does not match its decision trail, so it cannot be reviewed in the app. ${integrity.issues[0]}`);
  }
}

async function transition(
  store: DataStore<Schema>,
  me: Person,
  req: EndorsementRequest,
  action: Action,
  patch: UpdateInput<EndorsementRequest>,
  note: string | null,
  now: Date,
): Promise<EndorsementRequest> {
  const to = nextStatus(req.status, action);
  const updated = await store.repo('EndorsementRequest').update(req.id, { ...patch, status: to });
  await recordEvent(store, me, req.id, TRANSITIONS[action].event, note, now);
  return updated;
}

/** A reviewer takes a submitted request (it becomes in_review, and only they can decide it). */
export async function claimRequest(store: DataStore<Schema>, me: Person, id: string, now = new Date()) {
  const req = await getRequest(store, id);
  deny(claimBlocker(req, me));
  await assertConsistent(store, req);
  return transition(store, me, req, 'claim', { reviewerSub: me.sub, reviewerName: me.displayName }, null, now);
}

/** The claiming reviewer saves checklist results. Only changed answers are appended. */
export async function saveReview(
  store: DataStore<Schema>,
  me: Person,
  id: string,
  entries: AnswerInput[],
  now = new Date(),
): Promise<number> {
  const req = await getRequest(store, id);
  deny(decideBlocker(req, me));
  await assertConsistent(store, req);
  const items = neededItems(req.requestedLevel, req.checklistVersion);
  for (const e of entries) {
    if (!e.result) continue;
    const item = items.find((i) => i.key === e.itemKey);
    if (!item) throw new RuleError(`"${e.itemKey}" is not on this request's checklist.`);
    const msg = validateAnswer(item, e.result, e.evidence);
    if (msg) throw new RuleError(`${item.label}: ${msg}`);
  }
  const current = currentAnswers(req, await listAnswers(store, id), 'review');
  const changed = entries.filter((e) => {
    if (!e.result) return false;
    const c = current[e.itemKey];
    return !c || c.result !== e.result || (c.evidence ?? '') !== e.evidence.trim();
  });
  await appendAnswers(store, me, id, 'review', changed, now);
  return changed.length;
}

/**
 * The claiming reviewer decides. Every needed item must be passed or failed first (rule 6), approval needs
 * canApprove (rule 1), and each decision needs a note. Approving certified sets the expiry (rule 4).
 */
export async function decideRequest(
  store: DataStore<Schema>,
  me: Person,
  id: string,
  decision: Decision,
  note: string,
  now = new Date(),
): Promise<EndorsementRequest> {
  const req = await getRequest(store, id);
  deny(decideBlocker(req, me));
  await assertConsistent(store, req);
  checkNote(note, true, 'Decision note');
  const check = approvalCheck(req, await listAnswers(store, id));
  if (check.unanswered.length)
    throw new RuleError(`Pass or fail every item before deciding. ${describeCheck(check, req.checklistVersion)[0]}`);
  if (decision === 'approve' && !check.ok) throw new RuleError(`Cannot approve yet. ${describeCheck(check, req.checklistVersion).join(' ')}`);
  const decidedAt = now.toISOString();
  const patch: UpdateInput<EndorsementRequest> =
    decision === 'approve'
      ? { decidedAt, expiresAt: expiryFor(req.requestedLevel, decidedAt) }
      : decision === 'reject'
        ? { decidedAt }
        : {};
  return transition(store, me, req, decision, patch, note, now);
}

/**
 * The owner sends a changes_requested request back. Previous answers stay; the reviewer's failed answers are
 * cleared (see currentAnswers), and the owner may update their self-assessment for any item.
 */
export async function resubmitRequest(
  store: DataStore<Schema>,
  me: Person,
  id: string,
  input: { note: string; answers: AnswerInput[] },
  now = new Date(),
): Promise<EndorsementRequest> {
  const req = await getRequest(store, id);
  deny(ownerBlocker(req, me, 'resubmit this request'));
  nextStatus(req.status, 'resubmit');
  checkNote(input.note, true, 'What changed');
  const items = neededItems(req.requestedLevel, req.checklistVersion);
  for (const a of input.answers) {
    const item = items.find((i) => i.key === a.itemKey);
    if (!item) throw new RuleError(`"${a.itemKey}" is not on this request's checklist.`);
    const msg = validateAnswer(item, a.result, a.evidence);
    if (msg) throw new RuleError(`${item.label}: ${msg}`);
  }
  await appendAnswers(store, me, id, 'self', input.answers, now);
  return transition(store, me, req, 'resubmit', { lastResubmittedAt: now.toISOString() }, input.note, now);
}

/** The owner withdraws an open request. */
export async function withdrawRequest(store: DataStore<Schema>, me: Person, id: string, note: string, now = new Date()) {
  const req = await getRequest(store, id);
  deny(ownerBlocker(req, me, 'withdraw this request'));
  checkNote(note, false);
  return transition(store, me, req, 'withdraw', {}, note, now);
}

/* ------------------------------------------------------------------ read helpers */

/** Item keys the reviewer failed in the latest round (highlighted for the owner while changes are requested). */
export function failedItems(req: EndorsementRequest, answers: ChecklistAnswer[]): string[] {
  const review = currentAnswers(req, answers, 'review');
  return getChecklist(req.checklistVersion)
    .items.filter((i) => review[i.key]?.result === 'fail')
    .map((i) => i.key);
}

/** The latest note a reviewer left (claim, changes requested, decision), for the owner's list. Invalid events are ignored. */
export function latestReviewerComment(
  req: EndorsementRequest,
  events: EndorsementEvent[],
  adminSubs: ReadonlySet<string>,
): EndorsementEvent | null {
  const types: EventType[] = ['changes_requested', 'approved', 'rejected', 'claimed'];
  const mine = validEvents(req, events, adminSubs).filter((e) => types.includes(e.type) && e.note);
  return mine.length ? mine.reduce((a, b) => (b.at >= a.at ? b : a)) : null;
}
