// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { columns } from './fixtures';

/**
 * The plugin end to end in a DOM, against a fake `pp` that answers as the host does (`signals.set`, `columns`,
 * `nearest`), with the WebGL canvas replaced by a stand-in that records what it is asked to draw (happy-dom has no
 * WebGL): which calls each surface makes, what it shows, and what it says when there is no map.
 */

const drawn: { update: Record<string, unknown>[]; focus: number[] } = { update: [], focus: [] };
vi.mock('../src/canvas', () => ({
  MapCanvas: class {
    constructor(parent: HTMLElement) {
      parent.append(Object.assign(document.createElement('div'), { className: 'canvas' }));
    }
    update(input: Record<string, unknown>) {
      drawn.update.push(input);
    }
    focus(i: number) {
      drawn.focus.push(i);
    }
    reset() {}
    destroy() {}
  },
}));

const SET: PP.SignalSet = {
  id: 'benedict-armstrong/acceptodds-map',
  name: 'acceptodds map',
  description: null,
  source: 'github:benedict-armstrong/potentialpaper-acceptodds-map',
  commit: 'abc',
  publisher: 'benedict-armstrong',
  generation: 2,
  staged: null,
  changedAt: '2026-11-18T00:00:00.000Z',
  signals: ['embedding', 'map.cluster', 'map.region', 'map.xy'].map((name) => ({
    name,
    kind: name.startsWith('map.') && name !== 'map.xy' ? 'label' : 'vector',
    spec: {},
    count: 3,
  })),
};

const page = (kind: PP.PageKind, identifier: string, name = identifier): PP.PageSummary => ({
  kind,
  identifier,
  address: `/${identifier}`,
  url: `https://site.org/${identifier}`,
  name,
});

type Surface = PP.Context['surface'];

/** The host's `nearest`, over the fixture's papers: by `map.xy` (a then d's neighbours) or by `embedding`. */
function nearest(params: Record<string, unknown>) {
  const values: Record<string, Record<string, unknown>> = {
    'openreview:a': { 'map.xy': [0, 0], 'map.cluster': '12', embedding: [1, 0, 0] },
    'openreview:b': { 'map.xy': [1, 0], 'map.cluster': '40', embedding: [0.9, 0.1, 0] },
    'openreview:c': { 'map.xy': [10, 5], 'map.cluster': null, embedding: [0.5, 0.5, 0] },
    'openreview:e': { 'map.xy': [0.5, 0.5], 'map.cluster': '12', embedding: [0, 1, 0] },
  };
  const withValues = Array.isArray(params.with) && params.with.length > 0;
  const of = (paper: string) => (withValues ? { values: values[paper] } : {});
  const list =
    params.signal === 'map.xy'
      ? [
          { paper: 'openreview:e', title: 'Agents that act', score: -0.5 },
          { paper: 'openreview:b', title: 'Agents that remember', score: -1 },
        ]
      : [
          { paper: 'openreview:b', title: 'Agents that remember', score: 0.9 },
          { paper: 'openreview:c', title: 'Kv cache compression', score: 0.5 },
        ];
  return {
    set: SET.id,
    signal: params.signal,
    paper: 'openreview:a',
    ...of('openreview:a'),
    neighbours: list.map((n) => ({ ...n, ...of(n.paper) })),
    ...(withValues ? { labels: { 'map.cluster': { '12': 'planning', '40': 'memory' } } } : {}),
  };
}

function install(surface: Surface, current: PP.PageSummary | null, answers: Partial<Record<string, unknown>> = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const resize: ((size: PP.Size) => void)[] = [];
  const answer = async (method: string, params: Record<string, unknown>, fallback: unknown) => {
    calls.push({ method, params });
    const a = answers[method];
    if (a instanceof Error) throw a;
    return a ?? fallback;
  };
  const context: PP.Context = {
    plugin: { id: 'benedict-armstrong/paper-map', name: 'Paper map', version: '0.1.0', sha: null, dev: false },
    surface,
    page: current,
    scopes: [],
    viewer: { signedIn: false, isOwner: false },
    theme: { mode: 'light', tokens: { ink: '#1d1d1d', bg: '#fbfaf7', accent: '#b31b1b' } },
    settings: {},
    site: 'https://site.org',
    methods: [],
  };
  const pp = {
    context,
    ready: Promise.resolve(context),
    // No `pp.signals`, as in an SDK a browser cached from before it: the plugin calls the methods by name.
    call: (method: string, params: Record<string, unknown>) =>
      answer(
        method,
        params,
        {
          'signals.set': SET,
          'signals.columns': columns(),
          'signals.nearest': nearest(params),
        }[method],
      ),
    ui: {
      setHeight: vi.fn(async () => {}),
      autoHeight: vi.fn(),
      openUrl: vi.fn(async () => {}),
      onResize: (listener: (size: PP.Size) => void) => {
        resize.push(listener);
        return () => {};
      },
    },
    theme: { onChange: () => () => {} },
    settings: { onChange: () => () => {} },
  };
  (globalThis as unknown as { pp: unknown }).pp = pp;
  /** The host saying the frame is now this wide, as `surface.resize`. */
  const resizeTo = (width: number) => {
    if (context.surface.type === 'panel') context.surface.size = { width, height: 0 };
    resize.forEach((l) => l({ width, height: 0 }));
  };
  return { pp, calls, resizeTo };
}

const app = () => document.getElementById('app')!;

async function boot(surface: Surface, current: PP.PageSummary | null, answers?: Partial<Record<string, unknown>>) {
  const fake = install(surface, current, answers);
  vi.resetModules();
  await import('../src/main');
  return fake;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  drawn.update = [];
  drawn.focus = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { pp?: unknown }).pp;
});

describe('the map page', () => {
  it('draws every paper of the set, with titles, and opens on the paper in its path', async () => {
    const { pp, calls } = await boot({ type: 'page', page: 'map', path: ['openreview%3Ab'] , size: { width: 1200, height: 800 } }, null);
    await vi.waitFor(() => expect(app().querySelector('.controls')).not.toBeNull());
    const asked = calls.find((c) => c.method === 'signals.columns')!;
    expect(asked.params).toEqual({ set: SET.id, signals: ['map.xy', 'map.region', 'map.cluster'], titles: true });
    expect(app().textContent).toContain('3 papers, near the papers most like them');
    // The legend lists the regions, largest first.
    expect([...app().querySelectorAll('.legend li')].map((li) => li.textContent)).toEqual([
      'llm agents · skills 2',
      '3 1',
    ]);
    // A full-window page: it fills its frame and asks for no height.
    expect(pp.ui.setHeight).not.toHaveBeenCalled();
    expect(document.getElementById('app')!.style.height).toBe('100vh');
    // Opened on paper b: selected, flown to, and its nearest papers listed.
    expect(drawn.focus).toEqual([1]);
    await vi.waitFor(() => expect(app().querySelector('.selected ol')?.textContent).toContain('Kv cache compression'));
    expect(calls.find((c) => c.method === 'signals.nearest')!.params).toEqual({ set: SET.id, signal: 'embedding', paper: 'openreview:b', k: 10 });
    expect(drawn.update.at(-1)).toMatchObject({ selected: 1, neighbours: [2] });
    // The address names the selected paper.
    expect(calls.filter((c) => c.method === 'ui.setPath').at(-1)!.params).toEqual({ path: ['openreview:b'] });
  });

  it('lights the titles a search finds and the labels it names', async () => {
    await boot({ type: 'page', page: 'map', path: [] , size: { width: 1200, height: 800 } }, null);
    await vi.waitFor(() => expect(app().querySelector('.search')).not.toBeNull());
    const input = app().querySelector<HTMLInputElement>('.search')!;
    input.value = 'agents -remember';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(400);
    expect(app().querySelector('.status')?.textContent).toContain('1 match');
    expect(app().querySelector('.hits')?.textContent).toBe('Agents that plan');
    expect(drawn.update.at(-1)).toMatchObject({ highlight: ['agents'] });
  });

  it('shows only a grouping’s papers when it is clicked in the legend, and every paper on a second click', async () => {
    await boot({ type: 'page', page: 'map', path: [] , size: { width: 1200, height: 800 } }, null);
    await vi.waitFor(() => expect(app().querySelector('.legend button')).not.toBeNull());
    app().querySelector<HTMLButtonElement>('.legend button')!.click();
    const input = app().querySelector<HTMLInputElement>('.search')!;
    expect(input.value).toBe('region:"llm agents · skills"');
    expect(app().querySelector('.status')?.textContent).toContain('2 matches');
    expect(app().querySelector('.legend button')!.classList.contains('chosen')).toBe(true);
    app().querySelector<HTMLButtonElement>('.legend button')!.click();
    expect(input.value).toBe('');
    expect(app().querySelector('.hits')).toBeNull();
  });

  it('says so when the set is not on the site', async () => {
    const missing = Object.assign(new Error('no signal set x'), { code: 'Unavailable' });
    await boot({ type: 'page', page: 'map', path: [] , size: { width: 1200, height: 800 } }, null, { 'signals.set': missing });
    await vi.waitFor(() => expect(app().textContent).toBe('The signal set benedict-armstrong/acceptodds-map isn’t on this site.'.replace('’', "'")));
  });
});

describe('a venue’s tab', () => {
  it('maps the venue’s papers', async () => {
    const { calls } = await boot({ type: 'panel', panel: 'map', slot: 'venue.tabs', place: 'tab', size: { width: 900, height: 0 } }, page('venue', 'venue:iclr/2027', 'ICLR 2027'));
    await vi.waitFor(() => expect(app().querySelector('.controls')).not.toBeNull());
    expect(calls.find((c) => c.method === 'signals.columns')!.params).toMatchObject({ scope: 'venue:iclr/2027', titles: true });
    expect(app().textContent).toContain('3 papers of ICLR 2027');
  });

  it('says there is nothing here when the scope has no papers on the map', async () => {
    const empty = { ...columns(), papers: [], titles: [], signals: { 'map.xy': { kind: 'vector', dims: 2, values: [] } } };
    const { pp } = await boot({ type: 'panel', panel: 'scope-map', slot: 'category.tabs', place: 'tab', size: { width: 900, height: 0 } }, page('category', 'category:x'), {
      'signals.columns': empty,
    });
    await vi.waitFor(() => expect(app().textContent).toBe('No papers on this map here.'));
    expect(pp.ui.autoHeight).toHaveBeenCalledWith(true);
  });
});

describe('a paper’s minimap', () => {
  it('draws the paper among the papers round it, with lines to its nearest by content, from two small reads', async () => {
    const { pp, calls } = await boot({ type: 'panel', panel: 'minimap', slot: 'paper.community', place: 'community', size: { width: 640, height: 0 } }, page('paper', 'arxiv:1'));
    await vi.waitFor(() => expect(app().querySelector('.minimap')).not.toBeNull());
    const near = calls.filter((c) => c.method === 'signals.nearest').map((c) => c.params);
    expect(near).toEqual([
      { set: SET.id, signal: 'map.xy', paper: 'arxiv:1', k: 100, with: ['map.xy', 'map.cluster', 'embedding'] },
      { set: SET.id, signal: 'embedding', paper: 'arxiv:1', k: 10, with: ['map.xy', 'map.cluster', 'embedding'] },
    ]);
    // Not the whole map.
    expect(calls.some((c) => c.method === 'signals.columns')).toBe(false);
    // a, then e and b round it on the map, then c (nearest by content only); lines to b and c.
    expect(drawn.update.at(-1)).toMatchObject({ selected: 0, neighbours: [2, 3], labelMode: 'cluster' });
    app().querySelector<HTMLButtonElement>('.footer button')!.click();
    expect(pp.ui.openUrl).toHaveBeenCalledWith('https://site.org/x/benedict-armstrong/paper-map/map/openreview%3Aa');
  });

  it('is redrawn from the embeddings by default, and can be shown as on the map, remembered', async () => {
    localStorage.removeItem('paper-map:minimap-redraw');
    await boot(
      { type: 'panel', panel: 'minimap', slot: 'paper.community', place: 'community', size: { width: 640, height: 0 } },
      page('paper', 'arxiv:1'),
    );
    await vi.waitFor(() => expect(app().querySelector('.minimap')).not.toBeNull());
    const switcher = () => app().querySelector('.switch')!;
    expect(switcher().querySelector('.on')!.textContent).toBe('redrawn');
    expect(app().querySelector('.caption')!.textContent).toContain('Redrawn from the papers’ embeddings');
    [...switcher().querySelectorAll('button')].find((b) => b.textContent === 'as on the map')!.click();
    expect(switcher().querySelector('.on')!.textContent).toBe('as on the map');
    expect(app().querySelector('.caption')!.textContent).toContain('Placed as on the map');
    expect(localStorage.getItem('paper-map:minimap-redraw')).toBe('map');
    localStorage.removeItem('paper-map:minimap-redraw');
  });

  it('is a figure in the main text, the side column’s size there, and follows its width', async () => {
    const { resizeTo } = await boot(
      { type: 'panel', panel: 'minimap', slot: 'paper.community', place: 'community', size: { width: 640, height: 0 } },
      page('paper', 'arxiv:1'),
    );
    await vi.waitFor(() => expect(app().querySelector('.minimap')).not.toBeNull());
    const box = () => app().querySelector<HTMLElement>('.minimap')!;
    expect(box().style.height).toBe('320px');
    resizeTo(1000);
    expect(box().style.height).toBe('440px');
    resizeTo(400);
    expect(box().style.height).toBe('300px');
  });

  it('says the paper isn’t on the map', async () => {
    await boot({ type: 'panel', panel: 'minimap', slot: 'paper.community', place: 'community', size: { width: 640, height: 0 } }, page('paper', 'arxiv:2'), {
      'signals.nearest': { set: SET.id, signal: 'map.xy', paper: null, neighbours: [] },
    });
    await vi.waitFor(() => expect(app().textContent).toBe('This paper isn’t on the map.'));
  });
});
