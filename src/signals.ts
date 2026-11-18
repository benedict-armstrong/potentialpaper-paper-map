/**
 * `pp.signals`, called by method name through `pp.call`. The SDK file is cached by browsers for a day, so a reader can
 * still have a copy from before `pp.signals` existed; the host answers these methods either way.
 */

type Nearest = Awaited<ReturnType<PP.SDK['signals']['nearest']>>;

export const signals = {
  set: (set: string) => pp.call<PP.SignalSet>('signals.set', { set }),
  columns: (set: string, options: { signals?: string[]; scope?: string; titles?: boolean }) =>
    pp.call<PP.SignalColumns>('signals.columns', { set, ...options }),
  /** The current page's paper when `paper` is left out. */
  nearest: (set: string, signal: string, paper: string | undefined, options: { k?: number } = {}) =>
    pp.call<Nearest>('signals.nearest', {
      set,
      signal,
      paper: paper ?? pp.context?.page?.identifier,
      ...options,
    }),
};
