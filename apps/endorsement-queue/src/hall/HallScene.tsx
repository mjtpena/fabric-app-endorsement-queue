/**
 * The hall of seals (SVG). Seals hang in lit niches on the wall, grouped and coloured by the lens; open requests sit
 * as unstamped wax blanks on the assay bench in front. The camera (the viewBox) fits the hall to the stage, flies to
 * the focused item, and can be dragged and zoomed with a mouse. No WebGL: the same scene works everywhere.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';

import { useIsDesktop, useReducedMotion } from '@x10/shared/ui';

import {
  BLANK_R,
  groupOf,
  itemSummary,
  layoutHall,
  lensGroups,
  type HallData,
  type HallItem,
  type HallLayout,
  type HallLens,
  type LensGroup,
  type Placed,
} from '../domain/hall';
import { rng, waxOutline } from './geometry';
import { rimColor, SealMark, sealProps } from './Seal';
import { STATUS_LABEL } from '../labels';

type Box = { x: number; y: number; w: number; h: number };
type Insets = { t: number; r: number; b: number; l: number };

/** A viewBox with the container's aspect that shows `c` centred inside the area left free by the overlays. */
function fitBox(c: Box, w: number, h: number, i: Insets): Box {
  const aw = Math.max(1, w - i.l - i.r);
  const ah = Math.max(1, h - i.t - i.b);
  const s = Math.min(aw / c.w, ah / c.h);
  return { x: c.x - i.l / s - (aw / s - c.w) / 2, y: c.y - i.t / s - (ah / s - c.h) / 2, w: w / s, h: h / s };
}

const NICHE_HW = 128;

/** Split a long name over two lines at the space nearest the middle. */
function twoLines(s: string, max = 17): [string, string?] {
  if (s.length <= max) return [s];
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (best === -1 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  if (best === -1) return [s];
  const b = s.slice(best + 1);
  return [s.slice(0, best), b.length > max + 4 ? `${b.slice(0, max + 3)}…` : b];
}

/** Choose the number of seals per row that gives the largest scale for this stage. */
function bestLayout(data: HallData, lens: HallLens, w: number, h: number): HallLayout {
  // w and h are the free area (stage minus the overlays).
  let best: HallLayout | null = null;
  let bestScale = -1;
  const n = Math.max(1, data.seals.length);
  for (let cols = 2; cols <= Math.max(2, Math.min(8, n)); cols++) {
    const l = layoutHall(data, lens, cols);
    const s = Math.min(w / l.bounds.w, h / l.bounds.h);
    if (s > bestScale + 0.001) {
      best = l;
      bestScale = s;
    }
  }
  return best ?? layoutHall(data, lens, 3);
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: Math.max(1, el.clientWidth), h: Math.max(1, el.clientHeight) });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Tween the viewBox toward `target` (jumps with reduced motion). */
function useCamera(target: Box, reduced: boolean) {
  const [box, setBox] = useState(target);
  const cur = useRef(target);
  const key = `${target.x.toFixed(1)},${target.y.toFixed(1)},${target.w.toFixed(1)},${target.h.toFixed(1)}`;
  useEffect(() => {
    if (reduced) {
      cur.current = target;
      setBox(target);
      return;
    }
    const from = cur.current;
    const start = performance.now();
    const dur = 750;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const k = ease(t);
      const b = {
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        w: from.w + (target.w - from.w) * k,
        h: from.h + (target.h - from.h) * k,
      };
      cur.current = b;
      setBox(b);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);
  const jump = (b: Box) => {
    cur.current = b;
    setBox(b);
  };
  return [box, jump] as const;
}

export interface HallSceneProps {
  data: HallData;
  lens: HallLens;
  focusId: string | null;
  onPick: (id: string) => void;
  isDim: (item: HallItem) => boolean;
  /** A seal that was just approved: it is struck with the pressed-wax animation. */
  stampId?: string | null;
}

export function HallScene({ data, lens, focusId, onPick, isDim, stampId }: HallSceneProps) {
  const reduced = useReducedMotion();
  const desktop = useIsDesktop();
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const insets: Insets = desktop ? { t: 92, r: 24, b: 84, l: 24 } : { t: 14, r: 10, b: 14, l: 10 };
  const freeW = size.w - insets.l - insets.r;
  const freeH = size.h - insets.t - insets.b;
  const layout = useMemo(() => bestLayout(data, lens, freeW, freeH), [data, lens, freeW, freeH]);
  const groups = useMemo(() => lensGroups(data, lens), [data, lens]);
  const byId = useMemo(() => new Map<string, HallItem>([...data.seals, ...data.blanks].map((i) => [i.id, i])), [data]);
  const placed = useMemo(() => new Map<string, Placed>([...layout.seals, ...layout.blanks].map((p) => [p.id, p])), [layout]);

  const [userBox, setUserBox] = useState<Box | null>(null);
  useEffect(() => setUserBox(null), [focusId, lens]);

  const fit = layout.bounds;
  const focus = focusId ? placed.get(focusId) : undefined;
  const target: Box = useMemo(() => {
    if (!focus) return fitBox(fit, size.w, size.h, insets);
    const isBlank = focus.r === BLANK_R;
    const w = isBlank ? 620 : 780;
    const h = isBlank ? 480 : 720;
    return fitBox({ x: focus.x - w / 2, y: focus.y - h / 2 + (isBlank ? 40 : 40), w, h }, size.w, size.h, insets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, fit, size.w, size.h, desktop]);
  const [cam, jump] = useCamera(userBox ?? target, reduced);

  // Mouse drag to pan, wheel to zoom. Touch keeps scrolling the page.
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; box: Box; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, box: cam, moved: false };
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const el = svgRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) el.setPointerCapture(e.pointerId);
    d.moved = true;
    const k = Math.max(d.box.w / el.clientWidth, d.box.h / el.clientHeight);
    const b = { ...d.box, x: d.box.x - dx * k, y: d.box.y - dy * k };
    setUserBox(b);
    jump(b);
  };
  const onPointerUp = () => {
    if (drag.current?.moved) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    }
    drag.current = null;
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setUserBox((prev) => {
        const b = prev ?? cam;
        const z = Math.exp(Math.max(-0.4, Math.min(0.4, e.deltaY * 0.0015)));
        const w = Math.max(320, Math.min(fit.w * 2.2, b.w * z));
        const h = (b.h / b.w) * w;
        // Keep the point under the cursor fixed (meet scaling: use the larger ratio).
        const k = Math.max(b.w / r.width, b.h / r.height);
        const px = b.x + (b.w - r.width * k) / 2 + (e.clientX - r.left) * k;
        const py = b.y + (b.h - r.height * k) / 2 + (e.clientY - r.top) * k;
        const nb = { x: px - ((px - b.x) * w) / b.w, y: py - ((py - b.y) * h) / b.h, w, h };
        jump(nb);
        return nb;
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const pick = (id: string) => {
    if (suppressClick.current) return;
    onPick(id);
  };

  return (
    <div ref={wrapRef} className="absolute inset-y-0 left-0 w-[calc(100%-var(--side-w,0px))]" data-testid="hall">
      <svg
        ref={svgRef}
        viewBox={`${cam.x} ${cam.y} ${cam.w} ${cam.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full select-none"
        role="group"
        aria-label={`Hall of seals: ${data.seals.length} seals, ${data.blanks.length} on the assay bench`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setUserBox(null)}
        data-lens={lens}
      >
        <Room layout={layout} reduced={reduced} />
        {/* group plaques */}
        {layout.plaques.map((p) => (
          <g key={p.key} className="eq-place" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
            <circle cx={22} cy={-7} r={7} fill={rimColor(p.rim)} className="eq-rim-fill" />
            <text x={38} y={0} fill="var(--hall-ink)" style={{ fontFamily: 'var(--mono)', fontSize: 19, letterSpacing: 1.6, fontWeight: 600 }}>
              {p.label.toUpperCase()}
              <tspan fill="var(--hall-ink-muted)" dx={12} style={{ fontWeight: 400 }}>
                {p.count}
              </tspan>
            </text>
            <line x1={12} x2={p.width - 12} y1={14} y2={14} stroke="var(--hall-ink)" strokeOpacity={0.16} strokeWidth={1.5} />
          </g>
        ))}
        {/* niches and seals */}
        {layout.seals.map((p) => {
          const item = byId.get(p.id);
          if (!item || item.kind !== 'seal') return null;
          return (
            <SealInHall
              key={p.id}
              item={item}
              p={p}
              group={groupOf(item, lens, groups)}
              lens={lens}
              focused={focusId === p.id}
              dim={isDim(item)}
              stamp={stampId === p.id}
              onPick={pick}
            />
          );
        })}
        {/* the assay bench */}
        {layout.ledges.length > 0 && (
          <text
            x={layout.ledges[0].x0 + 10}
            y={layout.ledges[0].y - BLANK_R * 2 - 46}
            fill="var(--hall-ink-muted)"
            style={{ fontFamily: 'var(--mono)', fontSize: 17, letterSpacing: 1.6, fontWeight: 600 }}
          >
            ON THE ASSAY BENCH · {data.blanks.length}
          </text>
        )}
        {layout.blanks.map((p) => {
          const item = byId.get(p.id);
          if (!item || item.kind !== 'blank') return null;
          return (
            <BlankOnBench key={p.id} item={item} p={p} group={groupOf(item, lens, groups)} focused={focusId === p.id} dim={isDim(item)} onPick={pick} ledgeY={nearestLedge(layout, p.y)} />
          );
        })}
      </svg>
    </div>
  );
}

function nearestLedge(layout: HallLayout, y: number) {
  return layout.ledges.reduce((best, l) => (l.y >= y && (best === null || l.y < best) ? l.y : best), null as number | null) ?? y + BLANK_R + 10;
}

/* ------------------------------------------------------------------ the room */

const Room = memo(function Room({ layout, reduced }: { layout: HallLayout; reduced: boolean }) {
  const { floorY, bounds, seals, ledges } = layout;
  const vx = bounds.x + bounds.w / 2;
  const motes = useMemo(() => {
    const g = rng(seals.length * 31 + 7);
    return seals.flatMap((s) =>
      Array.from({ length: 3 }, () => ({
        x: s.x + (g() - 0.5) * 160,
        y: s.y - 420 + g() * 220,
        r: 1.4 + g() * 2.2,
        dx: (g() - 0.5) * 60,
        dy: 160 + g() * 200,
        d: 10 + g() * 10,
        delay: -g() * 18,
      })),
    );
  }, [seals]);
  return (
    <g aria-hidden="true">
      <defs>
        <linearGradient id="eq-wall" x1="0" y1="0" x2="0" y2="1" gradientUnits="userSpaceOnUse" gradientTransform={`translate(0 ${bounds.y - 400}) scale(1 ${floorY - bounds.y + 400})`}>
          <stop offset="0" stopColor="var(--hall-wall-2)" />
          <stop offset="0.45" stopColor="var(--hall-wall)" />
          <stop offset="1" stopColor="var(--hall-wall-2)" />
        </linearGradient>
        <linearGradient id="eq-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--hall-floor-2)" />
          <stop offset="0.25" stopColor="var(--hall-floor)" />
          <stop offset="1" stopColor="var(--hall-floor)" />
        </linearGradient>
        <linearGradient id="eq-niche" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--hall-niche-2)" />
          <stop offset="0.5" stopColor="var(--hall-niche)" />
          <stop offset="1" stopColor="var(--hall-niche)" />
        </linearGradient>
        <clipPath id="eq-floor-clip">
          <rect x={-8000} y={floorY} width={16000} height={6000} />
        </clipPath>
      </defs>
      {/* wall */}
      <rect x={-8000} y={-8000} width={16000} height={8000 + floorY} fill="url(#eq-wall)" />
      {/* dado rail */}
      <rect x={-8000} y={floorY - 150} width={16000} height={150} fill="var(--hall-wall-2)" opacity={0.7} />
      <rect x={-8000} y={floorY - 152} width={16000} height={3} fill="var(--hall-ink)" opacity={0.08} />
      {/* floor with perspective joints */}
      <rect x={-8000} y={floorY} width={16000} height={6000} fill="url(#eq-floor)" />
      <rect x={-8000} y={floorY} width={16000} height={4} fill="var(--hall-ink)" opacity={0.12} />
      <g clipPath="url(#eq-floor-clip)" stroke="var(--hall-ink)" strokeOpacity={0.07} strokeWidth={1.5}>
        {Array.from({ length: 41 }, (_, i) => {
          const x = vx + (i - 20) * 180;
          return <line key={`v${i}`} x1={vx + (x - vx) * 0.12} y1={floorY - 700} x2={vx + (x - vx) * 6} y2={floorY + 4000} />;
        })}
        {Array.from({ length: 10 }, (_, i) => {
          const y = floorY + 26 * Math.pow(i + 1, 1.55);
          return <line key={`h${i}`} x1={-8000} x2={8000} y1={y} y2={y} />;
        })}
      </g>
      {/* niches with their light */}
      {seals.map((s) => (
        <g key={s.id} className="eq-place" style={{ transform: `translate(${s.x}px, ${s.y}px)` }}>
          <polygon
            points={`-22,-900 22,-900 ${NICHE_HW + 30},150 ${-NICHE_HW - 30},150`}
            fill="url(#eq-cone)"
            opacity={0.28}
            className={reduced ? undefined : 'eq-light'}
          />
          <path
            d={`M${-NICHE_HW} 160 L${-NICHE_HW} -100 A${NICHE_HW} ${NICHE_HW} 0 0 1 ${NICHE_HW} -100 L${NICHE_HW} 160 Z`}
            fill="url(#eq-niche)"
            stroke="var(--hall-ink)"
            strokeOpacity={0.07}
            strokeWidth={2}
          />
          <path d={`M${-NICHE_HW + 10} 160 L${-NICHE_HW + 10} -100 A${NICHE_HW - 10} ${NICHE_HW - 10} 0 0 1 ${NICHE_HW - 10} -100`} fill="none" stroke="var(--hall-ink)" strokeOpacity={0.05} strokeWidth={6} />
          <ellipse cx={0} cy={-70} rx={NICHE_HW - 10} ry={170} fill="url(#eq-pool)" opacity={0.85} className={reduced ? undefined : 'eq-light'} />
          {/* sill */}
          <rect x={-NICHE_HW - 12} y={156} width={NICHE_HW * 2 + 24} height={10} rx={2} fill="var(--hall-ledge)" />
          <rect x={-NICHE_HW - 12} y={166} width={NICHE_HW * 2 + 24} height={4} fill="var(--hall-ink)" opacity={0.1} />
        </g>
      ))}
      {/* the assay bench */}
      {ledges.map((l, i) => (
        <g key={i} className="eq-place">
          <ellipse cx={(l.x0 + l.x1) / 2} cy={l.y + 96} rx={(l.x1 - l.x0) / 2 + 40} ry={18} fill="var(--world-shadow)" filter="url(#eq-soft)" />
          <polygon points={`${l.x0},${l.y} ${l.x1},${l.y} ${l.x1 + 28},${l.y + 20} ${l.x0 - 28},${l.y + 20}`} fill="var(--hall-ledge)" />
          <rect x={l.x0 - 28} y={l.y + 20} width={l.x1 - l.x0 + 56} height={64} fill="var(--hall-ledge-2)" />
          <rect x={l.x0 - 28} y={l.y + 20} width={l.x1 - l.x0 + 56} height={2} fill="white" opacity={0.25} />
        </g>
      ))}
      {!reduced &&
        motes.map((m, i) => (
          <circle
            key={i}
            cx={m.x}
            cy={m.y}
            r={m.r}
            fill="var(--hall-mote)"
            className="eq-mote"
            style={{ '--dx': `${m.dx}px`, '--dy': `${m.dy}px`, '--d': `${m.d}s`, '--delay': `${m.delay}s` } as CSSProperties}
          />
        ))}
    </g>
  );
});

/* ------------------------------------------------------------------ one seal in its niche */

function SealInHall({
  item,
  p,
  group,
  lens,
  focused,
  dim,
  stamp,
  onPick,
}: {
  item: Extract<HallItem, { kind: 'seal' }>;
  p: Placed;
  group: LensGroup;
  lens: HallLens;
  focused: boolean;
  dim: boolean;
  stamp: boolean;
  onPick: (id: string) => void;
}) {
  const r = item.request;
  const [l1, l2] = twoLines(r.modelName);
  const props = sealProps(item, group.rim);
  const sub =
    item.expiry.kind === 'none'
      ? 'NO EXPIRY'
      : item.expiry.kind === 'expired'
        ? `EXPIRED ${Math.abs(item.expiry.days ?? 0)} D AGO`
        : `${item.expiry.days} D LEFT`;
  const subTone = item.expiry.kind === 'expired' ? 'var(--bad-text)' : item.expiry.kind === 'due' ? 'var(--warn-text)' : 'var(--hall-ink-muted)';
  return (
    <g
      className="eq-place"
      style={{ transform: `translate(${p.x}px, ${p.y}px)`, opacity: dim ? 0.5 : 1, filter: dim ? 'grayscale(0.7)' : undefined }}
      data-testid="hall-seal"
      data-id={item.id}
      data-model={r.modelName}
      data-focused={focused || undefined}
    >
      <g
        className="eq-seal"
        role="button"
        tabIndex={0}
        aria-label={itemSummary(item)}
        aria-pressed={focused}
        onClick={() => onPick(item.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPick(item.id);
          }
        }}
      >
        <circle className="eq-focus-ring" r={128} fill="none" stroke="var(--focus)" strokeWidth={4} />
        {focused && <circle className="eq-halo" r={130} fill="none" stroke="var(--accent-9)" strokeWidth={5} />}
        <g className="eq-lift">
          <ellipse cx={10} cy={26} rx={104} ry={98} fill="var(--world-shadow)" filter="url(#eq-soft)" />
          {stamp ? (
            <g className="eq-stamp">
              <path className="eq-stamp-wax" d={waxOutline(item.seed + 3, 114, 0.06)} fill={`color-mix(in oklab, ${rimColor(group.rim)} 62%, #24180a)`} />
              <circle className="eq-stamp-ripple" r={118} fill="none" stroke={rimColor(group.rim)} strokeWidth={4} opacity={0} />
              <g className="eq-stamp-die">
                <SealMark {...props} emphasiseArc={lens === 'expiry'} />
              </g>
            </g>
          ) : (
            <SealMark {...props} drain={lens === 'expiry'} emphasiseArc={lens === 'expiry'} key={lens === 'expiry' ? 'x' : 'n'} />
          )}
        </g>
        {/* plaque */}
        <text y={l2 ? 204 : 214} textAnchor="middle" fill="var(--hall-ink)" style={{ fontSize: 27, fontWeight: 600, letterSpacing: -0.2 }}>
          {l1}
          {l2 && (
            <tspan x={0} dy={30}>
              {l2}
            </tspan>
          )}
        </text>
        <text y={l2 ? 266 : 246} textAnchor="middle" fill={subTone} style={{ fontFamily: 'var(--mono)', fontSize: 17, letterSpacing: 1.2, fontWeight: 600 }}>
          {item.verified ? sub : 'TRAIL MISMATCH'}
        </text>
      </g>
    </g>
  );
}

function BlankOnBench({
  item,
  p,
  group,
  focused,
  dim,
  onPick,
  ledgeY,
}: {
  item: Extract<HallItem, { kind: 'blank' }>;
  p: Placed;
  group: LensGroup;
  focused: boolean;
  dim: boolean;
  onPick: (id: string) => void;
  ledgeY: number;
}) {
  const r = item.request;
  const scale = p.r / 100;
  const name = r.modelName.length > 17 ? `${r.modelName.slice(0, 16)}…` : r.modelName;
  const status =
    item.status === 'in_review'
      ? `IN ASSAY ${item.checked}/${item.total}`
      : item.status === 'changes_requested'
        ? `${item.failed} TO FIX`
        : `WAITING ${item.age} D`;
  const tone = item.status === 'changes_requested' ? 'var(--warn-text)' : item.status === 'in_review' ? 'var(--accent-11)' : 'var(--hall-ink-muted)';
  return (
    <g
      className="eq-place"
      style={{ transform: `translate(${p.x}px, ${p.y}px)`, opacity: dim ? 0.5 : 1, filter: dim ? 'grayscale(0.7)' : undefined }}
      data-testid="hall-blank"
      data-id={item.id}
      data-model={r.modelName}
      data-focused={focused || undefined}
    >
      <g
        className="eq-seal"
        role="button"
        tabIndex={0}
        aria-label={itemSummary(item)}
        aria-pressed={focused}
        onClick={() => onPick(item.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPick(item.id);
          }
        }}
      >
        <circle className="eq-focus-ring" r={p.r * 1.25} fill="none" stroke="var(--focus)" strokeWidth={3} />
        {focused && <circle className="eq-halo" r={p.r * 1.28} fill="none" stroke="var(--accent-9)" strokeWidth={4} />}
        <g className="eq-lift">
          <ellipse cx={4} cy={p.r * 0.96} rx={p.r * 0.95} ry={10} fill="var(--world-shadow)" filter="url(#eq-soft)" />
          <g transform={`scale(${scale})`}>
            <SealMark {...sealProps(item, group.rim)} detail="small" />
          </g>
        </g>
        <title>{`${r.modelName}: ${STATUS_LABEL[item.status]}`}</title>
        <text y={ledgeY - p.y + 50} textAnchor="middle" fill="var(--hall-ink)" style={{ fontSize: 22, fontWeight: 600 }}>
          {name}
        </text>
        <text y={ledgeY - p.y + 74} textAnchor="middle" fill={tone} style={{ fontFamily: 'var(--mono)', fontSize: 15, letterSpacing: 1, fontWeight: 600 }}>
          {item.issue ? 'TRAIL MISMATCH' : status}
        </text>
      </g>
    </g>
  );
}
