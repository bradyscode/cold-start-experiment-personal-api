using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using personal_api.Caching;

namespace personal_api.Tests;

public class ReadCacheTests
{
    private static (ReadCache Cache, FakeTimeProvider Time) Create(int ttlSeconds = 30, int maxEntries = 512)
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
        return (new ReadCache(Options.Create(new CacheOptions { TtlSeconds = ttlSeconds, MaxEntries = maxEntries }), time), time);
    }

    [Fact]
    public async Task Second_call_is_served_from_the_cache()
    {
        var (cache, _) = Create();
        var calls = 0;
        Task<int> Compute() => Task.FromResult(++calls);

        var first = await cache.GetOrCreateAsync("k", Compute, CancellationToken.None);
        var second = await cache.GetOrCreateAsync("k", Compute, CancellationToken.None);

        Assert.Equal(1, first);
        Assert.Equal(1, second);
        Assert.Equal(1, calls);
        var stats = cache.GetStats();
        Assert.Equal((1, 1), (stats.Hits, stats.Misses));
    }

    [Fact]
    public async Task Entries_expire_after_the_ttl()
    {
        var (cache, time) = Create(ttlSeconds: 30);
        var calls = 0;
        Task<int> Compute() => Task.FromResult(++calls);

        await cache.GetOrCreateAsync("k", Compute, CancellationToken.None);
        time.Advance(TimeSpan.FromSeconds(29));
        await cache.GetOrCreateAsync("k", Compute, CancellationToken.None);
        Assert.Equal(1, calls);

        time.Advance(TimeSpan.FromSeconds(2));
        var third = await cache.GetOrCreateAsync("k", Compute, CancellationToken.None);
        Assert.Equal(2, third);
    }

    [Fact]
    public async Task Invalidate_forces_a_recompute()
    {
        var (cache, _) = Create();
        var calls = 0;
        Task<int> Compute() => Task.FromResult(++calls);

        await cache.GetOrCreateAsync("k", Compute, CancellationToken.None);
        cache.Invalidate();
        var after = await cache.GetOrCreateAsync("k", Compute, CancellationToken.None);

        Assert.Equal(2, after);
        Assert.Equal(1, cache.GetStats().Invalidations);
    }

    [Fact]
    public async Task Concurrent_callers_share_one_computation()
    {
        var (cache, _) = Create();
        var calls = 0;
        var gate = new TaskCompletionSource();
        async Task<int> Compute()
        {
            Interlocked.Increment(ref calls);
            await gate.Task;
            return 7;
        }

        var tasks = Enumerable.Range(0, 20).Select(_ => cache.GetOrCreateAsync("k", Compute, CancellationToken.None)).ToArray();
        gate.SetResult();
        var results = await Task.WhenAll(tasks);

        Assert.All(results, r => Assert.Equal(7, r));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Failures_are_not_cached()
    {
        var (cache, _) = Create();
        var calls = 0;
        Task<int> Compute() => ++calls == 1 ? throw new InvalidOperationException("boom") : Task.FromResult(5);

        await Assert.ThrowsAsync<InvalidOperationException>(() => cache.GetOrCreateAsync("k", Compute, CancellationToken.None));
        var retry = await cache.GetOrCreateAsync("k", Compute, CancellationToken.None);

        Assert.Equal(5, retry);
    }

    [Fact]
    public async Task A_cancelled_caller_does_not_fail_the_shared_computation()
    {
        var (cache, _) = Create();
        var gate = new TaskCompletionSource();
        async Task<int> Compute()
        {
            await gate.Task;
            return 9;
        }
        using var cts = new CancellationTokenSource();

        var first = cache.GetOrCreateAsync("k", Compute, cts.Token);
        var second = cache.GetOrCreateAsync("k", Compute, CancellationToken.None);
        await cts.CancelAsync();
        gate.SetResult();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        Assert.Equal(9, await second);
    }

    [Fact]
    public async Task A_computation_started_before_an_invalidation_is_not_served_afterwards()
    {
        var (cache, _) = Create();
        var gate = new TaskCompletionSource();
        var calls = 0;
        async Task<int> Compute()
        {
            var n = Interlocked.Increment(ref calls);
            if (n == 1) await gate.Task;
            return n;
        }

        var stale = cache.GetOrCreateAsync("k", Compute, CancellationToken.None);
        cache.Invalidate();
        var fresh = await cache.GetOrCreateAsync("k", Compute, CancellationToken.None);
        gate.SetResult();
        await stale;

        Assert.Equal(2, fresh);
        Assert.Equal(2, await cache.GetOrCreateAsync("k", Compute, CancellationToken.None));
    }

    [Fact]
    public async Task The_cache_never_holds_more_than_the_maximum_entries()
    {
        var (cache, _) = Create(maxEntries: 5);
        for (var i = 0; i < 40; i++)
            await cache.GetOrCreateAsync($"k{i}", () => Task.FromResult(i), CancellationToken.None);

        Assert.True(cache.GetStats().Entries <= 5);
    }
}
