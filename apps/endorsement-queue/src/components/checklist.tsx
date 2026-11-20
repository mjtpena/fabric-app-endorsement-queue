/**
 * The checklist on the assay desk: one row per item, the owner's claim beside the reviewer's verdict. The same rows
 * take the owner's self-assessment on Submit and the fixes on a resubmission.
 */
import { useId } from 'react';

import { isHttpUrl } from '@x10/shared/lib';
import { cx, TextArea } from '@x10/shared/ui';

import type { ChecklistItem } from '../config/checklist';
import type { AnswerMap } from '../domain/approval';
import { limits, type Result } from '../model';
import { ResultChip } from './chips';

/** Evidence text; a plain http(s) address becomes a link, anything else stays text (never a javascript: link). */
export function EvidenceText({ text, className }: { text: string | null | undefined; className?: string }) {
  const v = (text ?? '').trim();
  if (!v) return null;
  if (isHttpUrl(v) && !/\s/.test(v)) {
    return (
      <a href={v} target="_blank" rel="noreferrer noopener" className={cx('break-all', className)}>
        {v}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return <span className={cx('break-words', className)}>{v}</span>;
}

export interface DraftAnswer {
  result: Result | null;
  evidence: string;
}
export type Draft = Record<string, DraftAnswer>;

/** Draft values from saved answers (missing items start unanswered). */
export function draftFrom(items: ChecklistItem[], saved: AnswerMap): Draft {
  return Object.fromEntries(
    items.map((i) => [i.key, { result: saved[i.key]?.result ?? null, evidence: saved[i.key]?.evidence ?? '' }]),
  );
}

export function draftEntries(draft: Draft) {
  return Object.entries(draft).map(([itemKey, v]) => ({ itemKey, result: v.result, evidence: v.evidence }));
}

const RESULT_DOT: Record<Result, string> = { pass: 'bg-ok-solid', fail: 'bg-bad-solid', na: 'bg-gray-9' };
const RESULT_ON: Record<Result, string> = {
  pass: 'peer-checked:bg-ok-soft peer-checked:text-ok-text peer-checked:ring-[var(--ok-line)]',
  fail: 'peer-checked:bg-bad-soft peer-checked:text-bad-text peer-checked:ring-[var(--bad-line)]',
  na: 'peer-checked:bg-gray-4 peer-checked:text-fg peer-checked:ring-line-strong',
};

/** Pass / Fail / N/A as a segmented radio group (dot + label, no glyphs). */
function ResultRadios({
  item,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  item: ChecklistItem;
  value: Result | null;
  onChange: (r: Result) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const name = useId();
  const options: { v: Result; label: string }[] = [
    { v: 'pass', label: 'Pass' },
    { v: 'fail', label: 'Fail' },
  ];
  if (item.naAllowed) options.push({ v: 'na', label: 'N/A' });
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" aria-invalid={invalid || undefined} aria-describedby={describedBy}>
      <legend className="sr-only">Result for {item.label}</legend>
      <div className={cx('inline-flex gap-1 rounded-lg bg-surface-sunken p-1 ring-1 ring-inset', invalid ? 'ring-[var(--bad-line)]' : 'ring-line')}>
        {options.map((o) => (
          <label key={o.v} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              value={o.v}
              checked={value === o.v}
              onChange={() => onChange(o.v)}
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span
              className={cx(
                'x-tap inline-flex h-7 min-w-[64px] items-center justify-center gap-1.5 rounded-md px-2.5 text-ui font-medium text-muted ring-1 ring-inset ring-transparent transition-colors duration-[120ms]',
                'hover:text-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[var(--focus)]',
                'peer-checked:shadow-xs',
                RESULT_ON[o.v],
              )}
            >
              <span aria-hidden="true" className={cx('size-1.5 rounded-full', RESULT_DOT[o.v])} />
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The owner's (or reviewer's) earlier answer, quoted. */
function Claim({ label, answer }: { label: string; answer?: AnswerMap[string] }) {
  return (
    <div className="min-w-0">
      <div className="x-legend-label mb-1.5 text-faint">{label}</div>
      <ResultChip result={answer?.result} />
      {answer?.evidence?.trim() ? (
        <p className="m-0 mt-1.5 border-l-2 border-line-strong pl-2.5 text-ui leading-5 text-muted">
          <EvidenceText text={answer.evidence} />
        </p>
      ) : (
        answer && <p className="m-0 mt-1.5 text-ui text-faint">No evidence given.</p>
      )}
    </div>
  );
}

/**
 * Editable checklist rows. With `reference`, each row is two columns: the earlier answer (the owner's claim while
 * reviewing, the reviewer's verdict while fixing) beside the new verdict and its evidence.
 */
export function ChecklistForm({
  items,
  draft,
  onChange,
  errors,
  reference,
  referenceLabel,
  verdictLabel = 'Verdict',
  highlight,
}: {
  items: ChecklistItem[];
  draft: Draft;
  onChange: (key: string, v: DraftAnswer) => void;
  errors?: Record<string, string>;
  reference?: AnswerMap;
  referenceLabel?: string;
  verdictLabel?: string;
  highlight?: string[];
}) {
  return (
    <ol className="m-0 list-none divide-y divide-[var(--line)] p-0">
      {items.map((item, idx) => (
        <ChecklistRow
          key={item.key}
          index={idx + 1}
          item={item}
          value={draft[item.key] ?? { result: null, evidence: '' }}
          onChange={(v) => onChange(item.key, v)}
          error={errors?.[item.key]}
          reference={reference ? (reference[item.key] ?? null) : undefined}
          referenceLabel={referenceLabel}
          verdictLabel={verdictLabel}
          highlighted={highlight?.includes(item.key)}
        />
      ))}
    </ol>
  );
}

function ItemHead({ index, item, highlighted }: { index: number; item: ChecklistItem; highlighted?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-faint num">{String(index).padStart(2, '0')}</span>
        <span className="font-medium text-fg">{item.label}</span>
        {highlighted && <span className="text-xs font-medium text-warn-text">Needs work</span>}
      </div>
      <p className="m-0 mt-1 text-ui leading-5 text-muted">
        {item.help}
        {item.naAllowed && <span className="text-faint"> N/A allowed, with evidence.</span>}
      </p>
    </div>
  );
}

function ChecklistRow({
  index,
  item,
  value,
  onChange,
  error,
  reference,
  referenceLabel,
  verdictLabel,
  highlighted,
}: {
  index: number;
  item: ChecklistItem;
  value: DraftAnswer;
  onChange: (v: DraftAnswer) => void;
  error?: string;
  reference?: AnswerMap[string] | null;
  referenceLabel?: string;
  verdictLabel: string;
  highlighted?: boolean;
}) {
  const evId = useId();
  const errId = useId();
  const evidenceRequired = value.result === 'na';
  const two = reference !== undefined;
  return (
    <li
      data-testid={`item-${item.key}`}
      className={cx(
        'relative px-4 py-4 sm:px-5',
        error ? 'bg-bad-soft/40' : highlighted ? 'bg-warn-soft/50' : undefined,
      )}
    >
      {(error || highlighted) && <span aria-hidden="true" className={cx('absolute inset-y-0 left-0 w-[3px]', error ? 'bg-bad-solid' : 'bg-warn-solid')} />}
      <div className={cx('grid gap-x-6 gap-y-3', two ? 'lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.15fr)]' : 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]')}>
        <ItemHead index={index} item={item} highlighted={highlighted} />
        {two && <Claim label={referenceLabel ?? 'Earlier answer'} answer={reference ?? undefined} />}
        <div className="min-w-0">
          {two && <div className="x-legend-label mb-1.5 text-faint">{verdictLabel}</div>}
          <ResultRadios item={item} value={value.result} onChange={(r) => onChange({ ...value, result: r })} invalid={!!error} describedBy={error ? errId : undefined} />
          <div className="mt-2">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label htmlFor={evId} className="text-xs font-medium text-muted">
                Evidence<span className="sr-only"> for {item.label}: link or short note</span>
                {evidenceRequired ? <span className="text-warn-text"> (required for N/A)</span> : null}
              </label>
              <span className={cx('font-mono text-[11px] num', value.evidence.length > limits.evidence.max ? 'font-semibold text-bad-text' : 'text-faint')}>
                {value.evidence.length}/{limits.evidence.max}
              </span>
            </div>
            <TextArea
              id={evId}
              rows={2}
              value={value.evidence}
              placeholder="Link or short note"
              onChange={(e) => onChange({ ...value, evidence: e.target.value })}
              invalid={!!error}
              aria-describedby={error ? errId : undefined}
            />
          </div>
          {error && (
            <p id={errId} role="alert" className="m-0 mt-1.5 text-ui font-medium text-bad-text">
              {error}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

/** Read-only checklist: the owner's claim beside the reviewer's verdict. */
export function ChecklistView({
  items,
  self,
  review,
  highlight,
  reviewerName,
}: {
  items: ChecklistItem[];
  self: AnswerMap;
  review: AnswerMap;
  highlight?: string[];
  reviewerName?: string | null;
}) {
  return (
    <ol className="m-0 list-none divide-y divide-[var(--line)] p-0" data-testid="checklist-view">
      {items.map((item, idx) => {
        const hot = highlight?.includes(item.key);
        return (
          <li key={item.key} data-testid={`view-${item.key}`} className={cx('relative px-4 py-4 sm:px-5', hot && 'bg-warn-soft/50')}>
            {hot && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-warn-solid" />}
            <div className="grid gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <ItemHead index={idx + 1} item={item} highlighted={hot} />
              <Claim label="Owner's claim" answer={self[item.key]} />
              <Claim label={reviewerName ? `Assay · ${reviewerName}` : 'Assay'} answer={review[item.key]} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
