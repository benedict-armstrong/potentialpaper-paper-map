import { MapCanvas, type LabelMode } from './canvas';
import {
  EMBEDDING,
  fromColumns,
  groupName,
  members,
  minLabelled,
  paint,
  paperUrl,
  spotlight,
  type Grouping,
  type MapData,
} from './data';
import { el, toggle } from './dom';
import { MAX_RELAYOUT } from './layout';
import type { LayoutFrame, LayoutRequest } from './layout.worker';
import { categoryRgb, labelTerms, searchTitles, topicLabels, type TopicLabel } from './map';
import { mapTheme } from './theme';

/**
 * The whole map (the plugin's page, and a venue's, topic's or org's tab): every paper of the set (or of the scope)
 * where `map.xy` puts it, coloured by region or cluster, named by zoom; the search lights the titles it finds, and
 * "redraw" lays them out again among themselves. Selecting a paper draws lines to its nearest papers by the set's
 * `embedding` and lists them. acceptodds' `/map` (`PaperMapView`), without its market parts.
 */

const COLOURS: [Grouping, string][] = [
  ['region', 'region'],
  ['cluster', 'cluster'],
];
const LABELS: [LabelMode, string][] = [
  ['auto', 'by zoom'],
  ['region', 'regions'],
  ['cluster', 'clusters'],
  ['off', 'off'],
];
const SEARCH_HITS = 10;
/** A redraw restarts on every search, so wait for a pause in the typing. */
const SEARCH_DEBOUNCE_MS = 300;
/** Nearest papers a selection draws lines to and lists. */
const NEAREST = 10;
const PREFS_KEY = 'paper-map:prefs';

interface Prefs {
  colourBy: Grouping;
  labelMode: LabelMode;
  open: boolean;
  redraw: boolean;
}

function loadPrefs(): Prefs {
  const base: Prefs = { colourBy: 'region', labelMode: 'auto', open: true, redraw: true };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!saved) return base;
    return {
      colourBy: saved.colourBy === 'cluster' ? 'cluster' : 'region',
      labelMode: LABELS.some(([v]) => v === saved.labelMode) ? saved.labelMode! : 'auto',
      open: saved.open !== false,
      redraw: saved.redraw !== false,
    };
  } catch {
    return base;
  }
}

function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Remembering the controls is optional.
  }
}

export interface FullMapOptions {
  root: HTMLElement;
  set: string;
  /** The set has an `embedding` signal, so a selection can show its nearest papers. */
  hasEmbedding: boolean;
  columns: PP.SignalColumns;
  site: string;
  /** The paper to open on, selected (the map page's path). */
  initialPaper: string | null;
  /** On a venue's, topic's or org's page: what to call it. */
  scopeName?: string;
  /** In a page that scrolls (a tab): the wheel scrolls it. */
  embedded: boolean;
}

export function showFullMap(o: FullMapOptions): { destroy(): void; setTheme(theme: PP.Theme): void } {
  const data: MapData = fromColumns(o.columns);
  const prefs = loadPrefs();
  let theme = mapTheme(pp.context?.theme);
  let selected: number | null = null;
  let query = '';
  let asked = '';
  let matches: number[] | null = null;
  let pointed: number | null = null;
  let layout: { of: number[]; positions: Float32Array; settled: boolean } | null = null;
  let neighbours: { paper: string; title: string; index: number | undefined }[] | null = null;
  const nearestCache = new Map<string, Promise<{ paper: string; title: string }[]>>();

  const root = o.root;
  root.replaceChildren();
  root.classList.add('map');
  const tooltip = el('div', { className: 'tooltip', hidden: true });
  const panel = el('div', { className: 'controls' });
  root.append(tooltip, panel);

  const titleOf = (i: number) => data.titles?.[i] || data.papers[i];
  const open = (i: number) => {
    const url = paperUrl(o.site, data.papers[i]);
    if (url) void pp.ui.openUrl(url);
  };

  const canvas = new MapCanvas(root, {
    embedded: o.embedded,
    onHover: (hover) => showTooltip(hover),
    onSelect: (i) => {
      if (i !== null && i === selected) open(i);
      else select(i);
    },
    onOpen: open,
  });
  // The canvas goes under the floating parts.
  root.prepend(...[...root.children].filter((c) => c !== tooltip && c !== panel));

  function showTooltip(hover: { index: number; x: number; y: number } | null) {
    if (!hover) {
      tooltip.hidden = true;
      return;
    }
    const i = hover.index;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    tooltip.replaceChildren(
      el('span', {}, titleOf(i)),
      el('span', { className: 'sub' }, groupName(data, 'cluster', i) ?? groupName(data, 'region', i) ?? ''),
      el(
        'span',
        { className: 'hint' },
        `${i === selected ? 'Click again to open the paper · ' : ''}${mac ? '⌘' : 'Ctrl'}-click to open it in a new tab`,
      ),
    );
    tooltip.hidden = false;
    // Kept inside the frame: flipped to the left or above the pointer near the right or bottom edge.
    const w = root.clientWidth;
    const h = root.clientHeight;
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${hover.x + 14 + box.width > w ? Math.max(0, hover.x - 14 - box.width) : hover.x + 14}px`;
    tooltip.style.top = `${hover.y + 10 + box.height > h ? Math.max(0, hover.y - 10 - box.height) : hover.y + 10}px`;
  }

  // Redraw: the matches laid out again among themselves, in a worker, drawn as they settle.
  let worker: Worker | null = null;
  let job = 0;
  function relayout() {
    const subset = prefs.redraw && matches && matches.length > 0 && matches.length <= MAX_RELAYOUT ? matches : null;
    if (layout && layout.of !== subset) layout = null;
    if (worker) worker.postMessage({ id: ++job, stop: true } satisfies LayoutRequest);
    if (!subset) return;
    const start = new Float32Array(subset.length * 2);
    const groups = Int32Array.from(subset, (i) => data.group.cluster[i]);
    subset.forEach((i, k) => {
      start[2 * k] = data.positions[2 * i];
      start[2 * k + 1] = data.positions[2 * i + 1];
    });
    try {
      worker ??= new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return; // No workers here: the matches stay in place.
    }
    const id = ++job;
    worker.onmessage = (e: MessageEvent<LayoutFrame>) => {
      if (e.data.id !== job || subset !== matches) return;
      const all = Float32Array.from(data.positions);
      subset.forEach((i, k) => {
        all[2 * i] = e.data.positions[2 * k];
        all[2 * i + 1] = e.data.positions[2 * k + 1];
      });
      layout = { of: subset, positions: all, settled: e.data.settled };
      draw();
      if (e.data.settled) renderPanel();
    };
    worker.postMessage({ id, start, groups } satisfies LayoutRequest, { transfer: [start.buffer, groups.buffer] });
  }

  /** The labels, following a re-laid-out map once it settles, named only from the papers on it. */
  function labels(): { regions: TopicLabel[]; clusters: TopicLabel[] } {
    if (!layout) return { regions: data.labels.region, clusters: data.labels.cluster };
    if (!layout.settled) return { regions: [], clusters: [] };
    const on = new Set(layout.of);
    const only = (g: Int32Array) => Int32Array.from(g, (v, i) => (on.has(i) ? v : -1));
    // Named as a map of only the matches would be, a quarter as strict, as acceptodds does.
    const min = minLabelled(layout.of.length * 4);
    return {
      regions: topicLabels(layout.positions, only(data.group.region), data.names.region, min.region),
      clusters: topicLabels(layout.positions, only(data.group.cluster), data.names.cluster, min.cluster),
    };
  }

  let colours = paint(data, prefs.colourBy);
  let mask: Float32Array | null = null;
  function draw() {
    const lit = pointed !== null ? members(data, prefs.colourBy, pointed) : matches;
    mask = null;
    if (layout && matches) {
      mask = new Float32Array(data.papers.length);
      for (const i of layout.of) mask[i] = 1;
    } else if (prefs.redraw && matches && matches.length <= MAX_RELAYOUT && matches.length > 0) {
      // Waiting for the first frame of a redraw: hide the rest already, so the switch doesn't flash.
      mask = new Float32Array(data.papers.length);
      for (const i of matches) mask[i] = 1;
    }
    const { regions, clusters } = labels();
    canvas.update({
      positions: layout?.positions ?? data.positions,
      colours: lit ? spotlight(colours, lit) : colours,
      shown: mask,
      regions,
      clusters,
      labelMode: prefs.labelMode,
      selected,
      // Lines only to papers drawn: a redraw hides the rest.
      neighbours: (neighbours ?? []).flatMap((n) => (n.index === undefined || (mask && !mask[n.index]) ? [] : [n.index])),
      highlight: asked ? labelTerms(asked) : [],
      theme,
    });
  }

  function select(i: number | null, fly = false) {
    selected = i;
    neighbours = null;
    draw();
    renderPanel();
    if (i === null) return;
    if (fly) canvas.focus(i);
    if (!o.hasEmbedding) return;
    const paper = data.papers[i];
    let found = nearestCache.get(paper);
    if (!found) {
      found = pp.signals.nearest(o.set, EMBEDDING, paper, { k: NEAREST }).then((r) => r.neighbours);
      nearestCache.set(paper, found);
      found.catch(() => nearestCache.delete(paper));
    }
    found
      .then((list) => {
        if (selected !== i) return;
        neighbours = list
          .filter((n) => n.paper !== paper)
          .map((n) => ({ ...n, index: data.byPaper.get(n.paper) }));
        draw();
        renderPanel();
      })
      .catch(() => {
        if (selected !== i) return;
        neighbours = [];
        renderPanel();
      });
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function search(text: string) {
    query = text;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      asked = query.trim();
      matches = asked && data.titles ? searchTitles(data.titles, asked) : null;
      relayout();
      draw();
      renderPanel();
    }, SEARCH_DEBOUNCE_MS);
  }

  // The panel: rebuilt whole on each change but the search box, which keeps its focus and caret.
  const input = el('input', {
    className: 'search',
    type: 'search',
    placeholder: 'Search titles: words, "a phrase", -not',
    value: query,
  });
  input.setAttribute('aria-label', 'Search titles');
  input.addEventListener('input', () => search(input.value));
  if (!data.titles) input.disabled = true;

  function renderPanel() {
    const count = data.papers.length.toLocaleString('en-US');
    const head = el(
      'div',
      { className: 'head' },
      el('span', {}, `${count} papers${o.scopeName ? ` of ${o.scopeName}` : ''}, near the papers most like them`),
      button(prefs.open ? 'hide' : 'show', () => {
        prefs.open = !prefs.open;
        savePrefs(prefs);
        renderPanel();
      }),
    );
    if (!prefs.open) {
      panel.replaceChildren(head);
      return;
    }
    const body = el('div', { className: 'body' });
    body.append(
      toggle('Colour', COLOURS, prefs.colourBy, (v) => {
        prefs.colourBy = v;
        pointed = null;
        savePrefs(prefs);
        colours = paint(data, v);
        draw();
        renderPanel();
      }),
      toggle('Labels', LABELS, prefs.labelMode, (v) => {
        prefs.labelMode = v;
        savePrefs(prefs);
        draw();
        renderPanel();
      }),
      legend(),
    );

    const status = !asked
      ? data.titles
        ? 'Words search the titles.'
        : 'No titles to search.'
      : `${matches!.length.toLocaleString('en-US')} ${matches!.length === 1 ? 'match' : 'matches'}${relayoutNote()}`;
    const searchBox = el('div', { className: 'searchbox' }, input);
    const line = el('div', { className: 'status' }, el('span', {}, status));
    if (asked) {
      const box = el('input', { type: 'checkbox', checked: prefs.redraw });
      box.addEventListener('change', () => {
        prefs.redraw = box.checked;
        savePrefs(prefs);
        relayout();
        draw();
        renderPanel();
      });
      line.append(el('label', { className: 'check' }, box, 'redraw'));
    }
    searchBox.append(line);
    if (matches && matches.length > 0) {
      searchBox.append(
        el(
          'ul',
          { className: 'hits' },
          ...matches.slice(0, SEARCH_HITS).map((i) => el('li', {}, button(titleOf(i), () => select(i, true), 'title'))),
        ),
      );
    }
    body.append(searchBox);
    if (selected !== null) body.append(selection(selected));
    panel.replaceChildren(head, body);
  }

  function relayoutNote(): string {
    if (!prefs.redraw || !matches || matches.length === 0) return '';
    if (matches.length > MAX_RELAYOUT) return `, too many to lay out again (over ${MAX_RELAYOUT.toLocaleString('en-US')})`;
    return layout?.settled ? ', laid out again' : ', laying out…';
  }

  /** The legend: each grouping with its colour, largest first; pointing at one lights its papers. */
  function legend(): HTMLElement {
    const groups = data.groups[prefs.colourBy].filter((g) => g.size > 0).sort((a, b) => b.size - a.size);
    const list = el('ul', { className: 'legend' });
    for (const g of groups) {
      const [r, gg, b] = categoryRgb(g.number);
      const item = el(
        'button',
        { type: 'button', className: pointed === g.index ? 'on' : '' },
        el('span', { className: 'swatch', style: `background: rgb(${r},${gg},${b})` }),
        g.title ?? g.key,
        el('span', { className: 'count' }, ` ${g.size.toLocaleString('en-US')}`),
      );
      const point = (on: boolean) => {
        pointed = on ? g.index : pointed === g.index ? null : pointed;
        item.classList.toggle('on', on);
        draw();
      };
      item.addEventListener('mouseenter', () => point(true));
      item.addEventListener('mouseleave', () => point(false));
      item.addEventListener('focus', () => point(true));
      item.addEventListener('blur', () => point(false));
      list.append(el('li', {}, item));
    }
    return list;
  }

  function selection(i: number): HTMLElement {
    const box = el('div', { className: 'selected' });
    const title = button(titleOf(i), () => open(i), 'title paper-title');
    title.title = 'Open the paper';
    const where = [...new Set([groupName(data, 'cluster', i), groupName(data, 'region', i)].filter(Boolean))].join(' · ');
    box.append(el('div', {}, title), el('p', { className: 'sub' }, where));
    if (!o.hasEmbedding) return box;
    box.append(el('div', { className: 'subhead' }, 'Nearest papers'));
    if (neighbours === null) box.append(el('p', { className: 'note' }, 'Loading…'));
    else if (neighbours.length === 0) box.append(el('p', { className: 'note' }, 'None found.'));
    else
      box.append(
        el(
          'ol',
          {},
          ...neighbours.map((n) =>
            el(
              'li',
              {},
              n.index !== undefined
                ? button(n.title || n.paper, () => select(n.index!, true), 'title')
                : button(n.title || n.paper, () => {
                    const url = paperUrl(o.site, n.paper);
                    if (url) void pp.ui.openUrl(url);
                  }, 'title'),
            ),
          ),
        ),
      );
    return box;
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && selected !== null) select(null);
  };
  addEventListener('keydown', onKey);

  draw();
  renderPanel();
  let missing: HTMLElement | null = null;
  if (o.initialPaper) {
    const i = data.byPaper.get(o.initialPaper);
    if (i !== undefined) select(i, true);
    else {
      missing = el('div', { className: 'float notice' }, 'That paper isn’t on this map.');
      root.append(missing);
      setTimeout(() => missing?.remove(), 5000);
    }
  }

  return {
    destroy() {
      removeEventListener('keydown', onKey);
      worker?.terminate();
      canvas.destroy();
    },
    setTheme(next) {
      theme = mapTheme(next);
      draw();
    },
  };
}

function button(text: string, onClick: () => void, className = 'link'): HTMLButtonElement {
  const b = el('button', { type: 'button', className: className === 'link' ? 'link' : `link ${className}` }, text);
  b.addEventListener('click', onClick);
  return b;
}
