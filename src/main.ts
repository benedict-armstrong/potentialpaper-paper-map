/// <reference path="./pp.d.ts" />
/**
 * Paper map, a PotentialPaper plugin: acceptodds' map of papers, drawn from a signal set (`map.xy`, `map.region`,
 * `map.cluster`, `embedding`). Three surfaces, one frame each:
 *
 * - the plugin's page `map` (`/x/<id>/map[/<paper>]`): every paper of the set, opened on a paper when the path names one;
 * - a tab on a venue's, topic's or organisation's page: the same map, of that page's papers (`scope`);
 * - the aside of a paper's page: its minimap, the paper among the papers round it on the map.
 */
import './style.css';
import { defaultStore } from './cache';
import { EMBEDDING, fromColumns, paperFromPath, setOf, XY } from './data';
import { el, note } from './dom';
import { showFullMap } from './fullmap';
import { failureText, loadColumns, type ColumnsStore } from './load';
import { MINIMAP_LINES, pieceOf, showMinimap } from './minimap';
import { signals as sig } from './signals';

const app = document.getElementById('app')!;
const store: ColumnsStore = defaultStore<PP.SignalColumns>();

/** The page map fills its frame, which the site makes the whole window under its bar (`"layout": "full"`). */
const FULL = '100vh';
/** A tab's: a bit less, so the page around it still shows. */
function tabHeight(): number {
  return Math.round(Math.min(800, Math.max(420, (screen.availHeight || 900) * 0.65)));
}

let view: { destroy(): void; setTheme(theme: PP.Theme): void } | null = null;
let run = 0;
let currentSet = '';

function message(text: string) {
  note(app, text);
  pp.ui.autoHeight(true);
}

/** A box of the map's height saying it is loading, so nothing jumps when the map arrives. */
function loading(height: number | typeof FULL) {
  app.className = 'map';
  app.style.height = height === FULL ? FULL : `${height}px`;
  app.replaceChildren(el('p', { className: 'loading' }, 'Loading the map…'));
  if (height !== FULL) void pp.ui.setHeight(height);
}

async function start(ctx: PP.Context) {
  const token = ++run;
  view?.destroy();
  view = null;
  const set = setOf(ctx.settings);
  currentSet = set;
  const surface = ctx.surface;
  try {
    if (surface.type === 'page') {
      loading(FULL);
      const { set: info, columns } = await loadColumns(store, set, { titles: true });
      if (token !== run) return;
      if (!hasPapers(columns)) return message(`The signal set ${set} has no papers on its map yet.`);
      app.style.height = FULL;
      view = showFullMap({
        root: app,
        set,
        hasEmbedding: info.signals.some((s) => s.name === EMBEDDING),
        columns,
        site: ctx.site,
        initialPaper: paperFromPath(surface.path),
        embedded: false,
      });
      return;
    }
    if (!ctx.page) return message('Nothing to map here.');
    if (surface.panel === 'minimap') {
      // The paper's nearest first: it says whether the paper is on the map at all, before the map is fetched.
      const near = await sig.nearest(set, EMBEDDING, undefined, { k: MINIMAP_LINES });
      if (token !== run) return;
      if (!near.paper) return message('This paper isn’t on the map.');
      app.replaceChildren(el('p', { className: 'note' }, 'Loading the map…'));
      // With titles, so hovering names any paper: the same copy as the map page's, so either fills the cache.
      const { columns } = await loadColumns(store, set, { titles: true });
      if (token !== run) return;
      const data = fromColumns(columns);
      const piece = pieceOf(data, near.paper, near.neighbours);
      if (!piece) return message('This paper isn’t on the map.');
      app.className = '';
      view = showMinimap({ root: app, data, piece, site: ctx.site, pluginId: ctx.plugin.id, paper: near.paper });
      pp.ui.autoHeight(true);
      return;
    }
    const height = tabHeight();
    loading(height);
    const { set: info, columns } = await loadColumns(store, set, { scope: ctx.page.identifier, titles: true });
    if (token !== run) return;
    if (!hasPapers(columns)) return message('No papers on this map here.');
    app.style.height = `${height}px`;
    view = showFullMap({
      root: app,
      set,
      hasEmbedding: info.signals.some((s) => s.name === EMBEDDING),
      columns,
      site: ctx.site,
      initialPaper: null,
      scopeName: ctx.page.name,
      embedded: true,
    });
  } catch (error) {
    if (token !== run) return;
    console.error(error);
    message(failureText(error, set));
  }
}

function hasPapers(columns: PP.SignalColumns): boolean {
  const xy = columns.signals[XY];
  return columns.papers.length > 0 && !!xy && xy.values.some((v) => v !== null);
}

pp.ready.then(start);
pp.theme.onChange((theme) => view?.setTheme(theme));
pp.settings.onChange((settings) => {
  if (setOf(settings) !== currentSet && pp.context) void start({ ...pp.context, settings });
});
