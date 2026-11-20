import { MapCanvas } from './canvas';
import { CLUSTER, groupName, mapPageUrl, paperUrl, XY, type MapData } from './data';
import { el } from './dom';
import { categoryRgb, frameAround, topicLabels } from './map';
import { mapTheme } from './theme';

/**
 * A paper's piece of the map, for the Community section of its page: the paper among the papers nearest it on the map (`map.xy`),
 * framed round it, coloured and named by cluster, with lines to its nearest papers by the set's `embedding` wherever
 * they lie (the view widens to take them in, up to a point). acceptodds' `Minimap` "as on the map", with the nearest
 * papers by embedding in place of its related papers; its redraw from the vectors isn't ported (it needs every
 * paper's vector, which the host can't give cheaply yet).
 *
 * It draws from two `nearest` answers alone (`minimapColumns`), each a few KB the site caches per paper, not the
 * whole map: a reader moving between papers costs the site almost nothing.
 */

/** Papers on the map round the paper, and its nearest by embedding, which get a line. */
export const MINIMAP_NEAREST = 100;
export const MINIMAP_LINES = 10;
/** Smallest cluster that gets its name on the minimap. */
const MIN_LABELLED = 6;
const DOT_RADIUS = 3.2;
/** Papers other than this one and its linked ones: there, but behind. */
const CONTEXT_OPACITY = 0.45;

export interface Piece {
  /** Indexes into the map's papers: this paper first, then its nearest on the map, then linked ones not among them. */
  points: number[];
  /** Interleaved positions, framed round the paper (`frameAround`). */
  positions: Float32Array;
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
  return { points, positions: frameAround(raw, 0, linked, MINIMAP_NEAREST), linked, titles };
}

export function showMinimap(o: {
  root: HTMLElement;
  data: MapData;
  piece: Piece;
  site: string;
  pluginId: string;
  /** The set's identifier of the paper, for the full map's address. */
  paper: string;
}): { destroy(): void; setTheme(theme: PP.Theme): void } {
  const { data, piece } = o;
  const { points } = piece;
  const box = el('div', { className: 'map minimap' });
  const tooltip = el('div', { className: 'tooltip', hidden: true });
  const footer = el('div', { className: 'float footer' });
  const full = el('button', { type: 'button', className: 'link' }, 'Open the full map');
  full.addEventListener('click', () => void pp.ui.openUrl(mapPageUrl(o.site, o.pluginId, o.paper)));
  footer.append(full);
  const caption = el(
    'p',
    { className: 'caption' },
    'This paper (marked) among the papers around it on the map, coloured by cluster. ' +
      `${piece.linked.length > 0 ? `Lines go to the ${piece.linked.length} papers closest to it in content. ` : ''}` +
      'Click a paper to open it; ⌘/Ctrl + scroll to zoom.',
  );
  o.root.replaceChildren(box, caption);

  const colours = new Uint8Array(points.length * 4);
  const groups = Int32Array.from(points, (i) => data.group.cluster[i]);
  groups.forEach((g, k) => {
    colours.set(categoryRgb(g < 0 ? null : data.groups.cluster[g].number), 4 * k);
    colours[4 * k + 3] = 220;
  });
  const clusters = topicLabels(piece.positions, groups, data.names.cluster, MIN_LABELLED);

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
  let theme = mapTheme(pp.context?.theme);
  const draw = () =>
    canvas.update({
      positions: piece.positions,
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
  draw();
  return {
    destroy: () => canvas.destroy(),
    setTheme(next) {
      theme = mapTheme(next);
      draw();
    },
  };
}
