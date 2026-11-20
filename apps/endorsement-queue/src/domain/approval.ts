/**
 * Checklist evaluation: which answers count, whether a request can be approved, and per-answer validation.
 * Everything here is pure.
 */
import { latestBy } from '@x10/shared/data';

import { getChecklist, neededItems, type ChecklistItem } from '../config/checklist';
import { limits, type ChecklistAnswer, type EndorsementRequest, type Level, type Result, type Stage } from '../model';

export interface AnswerValue {
  result: Result;
  evidence: string | null;
  answeredByName?: string;
  answeredAt?: string;
}

/** Current answer per item key. A missing key means "not answered". */
export type AnswerMap = Record<string, AnswerValue>;

type RequestLike = Pick<
  EndorsementRequest,
  'id' | 'ownerSub' | 'requestedLevel' | 'checklistVersion' | 'reviewerSub' | 'lastResubmittedAt'
>;

/**
 * The current answers of one stage for a request.
 * - Latest row per item wins (answers are append-only).
 * - Self answers count only when written by the owner, review answers only when written by the claiming reviewer
 *   (anyone can append rows stamped with their own sub; those are ignored).
 * - After a resubmission, review answers that were "fail" before it are cleared (the owner has reworked them);
 *   pass and n/a answers are kept, so the reviewer only re-checks what failed.
 */
export function currentAnswers(request: RequestLike, answers: ChecklistAnswer[], stage: Stage): AnswerMap {
  const rows = answers.filter(
    (a) =>
      a.requestId === request.id &&
      a.stage === stage &&
      (stage === 'self'
        ? a.answeredBySub === request.ownerSub
        : request.reviewerSub !== null && a.answeredBySub === request.reviewerSub),
  );
  const latest = latestBy(rows, (a) => a.itemKey, (a) => a.answeredAt);
  const out: AnswerMap = {};
  for (const a of latest) {
    if (
      stage === 'review' &&
      a.result === 'fail' &&
      request.lastResubmittedAt &&
      a.answeredAt <= request.lastResubmittedAt
    ) {
      continue;
    }
    out[a.itemKey] = { result: a.result, evidence: a.evidence, answeredByName: a.answeredByName, answeredAt: a.answeredAt };
  }
  return out;
}

export interface ApprovalCheck {
  ok: boolean;
  /** Needed items with no current answer. */
  unanswered: string[];
  failing: string[];
  /** n/a on an item that does not allow it. */
  naNotAllowed: string[];
  /** n/a without the evidence text that explains it. */
  naWithoutEvidence: string[];
}

const hasText = (s: string | null | undefined) => !!s && s.trim().length > 0;

/** Judge a set of answers against the items a level needs in a checklist version. */
export function evaluateAnswers(level: Level, version: number, map: AnswerMap): ApprovalCheck {
  const check: ApprovalCheck = { ok: false, unanswered: [], failing: [], naNotAllowed: [], naWithoutEvidence: [] };
  for (const item of neededItems(level, version)) {
    const a = map[item.key];
    if (!a) check.unanswered.push(item.key);
    else if (a.result === 'fail') check.failing.push(item.key);
    else if (a.result === 'na') {
      if (!item.naAllowed) check.naNotAllowed.push(item.key);
      else if (!hasText(a.evidence)) check.naWithoutEvidence.push(item.key);
    }
  }
  check.ok =
    check.unanswered.length + check.failing.length + check.naNotAllowed.length + check.naWithoutEvidence.length === 0;
  return check;
}

/** The reviewer's current answers judged against the request's level and checklist version. */
export function approvalCheck(request: RequestLike, answers: ChecklistAnswer[]): ApprovalCheck {
  return evaluateAnswers(
    request.requestedLevel,
    request.checklistVersion,
    currentAnswers(request, answers, 'review'),
  );
}

/**
 * Rule 1: approve only when every item the level needs is "pass", or "n/a" where the item allows it (rls, label,
 * tests) and evidence text explains why. Only the claiming reviewer's current answers count.
 */
export function canApprove(request: RequestLike, answers: ChecklistAnswer[]): boolean {
  return approvalCheck(request, answers).ok;
}

/** Plain-language reasons why a check is not ok, using the item labels of the request's checklist version. */
export function describeCheck(check: ApprovalCheck, version: number): string[] {
  const label = (k: string) => getChecklist(version).items.find((i) => i.key === k)?.label ?? k;
  const list = (keys: string[]) => keys.map(label).join(', ');
  const out: string[] = [];
  if (check.unanswered.length) out.push(`Not reviewed yet: ${list(check.unanswered)}.`);
  if (check.failing.length) out.push(`Failing: ${list(check.failing)}.`);
  if (check.naNotAllowed.length) out.push(`N/A is not allowed for: ${list(check.naNotAllowed)}.`);
  if (check.naWithoutEvidence.length) out.push(`N/A needs evidence text for: ${list(check.naWithoutEvidence)}.`);
  return out;
}

/** Validate one answer before it is saved. Returns a message or null. */
export function validateAnswer(item: ChecklistItem, result: Result | null | undefined, evidence: string | null): string | null {
  if (!result) return item.naAllowed ? 'Choose Pass, Fail or N/A.' : 'Choose Pass or Fail.';
  if (result === 'na' && !item.naAllowed) return `N/A is not allowed for "${item.label}".`;
  if (result === 'na' && !hasText(evidence)) return 'Say why this item does not apply (evidence is required for N/A).';
  if ((evidence ?? '').trim().length > limits.evidence.max)
    return `Evidence must be ${limits.evidence.max} characters or fewer.`;
  return null;
}
