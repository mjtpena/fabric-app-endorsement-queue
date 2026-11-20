import type { DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { DAY, HOUR } from '@x10/shared/lib';
import type { SeedContext } from '@x10/shared/runtime';

import { neededItems } from './config/checklist';
import { rules } from './config/rules';
import { addMonths } from './domain/dates';
import type { EndorsementRequest, EventType, Level, Result, Schema, Stage, Status } from './model';

/** Default evidence per checklist item (fictional, generic). */
const EVIDENCE: Record<string, string> = {
  owner: 'Owner and backup are named in the model description.',
  description: 'Model and table descriptions are filled in.',
  refresh: 'Refresh history shows daily success.',
  naming: 'Checked against the team naming guide.',
  rls: 'Region roles reviewed with the data owner.',
  measures: 'All visible measures are documented in the Metric Dictionary.',
  tests: 'Measure test suite: latest run passed.',
  lineage: 'Sources are listed in the lineage view and the model notes.',
  label: 'Labelled Confidential.',
  cleanup: 'Unused columns removed; no duplicate measures found.',
};

type Answer = Result | [Result, string];

interface Spec {
  modelName: string;
  workspace: string;
  slug: string;
  owner: Person;
  level: Level;
  version: number;
  justification: string;
  status: Status;
  reviewer?: Person;
  submittedAt: string;
  decidedAt?: string;
  expiresAt?: string;
  lastResubmittedAt?: string;
  /** Self-assessment overrides (everything else is "pass"). */
  self?: Record<string, Answer>;
  /** Reviewer rounds: `all` passes every needed item, `answers` overrides or lists items. */
  reviews?: { at: string; all?: boolean; answers?: Record<string, Answer> }[];
  /** Owner's updated self answers at resubmission. */
  selfUpdates?: { at: string; answers: Record<string, Answer> };
  events: [EventType, Person, string, string?][];
}

/**
 * Fictional, generic seed data: 15 requests across every status and both levels, 6 approved (one expiring in
 * 10 days, one expired), three on the older checklist version, full checklist answers and an event trail for each.
 * Dates are computed from ctx.now. Runs once (runSeed checks a marker row).
 */
export async function seed(store: DataStore<Schema>, ctx: SeedContext): Promise<void> {
  const [alex, jordan, sam, priya] = ctx.people;
  const ago = (days: number) => new Date(ctx.now.getTime() - days * DAY).toISOString();
  const later = (iso: string, hours: number) => new Date(new Date(iso).getTime() + hours * HOUR).toISOString();
  const months = rules.certifiedValidityMonths;

  // Approvals placed so their expiry lands where the demo needs it.
  const salesExpires = new Date(ctx.now.getTime() + 10 * DAY).toISOString();
  const salesDecided = addMonths(salesExpires, -months);
  const ledgerExpires = new Date(ctx.now.getTime() - 5 * DAY).toISOString();
  const ledgerDecided = addMonths(ledgerExpires, -months);
  const c360Expires = new Date(ctx.now.getTime() + 45 * DAY).toISOString();
  const c360Decided = addMonths(c360Expires, -months);
  const supplyDecided = ago(60);

  const specs: Spec[] = [
    // ---------------------------------------------------------------- approved (6)
    {
      modelName: 'Sales Performance',
      workspace: 'Sales Analytics',
      slug: 'sales-performance',
      owner: sam,
      level: 'certified',
      version: 1,
      justification:
        'Used by every regional sales lead for the weekly pipeline review and the quarterly board pack. People should know this is the trusted source.',
      status: 'approved',
      reviewer: jordan,
      submittedAt: later(salesDecided, -6 * 24),
      decidedAt: salesDecided,
      expiresAt: salesExpires,
      reviews: [{ at: later(salesDecided, -2), all: true }],
      events: [
        ['submitted', sam, later(salesDecided, -6 * 24)],
        ['claimed', jordan, later(salesDecided, -4 * 24), 'Taking this one; I know the sales model.'],
        ['approved', jordan, salesDecided, 'All items pass. Certified for twelve months.'],
      ],
    },
    {
      modelName: 'Finance General Ledger',
      workspace: 'Finance',
      slug: 'finance-general-ledger',
      owner: priya,
      level: 'certified',
      version: 1,
      justification: 'Month-end close reporting reads from this model. Certification tells analysts to stop building their own GL extracts.',
      status: 'approved',
      reviewer: alex,
      submittedAt: later(ledgerDecided, -9 * 24),
      decidedAt: ledgerDecided,
      expiresAt: ledgerExpires,
      reviews: [{ at: later(ledgerDecided, -3), all: true }],
      events: [
        ['submitted', priya, later(ledgerDecided, -9 * 24)],
        ['claimed', alex, later(ledgerDecided, -7 * 24)],
        ['approved', alex, ledgerDecided, 'Solid model. RLS by cost centre checked with Finance.'],
      ],
    },
    {
      modelName: 'Customer 360',
      workspace: 'Customer Insights',
      slug: 'customer-360',
      owner: jordan,
      level: 'certified',
      version: 1,
      justification: 'Single customer view used by marketing, service and sales. Certification replaces three overlapping models.',
      status: 'approved',
      reviewer: alex,
      submittedAt: later(c360Decided, -5 * 24),
      decidedAt: c360Decided,
      expiresAt: c360Expires,
      self: { rls: ['na', 'Holds no person-level rows; every user may see every region.'] },
      reviews: [{ at: later(c360Decided, -1), all: true, answers: { rls: ['na', 'Confirmed: aggregated data only, no RLS needed.'] } }],
      events: [
        ['submitted', jordan, later(c360Decided, -5 * 24)],
        ['claimed', alex, later(c360Decided, -4 * 24), 'Jordan owns this, so I will review it.'],
        ['approved', alex, c360Decided, 'Passes. RLS not needed for aggregated data; evidence recorded.'],
      ],
    },
    {
      modelName: 'HR Headcount',
      workspace: 'People Analytics',
      slug: 'hr-headcount',
      owner: priya,
      level: 'promoted',
      version: 2,
      justification: 'Monthly headcount and attrition numbers for department heads. Promoting it so people find it before the old spreadsheet.',
      status: 'approved',
      reviewer: jordan,
      submittedAt: ago(44),
      decidedAt: ago(40),
      reviews: [{ at: later(ago(40), -2), all: true }],
      events: [
        ['submitted', priya, ago(44)],
        ['claimed', jordan, ago(42)],
        ['approved', jordan, ago(40), 'Promoted. Consider certification once tests exist.'],
      ],
    },
    {
      modelName: 'Supply Chain Inventory',
      workspace: 'Operations',
      slug: 'supply-chain-inventory',
      owner: sam,
      level: 'certified',
      version: 2,
      justification: 'Stock levels and reorder points for every warehouse. Planners rely on it daily; it needs the certified badge.',
      status: 'approved',
      reviewer: alex,
      submittedAt: ago(75),
      decidedAt: supplyDecided,
      expiresAt: addMonths(supplyDecided, months),
      lastResubmittedAt: ago(66),
      self: { label: ['na', 'Aggregated stock counts only; the labelling policy exempts operational aggregates.'] },
      reviews: [
        {
          at: ago(70),
          all: true,
          answers: {
            lineage: ['fail', 'The two supplier feeds are not documented anywhere.'],
            label: ['na', 'Agree: exempt under the labelling policy.'],
          },
        },
        { at: later(supplyDecided, -1), answers: { lineage: ['pass', 'Supplier feeds now documented in the model notes.'] } },
      ],
      selfUpdates: { at: ago(66), answers: { lineage: ['pass', 'Added both supplier feeds to the lineage notes.'] } },
      events: [
        ['submitted', sam, ago(75)],
        ['claimed', alex, ago(73)],
        ['changes_requested', alex, ago(70), 'Nearly there: please document the two supplier feeds (lineage).'],
        ['resubmitted', sam, ago(66), 'Lineage notes added for both supplier feeds.'],
        ['approved', alex, supplyDecided, 'Lineage fixed. Certified.'],
      ],
    },
    {
      modelName: 'Marketing Campaigns',
      workspace: 'Marketing',
      slug: 'marketing-campaigns',
      owner: jordan,
      level: 'promoted',
      version: 2,
      justification: 'Campaign spend and response rates. Promoting it so the agency team stops exporting raw tables.',
      status: 'approved',
      reviewer: alex,
      submittedAt: ago(24),
      decidedAt: ago(20),
      reviews: [{ at: later(ago(20), -1), all: true }],
      events: [
        ['submitted', jordan, ago(24)],
        ['claimed', alex, ago(22)],
        ['approved', alex, ago(20), 'Promoted. Naming is clean and refresh is healthy.'],
      ],
    },
    // ---------------------------------------------------------------- submitted (3)
    {
      modelName: 'Support Tickets',
      workspace: 'Customer Service',
      slug: 'support-tickets',
      owner: sam,
      level: 'promoted',
      version: 2,
      justification: 'Ticket volumes and resolution times for the service desk. Team leads want one promoted model instead of personal copies.',
      status: 'submitted',
      submittedAt: ago(12),
      self: { naming: ['fail', 'Two tables still use legacy names; renaming is planned this sprint.'] },
      events: [['submitted', sam, ago(12)]],
    },
    {
      modelName: 'Web Analytics',
      workspace: 'Digital',
      slug: 'web-analytics',
      owner: priya,
      level: 'certified',
      version: 2,
      justification: 'Site traffic and conversion funnel used in the weekly trading meeting. Several dashboards depend on it.',
      status: 'submitted',
      submittedAt: ago(6),
      self: { rls: ['na', 'No user-level data; sessions are aggregated by day.'] },
      events: [['submitted', priya, ago(6)]],
    },
    {
      modelName: 'Procurement Spend',
      workspace: 'Finance',
      slug: 'procurement-spend',
      owner: alex,
      level: 'certified',
      version: 2,
      justification: 'Spend by supplier and category for the procurement team. I built it, so another reviewer needs to check it.',
      status: 'submitted',
      submittedAt: ago(1),
      events: [['submitted', alex, ago(1)]],
    },
    // ---------------------------------------------------------------- in review (2)
    {
      modelName: 'Field Service Operations',
      workspace: 'Operations',
      slug: 'field-service-operations',
      owner: priya,
      level: 'certified',
      version: 2,
      justification: 'Job completion, travel time and first-time fix rate for field engineers. Regional managers use it every morning.',
      status: 'in_review',
      reviewer: alex,
      submittedAt: ago(3),
      self: { tests: ['na', 'No measure tests yet; the logic is simple counts.'] },
      reviews: [{ at: ago(1), answers: { owner: 'pass', description: 'pass', refresh: 'pass', naming: 'pass' } }],
      events: [
        ['submitted', priya, ago(3)],
        ['claimed', alex, ago(2), 'Reviewing this week.'],
      ],
    },
    {
      modelName: 'Revenue Forecast',
      workspace: 'Finance',
      slug: 'revenue-forecast',
      owner: sam,
      level: 'promoted',
      version: 2,
      justification: 'Rolling twelve-month revenue forecast. Finance business partners should find this first.',
      status: 'in_review',
      reviewer: jordan,
      submittedAt: ago(8),
      reviews: [{ at: ago(5), answers: { owner: 'pass', description: 'pass' } }],
      events: [
        ['submitted', sam, ago(8)],
        ['claimed', jordan, ago(6)],
      ],
    },
    // ---------------------------------------------------------------- changes requested (2)
    {
      modelName: 'Product Usage',
      workspace: 'Product',
      slug: 'product-usage',
      owner: sam,
      level: 'certified',
      version: 2,
      justification: 'Feature adoption and active users per product. Product managers quote these numbers in planning, so they must be trusted.',
      status: 'changes_requested',
      reviewer: jordan,
      submittedAt: ago(9),
      reviews: [
        {
          at: ago(5),
          all: true,
          answers: {
            tests: ['fail', 'No test run in the last month.'],
            measures: ['fail', '14 measures have no description.'],
          },
        },
      ],
      events: [
        ['submitted', sam, ago(9)],
        ['claimed', jordan, ago(7)],
        ['changes_requested', jordan, ago(5), 'Two items need work: run the test suite again and describe the 14 undocumented measures.'],
      ],
    },
    {
      modelName: 'Partner Portal',
      workspace: 'Partnerships',
      slug: 'partner-portal',
      owner: priya,
      level: 'promoted',
      version: 2,
      justification: 'Partner sales and deal registrations. Promoting it for the partner managers.',
      status: 'changes_requested',
      reviewer: alex,
      submittedAt: ago(7),
      reviews: [{ at: ago(4), all: true, answers: { description: ['fail', 'Four tables have no description.'] } }],
      events: [
        ['submitted', priya, ago(7)],
        ['claimed', alex, ago(6)],
        ['changes_requested', alex, ago(4), 'Please add descriptions to the four undocumented tables.'],
      ],
    },
    // ---------------------------------------------------------------- rejected (1)
    {
      modelName: 'Legacy Orders Archive',
      workspace: 'Sales Analytics',
      slug: 'legacy-orders-archive',
      owner: sam,
      level: 'promoted',
      version: 2,
      justification: 'Historic orders before the platform move. Some analysts still use it.',
      status: 'rejected',
      reviewer: alex,
      submittedAt: ago(19),
      decidedAt: ago(15),
      self: { refresh: ['fail', 'Source system is read-only; refresh is manual.'] },
      reviews: [
        {
          at: later(ago(15), -1),
          all: true,
          answers: {
            refresh: ['fail', 'Refresh has failed for three weeks.'],
            naming: ['fail', 'Column names are raw source names.'],
          },
        },
      ],
      events: [
        ['submitted', sam, ago(19)],
        ['claimed', alex, ago(17)],
        ['rejected', alex, ago(15), 'This duplicates Sales Performance and has not refreshed for three weeks. Please retire it instead.'],
      ],
    },
    // ---------------------------------------------------------------- withdrawn (1)
    {
      modelName: 'Inventory Snapshot (copy)',
      workspace: 'Operations',
      slug: 'inventory-snapshot-copy',
      owner: priya,
      level: 'certified',
      version: 2,
      justification: 'Daily inventory snapshot for the planning team.',
      status: 'withdrawn',
      submittedAt: ago(20),
      events: [
        ['submitted', priya, ago(20)],
        ['withdrawn', priya, ago(18), 'Submitted by mistake: Supply Chain Inventory already covers this.'],
      ],
    },
  ];

  const requests = store.repo('EndorsementRequest');
  const answers = store.repo('ChecklistAnswer');
  const events = store.repo('EndorsementEvent');

  const writeAnswers = async (
    r: EndorsementRequest,
    stage: Stage,
    by: Person,
    at: string,
    entries: [string, Answer][],
  ) => {
    for (const [itemKey, a] of entries) {
      const [result, evidence] = Array.isArray(a) ? a : [a, a === 'pass' ? EVIDENCE[itemKey] : null];
      await answers.create({
        requestId: r.id,
        itemKey,
        stage,
        result,
        evidence: evidence ?? null,
        answeredBySub: by.sub,
        answeredByName: by.displayName,
        answeredAt: at,
      });
    }
  };

  for (const s of specs) {
    const r = await requests.create({
      modelName: s.modelName,
      workspace: s.workspace,
      modelUrl: `https://fabric.example.com/models/${s.slug}`,
      ownerSub: s.owner.sub,
      ownerName: s.owner.displayName,
      requestedLevel: s.level,
      justification: s.justification,
      status: s.status,
      reviewerSub: s.reviewer?.sub ?? null,
      reviewerName: s.reviewer?.displayName ?? null,
      submittedAt: s.submittedAt,
      decidedAt: s.decidedAt ?? null,
      expiresAt: s.expiresAt ?? null,
      lastResubmittedAt: s.lastResubmittedAt ?? null,
      checklistVersion: s.version,
      renewalOfId: null,
    });
    const keys = neededItems(s.level, s.version).map((i) => i.key);
    await writeAnswers(r, 'self', s.owner, s.submittedAt, keys.map((k) => [k, s.self?.[k] ?? 'pass']));
    if (s.selfUpdates) await writeAnswers(r, 'self', s.owner, s.selfUpdates.at, Object.entries(s.selfUpdates.answers));
    for (const round of s.reviews ?? []) {
      const entries: [string, Answer][] = round.all
        ? keys.map((k) => [k, round.answers?.[k] ?? 'pass'])
        : Object.entries(round.answers ?? {});
      await writeAnswers(r, 'review', s.reviewer!, round.at, entries);
    }
    for (const [type, by, at, note] of s.events) {
      await events.create({ requestId: r.id, type, bySub: by.sub, byName: by.displayName, note: note ?? null, at });
    }
  }
}
