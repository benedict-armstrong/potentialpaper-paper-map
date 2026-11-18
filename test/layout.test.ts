import { describe, expect, it } from 'vitest';
import { nearestNeighbours, settle } from '../src/layout';
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
