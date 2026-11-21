import { describe, expect, it } from 'vitest';
import { cosineDistance, embedAround, nearestNeighbours, settle } from '../src/layout';
import { MAP_SIZE } from '../src/map';

describe('nearestNeighbours', () => {
  it('finds each point’s nearest by distance', () => {
    const at = Float32Array.from([0, 0, 1, 0, 5, 0, 6, 0]);
    expect(nearestNeighbours(at, 1)).toEqual([[1], [0], [3], [2]]);
    expect(nearestNeighbours(at, 2)[0]).toEqual([1, 2]);
  });
});

describe('settle', () => {
  it('yields frames within the map, ending settled', () => {
    const n = 60;
    const start = Float32Array.from({ length: n * 2 }, (_, i) => (i * 37) % 101);
    const groups = Int32Array.from({ length: n }, (_, i) => i % 3);
    const frames = [...settle(start, groups)];
    expect(frames.length).toBeGreaterThan(1);
    const last = frames.at(-1)!;
    expect(last.length).toBe(n * 2);
    expect(Math.max(...last)).toBeLessThanOrEqual(MAP_SIZE + 1e-3);
    expect(Math.min(...last)).toBeGreaterThanOrEqual(-1e-3);
  });
  it('gives a tiny subset back at once', () => {
    expect([...settle(Float32Array.from([1, 1, 2, 2]), Int32Array.from([0, 0]))]).toHaveLength(1);
  });
});

describe('embedAround (the minimap’s redraw)', () => {
  // Two groups by content, mixed up on the map: the redraw should part them, the paper's own group round it.
  const n = 24;
  const vectors = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? [1, 0.05 * i, 0] : [0, 0.05 * i, 1]));
  const start = Float32Array.from({ length: n * 2 }, (_, i) => (i * 37) % 101);
  const frames = [...embedAround(start, vectors, 0, [2, 4])];
  const last = frames.at(-1)!;
  const at = (i: number) => [last[2 * i], last[2 * i + 1]];
  const d = (a: number, b: number) => Math.hypot(at(a)[0] - at(b)[0], at(a)[1] - at(b)[1]);

  it('animates from the map and keeps the paper at the centre', () => {
    expect(frames.length).toBeGreaterThan(1);
    expect(at(0)).toEqual([MAP_SIZE / 2, MAP_SIZE / 2]);
  });
  it('puts papers alike in content closer than papers unlike', () => {
    const same = [2, 4, 6, 8].map((i) => d(0, i));
    const other = [1, 3, 5, 7].map((i) => d(0, i));
    expect(Math.max(...same)).toBeLessThan(Math.min(...other));
  });
  it('is the same every time', () => {
    expect([...embedAround(start, vectors, 0, [2, 4])].at(-1)).toEqual(last);
  });
  it('gives a tiny piece back at once', () => {
    expect([...embedAround(Float32Array.from([0, 0, 1, 1, 2, 2]), [[1], [1], [1]], 0, [])]).toHaveLength(1);
  });
});

describe('cosineDistance', () => {
  it('is 0 alike, 1 apart, 1 from nothing', () => {
    expect(cosineDistance([1, 0], [2, 0])).toBeCloseTo(0);
    expect(cosineDistance([1, 0], [0, 3])).toBeCloseTo(1);
    expect(cosineDistance([0, 0], [1, 0])).toBe(1);
  });
});
