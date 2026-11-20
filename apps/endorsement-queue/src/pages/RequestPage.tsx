/**
 * The assay desk for one request: the owner's claim and evidence beside the reviewer's pass/fail for every checklist
 * item, the decision bar, the record and the append-only trail. Approving strikes the seal (pressed wax).
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowUpRight, ChevronLeft, Landmark } from 'lucide-react';

import { describeError, formatDate, formatDateTime, formatRelative, isHttpUrl, useAsync, useNow } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import {
  Button,
  Callout,
  ConfirmDialog,
  cx,
  DataState,
  Field,
  InlineError,
  Meter,
  Skeleton,
  SkeletonText,
  TextArea,
  Toast,
} from '@x10/shared/ui';

import { ExpiryChip, LevelMark, StatusChip } from '../components/chips';
import { ChecklistForm, ChecklistView, draftEntries, draftFrom, type Draft } from '../components/checklist';
import { BadgeReminder, EventTrail } from '../components/trail';
import { CURRENT_CHECKLIST_VERSION, neededItems, type ChecklistItem } from '../config/checklist';
import { rules } from '../config/rules';
import { currentAnswers, describeCheck, evaluateAnswers, validateAnswer, type AnswerMap } from '../domain/approval';
import { checkIntegrity } from '../domain/integrity';
import { expiryState } from '../domain/register';
import { getRequestBundle, isOpen, type RequestBundle } from '../domain/requests';
import {
  claimBlocker,
  claimRequest,
  decideBlocker,
  decideRequest,
  expiryFor,
  failedItems,
  resubmitRequest,
  saveReview,
  withdrawRequest,
  type Decision,
} from '../domain/workflow';
import { sealForRequest } from '../hall/forRequest';
import { SealBadge, WaxStamp } from '../hall/Seal';
import { LEVEL_LABEL } from '../labels';
import { limits, type EndorsementRequest, type Schema } from '../model';

export function RequestPage() {
  const { id = '' } = useParams();
  const { store } = useApp<Schema>();
  const location = useLocation();
  const [toast, setToast] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);
  const [sealed, setSealed] = useState<string | null>(null);
  const state = useAsync(() => getRequestBundle(store, id), [store, id]);
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-ui text-muted">
        <Link to="/" className="inline-flex items-center gap-1 text-muted no-underline hover:text-fg">
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Hall
        </Link>
        <span className="text-faint">/</span>
        <span>Assay desk</span>
      </nav>
      <DataState state={state} skeleton={<DeskSkeleton />}>
        {(b) => <RequestView bundle={b} reload={state.reload} notify={setToast} sealed={sealed === b.request.id} onSealed={() => setSealed(b.request.id)} />}
      </DataState>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function DeskSkeleton() {
  return (
    <div>
      <div className="mb-8 flex items-center gap-5">
        <Skeleton circle width={88} height={88} />
        <div className="flex-1">
          <Skeleton width={180} height={12} />
          <Skeleton width={320} height={28} className="mt-2" />
          <Skeleton width={260} height={14} className="mt-3" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-line bg-surface p-5">
          <SkeletonText lines={8} />
        </div>
        <div className="space-y-3">
          <SkeletonText lines={6} />
        </div>
      </div>
    </div>
  );
}

function RequestView({
  bundle,
  reload,
  notify,
  sealed,
  onSealed,
}: {
  bundle: RequestBundle;
  reload: () => Promise<void>;
  notify: (m: string) => void;
  sealed: boolean;
  onSealed: () => void;
}) {
  const { me } = useApp<Schema>();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const r = bundle.request;
  const items = neededItems(r.requestedLevel, r.checklistVersion);
  const self = currentAnswers(r, bundle.answers, 'self');
  const review = currentAnswers(r, bundle.answers, 'review');
  const failed = r.status === 'changes_requested' ? failedItems(r, bundle.answers) : [];
  const integrity = checkIntegrity(r, bundle.events, bundle.adminSubs);
  // A row that does not match its trail is shown read-only: it cannot be claimed or decided in the app.
  const canDecide = integrity.ok && decideBlocker(r, me) === null;
  const isOwner = r.ownerSub === me.sub;
  const reviewed = Object.keys(review).filter((k) => items.some((i) => i.key === k)).length;
  const mark = sealForRequest(r, now, { verified: integrity.ok, checked: reviewed, total: items.length, failed: failed.length });

  let main: ReactNode;
  if (canDecide) {
    main = <ReviewWorkspace key={bundle.answers.length} request={r} items={items} self={self} review={review} reload={reload} notify={notify} onSealed={onSealed} />;
  } else if (isOwner && r.status === 'changes_requested') {
    main = (
      <>
        <ResubmitPanel key={bundle.answers.length} request={r} items={items} self={self} review={review} failed={failed} bundle={bundle} reload={reload} notify={notify} />
        <Sheet title="The full assay" meta={`Checklist v${r.checklistVersion}`}>
          <ChecklistView items={items} self={self} review={review} highlight={failed} reviewerName={r.reviewerName} />
        </Sheet>
      </>
    );
  } else {
    main = (
      <Sheet title="The assay" meta={`${reviewed} of ${items.length} checked · checklist v${r.checklistVersion}`}>
        <ChecklistView items={items} self={self} review={review} highlight={failed} reviewerName={r.reviewerName} />
      </Sheet>
    );
  }

  return (
    <>
      <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="relative grid size-[104px] shrink-0 place-items-center">
          {sealed && r.status === 'approved' ? <WaxStamp size={104} {...mark} /> : <SealBadge size={96} {...mark} label={r.status === 'approved' ? `${LEVEL_LABEL[r.requestedLevel]} seal` : 'Unstamped blank'} />}
        </div>
        <div className="min-w-0 flex-1 basis-[18rem]">
          <div className="x-legend-label mb-1.5 text-muted">
            {LEVEL_LABEL[r.requestedLevel]} request · {r.workspace}
          </div>
          <h1 className="m-0 text-2xl font-semibold break-words md:text-[30px] md:leading-9">{r.modelName}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-ui text-muted">
            <StatusChip status={r.status} />
            <LevelMark level={r.requestedLevel} />
            {r.status === 'approved' && r.requestedLevel === 'certified' && <ExpiryChip state={expiryState(r, now)} expiresAt={r.expiresAt} />}
            <span>
              Owner <span className="text-fg">{r.ownerName}</span>
            </span>
            <span>
              Reviewer <span className="text-fg">{r.reviewerName ?? 'not claimed'}</span>
            </span>
            <span className="num">submitted {formatRelative(r.submittedAt, now)}</span>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        <div className="min-w-0 space-y-5">
          {!integrity.ok && (
            <div role="alert" data-testid="integrity-warning">
              <Callout tone="bad" title="This request's record does not match its decision trail">
                <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4">
                  {integrity.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
                <p className="m-0 mt-2">It was probably changed outside the app. It cannot be claimed or decided here until the deployer fixes the row in SQL (see the README).</p>
              </Callout>
            </div>
          )}
          {r.status === 'approved' && integrity.ok && (
            <section aria-label="Sealed" className="flex flex-wrap items-start gap-4 rounded-xl border border-[color-mix(in_oklab,var(--accent-9)_35%,var(--line))] bg-[color-mix(in_oklab,var(--accent-9)_7%,var(--surface))] p-4 sm:p-5">
              <div className="min-w-0 flex-1 basis-[16rem]">
                <div className="text-base font-semibold text-fg">
                  {sealed ? 'Sealed. ' : ''}
                  {r.requestedLevel === 'certified' ? `Certified until ${formatDate(r.expiresAt)}` : 'Promoted, no expiry'}
                </div>
                <p className="m-0 mt-1 text-ui text-muted">
                  Approved by {r.reviewerName} on {formatDate(r.decidedAt)}. The seal hangs in the hall
                  {r.requestedLevel === 'certified' ? ` and its arc drains toward renewal over ${rules.certifiedValidityMonths} months.` : '.'}
                </p>
                <div className="mt-3">
                  <BadgeReminder level={r.requestedLevel} compact />
                </div>
              </div>
              <Button icon={<Landmark />} onClick={() => navigate('/', { state: sealed ? { stamped: r.id } : { focus: r.id } })} data-testid="see-in-hall">
                See it in the hall
              </Button>
            </section>
          )}
          {integrity.ok && <ClaimPanel request={r} reload={reload} notify={notify} />}
          {main}
        </div>
        <aside className="min-w-0 space-y-8" aria-label="Request details and trail">
          <section>
            <h2 className="x-legend-label m-0 mb-3 text-muted">The record</h2>
            <Details request={r} renewalOf={bundle.renewalOf} />
            <OwnerActions request={r} reload={reload} notify={notify} />
          </section>
          <section>
            <h2 className="x-legend-label m-0 mb-3 text-muted">Decision trail</h2>
            <EventTrail events={bundle.events} ignored={integrity.ignored} />
          </section>
        </aside>
      </div>
    </>
  );
}

/** A panel holding the checklist rows (one panel, rows divided by hairlines). */
function Sheet({ title, meta, children, actions, className, ...rest }: { title: ReactNode; meta?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string } & Record<`data-${string}`, string>) {
  return (
    <section className={cx('overflow-hidden rounded-xl border border-line bg-surface', className)} {...rest}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="m-0 text-base font-semibold">{title}</h2>
          {meta && <span className="font-mono text-[11px] text-muted num">{meta}</span>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-1.5">
      <dt className="text-ui text-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-ui text-fg">{children}</dd>
    </div>
  );
}

function Details({ request: r, renewalOf }: { request: EndorsementRequest; renewalOf: EndorsementRequest | null }) {
  return (
    <>
      <dl className="m-0 divide-y divide-[var(--line)] border-y border-line">
        <Row label="Submitted">
          <span className="font-mono text-xs num">{formatDateTime(r.submittedAt)}</span>
        </Row>
        {r.lastResubmittedAt && (
          <Row label="Resubmitted">
            <span className="font-mono text-xs num">{formatDateTime(r.lastResubmittedAt)}</span>
          </Row>
        )}
        {r.decidedAt && (
          <Row label="Decided">
            <span className="font-mono text-xs num">{formatDateTime(r.decidedAt)}</span>
          </Row>
        )}
        {r.status === 'approved' && (
          <Row label="Expires">
            <span className="font-mono text-xs num">{r.expiresAt ? formatDate(r.expiresAt) : 'No expiry'}</span>
          </Row>
        )}
        <Row label="Checklist">
          Version {r.checklistVersion}
          {r.checklistVersion !== CURRENT_CHECKLIST_VERSION && <span className="text-muted"> (older version)</span>}
        </Row>
        {r.modelUrl && (
          <Row label="Model">
            {isHttpUrl(r.modelUrl) ? (
              <a href={r.modelUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1">
                Open in Fabric
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="text-muted">Link hidden (not a web address)</span>
            )}
          </Row>
        )}
        {renewalOf && (
          <Row label="Renews">
            <Link to={`/requests/${renewalOf.id}`}>Approval of {formatDate(renewalOf.decidedAt)}</Link>
          </Row>
        )}
      </dl>
      <h3 className="x-legend-label m-0 mt-5 mb-2 text-muted">The owner's case</h3>
      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-fg">{r.justification}</p>
    </>
  );
}

/* ------------------------------------------------------------------ claim */

function ClaimPanel({ request: r, reload, notify }: { request: EndorsementRequest; reload: () => Promise<void>; notify: (m: string) => void }) {
  const { store, me, isAdmin } = useApp<Schema>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  if (r.status === 'in_review' && r.reviewerSub !== me.sub) {
    return (
      <Callout tone="info" title={`In review with ${r.reviewerName}.`}>
        Only they can record results and decide.
      </Callout>
    );
  }
  if (r.status !== 'submitted') return null;
  if (!isAdmin) {
    return (
      <Callout tone="info" title="Waiting for a reviewer.">
        {r.ownerSub === me.sub ? 'A reviewer claims it from the assay desk; you can withdraw it until it is decided.' : 'A reviewer will claim it from the assay desk.'}
      </Callout>
    );
  }
  const blocker = claimBlocker(r, me);
  return (
    <section className={cx('flex flex-wrap items-center gap-4 rounded-xl border px-4 py-4 sm:px-5', blocker ? 'border-line bg-surface-sunken' : 'border-[color-mix(in_oklab,var(--accent-9)_40%,var(--line))] bg-[color-mix(in_oklab,var(--accent-9)_8%,var(--surface))]')}>
      <div className="min-w-0 flex-1 basis-[16rem]">
        <h2 className="m-0 text-base font-semibold">{blocker ? 'You cannot assay this one' : 'Ready for assay'}</h2>
        <p className="m-0 mt-1 text-ui text-muted" id={reasonId} data-testid={blocker ? 'claim-blocked' : undefined}>
          {blocker ?? 'Claim it to record a verdict per item. Once claimed, only you can decide it.'}
        </p>
        <InlineError error={error} />
      </div>
      <Button
        variant="primary"
        disabled={!!blocker}
        aria-describedby={reasonId}
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await claimRequest(store, me, r.id);
            notify('Claimed. Record a verdict for every item, then decide.');
            await reload();
          } catch (e) {
            setError(describeError(e).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Claim for review
      </Button>
    </section>
  );
}

/* ------------------------------------------------------------------ review */

function itemErrors(items: ChecklistItem[], draft: Draft, requireAll: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) {
    const d = draft[item.key];
    if (!d?.result && !requireAll) continue;
    const msg = validateAnswer(item, d?.result, d?.evidence ?? '');
    if (msg) out[item.key] = msg;
  }
  return out;
}

function toMap(draft: Draft): AnswerMap {
  const out: AnswerMap = {};
  for (const [k, v] of Object.entries(draft)) if (v.result) out[k] = { result: v.result, evidence: v.evidence };
  return out;
}

const DECISIONS: Record<Decision, { label: string; title: string; done: string }> = {
  approve: { label: 'Approve', title: 'Approve and strike the seal', done: 'Sealed. The reviewer still applies the badge in Fabric.' },
  request_changes: { label: 'Request changes', title: 'Send back for changes', done: 'Sent back to the owner with the failing items marked.' },
  reject: { label: 'Reject', title: 'Reject this request', done: 'Rejected.' },
};

function ReviewWorkspace({
  request: r,
  items,
  self,
  review,
  reload,
  notify,
  onSealed,
}: {
  request: EndorsementRequest;
  items: ChecklistItem[];
  self: AnswerMap;
  review: AnswerMap;
  reload: () => Promise<void>;
  notify: (m: string) => void;
  onSealed: () => void;
}) {
  const { store, me } = useApp<Schema>();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(items, review));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Decision | null>(null);
  const hintId = useId();

  const check = useMemo(() => evaluateAnswers(r.requestedLevel, r.checklistVersion, toMap(draft)), [draft, r]);
  const reviewed = items.filter((i) => draft[i.key]?.result).length;
  const allReviewed = reviewed === items.length;
  const reasons = describeCheck(check, r.checklistVersion);
  const expiry = expiryFor(r.requestedLevel, new Date().toISOString());
  const passes = items.filter((i) => draft[i.key]?.result === 'pass' || draft[i.key]?.result === 'na').length;
  const fails = items.filter((i) => draft[i.key]?.result === 'fail').length;

  const persist = async () => {
    const errs = itemErrors(items, draft, false);
    setErrors(errs);
    if (Object.keys(errs).length) throw new Error('Fix the marked items first.');
    await saveReview(store, me, r.id, draftEntries(draft));
  };

  return (
    <>
      <Sheet
        title="Assay"
        meta={`checklist v${r.checklistVersion}`}
        actions={
          <span className="flex items-center gap-3">
            <Meter value={reviewed} max={items.length} size="sm" tone={allReviewed ? 'ok' : 'brand'} className="w-24" />
            <span className="font-mono text-xs text-muted num" data-testid="review-progress">
              {reviewed} of {items.length} reviewed
            </span>
          </span>
        }
      >
        <ChecklistForm
          items={items}
          draft={draft}
          errors={errors}
          reference={self}
          referenceLabel="Owner's claim"
          verdictLabel="Your verdict"
          onChange={(key, v) => {
            setDraft((d) => ({ ...d, [key]: v }));
            setErrors((e) => {
              if (!e[key]) return e;
              const { [key]: _drop, ...rest } = e;
              void _drop;
              return rest;
            });
          }}
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 sm:px-5">
          <Button
            size="sm"
            busy={saving}
            onClick={async () => {
              setSaving(true);
              setSaveError(null);
              try {
                await persist();
                notify('Assay saved.');
              } catch (e) {
                setSaveError(describeError(e).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save checklist
          </Button>
          <span className="text-ui text-muted">Deciding saves it too.</span>
          <InlineError error={saveError} className="mt-0 w-full" />
        </div>
      </Sheet>

      <section
        data-testid="decision-panel"
        aria-label="Decision"
        className="x-glass sticky bottom-[calc(var(--x-bottom-inset)+12px)] z-10 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl px-4 py-3 shadow-[var(--shadow-float)] sm:px-5"
      >
        <div id={hintId} className="min-w-0 flex-1 basis-[18rem] text-ui">
          <div className="flex items-center gap-3 font-mono text-xs num">
            <span className="text-ok-text">{passes} pass</span>
            <span className={fails ? 'text-bad-text' : 'text-muted'}>{fails} fail</span>
            <span className="text-muted">{items.length - reviewed} open</span>
          </div>
          {check.ok ? (
            <p className="m-0 mt-1 font-medium text-fg">Every item the {LEVEL_LABEL[r.requestedLevel].toLowerCase()} level needs is satisfied.</p>
          ) : (
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-muted">
              {!allReviewed && <li>Pass or fail every item before deciding.</li>}
              {reasons.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button variant="danger" disabled={!allReviewed} aria-describedby={hintId} onClick={() => setDialog('reject')} className="flex-1 sm:flex-none">
            Reject
          </Button>
          <Button disabled={!allReviewed} aria-describedby={hintId} onClick={() => setDialog('request_changes')} className="flex-1 sm:flex-none">
            Request changes
          </Button>
          <Button variant="primary" disabled={!check.ok} aria-describedby={hintId} onClick={() => setDialog('approve')} className="flex-1 sm:flex-none">
            Approve
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog ? DECISIONS[dialog].title : ''}
        confirmLabel={dialog ? DECISIONS[dialog].label : 'Confirm'}
        danger={dialog === 'reject'}
        noteLabel="Decision note"
        noteRequired
        noteMax={limits.decisionNote.max}
        body={
          dialog === 'approve' ? (
            <div className="space-y-3">
              <p className="m-0">
                {r.requestedLevel === 'certified' ? (
                  <>
                    The seal&apos;s arc runs out on <strong className="text-fg" data-testid="approve-expiry">{formatDate(expiry)}</strong> ({rules.certifiedValidityMonths} months from
                    today).
                  </>
                ) : (
                  'A Promoted seal does not expire.'
                )}
              </p>
              <BadgeReminder level={r.requestedLevel} compact />
            </div>
          ) : dialog === 'request_changes' ? (
            <p className="m-0">The owner sees the failing items marked. When they resubmit, their answers are kept and only the failed items come back to you.</p>
          ) : (
            <p className="m-0">Rejecting closes the request without a seal. The owner can submit a new one later.</p>
          )
        }
        onConfirm={async (note) => {
          if (!dialog) return;
          await persist();
          await decideRequest(store, me, r.id, dialog, note);
          notify(DECISIONS[dialog].done);
          if (dialog === 'approve') onSealed();
          setDialog(null);
          await reload();
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ owner */

function ResubmitPanel({
  request: r,
  items,
  self,
  review,
  failed,
  bundle,
  reload,
  notify,
}: {
  request: EndorsementRequest;
  items: ChecklistItem[];
  self: AnswerMap;
  review: AnswerMap;
  failed: string[];
  bundle: RequestBundle;
  reload: () => Promise<void>;
  notify: (m: string) => void;
}) {
  const { store, me } = useApp<Schema>();
  const failedDefs = items.filter((i) => failed.includes(i.key));
  const [draft, setDraft] = useState<Draft>(() => draftFrom(failedDefs, self));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const ask = [...bundle.events].reverse().find((e) => e.type === 'changes_requested');

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--warn-line)] bg-surface" data-testid="resubmit-panel">
      <div className="border-b border-line bg-warn-soft/40 px-4 py-4 sm:px-5">
        <h2 className="m-0 text-base font-semibold">Changes requested by {r.reviewerName}</h2>
        {ask?.note && <blockquote className="m-0 mt-2 border-l-2 border-warn-solid pl-3 text-sm leading-6">{ask.note}</blockquote>}
        <p className="m-0 mt-2 text-ui text-muted">
          {failedDefs.length
            ? `${failedDefs.length === 1 ? 'One item goes' : `${failedDefs.length} items go`} back to the reviewer. Everything that passed stays passed.`
            : 'No item is marked as failed. Say what you changed and resubmit.'}
        </p>
      </div>
      {failedDefs.length > 0 && (
        <ChecklistForm
          items={failedDefs}
          draft={draft}
          errors={errors}
          reference={review}
          referenceLabel="Reviewer's verdict"
          verdictLabel="Your answer"
          highlight={failed}
          onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
        />
      )}
      <div className="border-t border-line px-4 py-4 sm:px-5">
        <Field label="What changed" htmlFor={noteId} required error={noteError} counter={{ value: note.length, max: limits.note.max }}>
          <TextArea id={noteId} rows={3} value={note} onChange={(e) => setNote(e.target.value)} invalid={!!noteError} />
        </Field>
        <Button
          variant="primary"
          busy={busy}
          className="w-full sm:w-auto"
          onClick={async () => {
            const errs = itemErrors(failedDefs, draft, true);
            setErrors(errs);
            const n = note.trim();
            const nErr = !n
              ? 'What changed is required.'
              : n.length < limits.decisionNote.min
                ? `What changed needs at least ${limits.decisionNote.min} characters.`
                : n.length > limits.note.max
                  ? `Keep it to ${limits.note.max} characters.`
                  : null;
            setNoteError(nErr);
            if (Object.keys(errs).length || nErr) return;
            setBusy(true);
            setError(null);
            try {
              await resubmitRequest(store, me, r.id, { note, answers: draftEntries(draft) });
              notify(`Resubmitted. It is back on ${r.reviewerName}'s desk.`);
              await reload();
            } catch (e) {
              setError(describeError(e).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Resubmit for review
        </Button>
        <InlineError error={error} />
      </div>
    </section>
  );
}

function OwnerActions({ request: r, reload, notify }: { request: EndorsementRequest; reload: () => Promise<void>; notify: (m: string) => void }) {
  const { store, me } = useApp<Schema>();
  const [withdrawing, setWithdrawing] = useState(false);
  const canWithdraw = r.ownerSub === me.sub && isOpen(r.status);
  if (!canWithdraw) return null;
  return (
    <div className="mt-4">
      <Button size="sm" variant="ghost" onClick={() => setWithdrawing(true)}>
        Withdraw request
      </Button>
      <ConfirmDialog
        open={withdrawing}
        onClose={() => setWithdrawing(false)}
        title="Withdraw this request?"
        body="The request closes and stays in the trail. You can submit a new one later."
        confirmLabel="Withdraw"
        danger
        noteLabel="Reason (optional)"
        noteMax={limits.note.max}
        onConfirm={async (note) => {
          await withdrawRequest(store, me, r.id, note);
          notify('Withdrawn.');
          await reload();
        }}
      />
    </div>
  );
}

