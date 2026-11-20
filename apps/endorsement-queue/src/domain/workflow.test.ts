import { PermissionError, RuleError, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { MINUTE } from '@x10/shared/lib';
import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas, PERSONA } from '../app.config';
import { neededItems } from '../config/checklist';
import { defs, STATUSES, type Schema, type Status } from '../model';
import { seed } from '../seed';
import { canApprove, currentAnswers } from './approval';
import { addMonths } from './dates';
import { policyStore } from './policyStore.testutil';
import { DuplicateRequestError, getRequestBundle, listRequests, type RequestInput } from './requests';
import {
  availableActions,
  claimBlocker,
  claimRequest,
  decideRequest,
  failedItems,
  latestReviewerComment,
  nextStatus,
  resubmitRequest,
  saveReview,
  submitRequest,
  TRANSITIONS,
  withdrawRequest,
  type Action,
  type AnswerInput,
} from './workflow';

const at = (minutes: number) => new Date(FIXED_NOW.getTime() + minutes * MINUTE);

async function setup() {
  const raw = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
  const people = await raw.repo('Person').list();
  const person = (sub: string) => people.find((p) => p.sub === sub)!;
  const alex = person(PERSONA.alex);
  const jordan = person(PERSONA.jordan);
  const sam = person(PERSONA.sam);
  const priya = person(PERSONA.priya);
  /** The store as the API would treat a call from `p` (row-level security mirrored). */
  const as = (p: Person): DataStore<Schema> => policyStore(raw, p.sub);
  const byName = async (name: string) => (await listRequests(raw)).find((r) => r.modelName === name)!;
  return { raw, alex, jordan, sam, priya, as, byName };
}

const allPass = (level: 'promoted' | 'certified', version = 2): AnswerInput[] =>
  neededItems(level, version).map((i) => ({ itemKey: i.key, result: 'pass', evidence: `Checked ${i.key}.` }));

const input = (over: Partial<RequestInput> = {}): RequestInput => ({
  modelName: 'Churn Model',
  workspace: 'Customer Insights',
  modelUrl: 'https://fabric.example.com/models/churn',
  requestedLevel: 'certified',
  justification: 'Used by the retention team every week.',
  ...over,
});

describe('status machine', () => {
  it('allows only the listed transitions', () => {
    const table: Record<Action, Status> = {
      claim: 'in_review',
      request_changes: 'changes_requested',
      resubmit: 'in_review',
      approve: 'approved',
      reject: 'rejected',
      withdraw: 'withdrawn',
    };
    for (const [action, to] of Object.entries(table) as [Action, Status][]) {
      for (const from of STATUSES) {
        if (TRANSITIONS[action].from.includes(from)) expect(nextStatus(from, action)).toBe(to);
        else expect(() => nextStatus(from, action)).toThrow(RuleError);
      }
    }
  });

  it('never leaves a final status', () => {
    for (const from of ['approved', 'rejected', 'withdrawn'] as Status[]) {
      for (const a of Object.keys(TRANSITIONS) as Action[]) expect(() => nextStatus(from, a)).toThrow(/cannot be/);
    }
  });
});

describe('reviewer claim rule', () => {
  it('a reviewer who owns the request cannot claim it (domain and UI rule)', async () => {
    const { alex, as, byName } = await setup();
    const own = await byName('Procurement Spend');
    expect(own.ownerSub).toBe(alex.sub);
    expect(claimBlocker(own, alex)).toMatch(/You own this request/);
    expect(availableActions(own, alex)).not.toContain('claim');
    await expect(claimRequest(as(alex), alex, own.id, at(1))).rejects.toThrow(PermissionError);
    expect((await byName('Procurement Spend')).status).toBe('submitted');
  });

  it('a non-admin cannot claim', async () => {
    const { priya, as, byName } = await setup();
    const r = await byName('Support Tickets');
    await expect(claimRequest(as(priya), priya, r.id, at(1))).rejects.toThrow(/Only reviewers/);
  });

  it('another reviewer claims it and becomes the only one who can decide', async () => {
    const { alex, jordan, as, byName, raw } = await setup();
    const r = await byName('Procurement Spend');
    const claimed = await claimRequest(as(jordan), jordan, r.id, at(1));
    expect(claimed.status).toBe('in_review');
    expect(claimed.reviewerSub).toBe(jordan.sub);
    await expect(claimRequest(as(alex), alex, r.id, at(2))).rejects.toThrow(PermissionError);
    // Alex is an admin but did not claim it (and owns it): no review, no decision.
    await expect(saveReview(as(alex), alex, r.id, allPass('certified'), at(3))).rejects.toThrow(PermissionError);
    await expect(decideRequest(as(alex), alex, r.id, 'approve', 'Looks fine', at(3))).rejects.toThrow(PermissionError);
    const { events } = await getRequestBundle(raw, r.id);
    expect(events.map((e) => e.type)).toEqual(['submitted', 'claimed']);
  });

  it('a second admin cannot decide a request claimed by the first', async () => {
    const { jordan, as, byName } = await setup();
    const r = await byName('Field Service Operations');
    expect(r.reviewerName).toBe('Alex Rivera');
    await expect(decideRequest(as(jordan), jordan, r.id, 'reject', 'Not mine to decide', at(1))).rejects.toThrow(/Only Alex Rivera/);
  });
});

describe('deciding', () => {
  it('needs every item reviewed, a note, and canApprove; certified approval expires 12 months later', async () => {
    const { alex, as, byName, raw } = await setup();
    const r = await byName('Field Service Operations');
    await expect(decideRequest(as(alex), alex, r.id, 'approve', 'Ship it', at(1))).rejects.toThrow(/Pass or fail every item/);
    await expect(decideRequest(as(alex), alex, r.id, 'reject', 'Not ready', at(1))).rejects.toThrow(/Pass or fail every item/);

    const answers = allPass('certified').map((a) => (a.itemKey === 'tests' ? { ...a, result: 'fail' as const } : a));
    // All ten count as changed: the four already reviewed had different evidence text.
    expect(await saveReview(as(alex), alex, r.id, answers, at(2))).toBe(10);
    await expect(decideRequest(as(alex), alex, r.id, 'approve', 'Ship it', at(3))).rejects.toThrow(/Cannot approve yet. Failing: Test suite passing/);

    await expect(saveReview(as(alex), alex, r.id, [{ itemKey: 'tests', result: 'na', evidence: '' }], at(4))).rejects.toThrow(
      /evidence is required/,
    );
    await saveReview(as(alex), alex, r.id, [{ itemKey: 'tests', result: 'na', evidence: 'Simple counts only; covered by row-count checks.' }], at(4));
    await expect(decideRequest(as(alex), alex, r.id, 'approve', '', at(5))).rejects.toThrow(/Decision note is required/);

    const approved = await decideRequest(as(alex), alex, r.id, 'approve', 'All items pass; tests n/a with evidence.', at(6));
    expect(approved.status).toBe('approved');
    expect(approved.decidedAt).toBe(at(6).toISOString());
    expect(approved.expiresAt).toBe(addMonths(at(6), 12));
    expect(approved.expiresAt?.slice(0, 10)).toBe('2027-11-20');
    const bundle = await getRequestBundle(raw, r.id);
    expect(canApprove(bundle.request, bundle.answers)).toBe(true);
    expect(bundle.events.map((e) => e.type)).toEqual(['submitted', 'claimed', 'approved']);
    expect(bundle.events.at(-1)!.note).toMatch(/All items pass/);
  });

  it('promoted approval has no expiry; reject records decidedAt', async () => {
    const { jordan, as, byName } = await setup();
    const r = await byName('Revenue Forecast');
    await saveReview(as(jordan), jordan, r.id, allPass('promoted'), at(1));
    const ok = await decideRequest(as(jordan), jordan, r.id, 'approve', 'Promoted.', at(2));
    expect(ok.expiresAt).toBeNull();
    expect(ok.decidedAt).toBe(at(2).toISOString());
  });

  it('saveReview appends only changed answers and rejects items not on the checklist', async () => {
    const { jordan, as, byName } = await setup();
    const r = await byName('Revenue Forecast');
    const first = await saveReview(as(jordan), jordan, r.id, allPass('promoted'), at(1));
    expect(first).toBe(4);
    expect(await saveReview(as(jordan), jordan, r.id, allPass('promoted'), at(2))).toBe(0);
    await expect(saveReview(as(jordan), jordan, r.id, [{ itemKey: 'tests', result: 'pass', evidence: '' }], at(3))).rejects.toThrow(/not on this request/);
  });
});

describe('changes requested and resubmission', () => {
  it('highlights failing items, keeps previous answers and clears only the failed ones on resubmit', async () => {
    const { jordan, sam, priya, as, byName, raw } = await setup();
    const r = await byName('Product Usage');
    expect(r.status).toBe('changes_requested');
    let bundle = await getRequestBundle(raw, r.id);
    expect(failedItems(bundle.request, bundle.answers)).toEqual(['measures', 'tests']);
    expect(latestReviewerComment(r, bundle.events, bundle.adminSubs)?.note).toMatch(/Two items need work/);

    await expect(resubmitRequest(as(priya), priya, r.id, { note: 'Fixed', answers: [] }, at(1))).rejects.toThrow(/Only the owner/);
    await expect(resubmitRequest(as(sam), sam, r.id, { note: '', answers: [] }, at(1))).rejects.toThrow(/What changed is required/);

    const resubmitted = await resubmitRequest(
      as(sam),
      sam,
      r.id,
      {
        note: 'Test suite re-run and all measures described.',
        answers: [
          { itemKey: 'tests', result: 'pass', evidence: 'Latest run passed this morning.' },
          { itemKey: 'measures', result: 'pass', evidence: 'All 14 measures now described.' },
        ],
      },
      at(1),
    );
    expect(resubmitted.status).toBe('in_review');
    expect(resubmitted.reviewerSub).toBe(jordan.sub);

    bundle = await getRequestBundle(raw, r.id);
    const review = currentAnswers(bundle.request, bundle.answers, 'review');
    expect(Object.keys(review)).toHaveLength(8);
    expect(review.tests).toBeUndefined();
    expect(review.measures).toBeUndefined();
    expect(review.owner.result).toBe('pass');
    expect(currentAnswers(bundle.request, bundle.answers, 'self').tests.evidence).toBe('Latest run passed this morning.');
    expect(failedItems(bundle.request, bundle.answers)).toEqual([]);

    await saveReview(as(jordan), jordan, r.id, [
      { itemKey: 'tests', result: 'pass', evidence: 'Run checked.' },
      { itemKey: 'measures', result: 'pass', evidence: 'Descriptions checked.' },
    ], at(2));
    const done = await decideRequest(as(jordan), jordan, r.id, 'approve', 'Both items fixed. Certified.', at(3));
    expect(done.status).toBe('approved');
  });
});

describe('event trail', () => {
  it('records every transition of a full cycle in order', async () => {
    const { alex, jordan, priya, as, raw } = await setup();
    const created = await submitRequest(as(priya), priya, input(), allPass('certified'), { now: at(1) });
    await claimRequest(as(jordan), jordan, created.id, at(2));
    await saveReview(
      as(jordan),
      jordan,
      created.id,
      allPass('certified').map((a) => (a.itemKey === 'label' ? { ...a, result: 'fail' as const } : a)),
      at(3),
    );
    await decideRequest(as(jordan), jordan, created.id, 'request_changes', 'Apply a sensitivity label.', at(4));
    await resubmitRequest(as(priya), priya, created.id, { note: 'Label applied.', answers: [{ itemKey: 'label', result: 'pass', evidence: 'Confidential' }] }, at(5));
    await saveReview(as(jordan), jordan, created.id, [{ itemKey: 'label', result: 'pass', evidence: 'Label seen.' }], at(6));
    await decideRequest(as(jordan), jordan, created.id, 'approve', 'Certified.', at(7));
    const { events } = await getRequestBundle(raw, created.id);
    expect(events.map((e) => [e.type, e.byName])).toEqual([
      ['submitted', 'Priya Nair'],
      ['claimed', 'Jordan Lee'],
      ['changes_requested', 'Jordan Lee'],
      ['resubmitted', 'Priya Nair'],
      ['approved', 'Jordan Lee'],
    ]);
    expect(events.map((e) => e.at)).toEqual([1, 2, 4, 5, 7].map((m) => at(m).toISOString()));
    void alex;
  });
});

describe('submit', () => {
  it('validates the form and the self-assessment', async () => {
    const { sam, as } = await setup();
    await expect(submitRequest(as(sam), sam, input({ modelName: 'ab' }), allPass('certified'), { now: at(1) })).rejects.toThrow(/at least 3/);
    await expect(submitRequest(as(sam), sam, input({ modelUrl: 'not a link' }), allPass('certified'), { now: at(1) })).rejects.toThrow(/https/);
    await expect(submitRequest(as(sam), sam, input(), allPass('promoted'), { now: at(1) })).rejects.toThrow(/Answer every checklist item/);
  });

  it('creates the request as the viewer with the current checklist version, self answers and a submitted event', async () => {
    const { sam, as, raw } = await setup();
    const r = await submitRequest(as(sam), sam, input({ requestedLevel: 'promoted', modelUrl: '' }), allPass('certified'), { now: at(1) });
    expect(r).toMatchObject({ ownerSub: sam.sub, ownerName: 'Sam Taylor', status: 'submitted', checklistVersion: 2, modelUrl: null, reviewerSub: null });
    const bundle = await getRequestBundle(raw, r.id);
    // Only the promoted items are stored.
    expect(bundle.answers.map((a) => a.itemKey)).toEqual(['owner', 'description', 'refresh', 'naming']);
    expect(bundle.events.map((e) => e.type)).toEqual(['submitted']);
  });

  it('blocks a duplicate open request for the same model and workspace (case and spaces ignored)', async () => {
    const { sam, as, byName } = await setup();
    const open = await byName('Web Analytics');
    const err = await submitRequest(as(sam), sam, input({ modelName: ' web  analytics ', workspace: 'DIGITAL' }), allPass('certified'), { now: at(1) }).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateRequestError);
    expect((err as DuplicateRequestError).existing.id).toBe(open.id);
    // A closed request for the same model does not block (Legacy Orders Archive was rejected).
    await expect(
      submitRequest(as(sam), sam, input({ modelName: 'Legacy Orders Archive', workspace: 'Sales Analytics' }), allPass('certified'), { now: at(1) }),
    ).resolves.toBeTruthy();
  });

  it('links a renewal to the request it renews', async () => {
    const { sam, as, byName } = await setup();
    const old = await byName('Sales Performance');
    const r = await submitRequest(as(sam), sam, input({ modelName: old.modelName, workspace: old.workspace }), allPass('certified'), { renewalOfId: old.id, now: at(1) });
    expect(r.renewalOfId).toBe(old.id);
  });
});

describe('withdraw', () => {
  it('only the owner withdraws an open request', async () => {
    const { sam, priya, as, byName } = await setup();
    const r = await byName('Support Tickets');
    await expect(withdrawRequest(as(priya), priya, r.id, '', at(1))).rejects.toThrow(/Only the owner/);
    const w = await withdrawRequest(as(sam), sam, r.id, 'Merging into another model.', at(1));
    expect(w.status).toBe('withdrawn');
    await expect(withdrawRequest(as(sam), sam, r.id, '', at(2))).rejects.toThrow(/cannot be withdrawn/);
  });
});
