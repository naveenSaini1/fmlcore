// Memory only: never persist account data or credentials in browser storage.
export const INITIAL_SESSION = { user: null, ready: false, error: null };

export function createSessionStore() {
  let snapshot = INITIAL_SESSION;
  let generation = 0;
  let identityVersion = 0;
  let pending = null;
  const listeners = new Set();
  const publish = (value) => {
    if (snapshot.user?.id !== value.user?.id) identityVersion += 1;
    snapshot = value;
    listeners.forEach((listener) => listener());
  };
  const store = {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL_SESSION,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getGeneration: () => generation,
    getIdentityVersion: () => identityVersion,
    setUser(user) {
      generation += 1;
      pending = null;
      publish({ user, ready: true, error: null });
    },
    invalidate() {
      identityVersion += 1;
      generation += 1;
      pending = null;
      publish({ ...snapshot, ready: false, error: null });
    },
    load(fetchUser) {
      if (snapshot.ready) return snapshot.error ? Promise.reject(snapshot.error) : Promise.resolve(snapshot.user);
      if (pending) return pending;
      const requestGeneration = generation;
      pending = Promise.resolve().then(fetchUser).then((user) => {
        if (requestGeneration !== generation) return store.load(fetchUser);
        pending = null;
        publish({ user, ready: true, error: null });
        return user;
      }, (error) => {
        if (requestGeneration !== generation) return store.load(fetchUser);
        pending = null;
        if (error.status === 401) {
          publish({ user: null, ready: true, error: null });
          return null;
        }
        publish({ ...snapshot, ready: true, error });
        throw error;
      });
      return pending;
    },
  };
  return store;
}

export const sessionStore = createSessionStore();
