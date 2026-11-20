/** Renewals: certified seals whose arc is nearly drained (or has run out), soonest first. */
import { Link } from 'react-router-dom';
import { Hourglass, RefreshCw } from 'lucide-react';

import { formatDate, plural, useAsync, useNow } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import { Callout, cx, DataState, EmptyState, LinkButton, PageHeader, Skeleton } from '@x10/shared/ui';

import { ExpiryChip, StatusChip } from '../components/chips';
import { rules } from '../config/rules';
import { loadRenewals } from '../domain/register';
import { sealForRequest } from '../hall/forRequest';
import { SealBadge } from '../hall/Seal';
import type { Schema } from '../model';

function RenewalsSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0">
          <Skeleton circle width={72} height={72} />
          <div className="flex-1">
            <Skeleton width={180} height={16} />
            <Skeleton width={260} className="mt-2" />
          </div>
          <Skeleton width={48} height={28} />
        </div>
      ))}
    </div>
  );
}

export function RenewalsPage() {
  const { store, me, isAdmin } = useApp<Schema>();
  const now = useNow(60_000);
  const state = useAsync(() => loadRenewals(store, me), [store, me.id]);

  return (
    <>
      <PageHeader title="Renewals" subtitle={`Certified seals with less than ${rules.renewalsWindowDays} days left, and any that have run out.`} />
      <DataState
        state={state}
        skeleton={<RenewalsSkeleton />}
        isEmpty={(d) => d.rows.length === 0}
        empty={
          <EmptyState icon={<Hourglass />} title={`Nothing runs out in the next ${rules.renewalsWindowDays} days`} bordered>
            Certified seals last {rules.certifiedValidityMonths} months and arrive here {rules.renewalsWindowDays} days before they run out.
          </EmptyState>
        }
      >
        {({ rows, eventsWritten }) => (
          <>
            {isAdmin && eventsWritten > 0 && (
              <div role="status" data-testid="renewal-events-written" className="mb-5">
                <Callout tone="info" title={`Recorded “renewal due” on the trail of ${plural(eventsWritten, 'model')}.`}>
                  It is written once per approval, the first time a reviewer opens Renewals after the renewal date.
                </Callout>
              </div>
            )}
            <ul className="m-0 list-none divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line bg-surface p-0" data-testid="renewals-list">
              {rows.map(({ request: r, expiry, renewal }) => {
                const days = expiry.days ?? 0;
                return (
                  <li key={r.id} data-testid="renewal-row" data-model={r.modelName} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4 sm:px-5">
                    <SealBadge size={76} {...sealForRequest(r, now)} emphasiseArc />
                    <div className="min-w-0 flex-1 basis-[14rem]">
                      <Link to={`/requests/${r.id}`} className="text-base font-semibold text-fg break-words">
                        {r.modelName}
                      </Link>
                      <div className="mt-0.5 text-ui text-muted">
                        {r.workspace} · owner {r.ownerName}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui text-muted">
                        <ExpiryChip state={expiry} expiresAt={r.expiresAt} />
                        <span className="font-mono text-xs num">
                          sealed {formatDate(r.decidedAt)} · {expiry.kind === 'expired' ? 'ran out' : 'runs out'} {formatDate(r.expiresAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
                      <div className="text-right">
                        <div className={cx('text-3xl font-semibold leading-none tracking-[-0.03em] num', expiry.kind === 'expired' ? 'text-bad-text' : expiry.kind === 'due' ? 'text-warn-text' : 'text-fg')}>
                          {Math.abs(days)}
                        </div>
                        <div className="mt-1 text-[11px] text-muted">{expiry.kind === 'expired' ? 'days ago' : 'days left'}</div>
                      </div>
                      {renewal ? (
                        <div className="flex flex-col items-end gap-1 text-ui">
                          <StatusChip status={renewal.status} />
                          <Link to={`/requests/${renewal.id}`} className="font-medium">
                            Open renewal
                          </Link>
                        </div>
                      ) : (
                        <LinkButton to={`/submit?renew=${r.id}`} variant="primary" icon={<RefreshCw />} data-testid="start-renewal">
                          Start renewal
                        </LinkButton>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DataState>
    </>
  );
}
