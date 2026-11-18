/**
 * A copy of each map the plugin has fetched (`pp.signals.columns`, up to a few MB at an ICLR-sized set), in its own
 * origin's IndexedDB, keyed by set, scope and whether it has titles, and stamped with the set's live generation and
 * when it last changed (`pp.signals.set`, small). Opening the map again, or moving between papers' minimaps, costs one
 * small call while the set is unchanged. Where IndexedDB is unavailable, a copy lives in memory for the frame's life.
 */

const DB = 'paper-map';
const STORE = 'columns';
const VERSION = 1;
/** Maps kept; the oldest written go first. Few: each can be a few MB. */
const MAX_ENTRIES = 8;

export interface Entry<T> {
  key: string;
  stamp: string;
  value: T;
  savedAt: number;
}

export interface Store<T> {
  get(key: string): Promise<Entry<T> | undefined>;
  put(entry: Entry<T>): Promise<void>;
}

export function memoryStore<T>(): Store<T> & { entries: Map<string, Entry<T>> } {
  const entries = new Map<string, Entry<T>>();
  return {
    entries,
    async get(key) {
      return entries.get(key);
    },
    async put(entry) {
      entries.set(entry.key, entry);
      if (entries.size > MAX_ENTRIES) {
        const oldest = [...entries.values()].sort((a, b) => a.savedAt - b.savedAt)[0];
        entries.delete(oldest.key);
      }
    },
  };
}

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function indexedDbStore<T>(): Store<T> | null {
  if (typeof indexedDB === 'undefined') return null;
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        const store = r.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('savedAt', 'savedAt');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return opened;
  };
  return {
    async get(key) {
      const db = await open();
      return request<Entry<T> | undefined>(db.transaction(STORE).objectStore(STORE).get(key));
    },
    async put(entry) {
      const db = await open();
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      await request(store.put(entry));
      const total = await request(store.count());
      if (total > MAX_ENTRIES) {
        const cursor = await request(store.index('savedAt').openCursor());
        if (cursor) await request(cursor.delete());
      }
    },
  };
}

/** The store to use: IndexedDB when the frame may, memory otherwise. */
export function defaultStore<T>(): Store<T> {
  const memory = memoryStore<T>();
  const idb = indexedDbStore<T>();
  if (!idb) return memory;
  return {
    async get(key) {
      try {
        return (await memory.get(key)) ?? (await idb.get(key));
      } catch {
        return memory.get(key);
      }
    },
    async put(entry) {
      await memory.put(entry);
      try {
        await idb.put(entry);
      } catch {
        // Private browsing or storage full: memory will do.
      }
    },
  };
}

/**
 * The value for the first of `keys` whose copy has `stamp`; else fetched and stored under the first key. Later keys
 * are copies that would also do (a map with titles does for one asked without).
 */
export async function cached<T>(
  store: Store<T>,
  keys: string[],
  stamp: string,
  fetch: () => Promise<T>,
  now = Date.now(),
): Promise<T> {
  for (const key of keys) {
    const hit = await store.get(key);
    if (hit && hit.stamp === stamp) return hit.value;
  }
  const value = await fetch();
  await store.put({ key: keys[0], stamp, value, savedAt: now });
  return value;
}
