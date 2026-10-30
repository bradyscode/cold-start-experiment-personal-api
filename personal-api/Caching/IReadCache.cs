namespace personal_api.Caching;

public sealed record CacheStats(long Hits, long Misses, long Invalidations, int Entries, int TtlSeconds)
{
    public double HitRate => Hits + Misses == 0 ? 0 : (double)Hits / (Hits + Misses);
}

public interface IReadCache
{
    // Concurrent callers with the same key share one computation; failures are never cached.
    Task<T> GetOrCreateAsync<T>(string key, Func<Task<T>> compute, CancellationToken ct);

    // Drops every entry; results computed before the call are never served afterwards.
    void Invalidate();

    // Raised after every Invalidate().
    event Action? Invalidated;

    // While the returned scope is open on this async flow, reads recompute and replace their entries instead of reusing them; callers keep getting the old value until the new one is ready.
    IDisposable Refreshing();

    CacheStats GetStats();
}
