/**
 * The endorsement checklist, versioned. A request stores the version it was submitted with and is always shown
 * and judged against that version, so changing the checklist never rewrites old reviews.
 *
 * To change the checklist: add a new version to `CHECKLISTS` and bump `CURRENT_CHECKLIST_VERSION`.
 * Never edit a version that requests already use.
 */
import type { Level } from '../model';

export interface ChecklistItem {
  key: string;
  label: string;
  /** What the reviewer checks, in one sentence. */
  help: string;
  /** Levels that need this item. */
  levels: Level[];
  /** "Not applicable" is allowed for this item, with evidence text explaining why. */
  naAllowed: boolean;
}

export interface Checklist {
  version: number;
  /** What changed in this version (for the About page). */
  summary: string;
  items: ChecklistItem[];
}

const both: Level[] = ['promoted', 'certified'];
const certifiedOnly: Level[] = ['certified'];

const v1: Checklist = {
  version: 1,
  summary: 'Original eight-item checklist.',
  items: [
    { key: 'owner', label: 'Named owner', help: 'The model has a named owner who answers questions about it.', levels: both, naAllowed: false },
    { key: 'description', label: 'Descriptions', help: 'The model has a description in its settings.', levels: both, naAllowed: false },
    { key: 'refresh', label: 'Refresh healthy', help: 'A scheduled refresh succeeded in the last 14 days.', levels: both, naAllowed: false },
    { key: 'naming', label: 'Naming conventions', help: 'Tables, columns and measures follow the naming conventions.', levels: both, naAllowed: false },
    { key: 'rls', label: 'Row-level security', help: 'RLS roles were reviewed, or RLS is not needed.', levels: certifiedOnly, naAllowed: true },
    { key: 'measures', label: 'Measures documented', help: 'Key measures have descriptions.', levels: certifiedOnly, naAllowed: false },
    { key: 'tests', label: 'Tests', help: 'Measure tests exist and the latest run passed.', levels: certifiedOnly, naAllowed: true },
    { key: 'label', label: 'Sensitivity label', help: 'A sensitivity label is applied.', levels: certifiedOnly, naAllowed: true },
  ],
};

const v2: Checklist = {
  version: 2,
  summary: 'Adds lineage and clutter checks, asks for a backup owner, and tightens refresh to 7 days.',
  items: [
    { key: 'owner', label: 'Owner and backup', help: 'A named owner and a named backup are listed for the model.', levels: both, naAllowed: false },
    { key: 'description', label: 'Descriptions', help: 'The model and every visible table have descriptions.', levels: both, naAllowed: false },
    { key: 'refresh', label: 'Refresh healthy', help: 'A refresh succeeded in the last 7 days.', levels: both, naAllowed: false },
    { key: 'naming', label: 'Naming conventions', help: 'Tables, columns and measures follow the naming conventions.', levels: both, naAllowed: false },
    { key: 'rls', label: 'Row-level security', help: 'RLS roles were reviewed, or RLS is not needed (say why).', levels: certifiedOnly, naAllowed: true },
    { key: 'measures', label: 'Measures documented', help: 'Measures are documented in the Metric Dictionary or an equivalent.', levels: certifiedOnly, naAllowed: false },
    { key: 'tests', label: 'Test suite passing', help: 'A measure test suite exists and its latest run passes.', levels: certifiedOnly, naAllowed: true },
    { key: 'lineage', label: 'Lineage documented', help: 'Upstream sources are documented.', levels: certifiedOnly, naAllowed: false },
    { key: 'label', label: 'Sensitivity label', help: 'A sensitivity label is applied (or say why none is needed).', levels: certifiedOnly, naAllowed: true },
    { key: 'cleanup', label: 'No clutter', help: 'No unused or duplicate columns and measures.', levels: certifiedOnly, naAllowed: false },
  ],
};

/** Every checklist version ever published, keyed by version number. */
export const CHECKLISTS: Readonly<Record<number, Checklist>> = { 1: v1, 2: v2 };

/** The version new requests are submitted with. */
export const CURRENT_CHECKLIST_VERSION = 2;

/** The checklist a request was submitted with. Unknown versions fall back to the current one. */
export function getChecklist(version: number): Checklist {
  return CHECKLISTS[version] ?? CHECKLISTS[CURRENT_CHECKLIST_VERSION];
}

/** Items a level needs, in checklist order. */
export function neededItems(level: Level, version: number): ChecklistItem[] {
  return getChecklist(version).items.filter((i) => i.levels.includes(level));
}
