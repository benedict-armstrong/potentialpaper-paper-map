/**
 * Fetching a map from the signal set: the set's description first (small), whose live generation and last change
 * stamp the copy kept in IndexedDB (`cache.ts`), then its columns only when that copy is stale.
 */
import { cached, type Store } from './cache';
import { CLUSTER, REGION, XY } from './data';
import { signals as sig } from './signals';

export const MAP_SIGNALS = [XY, REGION, CLUSTER];

export type ColumnsStore = Store<PP.SignalColumns>;

/** The set's version, for caches: its generation and when it last changed. */
export function stampOf(set: Pick<PP.SignalSet, 'generation' | 'changedAt'>): string {
  return `${set.generation}|${set.changedAt}`;
}

/** The cache keys a request may be answered from: its own, and (without titles) the same map with titles. */
export function keysFor(set: string, scope: string | null, titles: boolean): string[] {
  const key = (t: boolean) => `${set}\n${scope ?? ''}\n${t ? 'titles' : ''}`;
  return titles ? [key(true)] : [key(false), key(true)];
}

export async function loadColumns(
  store: ColumnsStore,
  set: string,
  options: { scope?: string | null; titles: boolean },
): Promise<{ set: PP.SignalSet; columns: PP.SignalColumns }> {
  const info = await sig.set(set);
  const missing = MAP_SIGNALS.filter((s) => !info.signals.some((g) => g.name === s));
  if (missing.includes(XY)) throw new NoMap(`The signal set ${set} has no "${XY}" signal, so it can't be drawn.`);
  const signals = MAP_SIGNALS.filter((s) => !missing.includes(s));
  const columns = await cached(store, keysFor(set, options.scope ?? null, options.titles), stampOf(info), () =>
    sig.columns(set, { signals, titles: options.titles, ...(options.scope ? { scope: options.scope } : {}) }),
  );
  return { set: info, columns };
}

/** A map that can't be drawn, said plainly to the reader. */
export class NoMap extends Error {}

/** What to tell the reader when a load fails. */
export function failureText(error: unknown, set: string): string {
  if (error instanceof NoMap) return error.message;
  const code = (error as { code?: string } | null)?.code;
  if (code === 'Unavailable' || code === 'InvalidParams' || /not.?found|404/i.test(String((error as Error)?.message)))
    return `The signal set ${set} isn't on this site.`;
  return 'The map could not be loaded.';
}
