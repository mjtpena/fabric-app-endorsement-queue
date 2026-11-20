/**
 * The hall of seals (pure model + one loader). Every approved model (newest approval per model and workspace) is a
 * seal; every open request is an unstamped blank on the assay bench. Lenses group and colour the same items; the
 * layout, the Today list and the view-as dimming are computed here so they can be unit-tested.
 */
import { groupBy, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { normKey, toMs } from '@x10/shared/lib';
import type { Tone } from '@x10/shared/ui';

import { neededItems } from '../config/checklist';
import { sealInitials, sealSeed } from '../hall/geometry';
import { LEVEL_LABEL } from '../labels';
import type { ChecklistAnswer, EndorsementEvent, EndorsementRequest, Level, Schema } from '../model';
import { currentAnswers } from './approval';
import { checkIntegrity } from './integrity';
import { ageDays, ageTone } from './queue';
import { registerEntries, type ExpiryState } from './register';
import { listRequests } from './requests';

export type HallLens = 'level' | 'expiry' | 'owner' | 'reviewer' | 'workspace';
export type ViewAs = 'all' | 'reviewer' | 'owner';
export type OpenStatus = 'submitted' | 'in_review' | 'changes_requested';

interface Base {
  id: string;
  request: EndorsementRequest;
  seed: number;
  initials: string;
  level: Level;
}

export interface HallSeal extends Base {
  kind: 'seal';
  expiry: ExpiryState;
  /** Validity left, 1 at approval and 0 at expiry. Null for Promoted (no expiry). */
  fraction: number | null;
  verified: boolean;
  reason: string | null;
}

export interface HallBlank extends Base {
  kind: 'blank';
  status: OpenStatus;
  /** Reviewer's progress on the needed items (checked includes failed). */
  checked: number;
  total: number;
  failed: number;
  age: number;
  issue: string | null;
}

export type HallItem = HallSeal | HallBlank;

export interface HallData {
  seals: HallSeal[];
  blanks: HallBlank[];
  /** Rejected and withdrawn requests: they never reach the hall. */
  closed: number;
  /** Reviewer subs (admins), to tell reviewers from owners. */
  adminSubs: Set<string>;
}

/** Remaining validity of a certified approval, 0..1. */
export function validityFraction(req: Pick<EndorsementRequest, 'decidedAt' | 'expiresAt'>, now: Date): number | null {
  if (!req.expiresAt || !req.decidedAt) return null;
  const span = toMs(req.expiresAt) - toMs(req.decidedAt);
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (toMs(req.expiresAt) - now.getTime()) / span));
}

const OPEN: OpenStatus[] = ['submitted', 'in_review', 'changes_requested'];

export function buildHall(
  requests: EndorsementRequest[],
  events: EndorsementEvent[],
  people: Pick<Person, 'sub' | 'isAdmin'>[],
  answers: ChecklistAnswer[],
  now: Date,
): HallData {
  const adminSubs = new Set(people.filter((p) => p.isAdmin === true).map((p) => p.sub));
  const evBy = groupBy(events, (e) => e.requestId);
  const ansBy = groupBy(answers, (a) => a.requestId);
  const base = (r: EndorsementRequest) => ({
    id: r.id,
    request: r,
    seed: sealSeed(r.modelName, r.workspace),
    initials: sealInitials(r.modelName),
    level: r.requestedLevel,
  });
  const seals: HallSeal[] = registerEntries(requests, events, people, now).map((e) => ({
    ...base(e.request),
    kind: 'seal',
    expiry: e.expiry,
    fraction: validityFraction(e.request, now),
    verified: e.verification.ok,
    reason: e.verification.reason,
  }));
  const blanks: HallBlank[] = requests
    .filter((r): r is EndorsementRequest & { status: OpenStatus } => OPEN.includes(r.status as OpenStatus))
    .map((r) => {
      const needed = neededItems(r.requestedLevel, r.checklistVersion);
      const review = r.reviewerSub ? currentAnswers(r, ansBy.get(r.id) ?? [], 'review') : {};
      const checked = needed.filter((i) => review[i.key]).length;
      const failed = needed.filter((i) => review[i.key]?.result === 'fail').length;
      return {
        ...base(r),
        kind: 'blank',
        status: r.status,
        checked,
        total: needed.length,
        failed,
        age: ageDays(r, now),
        issue: checkIntegrity(r, evBy.get(r.id) ?? [], adminSubs).issues[0] ?? null,
      };
    });
  const closed = requests.filter((r) => r.status === 'rejected' || r.status === 'withdrawn').length;
  return { seals, blanks, closed, adminSubs };
}

export async function loadHall(store: DataStore<Schema>, now = new Date()): Promise<HallData> {
  const [requests, events, people, answers] = await Promise.all([
    listRequests(store),
    store.repo('EndorsementEvent').list({ orderBy: { field: 'at', dir: 'asc' } }),
    store.repo('Person').list(),
    store.repo('ChecklistAnswer').list({ where: { stage: 'review' } }),
  ]);
  return buildHall(requests, events, people, answers, now);
}

/* ------------------------------------------------------------------ lenses */

/** Colour keys a seal rim can take. Level: gold/slate. Expiry: ok/warn/bad/none. Categories: c0..c7. */
export type RimKey = 'gold' | 'slate' | 'ok' | 'warn' | 'bad' | 'none' | 'pending' | `c${number}`;

export interface LensGroup {
  key: string;
  label: string;
  rim: RimKey;
}

export const CATEGORY_COUNT = 8;

const EXPIRY_GROUPS: LensGroup[] = [
  { key: 'expired', label: 'Expired', rim: 'bad' },
  { key: 'due', label: 'Renewal due', rim: 'warn' },
  { key: 'valid', label: 'Valid', rim: 'ok' },
  { key: 'none', label: 'No expiry', rim: 'none' },
  { key: 'pending', label: 'Not sealed yet', rim: 'pending' },
];

function rawKey(item: HallItem, lens: HallLens): { key: string; label: string } {
  const r = item.request;
  switch (lens) {
    case 'level':
      return { key: item.level, label: LEVEL_LABEL[item.level] };
    case 'expiry':
      return item.kind === 'seal' ? { key: item.expiry.kind, label: '' } : { key: 'pending', label: '' };
    case 'owner':
      return { key: r.ownerSub, label: r.ownerName };
    case 'reviewer':
      return r.reviewerSub ? { key: r.reviewerSub, label: r.reviewerName ?? 'Reviewer' } : { key: '~unclaimed', label: 'Unclaimed' };
    case 'workspace':
      return { key: normKey(r.workspace), label: r.workspace };
  }
}

/**
 * The groups of a lens in display order, with a stable colour per group. Category colours are assigned by label
 * over every item (seals and blanks), so a person keeps their colour when their seal count changes.
 */
export function lensGroups(data: Pick<HallData, 'seals' | 'blanks'>, lens: HallLens): LensGroup[] {
  const all: HallItem[] = [...data.seals, ...data.blanks];
  if (lens === 'level') {
    return (['certified', 'promoted'] as Level[])
      .filter((l) => all.some((i) => i.level === l))
      .map((l) => ({ key: l, label: LEVEL_LABEL[l], rim: l === 'certified' ? 'gold' : 'slate' }));
  }
  if (lens === 'expiry') {
    const present = new Set(all.map((i) => rawKey(i, 'expiry').key));
    return EXPIRY_GROUPS.filter((g) => present.has(g.key));
  }
  const labels = new Map<string, string>();
  for (const i of all) {
    const k = rawKey(i, lens);
    if (!labels.has(k.key)) labels.set(k.key, k.label);
  }
  const keys = [...labels.keys()].sort((a, b) => {
    if (a === '~unclaimed') return 1;
    if (b === '~unclaimed') return -1;
    return (labels.get(a) ?? '').localeCompare(labels.get(b) ?? '');
  });
  return keys.map((key, i) => ({
    key,
    label: labels.get(key) ?? key,
    rim: key === '~unclaimed' ? 'none' : (`c${i % CATEGORY_COUNT}` as RimKey),
  }));
}

export function groupOf(item: HallItem, lens: HallLens, groups: LensGroup[]): LensGroup {
  const k = rawKey(item, lens).key;
  return groups.find((g) => g.key === k) ?? { key: k, label: k, rim: 'none' };
}

/* ------------------------------------------------------------------ layout */

export const SEAL_R = 100;
export const BLANK_R = 64;
export const CELL_W = 300;
export const ROW_H = 590;
export const GROUP_GAP = 84;
export const BLANK_W = 218;
export const LEDGE_H = 300;

export interface Placed {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface Plaque {
  key: string;
  label: string;
  count: number;
  rim: RimKey;
  x: number;
  y: number;
  width: number;
}

export interface Ledge {
  y: number;
  x0: number;
  x1: number;
}

export interface HallLayout {
  seals: Placed[];
  blanks: Placed[];
  plaques: Plaque[];
  ledges: Ledge[];
  /** y of the floor line (the bottom of the wall). */
  floorY: number;
  bounds: { x: number; y: number; w: number; h: number };
}

interface Slot {
  id: string;
  group: LensGroup;
}

/** Flow items into rows of at most `cols` cells, starting each group on a fresh run with a gap before it. */
function flow(slots: Slot[], cols: number, cellW: number, gap: number) {
  const rows: { items: { id: string; x: number; group: LensGroup }[]; plaques: { group: LensGroup; x0: number; x1: number; count: number }[] }[] = [];
  let row = { items: [] as { id: string; x: number; group: LensGroup }[], plaques: [] as { group: LensGroup; x0: number; x1: number; count: number }[] };
  let used = 0; // cells used in this row
  let x = 0;
  let prev: string | null = null;
  const capacity = cols;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const starts = s.group.key !== prev;
    if (starts) {
      const remaining = slots.slice(i).findIndex((o) => o.group.key !== s.group.key);
      const size = remaining === -1 ? slots.length - i : remaining;
      // Start a new row when the group would split and there is already something on this row.
      if (used > 0 && used + Math.min(size, capacity) > capacity) {
        rows.push(row);
        row = { items: [], plaques: [] };
        used = 0;
        x = 0;
      } else if (used > 0) x += gap;
      row.plaques.push({ group: s.group, x0: x, x1: x, count: 0 });
    } else if (used >= capacity) {
      rows.push(row);
      row = { items: [], plaques: [{ group: s.group, x0: 0, x1: 0, count: 0 }] };
      used = 0;
      x = 0;
    }
    row.items.push({ id: s.id, x: x + cellW / 2, group: s.group });
    const p = row.plaques[row.plaques.length - 1];
    p.x1 = x + cellW;
    p.count++;
    x += cellW;
    used++;
    prev = s.group.key;
  }
  if (row.items.length) rows.push(row);
  return rows.map((r) => {
    const width = r.plaques.length ? r.plaques[r.plaques.length - 1].x1 : 0;
    return { ...r, width };
  });
}

/** Positions for every seal and blank under a lens. `cols` is the number of seals per row. */
export function layoutHall(data: Pick<HallData, 'seals' | 'blanks'>, lens: HallLens, cols: number): HallLayout {
  const groups = lensGroups(data, lens);
  const order = (g: LensGroup) => groups.findIndex((x) => x.key === g.key);
  const sealSort = (a: HallSeal, b: HallSeal) => {
    if (lens === 'expiry') return (a.fraction ?? 2) - (b.fraction ?? 2) || a.request.modelName.localeCompare(b.request.modelName);
    return a.request.modelName.localeCompare(b.request.modelName);
  };
  const sealSlots = data.seals
    .map((s) => ({ s, g: groupOf(s, lens, groups) }))
    .sort((a, b) => order(a.g) - order(b.g) || sealSort(a.s, b.s))
    .map(({ s, g }) => ({ id: s.id, group: g }));
  const blankSlots = data.blanks
    .map((b) => ({ b, g: groupOf(b, lens, groups) }))
    .sort((a, b) => order(a.g) - order(b.g) || b.b.age - a.b.age)
    .map(({ b, g }) => ({ id: b.id, group: g }));

  const seals: Placed[] = [];
  const plaques: Plaque[] = [];
  const sealRows = flow(sealSlots, Math.max(1, cols), CELL_W, GROUP_GAP);
  sealRows.forEach((row, ri) => {
    const y = ri * ROW_H;
    const shift = -row.width / 2;
    for (const it of row.items) seals.push({ id: it.id, x: it.x + shift, y, r: SEAL_R });
    for (const p of row.plaques) {
      plaques.push({ key: `${p.group.key}:${ri}`, label: p.group.label, count: p.count, rim: p.group.rim, x: p.x0 + shift, y: y - 268, width: p.x1 - p.x0 });
    }
  });

  const sealBottom = sealRows.length ? (sealRows.length - 1) * ROW_H + 250 : -60;
  const blankCols = Math.max(2, Math.floor((Math.max(1, cols) * CELL_W) / BLANK_W));
  const blankRows = blankSlots.length ? flow(blankSlots, blankCols, BLANK_W, 50) : [];
  const blanks: Placed[] = [];
  const ledges: Ledge[] = [];
  blankRows.forEach((row, ri) => {
    const ledgeY = sealBottom + 150 + ri * LEDGE_H + BLANK_R * 2;
    const shift = -row.width / 2;
    for (const it of row.items) blanks.push({ id: it.id, x: it.x + shift, y: ledgeY - BLANK_R - 10, r: BLANK_R });
    ledges.push({ y: ledgeY, x0: shift - 40, x1: shift + row.width + 40 });
  });

  const floorY = ledges.length ? ledges[ledges.length - 1].y + 120 : sealBottom + 60;
  const xs = [...seals.map((p) => [p.x - CELL_W / 2, p.x + CELL_W / 2]), ...ledges.map((l) => [l.x0, l.x1])].flat();
  const minX = xs.length ? Math.min(...xs) : -300;
  const maxX = xs.length ? Math.max(...xs) : 300;
  const top = seals.length ? -310 : sealBottom + 20;
  const bottom = floorY + 50;
  return { seals, blanks, plaques, ledges, floorY, bounds: { x: minX - 40, y: top, w: maxX - minX + 80, h: bottom - top } };
}

/* ------------------------------------------------------------------ view as */

type Viewer = Pick<Person, 'sub' | 'isAdmin'>;

/** Whether an item steps back (dims) for the chosen view. Reviewer view dims nothing for people who are not reviewers. */
export function isDimmed(item: HallItem, viewAs: ViewAs, me: Viewer): boolean {
  const r = item.request;
  if (viewAs === 'all') return false;
  if (viewAs === 'owner') return r.ownerSub !== me.sub;
  if (me.isAdmin !== true) return false;
  if (item.kind === 'seal') return r.reviewerSub !== me.sub;
  if (r.status === 'submitted') return r.ownerSub === me.sub;
  return r.reviewerSub !== me.sub;
}

/* ------------------------------------------------------------------ today */

export interface TodayEntry {
  id: string;
  title: string;
  severity: Tone;
  value?: string | number;
  unit?: string;
  lens: HallLens;
  meta: string;
}

const RANK: Record<Tone, number> = { bad: 0, warn: 1, brand: 2, info: 3, ok: 4, neutral: 5 };

/** The three to five things to look at now, ranked: broken and expired first, then due, then work in hand. */
export function todayFor(data: HallData, viewAs: ViewAs, me: Viewer): TodayEntry[] {
  const out: TodayEntry[] = [];
  const mineOnly = viewAs === 'owner';
  const seals = data.seals.filter((s) => !mineOnly || s.request.ownerSub === me.sub);
  for (const s of seals) {
    const m = s.request;
    if (!s.verified) out.push({ id: s.id, title: `${m.modelName} does not match its trail`, severity: 'bad', lens: 'level', meta: m.workspace });
    else if (s.expiry.kind === 'expired') {
      const d = Math.abs(s.expiry.days ?? 0);
      out.push({ id: s.id, title: `${m.modelName} seal has expired`, severity: 'bad', value: d, unit: d === 1 ? 'day ago' : 'days ago', lens: 'expiry', meta: m.workspace });
    } else if (s.expiry.kind === 'due') {
      out.push({ id: s.id, title: `${m.modelName} seal is nearly drained`, severity: 'warn', value: s.expiry.days ?? 0, unit: 'days left', lens: 'expiry', meta: m.workspace });
    }
  }
  if (viewAs === 'owner') {
    for (const b of data.blanks.filter((x) => x.request.ownerSub === me.sub)) {
      const m = b.request;
      if (b.status === 'changes_requested')
        out.push({ id: b.id, title: `${m.modelName} came back with changes`, severity: 'warn', value: b.failed, unit: b.failed === 1 ? 'item to fix' : 'items to fix', lens: 'owner', meta: m.reviewerName ?? m.workspace });
      else if (b.status === 'in_review')
        out.push({ id: b.id, title: `${m.modelName} is in assay`, severity: 'brand', value: `${b.checked}/${b.total}`, unit: 'checked', lens: 'reviewer', meta: m.reviewerName ?? '' });
      else
        out.push({ id: b.id, title: `${m.modelName} waits for a reviewer`, severity: 'info', value: b.age, unit: b.age === 1 ? 'day waiting' : 'days waiting', lens: 'level', meta: m.workspace });
    }
  } else {
    for (const b of data.blanks) {
      const m = b.request;
      if (b.status === 'in_review' && m.reviewerSub === me.sub)
        out.push({ id: b.id, title: `${m.modelName} is on your desk`, severity: 'brand', value: `${b.checked}/${b.total}`, unit: 'checked', lens: 'reviewer', meta: m.ownerName });
      else if (viewAs === 'all' && b.status === 'changes_requested')
        out.push({ id: b.id, title: `${m.modelName} is back with its owner`, severity: 'info', value: b.failed, unit: b.failed === 1 ? 'item to fix' : 'items to fix', lens: 'owner', meta: m.ownerName });
    }
    const waiting = data.blanks
      .filter((b) => b.status === 'submitted' && !b.issue && (me.isAdmin !== true || b.request.ownerSub !== me.sub))
      .sort((a, b) => b.age - a.age)
      .slice(0, 2);
    for (const b of waiting) {
      const tone = ageTone(b.age);
      out.push({
        id: b.id,
        title: `${b.request.modelName} waits for a reviewer`,
        severity: tone === 'neutral' ? 'info' : tone,
        value: b.age,
        unit: b.age === 1 ? 'day waiting' : 'days waiting',
        lens: 'reviewer',
        meta: b.request.ownerName,
      });
    }
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, 5);
}

/* ------------------------------------------------------------------ words */

export function itemSummary(item: HallItem): string {
  const r = item.request;
  if (item.kind === 'seal') {
    const exp =
      item.expiry.kind === 'none'
        ? 'no expiry'
        : item.expiry.kind === 'expired'
          ? `expired ${Math.abs(item.expiry.days ?? 0)} days ago`
          : `${item.expiry.days} days left`;
    return `${r.modelName}, ${LEVEL_LABEL[item.level]} seal, ${exp}, owner ${r.ownerName}${item.verified ? '' : ', trail mismatch'}`;
  }
  const st = item.status === 'submitted' ? 'waiting for a reviewer' : item.status === 'in_review' ? `in assay, ${item.checked} of ${item.total} checked` : `changes requested, ${item.failed} to fix`;
  return `${r.modelName}, ${LEVEL_LABEL[item.level]} request, ${st}, owner ${r.ownerName}`;
}
