/** My requests: the models I asked to have sealed, and where each one stands. */
import { Link } from 'react-router-dom';
import { CirclePlus, Inbox } from 'lucide-react';

import { formatRelative, plural, useAsync, useNow } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import { DataState, EmptyState, LinkButton, PageHeader, Skeleton } from '@x10/shared/ui';

import { ExpiryChip, LevelMark, StatusChip } from '../components/chips';
import { expiryState } from '../domain/register';
import { loadMyRequests } from '../domain/views';
import { sealForRequest } from '../hall/forRequest';
import { SealBadge } from '../hall/Seal';
import type { Schema } from '../model';

function MineSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-4 border-b border-line px-5 py-4 last:border-0">
          <Skeleton circle width={52} height={52} />
          <div className="flex-1">
            <Skeleton width={200} height={16} />
            <Skeleton width={300} className="mt-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MyRequestsPage() {
  const { store, me } = useApp<Schema>();
  const state = useAsync(() => loadMyRequests(store, me.sub), [store, me.sub]);
  const now = useNow(60_000);

  return (
    <>
      <PageHeader
        title="My requests"
        actions={
          <LinkButton to="/submit" variant="primary" icon={<CirclePlus />}>
            New request
          </LinkButton>
        }
      />
      <DataState
        state={state}
        skeleton={<MineSkeleton />}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState icon={<Inbox />} title="Nothing submitted yet" bordered action={<LinkButton to="/submit" variant="primary">Submit a model</LinkButton>}>
            Submit a semantic model with a self-assessment. A reviewer assays it and, if it holds, strikes its seal.
          </EmptyState>
        }
      >
        {(rows) => (
          <ul className="m-0 list-none divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line bg-surface p-0" data-testid="my-requests">
            {rows.map(({ request: r, comment, toFix, issue }) => (
              <li key={r.id} className="flex gap-4 px-4 py-4 sm:px-5">
                <SealBadge size={52} {...sealForRequest(r, now, { verified: !issue, failed: toFix, total: Math.max(1, toFix) })} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Link to={`/requests/${r.id}`} className="text-base font-semibold text-fg break-words">
                      {r.modelName}
                    </Link>
                    <span className="font-mono text-[11px] text-muted num">submitted {formatRelative(r.submittedAt, now)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-ui text-muted">
                    <StatusChip status={r.status} />
                    <LevelMark level={r.requestedLevel} />
                    <span>{r.workspace}</span>
                    {r.status === 'approved' && r.requestedLevel === 'certified' && <ExpiryChip state={expiryState(r, now)} expiresAt={r.expiresAt} />}
                  </div>
                  {issue && <p className="m-0 mt-2 text-ui font-medium text-bad-text">Record does not match its trail: {issue}</p>}
                  {toFix > 0 && <p className="m-0 mt-2 text-ui font-medium text-warn-text">{plural(toFix, 'item')} to fix, then resubmit.</p>}
                  {comment ? (
                    <blockquote className="m-0 mt-2.5 border-l-2 border-line-strong pl-3 text-ui leading-5">
                      <p className="m-0 break-words text-fg">{comment.note}</p>
                      <footer className="mt-1 text-xs text-muted">
                        {comment.byName}, {formatRelative(comment.at, now)}
                      </footer>
                    </blockquote>
                  ) : (
                    <p className="m-0 mt-2 text-ui text-faint">{r.status === 'submitted' ? 'Waiting on the bench for a reviewer.' : 'No reviewer note yet.'}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DataState>
    </>
  );
}
