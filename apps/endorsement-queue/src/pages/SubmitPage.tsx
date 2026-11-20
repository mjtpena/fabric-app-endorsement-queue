/** Submit (or renew): the model, its level, the owner's case and a self-assessment, with the blank previewed live. */
import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { describeError, formatDate, hasErrors, useAsync, type Errors } from '@x10/shared/lib';
import { useApp } from '@x10/shared/runtime';
import { Button, Callout, cx, ErrorPanel, Field, InlineError, Input, PageHeader, Skeleton, SkeletonText, TextArea } from '@x10/shared/ui';

import { ChecklistForm, draftEntries, type Draft } from '../components/checklist';
import { CURRENT_CHECKLIST_VERSION, neededItems } from '../config/checklist';
import { rules } from '../config/rules';
import { DuplicateRequestError, emptyInput, getRequest, renewalInput, validateRequestInput, type RequestInput } from '../domain/requests';
import { submitRequest, validateAnswers } from '../domain/workflow';
import { sealInitials, sealSeed } from '../hall/geometry';
import { levelRim, SealBadge } from '../hall/Seal';
import { LEVEL_LABEL } from '../labels';
import { limits, type EndorsementRequest, type Level, type Schema } from '../model';

const LEVEL_TEXT: Record<Level, string> = {
  promoted: `${neededItems('promoted', CURRENT_CHECKLIST_VERSION).length} checks. Ready to use. No expiry.`,
  certified: `${neededItems('certified', CURRENT_CHECKLIST_VERSION).length} checks. The trusted source. Runs out after ${rules.certifiedValidityMonths} months.`,
};

export function SubmitPage() {
  const { store } = useApp<Schema>();
  const [params] = useSearchParams();
  const renewId = params.get('renew');
  const renewal = useAsync(() => (renewId ? getRequest(store, renewId) : Promise.resolve(null)), [store, renewId]);

  if (renewId && renewal.loading)
    return (
      <div role="status" aria-label="Loading">
        <Skeleton width={260} height={28} />
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <SkeletonText lines={6} />
        </div>
      </div>
    );
  if (renewId && renewal.error) return <ErrorPanel error={renewal.error} onRetry={() => void renewal.reload()} />;
  return <SubmitForm key={renewId ?? 'new'} renewalOf={renewal.data ?? null} />;
}

function SubmitForm({ renewalOf }: { renewalOf: EndorsementRequest | null }) {
  const { store, me } = useApp<Schema>();
  const navigate = useNavigate();
  const ids = { name: useId(), ws: useId(), url: useId(), just: useId(), level: useId() };
  const [v, setV] = useState<RequestInput>(() => (renewalOf ? renewalInput(renewalOf) : emptyInput()));
  const [draft, setDraft] = useState<Draft>({});
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; existing?: EndorsementRequest } | null>(null);

  const items = useMemo(() => (v.requestedLevel ? neededItems(v.requestedLevel, CURRENT_CHECKLIST_VERSION) : []), [v.requestedLevel]);
  const errors: Errors<RequestInput> = showErrors ? validateRequestInput(v) : {};
  const itemErrors = showErrors && v.requestedLevel ? validateAnswers(v.requestedLevel, CURRENT_CHECKLIST_VERSION, draftEntries(draft)) : {};

  useEffect(() => setFailure(null), [v.modelName, v.workspace]);

  const set = (k: keyof RequestInput) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [k]: e.target.value }));

  const submit = async () => {
    setShowErrors(true);
    setFailure(null);
    const errs = validateRequestInput(v);
    const answerErrs = v.requestedLevel ? validateAnswers(v.requestedLevel, CURRENT_CHECKLIST_VERSION, draftEntries(draft)) : {};
    if (hasErrors(errs) || Object.keys(answerErrs).length) {
      const firstKey = Object.keys(errs)[0];
      const map: Record<string, string> = { modelName: ids.name, workspace: ids.ws, modelUrl: ids.url, justification: ids.just, requestedLevel: ids.level };
      const target = firstKey ? map[firstKey] : null;
      if (target) document.getElementById(target)?.focus();
      return;
    }
    setBusy(true);
    try {
      const created = await submitRequest(store, me, v, draftEntries(draft), { renewalOfId: renewalOf?.id ?? null });
      navigate(`/requests/${created.id}`, { state: { flash: 'Submitted. Your blank is on the assay bench.' } });
    } catch (err) {
      if (err instanceof DuplicateRequestError) setFailure({ message: err.message, existing: err.existing });
      else setFailure({ message: describeError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const unanswered = items.filter((i) => !draft[i.key]?.result);
  const previewName = v.modelName.trim() || 'New model';
  const previewLevel: Level = v.requestedLevel || 'promoted';

  return (
    <>
      <PageHeader eyebrow={renewalOf ? 'Renewal' : 'New request'} title={renewalOf ? `Renew ${renewalOf.modelName}` : 'Submit a model for a seal'} />
      {renewalOf && (
        <Callout tone="info" title={`Renewing the ${LEVEL_LABEL[renewalOf.requestedLevel].toLowerCase()} seal of ${formatDate(renewalOf.decidedAt)}`} className="mb-6">
          It runs out {formatDate(renewalOf.expiresAt)}. The fields are copied from it; you own the renewal. Answer the current checklist afresh.
        </Callout>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"
      >
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
            <h2 className="x-legend-label m-0 mb-4 text-muted">The model</h2>
            <div className="grid gap-x-4 md:grid-cols-2">
              <Field label="Model name" htmlFor={ids.name} required error={errors.modelName} counter={{ value: v.modelName.length, max: limits.modelName.max }}>
                <Input id={ids.name} value={v.modelName} onChange={set('modelName')} invalid={!!errors.modelName} autoComplete="off" />
              </Field>
              <Field label="Workspace" htmlFor={ids.ws} required error={errors.workspace} counter={{ value: v.workspace.length, max: limits.workspace.max }}>
                <Input id={ids.ws} value={v.workspace} onChange={set('workspace')} invalid={!!errors.workspace} autoComplete="off" />
              </Field>
            </div>
            <Field label="Model link (optional)" htmlFor={ids.url} error={errors.modelUrl} hint="The semantic model's address in Fabric, so reviewers can open it.">
              <Input id={ids.url} type="url" inputMode="url" value={v.modelUrl} onChange={set('modelUrl')} invalid={!!errors.modelUrl} placeholder="https://" />
            </Field>
            <fieldset className="m-0 mb-4 border-0 p-0" aria-describedby={errors.requestedLevel ? `${ids.level}-err` : undefined}>
              <legend className="mb-2 text-ui font-medium">
                Level<span className="text-bad-text" aria-hidden="true"> *</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['promoted', 'certified'] as Level[]).map((lvl, i) => (
                  <label
                    key={lvl}
                    className={cx(
                      'relative flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors duration-[120ms] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
                      v.requestedLevel === lvl ? 'border-accent-8 bg-[color-mix(in_oklab,var(--accent-9)_8%,var(--surface))]' : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <input
                      id={i === 0 ? ids.level : undefined}
                      type="radio"
                      name="level"
                      value={lvl}
                      checked={v.requestedLevel === lvl}
                      onChange={() => setV((cur) => ({ ...cur, requestedLevel: lvl }))}
                      className="absolute inset-0 z-[1] h-full w-full cursor-pointer opacity-0"
                    />
                    <SealBadge
                      size={42}
                      kind="seal"
                      seed={lvl === 'certified' ? 11 : 5}
                      initials={lvl === 'certified' ? 'C' : 'P'}
                      level={lvl}
                      rim={levelRim(lvl)}
                      fraction={lvl === 'certified' ? 1 : null}
                      arcTone={lvl === 'certified' ? 'ok' : null}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{LEVEL_LABEL[lvl]}</span>
                      <span className="block text-ui text-muted">{LEVEL_TEXT[lvl]}</span>
                    </span>
                  </label>
                ))}
              </div>
              {errors.requestedLevel && (
                <p id={`${ids.level}-err`} role="alert" className="m-0 mt-1.5 text-ui font-medium text-bad-text">
                  {errors.requestedLevel}
                </p>
              )}
            </fieldset>
            <Field
              label="Justification"
              htmlFor={ids.just}
              required
              error={errors.justification}
              counter={{ value: v.justification.length, max: limits.justification.max }}
              hint="Who uses it, for what, and why people should be told to trust it."
              className="mb-0"
            >
              <TextArea id={ids.just} rows={4} value={v.justification} onChange={set('justification')} invalid={!!errors.justification} />
            </Field>
          </section>

          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <div className="flex items-baseline gap-3">
                <h2 className="m-0 text-base font-semibold">Self-assessment</h2>
                <span className="font-mono text-[11px] text-muted num">checklist v{CURRENT_CHECKLIST_VERSION}</span>
              </div>
              {items.length > 0 && unanswered.length > 0 && (
                <Button
                  size="sm"
                  onClick={() =>
                    setDraft((d) => {
                      const next = { ...d };
                      for (const i of unanswered) next[i.key] = { result: 'pass', evidence: d[i.key]?.evidence ?? '' };
                      return next;
                    })
                  }
                >
                  Mark {unanswered.length} unanswered as Pass
                </Button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="m-0 px-5 py-8 text-center text-ui text-muted">Choose a level to see its checklist. A Fail here is fine: it saves the reviewer a round trip.</p>
            ) : (
              <ChecklistForm items={items} draft={draft} errors={itemErrors} onChange={(key, val) => setDraft((d) => ({ ...d, [key]: val }))} />
            )}
          </section>

          {failure && (
            <div role="alert" data-testid="submit-failure">
              <Callout
                tone="bad"
                title={failure.message}
                action={
                  failure.existing && (
                    <Link to={`/requests/${failure.existing.id}`} className="font-medium">
                      Open the existing request
                    </Link>
                  )
                }
              />
            </div>
          )}
          {showErrors && (hasErrors(errors) || Object.keys(itemErrors).length > 0) && <InlineError error="Fix the marked fields, then submit again." />}
          <div className="x-glass sticky bottom-[calc(var(--x-bottom-inset)+12px)] z-10 flex gap-2 rounded-xl p-2 shadow-[var(--shadow-float)] sm:static sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none">
            <Button type="submit" variant="primary" size="lg" busy={busy} className="flex-1 sm:flex-none">
              Submit request
            </Button>
            <Button size="lg" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </div>

        <aside className="hidden lg:block" aria-label="Preview of your blank">
          <div className="sticky top-[calc(var(--header-h)+24px)] flex flex-col items-center rounded-xl border border-line bg-[linear-gradient(180deg,var(--hall-wall-2),var(--hall-wall))] px-6 pt-8 pb-6 text-center">
            <SealBadge
              size={168}
              kind="blank"
              seed={sealSeed(previewName, v.workspace)}
              initials={sealInitials(previewName)}
              level={previewLevel}
              rim={v.requestedLevel ? levelRim(previewLevel) : 'pending'}
              status="submitted"
            />
            <div className="mt-5 text-base font-semibold break-words text-fg">{v.modelName.trim() || 'Your model'}</div>
            <div className="x-legend-label mt-1 text-muted">{v.workspace.trim() || 'Workspace'}</div>
            <p className="m-0 mt-4 text-ui text-muted">
              {items.length ? `${items.length - unanswered.length} of ${items.length} answered. ` : ''}
              The blank waits on the assay bench until a reviewer strikes its seal.
            </p>
          </div>
        </aside>
      </form>
    </>
  );
}
