/** Seal register: every endorsed model (newest approval per model), searchable, with a CSV export. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Download } from 'lucide-react';

import { downloadText, formatDate, plural, useAsync, useNow } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import {
  Badge,
  Button,
  DataState,
  EmptyState,
  LinkButton,
  PageHeader,
  SearchInput,
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

import { ExpiryChip, LevelMark } from '../components/chips';
import { rules } from '../config/rules';
import { loadRegister, registerCsv, searchRegister } from '../domain/register';
import { sealForRequest } from '../hall/forRequest';
import { SealBadge } from '../hall/Seal';
import type { Schema } from '../model';

function RegisterSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
          <Skeleton circle width={36} height={36} />
          <Skeleton width={200} />
          <Skeleton width={80} className="ml-auto" />
        </div>
      ))}
    </div>
  );
}

export function RegisterPage() {
  const { store } = useApp<Schema>();
  const now = useNow(60_000);
  const state = useAsync(() => loadRegister(store), [store]);
  const [q, setQ] = useState('');

  return (
    <>
      <PageHeader title="Seal register" subtitle={`Newest approval per model. Certified seals flag renewal ${rules.renewalDueDays} days before they run out.`} />
      <DataState
        state={state}
        skeleton={<RegisterSkeleton />}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState icon={<BookOpen />} title="No seals yet" bordered action={<LinkButton to="/submit" variant="primary">Submit the first model</LinkButton>}>
            Approved requests are entered here with their level, owner, reviewer and expiry.
          </EmptyState>
        }
      >
        {(all) => {
          const rows = searchRegister(all, q);
          const certified = all.filter((e) => e.request.requestedLevel === 'certified').length;
          const due = all.filter((e) => e.expiry.kind === 'due').length;
          const expired = all.filter((e) => e.expiry.kind === 'expired').length;
          const mismatch = all.filter((e) => !e.verification.ok).length;
          return (
            <>
              <StatStrip>
                <Stat label="Seals" value={all.length} hint={`${certified} certified · ${all.length - certified} promoted`} />
                <Stat label="Renewal due" value={due} tone={due ? 'warn' : undefined} />
                <Stat label="Expired" value={expired} tone={expired ? 'bad' : undefined} />
                <Stat label="Trail mismatches" value={mismatch} tone={mismatch ? 'bad' : undefined} />
              </StatStrip>
              <Toolbar className="mt-6">
                <SearchInput value={q} onChange={setQ} label="Search the register" placeholder="Model, workspace or person" shortcut="/" />
                <Button
                  icon={<Download />}
                  className="ml-auto"
                  onClick={() => downloadText(`endorsement-register-${new Date().toISOString().slice(0, 10)}.csv`, registerCsv(rows))}
                >
                  Export CSV
                </Button>
              </Toolbar>
              <p className="m-0 mt-3 mb-2 font-mono text-xs text-muted num" aria-live="polite">
                {plural(rows.length, 'seal')}
                {q.trim() ? ` matching "${q.trim()}"` : ''}
              </p>
              {rows.length === 0 ? (
                <EmptyState title="No seal matches" compact bordered>
                  Try a model, workspace or person&apos;s name.
                </EmptyState>
              ) : (
                <TableWrap label="Endorsed models">
                  <Table data-testid="register-table" className="min-w-[900px]">
                    <thead>
                      <tr>
                        <Th>Model</Th>
                        <Th>Level</Th>
                        <Th>Owner</Th>
                        <Th>Reviewer</Th>
                        <Th numeric>Sealed</Th>
                        <Th>Expiry</Th>
                        <Th numeric>Days left</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ request: r, expiry, verification }) => (
                        <Tr key={r.id} data-testid="register-row" data-model={r.modelName}>
                          <Td>
                            <span className="flex items-center gap-3">
                              <SealBadge size={38} {...sealForRequest(r, now, { verified: verification.ok })} />
                              <span className="min-w-0">
                                <Link to={`/requests/${r.id}`} className="block font-medium text-fg">
                                  {r.modelName}
                                </Link>
                                <span className="block text-xs text-muted">{r.workspace}</span>
                                {!verification.ok && (
                                  <span className="mt-1 block" title={verification.reason ?? undefined}>
                                    <Badge tone="bad">Trail mismatch: {verification.reason}</Badge>
                                  </span>
                                )}
                              </span>
                            </span>
                          </Td>
                          <Td>
                            <LevelMark level={r.requestedLevel} />
                          </Td>
                          <Td muted>{r.ownerName}</Td>
                          <Td muted>{r.reviewerName ?? '—'}</Td>
                          <Td numeric className="whitespace-nowrap">
                            {formatDate(r.decidedAt)}
                          </Td>
                          <Td>
                            <ExpiryChip state={expiry} expiresAt={r.expiresAt} />
                          </Td>
                          <Td numeric className={expiry.kind === 'expired' ? 'text-bad-text' : expiry.kind === 'due' ? 'text-warn-text' : undefined}>
                            {expiry.days ?? '—'}
                          </Td>
                        </Tr>
                      ))}
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
