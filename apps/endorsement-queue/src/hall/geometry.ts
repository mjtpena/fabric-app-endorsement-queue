/**
 * Procedural geometry for the seals (pure, no React). Every seal is drawn in a unit space of radius 100 and scaled
 * where it is used. The pattern is seeded by the model's identity, so a model keeps the same medallion everywhere
 * (hall, desk, register, renewals) and across reloads.
 */

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32): the same seed always gives the same sequence in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed for a model: case and spaces ignored, so "Sales  performance" and "Sales Performance" share a seal. */
export function sealSeed(modelName: string, workspace: string): number {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
  return hashString(`${norm(modelName)}|${norm(workspace)}`);
}

/**
 * The letters struck in the middle of a seal: the first letter of the first two words, or a whole short number
 * ("Customer 360" is "C360"). Brackets and punctuation are ignored. At most four characters.
 */
export function sealInitials(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s\-_/.,:;]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (!words.length) return '?';
  const part = (w: string) => (/^\p{N}+$/u.test(w) ? w.slice(0, 3) : w[0].toUpperCase());
  if (words.length === 1) {
    const w = words[0];
    return /^\p{N}+$/u.test(w) ? w.slice(0, 3) : (w[0].toUpperCase() + (w[1] ?? '').toLowerCase()).trim();
  }
  return (part(words[0]) + part(words[1])).slice(0, 4);
}

const f = (n: number) => (Math.round(n * 10) / 10).toString();

/** A closed smooth path through points (Catmull-Rom converted to cubic Béziers). */
export function smoothClosedPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 3) return '';
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/** Points of a polar curve r(t) sampled `n` times around the circle. */
function polar(n: number, r: (t: number) => number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const rr = r(t);
    return [rr * Math.cos(t), rr * Math.sin(t)] as [number, number];
  });
}

export interface Rosette {
  /** The interwoven band of sine rings (the classic banknote guilloché). */
  band: string[];
  /** The inner rosette petals. */
  inner: string[];
  /** Lobes of the band, for tests. */
  lobes: number;
}

const rosetteCache = new Map<string, Rosette>();

/**
 * Guilloché for a seed: `band` sine rings between radius 44 and 70 with a phase shift per ring, and an inner rosette
 * below radius 40. `detail` lowers the number of curves for small badges.
 */
export function rosette(seed: number, detail: 'full' | 'small' = 'full'): Rosette {
  const key = `${seed}:${detail}`;
  const hit = rosetteCache.get(key);
  if (hit) return hit;
  const r = rng(seed);
  const lobes = 9 + Math.floor(r() * 9); // 9..17
  const rings = detail === 'full' ? 9 + Math.floor(r() * 4) : 5;
  const amp = 5 + r() * 4;
  const mid = 57;
  const twist = 2 + Math.floor(r() * 3);
  const samples = detail === 'full' ? Math.max(72, lobes * 8) : Math.max(48, lobes * 5);
  const band = Array.from({ length: rings }, (_, i) => {
    const phase = (i / rings) * ((Math.PI * 2) / lobes);
    return smoothClosedPath(
      polar(samples, (t) => mid + amp * Math.sin(lobes * t + phase) + 1.6 * Math.sin(twist * lobes * t - phase * 3)),
    );
  });
  const petals = 5 + Math.floor(r() * 6); // 5..10
  const innerRings = detail === 'full' ? 5 : 3;
  const depth = 0.28 + r() * 0.18;
  const inner = Array.from({ length: innerRings }, (_, i) => {
    const base = 38 - i * 2.2;
    const rot = (i / innerRings) * (Math.PI / petals);
    return smoothClosedPath(polar(Math.max(60, petals * 10), (t) => base * (1 - depth * Math.pow(Math.sin((petals * (t + rot)) / 2), 2))));
  });
  const out = { band, inner, lobes };
  rosetteCache.set(key, out);
  return out;
}

/** An organic wax outline around radius `r` (the skirt a pressed seal leaves). */
export function waxOutline(seed: number, r: number, wobble = 0.045): string {
  const g = rng(seed ^ 0x9e3779b9);
  const a = g() * Math.PI * 2;
  const b = g() * Math.PI * 2;
  const c = g() * Math.PI * 2;
  return smoothClosedPath(
    polar(48, (t) => r * (1 + wobble * Math.sin(5 * t + a) + wobble * 0.7 * Math.sin(9 * t + b) + wobble * 0.5 * Math.sin(3 * t + c))),
  );
}

/** A scalloped circle (the edge of a Certified seal): `n` scallops between radius `r` and `r - depth`. */
export function scallopPath(r: number, n: number, depth: number): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const p0 = [r * Math.cos(a0), r * Math.sin(a0)];
    const p1 = [r * Math.cos(a1), r * Math.sin(a1)];
    const c = [(r + depth) * Math.cos(am), (r + depth) * Math.sin(am)];
    d += `${i === 0 ? `M${f(p0[0])} ${f(p0[1])}` : ''}Q${f(c[0])} ${f(c[1])} ${f(p1[0])} ${f(p1[1])}`;
  }
  return `${d}Z`;
}

/**
 * An arc path of radius `r` starting at 12 o'clock and running clockwise for `fraction` of the circle (0..1).
 * Returns an empty string for 0 and a full circle (two half arcs) for 1.
 */
export function arcPath(r: number, fraction: number): string {
  const fr = Math.max(0, Math.min(1, fraction));
  if (fr <= 0) return '';
  if (fr >= 0.9999) return `M0 ${f(-r)}A${f(r)} ${f(r)} 0 1 1 0 ${f(r)}A${f(r)} ${f(r)} 0 1 1 0 ${f(-r)}`;
  const a = fr * Math.PI * 2 - Math.PI / 2;
  const x = r * Math.cos(a);
  const y = r * Math.sin(a);
  return `M0 ${f(-r)}A${f(r)} ${f(r)} 0 ${fr > 0.5 ? 1 : 0} 1 ${f(x)} ${f(y)}`;
}

/** Where a fraction of the circle ends (for the bead at the tip of the expiry arc). */
export function arcTip(r: number, fraction: number): [number, number] {
  const a = Math.max(0, Math.min(1, fraction)) * Math.PI * 2 - Math.PI / 2;
  return [r * Math.cos(a), r * Math.sin(a)];
}

/** A jagged crack across the face (a seal whose trail does not verify). */
export function crackPath(seed: number): string {
  const g = rng(seed ^ 0x51ed270b);
  const pts: string[] = [];
  let x = -62 + g() * 10;
  let y = -40 + g() * 20;
  pts.push(`M${f(x)} ${f(y)}`);
  for (let i = 0; i < 7; i++) {
    x += 14 + g() * 6;
    y += (g() - 0.35) * 22;
    pts.push(`L${f(x)} ${f(y)}`);
  }
  return pts.join('');
}
