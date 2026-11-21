import { MapCanvas } from './canvas';
import { CLUSTER, EMBEDDING, groupName, mapPageUrl, paperUrl, XY, type MapData } from './data';
import { el } from './dom';
import type { LayoutFrame, LayoutRequest } from './layout.worker';
import { categoryRgb, frameAround, topicLabels } from './map';
import { mapTheme } from './theme';

/**
 * A paper's piece of the map, at the end of its page's Community section by default (a reader may move it): the paper among the papers nearest it on the map (`map.xy`),
 * framed round it, coloured and named by cluster, with lines to its nearest papers by the set's `embedding` wherever
 * they lie (the view widens to take them in, up to a point). acceptodds' `Minimap`, with the nearest papers by
 * embedding in place of its related papers: redrawn by default from the papers' `embedding` vectors (`embedAround`,
 * in a worker, animated from the map), or "as on the map".
 *
 * It draws from two `nearest` answers alone (`minimapColumns`, `vectorsOf`), each a few KB the site caches per paper,
 * not the whole map: a reader moving between papers costs the site almost nothing.
 */

/**
 * How tall the minimap is, by where it sits and how wide its frame is (`surface.place`, `surface.size`): 300px in the
 * side column or anywhere narrow, and in the main text half its width, up to 440px, so it reads as a figure there.
 */
export function minimapHeight(place: string, width: number): number {
  if (place === 'aside' || width < 600) return 300;
  return Math.min(440, Math.round(width / 2));
}

/** Papers on the map round the paper, and its nearest by embedding, which get a line. */
export const MINIMAP_NEAREST = 100;
export const MINIMAP_LINES = 10;
/** Smallest cluster that gets its name on the minimap. */
const MIN_LABELLED = 6;
const DOT_RADIUS = 3.2;
/** Papers other than this one and its linked ones: there, but behind. */
const CONTEXT_OPACITY = 0.45;
/** Whether the reader last chose "redrawn" or "as on the map" (redrawn unless they chose the map). */
const REDRAW_KEY = 'paper-map:minimap-redraw';

export interface Piece {
  /** Indexes into the map's papers: this paper first, then its nearest on the map, then linked ones not among them. */
  points: number[];
  /** Interleaved positions, framed round the paper (`frameAround`). */
  positions: Float32Array;
  /** Interleaved positions as on the set's map, unframed: where a redraw starts from. */
  start: Float32Array;
  /** Each point's `embedding`, in `points`' order, for the redraw; `null` unless every point has one. */
  vectors: number[][] | null;
  /** Indexes into `points` that get a line from the paper, nearest by embedding first. */
  linked: number[];
  /** Titles by position in `points`, where the map has none (`nearest` names the linked ones). */
  titles: Map<number, string>;
}

type Nearest = Awaited<ReturnType<PP.SDK['signals']['nearest']>>;

/**
 * The few papers a minimap draws, as columns (`fromColumns` reads them like the whole map's): the paper, its nearest
 * on the map (`onMap`, by `map.xy`) and its nearest by content (`byContent`), each asked `with` `map.xy` and
 * `map.cluster`. `null` when the paper isn't on the map.
 */
export function minimapColumns(
  set: string,
  onMap: Nearest,
  byContent: Nearest | null,
  title: string,
): PP.SignalColumns | null {
  if (!onMap.paper) return null;
  const rows = new Map<string, { title: string; values: Record<string, unknown> }>();
  rows.set(onMap.paper, { title, values: onMap.values ?? {} });
  for (const n of [...onMap.neighbours, ...(byContent?.neighbours ?? [])])
    if (!rows.has(n.paper)) rows.set(n.paper, { title: n.title, values: n.values ?? {} });
  const xy: (number | null)[] = [];
  const keys: string[] = [];
  const keyIndex = new Map<string, number>();
  const cluster: (number | null)[] = [];
  for (const { values } of rows.values()) {
    const at = values[XY];
    const ok = Array.isArray(at) && at.length >= 2 && at.every((v) => typeof v === 'number');
    xy.push(ok ? at[0] : null, ok ? at[1] : null);
    const key = values[CLUSTER];
    if (typeof key !== 'string') {
      cluster.push(null);
      continue;
    }
    let k = keyIndex.get(key);
    if (k === undefined) keyIndex.set(key, (k = keys.push(key) - 1));
    cluster.push(k);
  }
  const names = onMap.labels?.[CLUSTER] ?? {};
  return {
    set: { id: set, name: set, generation: 0 },
    papers: [...rows.keys()],
    titles: [...rows.values()].map((r) => r.title),
    signals: {
      [XY]: { kind: 'vector', dims: 2, values: xy },
      [CLUSTER]: { kind: 'label', keys, titles: keys.map((key) => names[key] ?? null), values: cluster },
    },
  };
}

/** Each paper's `embedding` in the two `nearest` answers (asked `with` it), by paper. */
export function vectorsOf(...answers: (Nearest | null)[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const add = (paper: string | null, values: Record<string, unknown> | undefined) => {
    const v = values?.[EMBEDDING];
    if (paper && Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number')) out.set(paper, v);
  };
  for (const a of answers) {
    if (!a) continue;
    add(a.paper, a.values);
    for (const n of a.neighbours) add(n.paper, n.values);
  }
  return out;
}

/** The `k` papers nearest point `at` on the map, nearest first, without it. */
export function nearestOnMap(positions: Float32Array, at: number, k: number): number[] {
  const n = positions.length / 2;
  const x = positions[2 * at];
  const y = positions[2 * at + 1];
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = (positions[2 * i] - x) ** 2 + (positions[2 * i + 1] - y) ** 2;
  const order = Array.from({ length: n }, (_, i) => i).filter((i) => i !== at);
  return order.sort((a, b) => d[a] - d[b]).slice(0, k);
}

/** The paper's piece of the map; `null` when the paper itself isn't on it. */
export function pieceOf(
  data: MapData,
  self: string,
  neighbours: readonly { paper: string; title: string }[],
  vectors: ReadonlyMap<string, number[]> = new Map(),
): Piece | null {
  const at = data.byPaper.get(self);
  if (at === undefined) return null;
  const points = [at, ...nearestOnMap(data.positions, at, MINIMAP_NEAREST)];
  const where = new Map(points.map((i, k) => [i, k]));
  const linked: number[] = [];
  const titles = new Map<number, string>();
  for (const n of neighbours.slice(0, MINIMAP_LINES)) {
    const i = data.byPaper.get(n.paper);
    if (i === undefined || i === at) continue;
    let k = where.get(i);
    if (k === undefined) {
      k = points.push(i) - 1;
      where.set(i, k);
    }
    linked.push(k);
    if (n.title) titles.set(k, n.title);
  }
  const raw = new Float32Array(points.length * 2);
  points.forEach((i, k) => {
    raw[2 * k] = data.positions[2 * i];
    raw[2 * k + 1] = data.positions[2 * i + 1];
  });
  const own = points.map((i) => vectors.get(data.papers[i]));
  return {
    points,
    positions: frameAround(raw, 0, linked, MINIMAP_NEAREST),
    start: raw,
    vectors: points.length >= 4 && own.every((v) => v !== undefined) ? (own as number[][]) : null,
    linked,
    titles,
  };
}

export function showMinimap(o: {
  root: HTMLElement;
  data: MapData;
  piece: Piece;
  site: string;
  pluginId: string;
  /** The set's identifier of the paper, for the full map's address. */
  paper: string;
  /** Its height in px (`minimapHeight`). */
  height: number;
}): { destroy(): void; setTheme(theme: PP.Theme): void; setHeight(height: number): void } {
  const { data, piece } = o;
  const { points } = piece;
  const box = el('div', { className: 'map minimap' });
  box.style.height = `${o.height}px`;
  const tooltip = el('div', { className: 'tooltip', hidden: true });
  const footer = el('div', { className: 'float footer' });
  const full = el('button', { type: 'button', className: 'link' }, 'Open the full map');
  full.addEventListener('click', () => void pp.ui.openUrl(mapPageUrl(o.site, o.pluginId, o.paper)));
  footer.append(full);
  const switcher = el('div', { className: 'float switch' });
  const caption = el('p', { className: 'caption' });
  o.root.replaceChildren(box, caption);
  const redrawable = piece.vectors !== null;
  let redraw = redrawable && loadRedraw();

  const colours = new Uint8Array(points.length * 4);
  const groups = Int32Array.from(points, (i) => data.group.cluster[i]);
  groups.forEach((g, k) => {
    colours.set(categoryRgb(g < 0 ? null : data.groups.cluster[g].number), 4 * k);
    colours[4 * k + 3] = 220;
  });
  // What is drawn: the map's piece, or the redraw's latest frame (`null` until the worker sends its first).
  let frame: { positions: Float32Array; settled: boolean } | null = null;
  const shown = () => (redraw && frame ? frame : { positions: piece.positions, settled: true });
  // Named once it stops moving: labels chasing a settling layout only flicker.
  const labels = () => {
    const { positions, settled } = shown();
    return settled ? topicLabels(positions, groups, data.names.cluster, MIN_LABELLED) : [];
  };
  let clusters = labels();

  const titleOf = (k: number) => piece.titles.get(k) ?? data.titles?.[points[k]] ?? data.papers[points[k]];
  const open = (k: number) => {
    const url = paperUrl(o.site, data.papers[points[k]]);
    if (url) void pp.ui.openUrl(url);
  };
  const canvas = new MapCanvas(box, {
    embedded: true,
    dotRadius: DOT_RADIUS,
    dimmed: CONTEXT_OPACITY,
    onHover: (hover) => {
      if (!hover) {
        tooltip.hidden = true;
        return;
      }
      const k = hover.index;
      tooltip.replaceChildren(
        k === 0 ? el('i', {}, 'This paper') : el('span', {}, titleOf(k)),
        el('span', { className: 'sub' }, groupName(data, 'cluster', points[k]) ?? ''),
      );
      tooltip.hidden = false;
      const w = box.clientWidth;
      const tw = tooltip.getBoundingClientRect().width;
      tooltip.style.left = `${hover.x + 14 + tw > w ? Math.max(0, hover.x - 14 - tw) : hover.x + 14}px`;
      tooltip.style.top = `${hover.y + 10}px`;
    },
    onSelect: (k) => {
      if (k !== null) open(k);
    },
    onOpen: open,
  });
  box.append(tooltip, footer);
  if (redrawable) box.append(switcher);
  let theme = mapTheme(pp.context?.theme);
  const draw = () =>
    canvas.update({
      positions: shown().positions,
      colours,
      shown: null,
      regions: [],
      clusters,
      labelMode: 'cluster',
      selected: 0,
      neighbours: piece.linked,
      highlight: [],
      theme,
    });

  function renderControls() {
    const choice = (on: boolean, text: string, to: boolean) => {
      if (on) return el('span', { className: 'on' }, text);
      const b = el('button', { type: 'button', className: 'link' }, text);
      b.addEventListener('click', () => setRedraw(to));
      return b;
    };
    switcher.replaceChildren(choice(redraw, 'redrawn', true), ' · ', choice(!redraw, 'as on the map', false));
    const lines =
      piece.linked.length > 0 ? `Lines go to the ${piece.linked.length} papers closest to it in content. ` : '';
    caption.textContent =
      'This paper (marked) with the papers around it on the map, coloured by cluster. ' +
      (redraw
        ? 'Redrawn from the papers’ embeddings alone, so that papers close in content lie close; turned as on the map. '
        : 'Placed as on the map. ') +
      lines +
      'Click a paper to open it; ⌘/Ctrl + scroll to zoom.';
  }

  // The redraw, in the map page's worker, frame by frame.
  let worker: Worker | null = null;
  function relayout() {
    worker?.terminate();
    worker = null;
    frame = null;
    if (!redraw || !piece.vectors) return;
    const still = matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    try {
      worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return; // No workers here: it stays as on the map.
    }
    worker.onmessage = (e: MessageEvent<LayoutFrame>) => {
      if (still && !e.data.settled) return;
      // Redrawn, the piece is compact round the paper: fit all of it, not only the nearest.
      const positions = frameAround(e.data.positions, 0, piece.linked, points.length - 1);
      frame = { positions, settled: e.data.settled };
      if (e.data.settled) clusters = labels();
      draw();
    };
    const start = Float32Array.from(piece.start);
    worker.postMessage(
      { id: 1, start, around: { vectors: piece.vectors, self: 0, linked: [...piece.linked] } } satisfies LayoutRequest,
      { transfer: [start.buffer] },
    );
  }

  function setRedraw(on: boolean) {
    redraw = on;
    saveRedraw(on);
    relayout();
    clusters = labels();
    renderControls();
    draw();
  }

  renderControls();
  draw();
  relayout();
  return {
    destroy: () => {
      worker?.terminate();
      canvas.destroy();
    },
    setHeight(height) {
      box.style.height = `${height}px`;
    },
    setTheme(next) {
      theme = mapTheme(next);
      draw();
    },
  };
}

function loadRedraw(): boolean {
  try {
    return localStorage.getItem(REDRAW_KEY) !== 'map';
  } catch {
    return true;
  }
}

function saveRedraw(on: boolean) {
  try {
    localStorage.setItem(REDRAW_KEY, on ? 'redrawn' : 'map');
  } catch {
    // Remembering the choice is optional.
  }
}
