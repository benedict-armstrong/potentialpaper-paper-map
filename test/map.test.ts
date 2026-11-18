import { describe, expect, it } from 'vitest';
import {
  categoryRgb,
  dotScale,
  frameAround,
  labelMatches,
  labelNumber,
  labelTerms,
  MAP_NONE,
  MAP_PALETTE,
  MAP_SIZE,
  normalise,
  parseQuery,
  searchTitles,
  sparseScale,
  topicLabels,
} from '../src/map';

describe('normalise', () => {
  it('fits the longer axis to the map and centres the shorter', () => {
    const out = normalise([0, 0, 10, 5, 5, 2.5]);
    expect([...out]).toEqual([0, 250, MAP_SIZE, 750, 500, 500]);
  });
  it('copes with no points and one', () => {
    expect(normalise([]).length).toBe(0);
    expect([...normalise([3, 4])]).toEqual([500, 500]);
  });
  it('does not overflow the stack on a big map', () => {
    const xy = Float32Array.from({ length: 400_000 }, (_, i) => i % 997);
    expect(normalise(xy).length).toBe(400_000);
  });
});

describe('search', () => {
  it('reads words, phrases and exclusions', () => {
    expect(parseQuery('Diffusion "language model" -video')).toEqual({
      include: ['diffusion', 'language model'],
      exclude: ['video'],
    });
  });
  it('lights labels only for words of three letters or more', () => {
    expect(labelTerms('a of rl agents agents')).toEqual(['agents']);
  });
  it('matches at the start of a word', () => {
    expect(labelMatches('llm agents · skills', ['agent'])).toBe(true);
    expect(labelMatches('reagents', ['agent'])).toBe(false);
    expect(labelMatches('Kv cache', ['cache'])).toBe(true);
  });
  it('finds titles with every word and none excluded', () => {
    const titles = ['Diffusion for video', 'Diffusion language models', 'Language models are few-shot'];
    expect(searchTitles(titles, 'diffusion')).toEqual([0, 1]);
    expect(searchTitles(titles, 'diffusion -video')).toEqual([1]);
    expect(searchTitles(titles, '"language models"')).toEqual([1, 2]);
    expect(searchTitles(titles, '  ')).toBeNull();
  });
});

describe('topicLabels', () => {
  it('names each big enough grouping at its median', () => {
    const positions = Float32Array.from([0, 0, 10, 10, 20, 20, 500, 500, 900, 900]);
    const groups = Int32Array.from([0, 0, 0, 1, -1]);
    const names = new Map([
      [0, 'zero'],
      [1, 'one'],
    ]);
    expect(topicLabels(positions, groups, names, 2)).toEqual([{ number: 0, text: 'zero', x: 10, y: 10, size: 3 }]);
    expect(topicLabels(positions, groups, names, 1)).toHaveLength(2);
  });
  it('skips groupings with no name', () => {
    expect(topicLabels(Float32Array.from([1, 1]), Int32Array.from([3]), new Map(), 1)).toEqual([]);
  });
});

describe('colours and sizes', () => {
  it('cycles the palette and greys out none', () => {
    expect(categoryRgb(0)).toEqual(MAP_PALETTE[0]);
    expect(categoryRgb(MAP_PALETTE.length + 1)).toEqual(MAP_PALETTE[1]);
    expect(categoryRgb(null)).toEqual(MAP_NONE);
    expect(categoryRgb(-1)).toEqual(MAP_NONE);
  });
  it('colours a numeric key by its number, others by their index', () => {
    expect(labelNumber('39', 0)).toBe(39);
    expect(labelNumber('agents', 4)).toBe(4);
  });
  it('grows dots with zoom and sparseness, within limits', () => {
    expect(dotScale(0, 0)).toBe(1);
    expect(dotScale(-2, 0)).toBe(1);
    expect(dotScale(20, 0)).toBe(6);
    expect(sparseScale(30_000, 30_000)).toBe(1);
    expect(sparseScale(179, 30_000)).toBeCloseTo(3.6, 1);
    expect(sparseScale(1, 1e9)).toBe(4);
  });
});

describe('frameAround', () => {
  it('centres the paper and fits its nearest to half the map', () => {
    // The paper at (10, 10), neighbours 1 and 2 units away, and a stray far off.
    const at = Float32Array.from([10, 10, 11, 10, 10, 12, 100, 100]);
    const out = frameAround(at, 0, [], 2);
    expect([out[0], out[1]]).toEqual([MAP_SIZE / 2, MAP_SIZE / 2]);
    // The second nearest (2 away) sits at the edge of the half span.
    expect(out[5]).toBeCloseTo(MAP_SIZE);
    // The stray stays, past the edge.
    expect(out[6]).toBeGreaterThan(MAP_SIZE);
  });
  it('widens for a linked paper not too far out', () => {
    const at = Float32Array.from([0, 0, 1, 0, 2, 0]);
    const out = frameAround(at, 0, [2], 1);
    // Radius 2 · 1.1 fills half the map.
    expect(out[4]).toBeCloseTo(MAP_SIZE / 2 + (2 * (MAP_SIZE / 2)) / 2.2);
  });
});
