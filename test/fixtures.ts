import { DEFAULT_SET } from '../src/data';

/** Columns as `pp.signals.columns` gives them: four papers, one without a place on the map. */
export function columns(): PP.SignalColumns {
  return {
    set: { id: DEFAULT_SET, name: 'acceptodds map', generation: 2 },
    papers: ['openreview:a', 'openreview:b', 'openreview:c', 'openreview:d'],
    titles: ['Agents that plan', 'Agents that remember', 'Kv cache compression', 'Nowhere'],
    signals: {
      'map.xy': { kind: 'vector', dims: 2, values: [0, 0, 1, 0, 10, 5, null, null] },
      'map.region': { kind: 'label', keys: ['7', '3'], titles: ['llm agents · skills', null], values: [0, 0, 1, 1] },
      'map.cluster': { kind: 'label', keys: ['12', '40'], titles: ['planning', 'memory'], values: [0, 1, null, 0] },
    },
  };
}
