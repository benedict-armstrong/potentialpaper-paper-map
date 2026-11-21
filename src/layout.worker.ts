import { embedAround, settle } from './layout';

/**
 * Runs `settle` (a search's matches) or `embedAround` (the minimap's redraw) off the main thread, so the map stays
 * smooth while it is laid out again. One job at a time: a newer request (or `{ id, stop }`) ends the current one
 * between frames. Frames go back with their buffers transferred, not copied.
 */

export type LayoutRequest =
  | {
      id: number;
      start: Float32Array;
      /** The cluster per point, -1 for none. */
      groups: Int32Array;
    }
  /** Round one paper (`embedAround`, the minimap's redraw) rather than spread over the frame (`settle`). */
  | {
      id: number;
      start: Float32Array;
      around: { vectors: number[][]; self: number; linked: number[] };
    }
  | { id: number; stop: true };
export type LayoutFrame = { id: number; positions: Float32Array; settled: boolean };

let current = 0;

self.onmessage = async (e: MessageEvent<LayoutRequest>) => {
  const job = e.data;
  current = job.id;
  if ('stop' in job) return;
  const frames =
    'around' in job
      ? embedAround(job.start, job.around.vectors, job.around.self, job.around.linked)
      : settle(job.start, job.groups);
  let next = frames.next();
  while (!next.done) {
    const following = frames.next();
    const frame: LayoutFrame = { id: job.id, positions: next.value, settled: following.done === true };
    (self as unknown as Worker).postMessage(frame, { transfer: [frame.positions.buffer] });
    next = following;
    // Let a newer request in between frames.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (current !== job.id) return;
  }
};
