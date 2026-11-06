import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestState {
  sqlClient?: { query: (sql: string, values?: any[]) => Promise<any> };
  database: any;
  walletChallenges?: Map<string, any>;
  sessions: Map<string, any>;
  loginRateLimits: Map<string, any>;
  publicEndpointRateLimits: Map<string, any>;
}
export const requestState = new AsyncLocalStorage<RequestState>();
export function scopedDatabase<T extends object>(fallback: T): T {
  return new Proxy(fallback, {
    get: (_target, key) => Reflect.get(requestState.getStore()?.database ?? fallback, key),
    set: (_target, key, value) => Reflect.set(requestState.getStore()?.database ?? fallback, key, value),
    ownKeys: () => Reflect.ownKeys(requestState.getStore()?.database ?? fallback),
    getOwnPropertyDescriptor: (_target, key) => ({ configurable: true, enumerable: true, writable: true, value: Reflect.get(requestState.getStore()?.database ?? fallback, key) }),
  });
}
export function scopedMap<K, V>(name: 'walletChallenges' | 'sessions' | 'loginRateLimits' | 'publicEndpointRateLimits'): Map<K, V> {
  const fallback = new Map<K, V>();
  return new Proxy(fallback, {
    get: (_target, key) => {
      const current = requestState.getStore()?.[name] ?? fallback;
      if (name === 'loginRateLimits' && key === 'set') return (k: K, v: any) => current.set(k as any, { ...v, updatedAtMs: Date.now() });
      const value = Reflect.get(current, key, current);
      return typeof value === 'function' ? value.bind(current) : value;
    },
  });
}
