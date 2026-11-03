import { describe, expect, it } from "bun:test";
import { TtlCache, cachedFetch } from "../src/utils/cache";

describe("TtlCache", () => {
  it("stores and retrieves values before TTL expiration", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("foo", "bar");
    expect(cache.get("foo")).toBe("bar");
    expect(cache.has("foo")).toBe(true);
  });

  it("expires entries after TTL", async () => {
    const cache = new TtlCache<string>(50);
    cache.set("short", "lived", 50);
    expect(cache.get("short")).toBe("lived");

    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(cache.get("short")).toBeUndefined();
    expect(cache.has("short")).toBe(false);
  });

  it("getOrFetch caches results and avoids duplicate calls", async () => {
    const cache = new TtlCache<number>(1000);
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return 42;
    };

    const val1 = await cache.getOrFetch("num", fetcher);
    const val2 = await cache.getOrFetch("num", fetcher);

    expect(val1).toBe(42);
    expect(val2).toBe(42);
    expect(callCount).toBe(1);
  });

  it("deduplicates concurrent in-flight requests for the same key", async () => {
    const cache = new TtlCache<string>(1000);
    let fetchCount = 0;

    const slowFetcher = async () => {
      fetchCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return `result-${fetchCount}`;
    };

    // 5 concurrent requests fired at once
    const results = await Promise.all([
      cache.getOrFetch("test-dedup", slowFetcher),
      cache.getOrFetch("test-dedup", slowFetcher),
      cache.getOrFetch("test-dedup", slowFetcher),
      cache.getOrFetch("test-dedup", slowFetcher),
      cache.getOrFetch("test-dedup", slowFetcher),
    ]);

    expect(fetchCount).toBe(1);
    expect(results).toEqual(["result-1", "result-1", "result-1", "result-1", "result-1"]);
  });

  it("removes in-flight promise if fetcher throws so subsequent calls can retry", async () => {
    const cache = new TtlCache<string>(1000);
    let shouldFail = true;

    const flakyFetcher = async () => {
      if (shouldFail) {
        throw new Error("Temporary network error");
      }
      return "recovered";
    };

    await expect(cache.getOrFetch("flaky", flakyFetcher)).rejects.toThrow("Temporary network error");

    shouldFail = false;
    const val = await cache.getOrFetch("flaky", flakyFetcher);
    expect(val).toBe("recovered");
  });

  it("cachedFetch helper uses the global singleton instance", async () => {
    let calls = 0;
    const getter = async () => {
      calls++;
      return "global-value";
    };

    const res1 = await cachedFetch("global-key", getter, 500);
    const res2 = await cachedFetch("global-key", getter, 500);

    expect(res1).toBe("global-value");
    expect(res2).toBe("global-value");
    expect(calls).toBe(1);
  });
});
