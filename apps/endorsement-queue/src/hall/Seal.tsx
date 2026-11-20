/**
 * The seal: a procedurally generated medallion (guilloché rings, initials, a level ring, an expiry arc that drains
 * toward renewal), and the unstamped wax blank an open request shows until it is approved. Drawn in a unit space of
 * radius ~120; `SealBadge` wraps it in its own <svg> for tables, the desk and the register.
 */
import { useEffect, useId, useState, type CSSProperties } from 'react';

import { useReducedMotion } from '@x10/shared/ui';

import type { HallItem, RimKey } from '../domain/hall';
import { CATEGORY_COUNT } from '../domain/hall';
import type { Level } from '../model';
import { arcTip, crackPath, rosette, scallopPath, waxOutline } from './geometry';

export const RIM_COLOR: Record<string, string> = {
  gold: 'var(--seal-gold)',
  slate: 'var(--seal-slate)',
  ok: 'var(--ok-solid)',
  warn: 'var(--warn-solid)',
  bad: 'var(--bad-solid)',
  none: 'var(--seal-none)',
  pending: 'var(--seal-pending)',
  ...Object.fromEntries(Array.from({ length: CATEGORY_COUNT }, (_, i) => [`c${i}`, `var(--seal-c${i})`])),
};

/** Rims light enough that the engraving is dark ink rather than light. */
const LIGHT_RIMS = new Set<string>(['gold', 'warn', 'c5', 'c7', 'none', 'pending']);

export const rimColor = (k: RimKey) => RIM_COLOR[k] ?? RIM_COLOR.none;
export const levelRim = (l: Level): RimKey => (l === 'certified' ? 'gold' : 'slate');

const ARC_COLOR = { ok: 'var(--ok-solid)', warn: 'var(--warn-solid)', bad: 'var(--bad-solid)' } as const;

/** Gradients and filters every seal uses. Mount once per page (App does). */
export function SealDefs() {
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} focusable="false">
      <defs>
        {Object.entries(RIM_COLOR).map(([k, c]) => (
          <linearGradient key={k} id={`eq-metal-${k}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`color-mix(in oklab, ${c} 52%, white)`} />
            <stop offset="38%" stopColor={c} />
            <stop offset="62%" stopColor={`color-mix(in oklab, ${c} 72%, black)`} />
            <stop offset="82%" stopColor={c} />
            <stop offset="100%" stopColor={`color-mix(in oklab, ${c} 80%, white)`} />
          </linearGradient>
        ))}
        <radialGradient id="eq-face" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="var(--seal-face-hi)" />
          <stop offset="100%" stopColor="var(--seal-face-lo)" />
        </radialGradient>
        <radialGradient id="eq-wax" cx="40%" cy="34%" r="72%">
          <stop offset="0%" stopColor="var(--wax-hi)" />
          <stop offset="100%" stopColor="var(--wax-lo)" />
        </radialGradient>
        <linearGradient id="eq-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.55" />
          <stop offset="45%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="eq-pool" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="var(--hall-light)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--hall-light)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="eq-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--hall-light)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--hall-light)" stopOpacity="0" />
        </linearGradient>
        <filter id="eq-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
    </svg>
  );
}

export interface SealMarkProps {
  kind: 'seal' | 'blank';
  seed: number;
  initials: string;
  level: Level;
  rim: RimKey;
  /** Text engraved around the rim. */
  legend?: string;
  /** Seal: validity left (null = no expiry). */
  fraction?: number | null;
  arcTone?: 'ok' | 'warn' | 'bad' | null;
  verified?: boolean;
  /** Blank: request status and the reviewer's progress. */
  status?: 'submitted' | 'in_review' | 'changes_requested';
  checked?: number;
  total?: number;
  failed?: number;
  detail?: 'full' | 'small';
  /** Animate the expiry arc draining from full to its value when it first shows. */
  drain?: boolean;
  /** Show the expiry arc emphasised (expiry lens). */
  emphasiseArc?: boolean;
}

/** Props for a SealMark from a hall item, coloured by `rim`. */
export function sealProps(item: HallItem, rim: RimKey): SealMarkProps {
  const r = item.request;
  if (item.kind === 'seal') {
    const year = (r.decidedAt ?? r.submittedAt).slice(0, 4);
    return {
      kind: 'seal',
      seed: item.seed,
      initials: item.initials,
      level: item.level,
      rim,
      legend: `${item.level === 'certified' ? 'CERTIFIED' : 'PROMOTED'} · ${r.workspace.toUpperCase()} · ${year}`,
      fraction: item.fraction,
      arcTone: item.expiry.kind === 'expired' ? 'bad' : item.expiry.kind === 'due' ? 'warn' : item.expiry.kind === 'valid' ? 'ok' : null,
      verified: item.verified,
    };
  }
  return {
    kind: 'blank',
    seed: item.seed,
    initials: item.initials,
    level: item.level,
    rim,
    status: item.status,
    checked: item.checked,
    total: item.total,
    failed: item.failed,
    verified: !item.issue,
  };
}

const C_ARC = 2 * Math.PI * 112;

export function SealMark(p: SealMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const reduced = useReducedMotion();
  const detail = p.detail ?? 'full';
  const ros = rosette(p.seed, detail);
  const base = rimColor(p.rim);
  const metal = `url(#eq-metal-${p.rim in RIM_COLOR ? p.rim : 'none'})`;

  // The arc drains from full to its value on first show (unless reduced motion).
  const target = p.fraction ?? 1;
  const [shown, setShown] = useState(p.drain && !reduced ? 1 : target);
  useEffect(() => {
    if (!p.drain || reduced) {
      setShown(target);
      return;
    }
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setShown(target)));
    return () => cancelAnimationFrame(t);
  }, [target, p.drain, reduced]);

  if (p.kind === 'blank') return <BlankMark {...p} uid={uid} base={base} />;

  const engrave = LIGHT_RIMS.has(p.rim) ? 'rgb(36 26 4 / 0.66)' : 'rgb(255 255 255 / 0.86)';
  const size = p.initials.length <= 2 ? 36 : p.initials.length === 3 ? 28 : 22;
  const hasExpiry = p.fraction !== null && p.fraction !== undefined;
  const tone = p.arcTone ? ARC_COLOR[p.arcTone] : base;
  const tip = arcTip(112, shown);
  return (
    <g>
      {/* expiry arc (outside the wax): drains toward renewal */}
      {hasExpiry ? (
        <g>
          <circle r={112} fill="none" stroke="var(--hall-ink-muted)" strokeOpacity={0.16} strokeWidth={p.emphasiseArc ? 7 : 5} />
          {shown > 0.002 && (
            <>
              <circle
                className="eq-arc"
                r={112}
                fill="none"
                stroke={tone}
                strokeWidth={p.emphasiseArc ? 8 : 5}
                strokeLinecap="round"
                strokeDasharray={`${C_ARC} ${C_ARC}`}
                strokeDashoffset={C_ARC * (1 - shown)}
                transform="rotate(-90)"
              />
              <circle cx={tip[0]} cy={tip[1]} r={p.emphasiseArc ? 6 : 4.5} fill={tone} stroke="var(--seal-face-hi)" strokeWidth={1.5} />
            </>
          )}
          {shown <= 0.002 && <circle cx={0} cy={-112} r={5} fill="var(--bad-solid)" />}
        </g>
      ) : (
        <circle r={112} fill="none" stroke="var(--hall-ink-muted)" strokeOpacity={0.28} strokeWidth={1.2} strokeDasharray="1.5 6" strokeLinecap="round" />
      )}

      {/* wax skirt */}
      <path d={waxOutline(p.seed, 103)} fill={`color-mix(in oklab, ${base} 70%, #24180a)`} className="eq-rim-fill" opacity={0.92} />
      <path d={waxOutline(p.seed + 7, 100.5, 0.03)} fill={`color-mix(in oklab, ${base} 86%, #2b1c08)`} className="eq-rim-fill" />

      {/* level ring: scalloped for Certified, plain for Promoted */}
      {p.level === 'certified' ? (
        <path d={scallopPath(94, 32, 3.4)} fill={metal} className="eq-rim-fill" />
      ) : (
        <circle r={95} fill={metal} className="eq-rim-fill" />
      )}
      <circle r={95.5} fill="none" stroke="rgb(0 0 0 / 0.18)" strokeWidth={0.8} />
      <circle r={79.5} fill="none" stroke="rgb(0 0 0 / 0.28)" strokeWidth={1.2} />
      <circle r={81} fill="none" stroke="rgb(255 255 255 / 0.35)" strokeWidth={0.8} />

      {/* rim legend */}
      {p.legend && detail === 'full' && (
        <>
          <path id={`r${uid}`} d="M0 87.2A87.2 87.2 0 1 1 0 -87.2A87.2 87.2 0 1 1 0 87.2" fill="none" />
          <text fill={engrave} style={{ fontFamily: 'var(--mono)', fontSize: 8.4, letterSpacing: 1.4, fontWeight: 600 }}>
            <textPath href={`#r${uid}`} startOffset="50%" textAnchor="middle">
              {p.legend.length > 46 ? `${p.legend.slice(0, 45)}…` : p.legend}
            </textPath>
          </text>
        </>
      )}

      {/* face, beads and guilloché */}
      <circle r={77} fill="url(#eq-face)" />
      {Array.from({ length: detail === 'full' ? 48 : 24 }, (_, i) => {
        const n = detail === 'full' ? 48 : 24;
        const a = (i / n) * Math.PI * 2;
        return <circle key={i} cx={74.2 * Math.cos(a)} cy={74.2 * Math.sin(a)} r={1.35} fill={base} opacity={0.75} className="eq-rim-fill" />;
      })}
      <g fill="none" stroke={base} className="eq-rim-fill">
        {ros.band.map((d, i) => (
          <path key={`b${i}`} d={d} strokeWidth={detail === 'full' ? 0.6 : 1.2} opacity={0.78} />
        ))}
        {ros.inner.map((d, i) => (
          <path key={`i${i}`} d={d} strokeWidth={detail === 'full' ? 0.55 : 1} opacity={0.5} />
        ))}
      </g>
      <circle r={30} fill="url(#eq-face)" stroke={base} strokeWidth={1} className="eq-rim-fill" />
      <circle r={26.5} fill="none" stroke={base} strokeWidth={0.5} opacity={0.6} className="eq-rim-fill" />
      <text
        y={size * 0.34}
        textAnchor="middle"
        fill="var(--seal-ink)"
        style={{ fontFamily: 'var(--serif)', fontSize: size, letterSpacing: p.initials.length > 2 ? -0.5 : 0.5 }}
      >
        {p.initials}
      </text>

      {/* sheen */}
      <path d="M-86 -14A88 88 0 0 1 14 -86A96 96 0 0 0 -86 -14Z" fill="url(#eq-sheen)" opacity={0.9} />
      <circle r={95} fill="url(#eq-sheen)" opacity={0.35} />

      {/* a seal whose trail does not verify is cracked */}
      {p.verified === false && (
        <g>
          <path d={crackPath(p.seed)} fill="none" stroke="var(--seal-face-hi)" strokeWidth={4} strokeLinejoin="round" />
          <path d={crackPath(p.seed)} fill="none" stroke="var(--bad-solid)" strokeWidth={2} strokeLinejoin="round" />
        </g>
      )}
    </g>
  );
}

function BlankMark(p: SealMarkProps & { uid: string; base: string }) {
  const size = p.initials.length <= 2 ? 34 : p.initials.length === 3 ? 26 : 21;
  const total = Math.max(1, p.total ?? 1);
  const C = 2 * Math.PI * 110;
  const checked = (p.checked ?? 0) / total;
  const failed = (p.failed ?? 0) / total;
  return (
    <g>
      {/* status ring */}
      <circle r={110} fill="none" stroke="var(--hall-ink-muted)" strokeOpacity={0.2} strokeWidth={4} strokeDasharray={p.status === 'submitted' ? '2 8' : undefined} strokeLinecap="round" />
      {p.status === 'in_review' && checked > 0 && (
        <circle r={110} fill="none" stroke="var(--accent-9)" strokeWidth={6} strokeLinecap="round" strokeDasharray={`${C * checked} ${C}`} transform="rotate(-90)" />
      )}
      {p.status === 'changes_requested' && (
        <circle r={110} fill="none" stroke="var(--warn-solid)" strokeWidth={6} strokeLinecap="round" strokeDasharray={`${Math.max(C * failed, 10)} ${C}`} transform="rotate(-90)" />
      )}
      {p.status === 'in_review' && (
        <g className="eq-assay-spin">
          <circle r={100} fill="none" stroke="var(--accent-9)" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="1 7" />
        </g>
      )}

      {/* unstamped wax */}
      <path d={waxOutline(p.seed, 94, 0.035)} fill="url(#eq-wax)" stroke="var(--wax-line)" strokeWidth={1.2} />
      <path d={waxOutline(p.seed, 94, 0.035)} fill={p.base} opacity={0.2} className="eq-rim-fill" />
      <circle r={86} fill="none" stroke="rgb(255 255 255 / 0.4)" strokeWidth={1} />
      {/* where the die will press: scalloped for a Certified request */}
      {p.level === 'certified' ? (
        <path d={scallopPath(70, 28, 2.6)} fill="none" stroke={p.base} strokeWidth={2} strokeDasharray="5 5" opacity={0.85} className="eq-rim-fill" />
      ) : (
        <circle r={71} fill="none" stroke={p.base} strokeWidth={2} strokeDasharray="5 5" opacity={0.85} className="eq-rim-fill" />
      )}
      <text y={size * 0.34} textAnchor="middle" fill="var(--seal-ink)" opacity={0.45} style={{ fontFamily: 'var(--serif)', fontSize: size }}>
        {p.initials}
      </text>
      <ellipse cx={-26} cy={-40} rx={42} ry={18} transform="rotate(-30 -26 -40)" fill="white" opacity={0.18} />
      {p.verified === false && <circle cx={64} cy={-64} r={9} fill="var(--bad-solid)" stroke="var(--seal-face-hi)" strokeWidth={2} />}
    </g>
  );
}

/** A seal in its own <svg>, for lists, the desk and the register. Decorative unless `label` is given. */
export function SealBadge({
  size = 40,
  label,
  className,
  style,
  ...mark
}: SealMarkProps & { size?: number; label?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="-122 -122 244 244"
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0, overflow: 'visible', ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <SealMark detail={size < 72 ? 'small' : 'full'} {...mark} />
    </svg>
  );
}

/**
 * The pressed-wax stamp: the wax pools, the die comes down, the seal is struck and a ripple runs out. Plays once on
 * mount (`play`); with reduced motion it shows the finished seal.
 */
export function WaxStamp({ size = 160, play = true, ...mark }: SealMarkProps & { size?: number; play?: boolean }) {
  const base = rimColor(mark.rim);
  return (
    <div className={play ? 'eq-stamp-shake' : undefined} style={{ width: size, height: size }} data-testid="wax-stamp">
      <svg viewBox="-140 -140 280 280" width={size} height={size} className={play ? 'eq-stamp' : undefined} aria-hidden="true" style={{ overflow: 'visible' }}>
        <ellipse cx={4} cy={18} rx={108} ry={100} fill="var(--world-shadow)" filter="url(#eq-soft)" />
        <path className="eq-stamp-wax" d={waxOutline(mark.seed + 3, 116, 0.06)} fill={`color-mix(in oklab, ${base} 62%, #24180a)`} />
        <circle className="eq-stamp-ripple" r={118} fill="none" stroke={base} strokeWidth={3} opacity={0} />
        <g className="eq-stamp-die">
          <SealMark {...mark} detail="full" />
        </g>
        <g style={{ mixBlendMode: 'soft-light' }} transform="rotate(20)">
          <rect className="eq-stamp-shine" x={-40} y={-120} width={40} height={240} fill="white" opacity={0} />
        </g>
      </svg>
    </div>
  );
}
