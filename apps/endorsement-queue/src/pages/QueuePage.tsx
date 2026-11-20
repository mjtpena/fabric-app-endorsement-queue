/** Assay desk: the unstamped blanks waiting for a reviewer, oldest first. Reviewers claim from here. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ScanSearch } from 'lucide-react';

import { describeError, useAsync, useNow, usePolling } from '@x10/shared/lib';
import { AdminOnly, useApp } from '@x10/shared/runtime';
import {
  Badge,
  Button,
  Checkbox,
  DataState,
  EmptyState,
  FilterSelect,
  InlineError,
  PageHeader,
  Skeleton,
  Stat,
  StatStrip,
  Table,
  TableWrap,
  Td,
  Th,
  Toolbar,
  Tr,
} from '@x10/shared/ui';

import { AgeChip, LevelMark, StatusChip } from '../components/chips';
import { rules } from '../config/rules';
import { ageDays, queueView, type LevelFilter, type StatusFilter } from '../domain/queue';
import { loadQueue } from '../domain/views';
import { claimBlocker, claimRequest } from '../domain/workflow';
import { sealForRequest } from '../hall/forRequest';
import { SealBadge } from '../hall/Seal';
import { STATUS_LABEL } from '../labels';
import { STATUSES, type EndorsementRequest, type Schema } from '../model';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  ...STATUSES.map((s) => ({ value: s as StatusFilter, label: STATUS_LABEL[s] })),
  { value: 'all', label: 'All' },
];

export function QueuePage() {
  return (
    <AdminOnly>
      <Queue />
    </AdminOnly>
  );
}

function QueueSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-surface p-5 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <Skeleton width={90} />
            <Skeleton width={48} height={24} className="mt-2" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-line bg-surface">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
            <Skeleton circle width={34} height={34} />
            <Skeleton width={220} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Queue() {
  const { store, me } = useApp<Schema>();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const state = useAsync(() => loadQueue(store), [store]);
  usePolling(state.reload, 15_000);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [mine, setMine] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = async (r: EndorsementRequest) => {
    setClaiming(r.id);
    setError(null);
    try {
      await claimRequest(store, me, r.id);
      navigate(`/requests/${r.id}`, { state: { flash: 'Claimed. Record a verdict for every item, then decide.' } });
    } catch (e) {
      setError(describeError(e).message);
      await state.reload();
    } finally {
      setClaiming(null);
    }
  };

  return (
    <>
      <PageHeader title="Assay desk" subtitle={`Oldest first. Waiting turns amber after ${rules.ageAmberDays} days and red after ${rules.ageRedDays}.`} />
      <DataState state={state} skeleton={<QueueSkeleton />}>
        {({ requests: all, issues }) => {
          const waiting = all.filter((r) => r.status === 'submitted');
          const rows = queueView(all, { level, status, mineSub: mine ? me.sub : null });
          const oldest = waiting.length ? Math.max(...waiting.map((r) => ageDays(r, now))) : 0;
          return (
            <>
              <StatStrip>
                <Stat label="Waiting for a reviewer" value={waiting.length} />
                <Stat label="On a desk" value={all.filter((r) => r.status === 'in_review').length} />
                <Stat label="Back with owners" value={all.filter((r) => r.status === 'changes_requested').length} />
                <Stat
                  label="Oldest waiting"
                  value={`${oldest} d`}
                  tone={oldest >= rules.ageRedDays ? 'bad' : oldest >= rules.ageAmberDays ? 'warn' : undefined}
                />
              </StatStrip>
              <Toolbar className="mt-6">
                <FilterSelect<LevelFilter>
                  label="Level"
                  value={level}
                  onChange={setLevel}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'promoted', label: 'Promoted' },
                    { value: 'certified', label: 'Certified' },
                  ]}
                />
                <FilterSelect<StatusFilter> label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
                <Checkbox label="Claimed by me" checked={mine} onChange={setMine} />
              </Toolbar>
              <InlineError error={error} />
              {rows.length === 0 ? (
                <EmptyState icon={<ScanSearch />} title="Nothing on the desk" bordered>
                  {status === 'open' && level === 'all' && !mine ? 'The bench is clear. New requests arrive here as owners submit them.' : 'Try another level or status.'}
                </EmptyState>
              ) : (
                <TableWrap label="Assay desk" className="mt-3">
                  <Table data-testid="queue-table" className="min-w-[860px]">
                    <thead>
                      <tr>
                        <Th>Model</Th>
                        <Th>Level</Th>
                        <Th>Status</Th>
                        <Th>Owner</Th>
                        <Th>Reviewer</Th>
                        <Th numeric>Waiting</Th>
                        <Th>
                          <span className="sr-only">Action</span>
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const issue = issues.get(r.id) ?? null;
                        const blocker = r.status === 'submitted' ? (issue ? 'Record does not match the trail' : claimBlocker(r, me)) : null;
                        return (
                          <Tr key={r.id} data-testid="queue-row">
                            <Td>
                              <span className="flex items-center gap-3">
                                <SealBadge size={34} {...sealForRequest(r, now, { verified: !issue })} />
                                <span className="min-w-0">
                                  <Link to={`/requests/${r.id}`} className="block font-medium text-fg">
                                    {r.modelName}
                                  </Link>
                                  <span className="block text-xs text-muted">{r.workspace}</span>
                                  {issue && (
                                    <span className="mt-1 block" title={issue} data-testid="queue-integrity">
                                      <Badge tone="bad">Record does not match trail</Badge>
                                    </span>
                                  )}
                                </span>
                              </span>
                            </Td>
                            <Td>
                              <LevelMark level={r.requestedLevel} />
                            </Td>
                            <Td>
                              <StatusChip status={r.status} />
                            </Td>
                            <Td muted>{r.ownerName}</Td>
                            <Td muted>{r.reviewerName ?? '—'}</Td>
                            <Td numeric>
                              <AgeChip days={ageDays(r, now)} />
                            </Td>
                            <Td className="text-right">
                              {r.status === 'submitted' &&
                                (blocker ? (
                                  <span className="text-xs text-muted">{r.ownerSub === me.sub ? 'Your request' : blocker}</span>
                                ) : (
                                  <Button size="sm" variant="primary" busy={claiming === r.id} onClick={() => void claim(r)} aria-label={`Claim ${r.modelName}`}>
                                    Claim
                                  </Button>
                                ))}
                              {r.status === 'in_review' && r.reviewerSub === me.sub && !issue && (
                                <Link to={`/requests/${r.id}`} className="text-ui font-medium">
                                  Continue assay
                                </Link>
                              )}
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </>
          );
        }}
      </DataState>
    </>
  );
}
