/**
 * The paper map's display maths, ported from acceptodds' `lib/map.ts`. Pure. The layout itself comes from the signal
 * set (`map.xy`); this only scales it to the screen, places the groupings' names and picks colours.
 */

/** Map units across the longer side, whatever the set's units were. */
export const MAP_SIZE = 1000;

/**
 * Scale interleaved points `[x0, y0, x1, y1, …]` into `[0, MAP_SIZE]` on the longer axis, keeping the aspect, centred
 * on the shorter, y pointing up.
 */
export function normalise(xy: ArrayLike<number>): Float32Array {
  const n = xy.length >> 1;
  const out = new Float32Array(n * 2);
  if (n === 0) return out;
  // A loop, not Math.min(...xs): spreading a whole map overflows the call stack.
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const x = xy[2 * i];
    const y = xy[2 * i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const scale = MAP_SIZE / (Math.max(w, h) || 1);
  const offX = (MAP_SIZE - w * scale) / 2;
  const offY = (MAP_SIZE - h * scale) / 2;
  for (let i = 0; i < n; i++) {
    out[2 * i] = offX + (xy[2 * i] - minX) * scale;
    out[2 * i + 1] = offY + (xy[2 * i + 1] - minY) * scale;
  }
  return out;
}

export interface TopicLabel {
  /** The grouping's index (into the label column's `keys`). */
  number: number;
  text: string;
  x: number;
  y: number;
  /** Points in the grouping: the bigger wins a label collision. */
  size: number;
}

/** Words shorter than this pick out no topic label: "a" or "of" would light half of them. */
const MIN_LABEL_TERM = 3;

/**
 * A search as the map reads it: its words and quoted phrases, lower case; those after a `-` are left out
 * (`exclude`). `field:value` words are kept whole, as words.
 */
export function parseQuery(query: string): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const m of query.toLowerCase().matchAll(/(-?)(?:"([^"]*)"?|(\S+))/g)) {
    const term = (m[2] ?? m[3] ?? '').trim();
    if (!term || term === '-') continue;
    (m[1] ? exclude : include).push(term);
  }
  return { include, exclude };
}

/** The words in a search a topic label can match: the positive words and phrases, of `MIN_LABEL_TERM` or more. */
export function labelTerms(query: string): string[] {
  return [...new Set(parseQuery(query).include)].filter((t) => t.length >= MIN_LABEL_TERM);
}

/** Whether `text` holds one of `terms` at the start of a word, as a search's words match as prefixes. */
export function labelMatches(text: string, terms: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((t) => {
    for (let at = lower.indexOf(t); at >= 0; at = lower.indexOf(t, at + 1))
      if (at === 0 || !/[\p{L}\p{N}]/u.test(lower[at - 1])) return true;
    return false;
  });
}

/**
 * The papers a search finds by title: every positive word or phrase at the start of a word, and no excluded one.
 * Indexes, in map order; `null` for an empty search.
 */
export function searchTitles(titles: readonly string[], query: string): number[] | null {
  const { include, exclude } = parseQuery(query);
  if (include.length === 0 && exclude.length === 0) return null;
  const out: number[] = [];
  titles.forEach((title, i) => {
    if (include.every((t) => labelMatches(title, [t])) && !labelMatches(title, exclude)) out.push(i);
  });
  return out;
}

/**
 * Where each grouping's name goes: the median of its points on each axis (robust to a few strays far from the
 * rest). Groupings with fewer than `minSize` points, or no name, get no label. `groups` holds -1 for none.
 */
export function topicLabels(
  positions: Float32Array,
  groups: ArrayLike<number>,
  names: ReadonlyMap<number, string>,
  minSize: number,
): TopicLabel[] {
  const xs = new Map<number, number[]>();
  const ys = new Map<number, number[]>();
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g < 0 || !names.has(g)) continue;
    if (!xs.has(g)) {
      xs.set(g, []);
      ys.set(g, []);
    }
    xs.get(g)!.push(positions[2 * i]);
    ys.get(g)!.push(positions[2 * i + 1]);
  }
  const median = (a: number[]) => a.sort((u, v) => u - v)[a.length >> 1];
  const out: TopicLabel[] = [];
  for (const [g, x] of xs) {
    if (x.length < minSize) continue;
    out.push({ number: g, text: names.get(g)!, x: median(x), y: median(ys.get(g)!), size: x.length });
  }
  return out;
}

export type Rgb = [number, number, number];

export function hexRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Categorical colours for groupings, cycled. Muted, so the accent (a selection) stays the loud colour. */
export const MAP_PALETTE: readonly Rgb[] = [
  '#4e79a7',
  '#e08b3a',
  '#59a14f',
  '#c75a5d',
  '#76b7b2',
  '#b6992d',
  '#9c6fa0',
  '#d4848f',
  '#8a6e58',
  '#5f8fc4',
  '#86bc6c',
  '#a1a1a1',
  '#3f8f86',
  '#c9a46a',
  '#7b6fb0',
  '#9b9a4a',
].map(hexRgb);

export const MAP_NONE: Rgb = hexRgb('#c8c4ba');

/** A grouping's colour by its number (`labelNumber`); none, -1 or `null`, is grey. */
export function categoryRgb(n: number | null): Rgb {
  return n === null || n < 0 ? MAP_NONE : MAP_PALETTE[n % MAP_PALETTE.length];
}

/**
 * The number a label key is coloured by: the key itself when it is a whole number (so a map keyed as acceptodds
 * keyed it keeps its colours), else its index among the keys.
 */
export function labelNumber(key: string, index: number): number {
  return /^\d{1,9}$/.test(key) ? Number(key) : index;
}

/**
 * Dot radius multiplier at a zoom level: about 1.5x per level past the opening view, never smaller than at it, capped
 * so dense regions stay legible.
 */
export function dotScale(zoom: number, openingZoom: number): number {
  return Math.min(6, Math.max(1, 1.5 ** (zoom - openingZoom)));
}

/**
 * Dot radius multiplier for showing `shown` of `total` papers: fewer dots, bigger, so a sparse search does not leave
 * the screen empty. The fourth root keeps it gentle (179 of 30k: about 3.6x), capped at 4x.
 */
export function sparseScale(shown: number, total: number): number {
  if (shown <= 0 || shown >= total) return 1;
  return Math.min(4, (total / shown) ** 0.25);
}

/** A neighbour this many times the nearest papers' distance or nearer widens a minimap to take it in. */
export const MINIMAP_STRETCH = 2.5;

/**
 * A minimap's radius round its paper: the distance to its `take`th nearest paper (`near`), widened to take in each
 * paper it draws a line to up to `MINIMAP_STRETCH` times that, with a margin. Any units.
 */
export function minimapRadius(near: number, linked: readonly number[]): number {
  return linked.filter((d) => d <= near * MINIMAP_STRETCH).reduce((m, d) => Math.max(m, d * 1.1), near);
}

/**
 * Interleaved positions moved so point `self` is at the centre of the map and `minimapRadius` round it fills half its
 * span, which the canvas fits to the shorter side of its box: sized by its `take` nearest points. `linked` are
 * indexes. Points outside stay, past the edge, for a wide box and for panning.
 */
export function frameAround(
  positions: Float32Array,
  self: number,
  linked: readonly number[],
  take: number,
): Float32Array {
  const n = positions.length / 2;
  const sx = positions[2 * self];
  const sy = positions[2 * self + 1];
  const dist = (i: number) => Math.hypot(positions[2 * i] - sx, positions[2 * i + 1] - sy);
  const all = Float64Array.from({ length: n }, (_, i) => dist(i)).sort();
  // `all[0]` is the paper itself; with fewer papers than wanted, the farthest sets it.
  const near = all[Math.max(1, Math.min(take, n - 1))] || 1;
  const scale = MAP_SIZE / 2 / minimapRadius(near, linked.map(dist));
  const out = new Float32Array(positions.length);
  for (let i = 0; i < n; i++) {
    out[2 * i] = MAP_SIZE / 2 + (positions[2 * i] - sx) * scale;
    out[2 * i + 1] = MAP_SIZE / 2 + (positions[2 * i + 1] - sy) * scale;
  }
  return out;
}
