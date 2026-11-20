import { CHECKLISTS, CURRENT_CHECKLIST_VERSION, getChecklist, neededItems } from '../config/checklist';
import type { ChecklistAnswer, EndorsementRequest, Level, Result } from '../model';
import { approvalCheck, canApprove, currentAnswers, describeCheck, evaluateAnswers, validateAnswer } from './approval';

const REVIEWER = 'rev-1';
const OWNER = 'own-1';

function req(level: Level, over: Partial<EndorsementRequest> = {}): EndorsementRequest {
  return {
    id: 'r1',
    modelName: 'Model',
    workspace: 'WS',
    modelUrl: null,
    ownerSub: OWNER,
    ownerName: 'Owner',
    requestedLevel: level,
    justification: 'Because it matters.',
    status: 'in_review',
    reviewerSub: REVIEWER,
    reviewerName: 'Reviewer',
    submittedAt: '2026-11-01T00:00:00.000Z',
    decidedAt: null,
    expiresAt: null,
    lastResubmittedAt: null,
    checklistVersion: CURRENT_CHECKLIST_VERSION,
    renewalOfId: null,
    ...over,
  };
}

let n = 0;
function ans(itemKey: string, result: Result, over: Partial<ChecklistAnswer> = {}): ChecklistAnswer {
  n++;
  return {
    id: `a${n}`,
    requestId: 'r1',
    itemKey,
    stage: 'review',
    result,
    evidence: null,
    answeredBySub: REVIEWER,
    answeredByName: 'Reviewer',
    answeredAt: new Date(Date.UTC(2026, 10, 10) + n * 1000).toISOString(),
    ...over,
  };
}

const allPass = (level: Level, version = CURRENT_CHECKLIST_VERSION) =>
  neededItems(level, version).map((i) => ans(i.key, 'pass'));

describe('checklist config', () => {
  it('has the spec items and levels in the current version', () => {
    const v = getChecklist(CURRENT_CHECKLIST_VERSION);
    expect(v.items.map((i) => i.key)).toEqual(['owner', 'description', 'refresh', 'naming', 'rls', 'measures', 'tests', 'lineage', 'label', 'cleanup']);
    expect(neededItems('promoted', 2).map((i) => i.key)).toEqual(['owner', 'description', 'refresh', 'naming']);
    expect(neededItems('certified', 2)).toHaveLength(10);
    expect(v.items.filter((i) => i.naAllowed).map((i) => i.key).sort()).toEqual(['label', 'rls', 'tests']);
  });

  it('keeps old versions and falls back to the current one for unknown versions', () => {
    expect(getChecklist(1)).toBe(CHECKLISTS[1]);
    expect(neededItems('certified', 1)).toHaveLength(8);
    expect(getChecklist(99).version).toBe(CURRENT_CHECKLIST_VERSION);
  });
});

describe('canApprove: promoted', () => {
  it('is true when the four promoted items pass', () => {
    expect(canApprove(req('promoted'), allPass('promoted'))).toBe(true);
  });

  it('ignores certified-only items', () => {
    const answers = [...allPass('promoted'), ans('tests', 'fail')];
    expect(canApprove(req('promoted'), answers)).toBe(true);
  });

  it('is false when an item fails or is missing', () => {
    const fail = allPass('promoted').map((a) => (a.itemKey === 'refresh' ? { ...a, result: 'fail' as const } : a));
    expect(canApprove(req('promoted'), fail)).toBe(false);
    expect(canApprove(req('promoted'), allPass('promoted').slice(1))).toBe(false);
  });

  it('rejects n/a on items that do not allow it, even with evidence', () => {
    const answers = allPass('promoted').map((a) =>
      a.itemKey === 'description' ? { ...a, result: 'na' as const, evidence: 'Not relevant' } : a,
    );
    const check = approvalCheck(req('promoted'), answers);
    expect(check.ok).toBe(false);
    expect(check.naNotAllowed).toEqual(['description']);
  });
});

describe('canApprove: certified', () => {
  it('is true when all ten items pass', () => {
    expect(canApprove(req('certified'), allPass('certified'))).toBe(true);
  });

  it('is false with only the promoted items', () => {
    const check = approvalCheck(req('certified'), allPass('promoted'));
    expect(check.ok).toBe(false);
    expect(check.unanswered).toEqual(['rls', 'measures', 'tests', 'lineage', 'label', 'cleanup']);
  });

  it.each(['rls', 'label', 'tests'])('allows n/a on %s with evidence text', (key) => {
    const answers = [...allPass('certified'), ans(key, 'na', { evidence: 'No personal data in this model.' })];
    expect(canApprove(req('certified'), answers)).toBe(true);
  });

  it.each(['rls', 'label', 'tests'])('refuses n/a on %s without evidence (blank counts as none)', (key) => {
    const answers = [...allPass('certified'), ans(key, 'na', { evidence: '   ' })];
    const check = approvalCheck(req('certified'), answers);
    expect(check.ok).toBe(false);
    expect(check.naWithoutEvidence).toEqual([key]);
  });

  it.each(['owner', 'description', 'refresh', 'naming', 'measures', 'lineage', 'cleanup'])('refuses n/a on %s', (key) => {
    const answers = [...allPass('certified'), ans(key, 'na', { evidence: 'Explained' })];
    expect(canApprove(req('certified'), answers)).toBe(false);
  });

  it('judges an old request against its own checklist version', () => {
    const v1 = req('certified', { checklistVersion: 1 });
    expect(canApprove(v1, allPass('certified', 1))).toBe(true);
    // The same eight answers are not enough for a version 2 request (lineage and cleanup are new).
    expect(approvalCheck(req('certified'), allPass('certified', 1)).unanswered).toEqual(['lineage', 'cleanup']);
  });
});

describe('which answers count', () => {
  it('counts only the claiming reviewer and only the latest answer per item', () => {
    const answers = [
      ...allPass('promoted'),
      ans('naming', 'fail', { answeredBySub: 'someone-else' }),
      ans('owner', 'pass', { stage: 'self', result: 'fail' }),
    ];
    expect(canApprove(req('promoted'), answers)).toBe(true);
    const later = ans('naming', 'fail', { answeredAt: '2026-11-11T00:00:00.000Z' });
    expect(canApprove(req('promoted'), [...answers, later])).toBe(false);
  });

  it('counts nothing when no reviewer has claimed it', () => {
    expect(canApprove(req('promoted', { reviewerSub: null }), allPass('promoted'))).toBe(false);
  });

  it('clears failed review answers made before a resubmission and keeps the rest', () => {
    const answers = [
      ans('owner', 'pass', { answeredAt: '2026-11-05T00:00:00.000Z' }),
      ans('description', 'fail', { answeredAt: '2026-11-05T00:00:00.000Z' }),
      ans('refresh', 'pass', { answeredAt: '2026-11-05T00:00:00.000Z' }),
      ans('naming', 'pass', { answeredAt: '2026-11-05T00:00:00.000Z' }),
    ];
    const r = req('promoted', { lastResubmittedAt: '2026-11-06T00:00:00.000Z' });
    const map = currentAnswers(r, answers, 'review');
    expect(Object.keys(map).sort()).toEqual(['naming', 'owner', 'refresh']);
    expect(approvalCheck(r, answers).unanswered).toEqual(['description']);
    const fixed = ans('description', 'pass', { answeredAt: '2026-11-07T00:00:00.000Z' });
    expect(canApprove(r, [...answers, fixed])).toBe(true);
  });

  it('keeps a fail given after the resubmission', () => {
    const r = req('promoted', { lastResubmittedAt: '2026-11-06T00:00:00.000Z' });
    const again = ans('description', 'fail', { answeredAt: '2026-11-07T00:00:00.000Z' });
    expect(currentAnswers(r, [again], 'review').description.result).toBe('fail');
  });
});

describe('evaluateAnswers, describeCheck and validateAnswer', () => {
  it('describes what blocks approval with item labels', () => {
    const check = evaluateAnswers('certified', 2, { owner: { result: 'fail', evidence: null }, rls: { result: 'na', evidence: '' } });
    const lines = describeCheck(check, 2);
    expect(lines[0]).toMatch(/^Not reviewed yet: Descriptions/);
    expect(lines).toContain('Failing: Owner and backup.');
    expect(lines).toContain('N/A needs evidence text for: Row-level security.');
  });

  it('validates one answer', () => {
    const rls = getChecklist(2).items.find((i) => i.key === 'rls')!;
    const naming = getChecklist(2).items.find((i) => i.key === 'naming')!;
    expect(validateAnswer(rls, null, null)).toMatch(/Pass, Fail or N\/A/);
    expect(validateAnswer(naming, null, null)).toBe('Choose Pass or Fail.');
    expect(validateAnswer(naming, 'na', 'why')).toMatch(/not allowed/);
    expect(validateAnswer(rls, 'na', '')).toMatch(/evidence is required/);
    expect(validateAnswer(rls, 'na', 'No RLS needed: aggregates only.')).toBeNull();
    expect(validateAnswer(rls, 'pass', 'x'.repeat(301))).toMatch(/300 characters/);
    expect(validateAnswer(rls, 'fail', '')).toBeNull();
  });
});
