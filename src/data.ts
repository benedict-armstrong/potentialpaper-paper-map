/**
 * The map's input, from a signal set's columns (`pp.signals.columns`): which papers have a position, where, and
 * their groupings with names. Pure.
 */
import { categoryRgb, labelNumber, normalise, topicLabels, type TopicLabel } from './map';

export const DEFAULT_SET = 'benedict-armstrong/acceptodds-map';
/** The signals the map reads. A set with these names, and the shapes below, can be drawn. */
export const XY = 'map.xy';
export const REGION = 'map.region';
export const CLUSTER = 'map.cluster';
export const EMBEDDING = 'embedding';
/** Smallest grouping that gets its name on a map of 40k papers (acceptodds'); smaller maps scale it down. */
export const MIN_LABELLED = { region: 40, cluster: 15 };

/** The smallest grouping named on a map of `n` papers: acceptodds' at 40k, in proportion below, never under 2. */
export function minLabelled(n: number): Record<Grouping, number> {
  const scale = Math.min(1, n / 40_000);
  return {
    region: Math.max(2, Math.round(MIN_LABELLED.region * scale)),
    cluster: Math.max(2, Math.round(MIN_LABELLED.cluster * scale)),
  };
}

export type Grouping = 'region' | 'cluster';

/** One grouping (a region or a cluster): its key in the set, its name, colour number and size. */
export interface Group {
  index: number;
  key: string;
  title: string | null;
  number: number;
  size: number;
}

export interface MapData {
  /** The set's identifier of each paper drawn (`openreview:abc`). */
  papers: string[];
  /** `null` when asked without titles. */
  titles: string[] | null;
  /** Interleaved, in `[0, MAP_SIZE]`. */
  positions: Float32Array;
  /** Each paper's grouping, an index into `groups[g]`, or -1. */
  group: Record<Grouping, Int32Array>;
  groups: Record<Grouping, Group[]>;
  /** A grouping's name by its index, for the ones that have one. */
  names: Record<Grouping, Map<number, string>>;
  labels: Record<Grouping, TopicLabel[]>;
  byPaper: Map<string, number>;
}

type LabelColumn = Extract<PP.SignalColumns['signals'][string], { kind: 'label' }>;

/**
 * The papers with a position, normalised, with their groupings. Papers without `map.xy` are left out; a missing
 * grouping column reads as none. `minSize` sets the smallest grouping that is named (by default, `minLabelled`).
 */
export function fromColumns(columns: PP.SignalColumns, minSize?: Record<Grouping, number>): MapData {
  const xy = columns.signals[XY];
  if (!xy || xy.kind !== 'vector' || xy.dims < 2) throw new Error(`the set has no 2D "${XY}" signal`);
  const keep: number[] = [];
  for (let i = 0; i < columns.papers.length; i++) {
    const x = xy.values[i * xy.dims];
    const y = xy.values[i * xy.dims + 1];
    if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) keep.push(i);
  }
  const raw = new Float32Array(keep.length * 2);
  keep.forEach((i, k) => {
    raw[2 * k] = xy.values[i * xy.dims]!;
    raw[2 * k + 1] = xy.values[i * xy.dims + 1]!;
  });
  const positions = normalise(raw);
  const smallest = minSize ?? minLabelled(keep.length);
  const papers = keep.map((i) => columns.papers[i]);
  const titles = columns.titles ? keep.map((i) => columns.titles![i] ?? '') : null;

  const read = (name: string, which: Grouping) => {
    const col = columns.signals[name];
    const label = col && col.kind === 'label' ? (col as LabelColumn) : null;
    const group = new Int32Array(keep.length).fill(-1);
    const sizes = new Array<number>(label?.keys.length ?? 0).fill(0);
    if (label)
      keep.forEach((i, k) => {
        const v = label.values[i];
        if (v !== null && v >= 0 && v < sizes.length) {
          group[k] = v;
          sizes[v]++;
        }
      });
    const groups: Group[] = (label?.keys ?? []).map((key, index) => ({
      index,
      key,
      title: label!.titles[index] ?? null,
      number: labelNumber(key, index),
      size: sizes[index],
    }));
    const names = new Map(groups.filter((g) => g.title).map((g) => [g.index, g.title!]));
    return { group, groups, names, labels: topicLabels(positions, group, names, smallest[which]) };
  };
  const region = read(REGION, 'region');
  const cluster = read(CLUSTER, 'cluster');
  return {
    papers,
    titles,
    positions,
    group: { region: region.group, cluster: cluster.group },
    groups: { region: region.groups, cluster: cluster.groups },
    names: { region: region.names, cluster: cluster.names },
    labels: { region: region.labels, cluster: cluster.labels },
    byPaper: new Map(papers.map((p, i) => [p, i])),
  };
}

/** A paper's grouping's name, if it has one. */
export function groupName(data: MapData, by: Grouping, i: number): string | null {
  const g = data.group[by][i];
  return g < 0 ? null : (data.names[by].get(g) ?? data.groups[by][g]?.key ?? null);
}

/** Alpha of a dot, of one the search didn't find, and of one outside the grouping pointed at in the legend. */
export const DOT_ALPHA = 200;
export const UNMATCHED_ALPHA = 22;

/** RGBA per paper, coloured by its grouping. */
export function paint(data: MapData, by: Grouping, alpha = DOT_ALPHA): Uint8Array {
  const group = data.group[by];
  const groups = data.groups[by];
  const out = new Uint8Array(group.length * 4);
  for (let i = 0; i < group.length; i++) {
    const g = group[i];
    out.set(categoryRgb(g < 0 ? null : groups[g].number), 4 * i);
    out[4 * i + 3] = alpha;
  }
  return out;
}

/** The colouring with every paper but `lit` faded. */
export function spotlight(colours: Uint8Array, lit: Iterable<number>): Uint8Array {
  const out = Uint8Array.from(colours);
  for (let i = 3; i < out.length; i += 4) out[i] = UNMATCHED_ALPHA;
  for (const i of lit) out[4 * i + 3] = colours[4 * i + 3];
  return out;
}

/** The papers in one grouping. */
export function members(data: MapData, by: Grouping, index: number): number[] {
  const out: number[] = [];
  data.group[by].forEach((g, i) => g === index && out.push(i));
  return out;
}

/** Where each paper scheme's pages live on the site (`src/lib/paper-ids.ts` `PATH_PREFIX` in PotentialPaper). */
const PATH_PREFIX: Record<string, string> = { arxiv: '/abs', doi: '/doi', openreview: '/openreview' };

/** A paper's page on the site, from its identifier (`openreview:abc` → `<site>/openreview/abc`); `null` if unknown. */
export function paperUrl(site: string, identifier: string): string | null {
  const at = identifier.indexOf(':');
  const prefix = PATH_PREFIX[identifier.slice(0, at)];
  if (at < 0 || !prefix) return null;
  const value = identifier.slice(at + 1);
  return `${site.replace(/\/$/, '')}${prefix}/${value.split('/').map(encodeURIComponent).join('/')}`;
}

/** The plugin's map page, opened on a paper: `<site>/x/<plugin id>/map/<identifier>`. */
export function mapPageUrl(site: string, pluginId: string, paper?: string | null): string {
  const base = `${site.replace(/\/$/, '')}/x/${pluginId}/map`;
  return paper ? `${base}/${encodeURIComponent(paper)}` : base;
}

/** The paper a map page opens on, from the rest of its path (`surface.path`). */
export function paperFromPath(path: readonly string[]): string | null {
  const joined = path.map((p) => decodeURIComponent(p)).join('/');
  return joined || null;
}

/** The set a reader picked in the settings, or the default. */
export function setOf(settings: Record<string, unknown> | null | undefined): string {
  const v = settings?.set;
  return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9-]{0,63}$/.test(v.trim()) ? v.trim() : DEFAULT_SET;
}
