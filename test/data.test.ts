import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SET,
  fromColumns,
  groupName,
  mapPageUrl,
  members,
  minLabelled,
  paint,
  paperFromPath,
  paperUrl,
  setOf,
  spotlight,
  UNMATCHED_ALPHA,
} from '../src/data';
import { MAP_PALETTE } from '../src/map';
import { nearestOnMap, pieceOf, MINIMAP_LINES } from '../src/minimap';
import { keysFor, stampOf } from '../src/load';
import { columns } from './fixtures';

describe('fromColumns', () => {
  const data = fromColumns(columns(), { region: 1, cluster: 1 });
  it('keeps the papers with a place, normalised', () => {
    expect(data.papers).toEqual(['openreview:a', 'openreview:b', 'openreview:c']);
    expect(data.titles).toEqual(['Agents that plan', 'Agents that remember', 'Kv cache compression']);
    expect([...data.positions]).toEqual([0, 250, 100, 250, 1000, 750]);
    expect(data.byPaper.get('openreview:c')).toBe(2);
  });
  it('reads the groupings, with sizes and colour numbers', () => {
    expect([...data.group.region]).toEqual([0, 0, 1]);
    expect([...data.group.cluster]).toEqual([0, 1, -1]);
    expect(data.groups.region.map((g) => [g.key, g.title, g.number, g.size])).toEqual([
      ['7', 'llm agents · skills', 7, 2],
      ['3', null, 3, 1],
    ]);
    // A region without a title gets no label on the map, and is named by its key.
    expect(data.labels.region.map((l) => l.text)).toEqual(['llm agents · skills']);
    expect(groupName(data, 'region', 2)).toBe('3');
    expect(groupName(data, 'cluster', 1)).toBe('memory');
    expect(groupName(data, 'cluster', 2)).toBeNull();
    expect(members(data, 'region', 0)).toEqual([0, 1]);
  });
  it('paints by grouping and spotlights some', () => {
    const colours = paint(data, 'region');
    expect([...colours.slice(0, 3)]).toEqual(MAP_PALETTE[7]);
    const lit = spotlight(colours, [2]);
    expect(lit[3]).toBe(UNMATCHED_ALPHA);
    expect(lit[11]).toBe(colours[11]);
  });
  it('reads a set without groupings, and refuses one without places', () => {
    const c = columns();
    delete c.signals['map.region'];
    expect([...fromColumns(c).group.region]).toEqual([-1, -1, -1]);
    delete c.signals['map.xy'];
    expect(() => fromColumns(c)).toThrow(/map\.xy/);
  });
});

describe('minLabelled', () => {
  it('names groupings as acceptodds does at 40k papers, in proportion below', () => {
    expect(minLabelled(42_000)).toEqual({ region: 40, cluster: 15 });
    expect(minLabelled(4_000)).toEqual({ region: 4, cluster: 2 });
    expect(minLabelled(10)).toEqual({ region: 2, cluster: 2 });
  });
});

describe('addresses', () => {
  it('links a paper by its scheme', () => {
    expect(paperUrl('https://site.org/', 'openreview:abc')).toBe('https://site.org/openreview/abc');
    expect(paperUrl('https://site.org', 'arxiv:1706.03762')).toBe('https://site.org/abs/1706.03762');
    expect(paperUrl('https://site.org', 'doi:10.1/x y')).toBe('https://site.org/doi/10.1/x%20y');
    expect(paperUrl('https://site.org', 'isbn:123')).toBeNull();
  });
  it('opens the map page on a paper and reads it back', () => {
    const url = mapPageUrl('https://site.org', 'benedict-armstrong/paper-map', 'openreview:abc');
    expect(url).toBe('https://site.org/x/benedict-armstrong/paper-map/map/openreview%3Aabc');
    expect(paperFromPath(['openreview%3Aabc'])).toBe('openreview:abc');
    expect(paperFromPath(['openreview:abc'])).toBe('openreview:abc');
    expect(paperFromPath(['arxiv:hep-th', '9901001'])).toBe('arxiv:hep-th/9901001');
    expect(paperFromPath([])).toBeNull();
  });
  it('takes the set from the settings, or the default', () => {
    expect(setOf({ set: ' someone/their-map ' })).toBe('someone/their-map');
    expect(setOf({ set: 'not a set' })).toBe(DEFAULT_SET);
    expect(setOf(null)).toBe(DEFAULT_SET);
  });
});

describe('the cache', () => {
  it('stamps by generation and change, and lets a map with titles answer one without', () => {
    expect(stampOf({ generation: 2, changedAt: 'x' })).toBe('2|x');
    expect(keysFor('s', null, false)).toEqual(['s\n\n', 's\n\ntitles']);
    expect(keysFor('s', 'venue:iclr/2027', true)).toEqual(['s\nvenue:iclr/2027\ntitles']);
  });
});

describe('pieceOf (the minimap)', () => {
  const data = fromColumns(columns());
  it('puts the paper first and centred, then the papers round it on the map, and links its nearest by content', () => {
    const piece = pieceOf(data, 'openreview:a', [
      { paper: 'openreview:c', title: 'C' },
      { paper: 'openreview:zzz', title: 'not on the map' },
      { paper: 'openreview:a', title: 'itself' },
    ])!;
    // a, then b (nearest on the map), then c.
    expect(piece.points).toEqual([0, 1, 2]);
    expect([piece.positions[0], piece.positions[1]]).toEqual([500, 500]);
    expect(piece.linked).toEqual([2]);
    expect(piece.titles.get(2)).toBe('C');
  });
  it('links only the closest few by content', () => {
    const many = Array.from({ length: 30 }, () => ({ paper: 'openreview:b', title: 'B' }));
    expect(pieceOf(data, 'openreview:a', many)!.linked.length).toBeLessThanOrEqual(MINIMAP_LINES);
  });
  it('is nothing for a paper not on the map', () => {
    expect(pieceOf(data, 'openreview:d', [])).toBeNull();
  });
  it('carries every point’s vector for the redraw, or none when one is missing', () => {
    const v = new Map(data.papers.map((p, i) => [p, [i, 1]]));
    const piece = pieceOf(data, 'openreview:a', [], v)!;
    expect(piece.points.length).toBeGreaterThanOrEqual(3);
    // Too few papers to lay out again.
    if (piece.points.length < 4) expect(piece.vectors).toBeNull();
    else expect(piece.vectors).toEqual(piece.points.map((i) => [i, 1]));
    v.delete(data.papers[piece.points[1]]);
    expect(pieceOf(data, 'openreview:a', [], v)!.vectors).toBeNull();
  });
});

describe('nearestOnMap', () => {
  it('orders the others by distance', () => {
    expect(nearestOnMap(Float32Array.from([0, 0, 5, 0, 1, 0, 2, 0]), 0, 2)).toEqual([2, 3]);
  });
});
