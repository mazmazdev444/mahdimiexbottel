/**
 * Lightweight, zero-dependency in-memory TTL cache with in-flight request deduplication.
 * Designed to prevent repetitive calls to external APIs (e.g., weather, currency, crypto)
 * from hammering endpoints or clogging the event loop.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private inFlight = new Map<string, Promise<T>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Retrieves a value if present and not expired.
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Stores a value with a specific or default TTL (in ms).
   */
  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Returns true if a non-expired entry exists.
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Removes an item from the cache.
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clears all cache entries and in-flight deduplication state.
   */
  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  /**
   * Number of items currently in cache (including unpruned expired ones).
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Returns a cached value if fresh. Otherwise invokes `fetcher`,
   * deduplicating concurrent in-flight requests for the same key.
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs = this.defaultTtlMs
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const existingPromise = this.inFlight.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      try {
        const result = await fetcher();
        this.set(key, result, ttlMs);
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}

export const globalCache = new TtlCache<any>(60_000);

export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 60_000
): Promise<T> {
  return globalCache.getOrFetch(key, fetcher, ttlMs);
}
