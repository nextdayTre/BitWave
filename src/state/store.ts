/**
 * Store and transaction boundary.
 *
 * The state tree is mutable (the renderers read it directly); what the store
 * adds is the boundary every write goes through: a transaction runs, then one
 * revision bump and one notification pass. Nested transactions collapse to the
 * outermost one, so a command may call another command without doubling work.
 *
 * DOM-free; tested in `tests/state.test.ts`.
 */

export type Listener<T> = (state: T) => void;
export type Mutator<T, R> = (state: T) => R;

export interface Store<T> {
  /** The live tree. Read-only by convention; writes go through `patch`. */
  get(): T;
  /** Runs a transaction and notifies subscribers once at the outermost exit. */
  patch<R = void>(mutate: Mutator<T, R>): R;
  /** Observes each completed transaction. Returns an unsubscribe function. */
  subscribe(listener: Listener<T>): () => void;
  /** Counts completed transactions (useful for tests and change detection). */
  revision(): number;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  let revision = 0;
  let depth = 0;
  const listeners = new Set<Listener<T>>();

  const notify = (): void => {
    revision += 1;
    for (const listener of listeners) listener(state);
  };

  return {
    get: () => state,

    patch<R = void>(mutate: Mutator<T, R>): R {
      depth += 1;
      try {
        return mutate(state);
      } finally {
        depth -= 1;
        if (depth === 0) notify();
      }
    },

    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    revision: () => revision,
  };
}
