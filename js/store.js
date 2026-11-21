// Keeps the data in browser storage and runs every change as a transaction.
import { buildSeed } from './seed.js';

const KEY = 'northfield-erp-v1';

export function createStore(storage, today) {
  let state;
  try { state = JSON.parse(storage?.getItem(KEY)); } catch { state = null; }
  if (!state) state = buildSeed(today);

  const save = () => { try { storage?.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked */ } };
  save();

  return {
    get: () => state,
    // Runs an engine function. If it throws, the stored data is untouched.
    run(fn, ...args) {
      const { state: next, result } = fn(state, ...args);
      state = next;
      save();
      return result;
    },
    // Direct edits to master data (already validated by the caller)
    update(mutator) {
      const next = structuredClone(state);
      mutator(next);
      state = next;
      save();
    },
    reset() { state = buildSeed(today); save(); },
  };
}
