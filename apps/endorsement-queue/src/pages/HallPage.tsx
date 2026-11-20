/**
 * Home: the hall of seals. Lenses re-colour and regroup the seals (keys 1-5), view as owner or reviewer dims what
 * is not yours (V), Today flies to what needs attention, L switches to the list of the same items.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CalendarClock, Gem, Keyboard, Landmark, RotateCcw, Search, ShieldCheck, UserRound } from 'lucide-react';

import { formatDate, useAsync, usePolling } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import {
  Badge,
  Button,
  Dialog,
  IconButton,
  Input,
  Kbd,
  Legend,
  LensBar,
  LinkButton,
  Spinner,
  StageMessage,
  StagePage,
  Table,
  TableWrap,
  Td,
  Th,
  TodayPanel,
  Tr,
  ViewAsSwitch,
  ViewToggle,
  useHotkeys,
  useIsDesktop,
  type LegendItem,
  type LensOption,
  type StageView,
  type TodayItem,
} from '@x10/shared/ui';

import { ExpiryChip, LevelMark, StatusChip } from '../components/chips';
import {
  groupOf,
  isDimmed,
  layoutHall,
  lensGroups,
  loadHall,
  todayFor,
  type HallData,
  type HallItem,
  type HallLens,
  type ViewAs,
} from '../domain/hall';
import { HallScene } from '../hall/HallScene';
import { rimColor, SealBadge, sealProps } from '../hall/Seal';
import { LEVEL_LABEL, STATUS_LABEL } from '../labels';
import type { Schema } from '../model';

const LENSES: LensOption<HallLens>[] = [
  { value: 'level', label: 'Level', swatch: 'conic-gradient(var(--seal-gold) 0 50%, var(--seal-slate) 0)', description: 'Certified in gold, Promoted in slate' },
  { value: 'expiry', label: 'Expiry', swatch: 'conic-gradient(var(--ok-solid) 0 40%, var(--warn-solid) 0 70%, var(--bad-solid) 0)', description: 'How much of each seal’s year is left' },
  { value: 'owner', label: 'Owner', icon: <UserRound />, description: 'Who owns each model' },
  { value: 'reviewer', label: 'Reviewer', icon: <ShieldCheck />, description: 'Who assayed and sealed it' },
  { value: 'workspace', label: 'Workspace', icon: <Landmark />, description: 'Where the model lives' },
];

const LENS_LABEL: Record<HallLens, string> = { level: 'Level', expiry: 'Expiry', owner: 'Owner', reviewer: 'Reviewer', workspace: 'Workspace' };

function legendFor(data: HallData, lens: HallLens): LegendItem[] {
  const groups = lensGroups(data, lens);
  const all: HallItem[] = [...data.seals, ...data.blanks];
  const items: LegendItem[] = groups.map((g) => ({
    label: g.label,
    color: rimColor(g.rim),
    shape: lens === 'expiry' ? 'line' : 'dot',
    value: all.filter((i) => groupOf(i, lens, groups).key === g.key).length,
  }));
  if (lens === 'level') {
    items.push({ label: 'Arc: time left', color: 'var(--ok-solid)', shape: 'line' }, { label: 'Blank: unsealed', color: 'var(--seal-pending)', shape: 'ring' });
  }
  return items;
}

const VIEW_KEY = 'x10:endorsement-queue:hall';

function readPrefs(): { lens?: HallLens; view?: StageView } {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function HallPage() {
  const { store, me } = useApp<Schema>();
  const location = useLocation();
  const navigate = useNavigate();
  const nav = (location.state as { stamped?: string; focus?: string } | null) ?? null;
  const state = useAsync(() => loadHall(store), [store]);
  usePolling(state.reload, 20_000);

  const prefs = useMemo(readPrefs, []);
  const [lens, setLens] = useState<HallLens>(prefs.lens ?? 'level');
  const [view, setView] = useState<StageView>(prefs.view ?? 'stage');
  const [viewAs, setViewAs] = useState<ViewAs>('all');
  const desktop = useIsDesktop();
  const [focus, setFocus] = useState<string | null>(nav?.stamped ?? nav?.focus ?? null);
  const [stamp, setStamp] = useState<string | null>(nav?.stamped ?? null);
  const [help, setHelp] = useState(false);
  const findRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({ lens, view }));
    } catch {
      /* storage blocked: preferences are a convenience */
    }
  }, [lens, view]);
  useEffect(() => {
    if (!stamp) return;
    const t = setTimeout(() => setStamp(null), 2600);
    return () => clearTimeout(t);
  }, [stamp]);

  const data = state.data;
  const all = useMemo(() => (data ? [...data.seals, ...data.blanks] : []), [data]);
  const focused = all.find((i) => i.id === focus) ?? null;
  const order = useMemo(() => {
    if (!data) return [] as string[];
    const l = layoutHall(data, lens, 6);
    return [...l.seals, ...l.blanks].map((p) => p.id);
  }, [data, lens]);
  const today: TodayItem[] = useMemo(
    () =>
      data
        ? todayFor(data, viewAs, me).map((t) => ({ id: t.id, title: t.title, severity: t.severity, value: t.value, unit: t.unit, lens: LENS_LABEL[t.lens], meta: t.meta }))
        : [],
    [data, viewAs, me],
  );
  const todayLens = useMemo(() => (data ? new Map(todayFor(data, viewAs, me).map((t) => [t.id, t.lens])) : new Map()), [data, viewAs, me]);

  const pick = (id: string) => setFocus((f) => (f === id ? null : id));
  const step = (dir: 1 | -1) => {
    if (!order.length) return;
    const i = focus ? order.indexOf(focus) : -1;
    setFocus(order[(i + dir + order.length) % order.length]);
  };
  const open = () => focused && navigate(`/requests/${focused.id}`);
  const fly = () => {
    const words = q.trim().toLowerCase();
    if (!words) return;
    const hit = all.find((i) => i.request.modelName.toLowerCase().includes(words) || i.request.workspace.toLowerCase().includes(words));
    if (hit) {
      setFocus(hit.id);
      setView('stage');
    }
  };

  useHotkeys({
    'shift+?': () => setHelp(true),
    escape: () => setFocus(null),
    arrowright: () => step(1),
    arrowleft: () => step(-1),
    o: open,
    enter: open,
    '/': () => findRef.current?.focus(),
  });

  const viewAsSwitch = (
    <ViewAsSwitch<ViewAs>
      value={viewAs}
      onChange={setViewAs}
      glass={!desktop ? true : false}
      className={desktop ? 'bg-gray-3' : undefined}
      options={[
        { value: 'all', label: 'All' },
        { value: 'reviewer', label: 'Reviewer' },
        { value: 'owner', label: 'Owner' },
      ]}
    />
  );

  const count = data ? `${data.seals.length} ${data.seals.length === 1 ? 'seal' : 'seals'} · ${data.blanks.length} on the bench` : 'Lighting the hall…';
  const groups = data ? lensGroups(data, lens) : [];

  const title = focused ? focused.request.modelName : 'The hall of seals';
  const breadcrumb = focused
    ? [{ label: 'Hall', onClick: () => setFocus(null) }, { label: groupOf(focused, lens, groups).label }]
    : undefined;
  const meta = focused ? <FocusMeta item={focused} /> : <span className="num">{count}</span>;

  const stage = state.error && !data ? (
    <StageMessage icon={<RotateCcw />} title="The hall did not load" action={<Button onClick={() => void state.reload()}>Retry</Button>}>
      {state.error.message}
    </StageMessage>
  ) : !data ? (
    <StageMessage icon={<Spinner small />} title="Lighting the hall">
      Gathering seals and blanks.
    </StageMessage>
  ) : all.length === 0 ? (
    <StageMessage icon={<Gem />} title="The hall is empty" action={<LinkButton to="/submit" variant="primary">Submit a model</LinkButton>}>
      Approved models hang here as seals; open requests wait on the bench.
    </StageMessage>
  ) : (
    <HallScene data={data} lens={lens} focusId={focus} onPick={pick} isDim={(i) => isDimmed(i, viewAs, me)} stampId={stamp} />
  );

  return (
    <>
      <StagePage
        label="Hall of seals"
        view={view}
        breadcrumb={breadcrumb}
        title={title}
        meta={meta}
        topRight={
          <>
            <form
              className="relative"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                fly();
              }}
            >
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-[1] size-4 -translate-y-1/2 text-faint" />
              <label htmlFor="eq-find" className="sr-only">
                Find a seal
              </label>
              <Input
                ref={findRef}
                id="eq-find"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a seal…"
                list="eq-find-list"
                className={view === 'stage' ? 'x-glass w-44 rounded-full! pl-8' : 'w-44 pl-8'}
              />
              <datalist id="eq-find-list">
                {all.map((i) => (
                  <option key={i.id} value={i.request.modelName} />
                ))}
              </datalist>
            </form>
            <IconButton label="Keyboard shortcuts" icon={<Keyboard />} onClick={() => setHelp(true)} variant="ghost" className={view === 'stage' ? 'x-glass rounded-full!' : undefined} />
            <ViewToggle value={view} onChange={setView} glass={view === 'stage'} stageLabel="Hall" listLabel="List" stageIcon={<Landmark />} />
          </>
        }
        lenses={<LensBar lenses={LENSES} value={lens} onChange={setLens} showLabel={false} />}
        legend={data && <Legend title={LENS_LABEL[lens]} items={legendFor(data, lens)} collapsible defaultOpen={desktop} />}
        bottomRight={desktop ? undefined : viewAsSwitch}
        side={
          <div>
            {desktop && <div className="mb-3 px-1">{viewAsSwitch}</div>}
            <TodayPanel
              bare
              items={today}
              date={formatDate(new Date().toISOString())}
              activeId={focus}
              empty={viewAs === 'owner' ? 'Nothing of yours needs attention.' : 'No seal needs attention today.'}
              onSelect={(it) => {
                setFocus(it.id);
                const l = todayLens.get(it.id);
                if (l) setLens(l);
                setView('stage');
              }}
            />
          </div>
        }
        sideCount={today.length}
        stage={stage}
        list={data ? <HallList data={data} lens={lens} focus={focus} /> : null}
      />
      <ShortcutSheet open={help} onClose={() => setHelp(false)} />
    </>
  );
}

function FocusMeta({ item }: { item: HallItem }) {
  const r = item.request;
  return (
    <>
      <LevelMark level={item.level} />
      {item.kind === 'seal' ? (
        <ExpiryChip state={item.expiry} expiresAt={r.expiresAt} />
      ) : (
        <StatusChip status={item.status} />
      )}
      <span>{r.ownerName}</span>
      <span className="flex w-full flex-wrap gap-2 pt-1.5">
        <LinkButton to={`/requests/${r.id}`} size="sm" variant="primary" data-testid="focus-open">
          {item.kind === 'seal' ? 'Open the record' : 'Open the assay'}
        </LinkButton>
        {item.kind === 'seal' && (item.expiry.kind === 'due' || item.expiry.kind === 'expired') && (
          <LinkButton to={`/submit?renew=${r.id}`} size="sm" icon={<CalendarClock />}>
            Start renewal
          </LinkButton>
        )}
      </span>
    </>
  );
}

/* ------------------------------------------------------------------ list (same data) */

function HallList({ data, lens, focus }: { data: HallData; lens: HallLens; focus: string | null }) {
  const groups = lensGroups(data, lens);
  const rows: HallItem[] = [...data.seals, ...data.blanks].sort(
    (a, b) =>
      groups.findIndex((g) => g.key === groupOf(a, lens, groups).key) - groups.findIndex((g) => g.key === groupOf(b, lens, groups).key) ||
      (a.kind === b.kind ? 0 : a.kind === 'seal' ? -1 : 1) ||
      a.request.modelName.localeCompare(b.request.modelName),
  );
  return (
    <>
      <TableWrap label="Seals and blanks">
        <Table data-testid="hall-list">
          <thead>
            <tr>
              <Th>Model</Th>
              {lens !== 'level' && <Th>{LENS_LABEL[lens]}</Th>}
              <Th>Level</Th>
              <Th>State</Th>
              <Th>Owner</Th>
              <Th>Reviewer</Th>
              <Th numeric>Days left</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const r = i.request;
              const g = groupOf(i, lens, groups);
              return (
                <Tr key={i.id} selected={i.id === focus} data-testid="hall-list-row" data-model={r.modelName}>
                  <Td>
                    <span className="flex min-w-[220px] items-center gap-3">
                      <SealBadge size={34} {...sealProps(i, g.rim)} />
                      <span className="min-w-0">
                        <Link to={`/requests/${r.id}`} className="block font-medium text-fg">
                          {r.modelName}
                        </Link>
                        <span className="block text-xs text-muted">{r.workspace}</span>
                      </span>
                    </span>
                  </Td>
                  {lens !== 'level' && (
                    <Td>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ui font-medium">
                        <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ background: rimColor(g.rim) }} />
                        {g.label}
                      </span>
                    </Td>
                  )}
                  <Td>
                    <LevelMark level={i.level} />
                  </Td>
                  <Td>
                    {i.kind === 'seal' ? (
                      i.verified ? (
                        <Badge tone="ok">Sealed</Badge>
                      ) : (
                        <Badge tone="bad" title={i.reason ?? undefined}>
                          Trail mismatch
                        </Badge>
                      )
                    ) : (
                      <Badge tone={i.status === 'changes_requested' ? 'warn' : i.status === 'in_review' ? 'brand' : 'info'}>{STATUS_LABEL[i.status]}</Badge>
                    )}
                  </Td>
                  <Td muted>{r.ownerName}</Td>
                  <Td muted>{r.reviewerName ?? '—'}</Td>
                  <Td numeric className={i.kind === 'seal' && i.expiry.kind === 'expired' ? 'text-bad-text' : i.kind === 'seal' && i.expiry.kind === 'due' ? 'text-warn-text' : undefined}>
                    {i.kind === 'seal' ? (i.expiry.days === null ? '—' : i.expiry.days) : '—'}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>
      <p className="mt-3 text-ui text-muted">
        {data.closed > 0 ? `${data.closed} rejected or withdrawn ${data.closed === 1 ? 'request is' : 'requests are'} not in the hall. ` : ''}
        A seal records the review; the reviewer still applies the {LEVEL_LABEL.promoted} or {LEVEL_LABEL.certified} badge in Fabric.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ keyboard */

const KEYS: [string[], string][] = [
  [['1', '–', '5'], 'Switch lens: level, expiry, owner, reviewer, workspace'],
  [['V'], 'View as reviewer or owner'],
  [['L'], 'Hall or list'],
  [['←', '→'], 'Step from seal to seal'],
  [['O'], 'Open the focused record'],
  [['/'], 'Find a seal'],
  [['Esc'], 'Back to the whole hall'],
  [['?'], 'This list'],
];

function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2.5 text-sm">
        {KEYS.map(([keys, what]) => (
          <div key={what} className="contents">
            <dt className="flex items-center gap-1">
              {keys.map((k) => (k === '–' ? <span key={k} className="text-faint">–</span> : <Kbd key={k}>{k}</Kbd>))}
            </dt>
            <dd className="m-0 text-muted">{what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
