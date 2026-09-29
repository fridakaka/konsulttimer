import { IDBFactory } from 'fake-indexeddb';
import { openStore } from '../../src/js/db.js';
import { localToMs } from '../../src/js/time.js';

export const ms = (date, time = '00:00') => localToMs(date, time);

/** Ny isolerad lagring med styrbar klocka. */
export async function makeStore(start = ms('2026-09-29', '09:00')) {
  const clock = { t: start };
  let n = 0;
  const idb = new IDBFactory();
  const store = await openStore({ indexedDB: idb, now: () => clock.t, uuid: () => `id-${++n}`, name: 'test' });
  return { store, clock, idb, reopen: () => openStore({ indexedDB: idb, now: () => clock.t, uuid: () => `id-r${++n}`, name: 'test' }) };
}
