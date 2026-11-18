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

function install(surface: Surface, current: PP.PageSummary | null, answers: Partial<Record<string, unknown>> = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
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
          'signals.nearest': {
            set: SET.id,
            signal: 'embedding',
            paper: 'openreview:a',
            neighbours: [
              { paper: 'openreview:b', title: 'Agents that remember', score: 0.9 },
              { paper: 'openreview:c', title: 'Kv cache compression', score: 0.5 },
            ],
          },
        }[method],
      ),
    ui: {
      setHeight: vi.fn(async () => {}),
      autoHeight: vi.fn(),
      openUrl: vi.fn(async () => {}),
    },
    theme: { onChange: () => () => {} },
    settings: { onChange: () => () => {} },
  };
  (globalThis as unknown as { pp: unknown }).pp = pp;
  return { pp, calls };
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
    const { pp, calls } = await boot({ type: 'page', page: 'map', path: ['openreview%3Ab'] }, null);
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
  });

  it('lights the titles a search finds and the labels it names', async () => {
    await boot({ type: 'page', page: 'map', path: [] }, null);
    await vi.waitFor(() => expect(app().querySelector('.search')).not.toBeNull());
    const input = app().querySelector<HTMLInputElement>('.search')!;
    input.value = 'agents -remember';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(400);
    expect(app().querySelector('.status')?.textContent).toContain('1 match');
    expect(app().querySelector('.hits')?.textContent).toBe('Agents that plan');
    expect(drawn.update.at(-1)).toMatchObject({ highlight: ['agents'] });
  });

  it('says so when the set is not on the site', async () => {
    const missing = Object.assign(new Error('no signal set x'), { code: 'Unavailable' });
    await boot({ type: 'page', page: 'map', path: [] }, null, { 'signals.set': missing });
    await vi.waitFor(() => expect(app().textContent).toBe('The signal set benedict-armstrong/acceptodds-map isn’t on this site.'.replace('’', "'")));
  });
});

describe('a venue’s tab', () => {
  it('maps the venue’s papers', async () => {
    const { calls } = await boot({ type: 'panel', panel: 'map', slot: 'venue.tabs' }, page('venue', 'venue:iclr/2027', 'ICLR 2027'));
    await vi.waitFor(() => expect(app().querySelector('.controls')).not.toBeNull());
    expect(calls.find((c) => c.method === 'signals.columns')!.params).toMatchObject({ scope: 'venue:iclr/2027', titles: true });
    expect(app().textContent).toContain('3 papers of ICLR 2027');
  });

  it('says there is nothing here when the scope has no papers on the map', async () => {
    const empty = { ...columns(), papers: [], titles: [], signals: { 'map.xy': { kind: 'vector', dims: 2, values: [] } } };
    const { pp } = await boot({ type: 'panel', panel: 'scope-map', slot: 'topic.tabs' }, page('topic', 'topic:x'), {
      'signals.columns': empty,
    });
    await vi.waitFor(() => expect(app().textContent).toBe('No papers on this map here.'));
    expect(pp.ui.autoHeight).toHaveBeenCalledWith(true);
  });
});

describe('a paper’s minimap', () => {
  it('draws the paper among the papers round it, with lines to its nearest by content', async () => {
    const { pp, calls } = await boot({ type: 'panel', panel: 'minimap', slot: 'paper.aside' }, page('paper', 'arxiv:1'));
    await vi.waitFor(() => expect(app().querySelector('.minimap')).not.toBeNull());
    expect(calls.find((c) => c.method === 'signals.nearest')!.params).toEqual({ set: SET.id, signal: 'embedding', paper: 'arxiv:1', k: 10 });
    expect(calls.find((c) => c.method === 'signals.columns')!.params).toMatchObject({ titles: true });
    expect(drawn.update.at(-1)).toMatchObject({ selected: 0, neighbours: [1, 2], labelMode: 'cluster' });
    app().querySelector<HTMLButtonElement>('.footer button')!.click();
    expect(pp.ui.openUrl).toHaveBeenCalledWith('https://site.org/x/benedict-armstrong/paper-map/map/openreview%3Aa');
  });

  it('says the paper isn’t on the map, without fetching it', async () => {
    const { calls } = await boot({ type: 'panel', panel: 'minimap', slot: 'paper.aside' }, page('paper', 'arxiv:2'), {
      'signals.nearest': { set: SET.id, signal: 'embedding', paper: null, neighbours: [] },
    });
    await vi.waitFor(() => expect(app().textContent).toBe('This paper isn’t on the map.'));
    expect(calls.some((c) => c.method === 'signals.columns')).toBe(false);
  });
});
