using System.Collections.Concurrent;
using Microsoft.Extensions.Options;

namespace personal_api.Caching;

public sealed class ReadCache(IOptions<CacheOptions> options, TimeProvider time) : IReadCache
{
    private readonly ConcurrentDictionary<string, Entry> _entries = new();
    private long _generation;
    private long _hits;
    private long _misses;
    private long _invalidations;
    private readonly AsyncLocal<bool> _refreshing = new();

    public event Action? Invalidated;

    private sealed record Entry(Task Result, long Generation, DateTimeOffset ExpiresAt);

    public async Task<T> GetOrCreateAsync<T>(string key, Func<Task<T>> compute, CancellationToken ct)
    {
        if (_refreshing.Value)
        {
            _refreshing.Value = false;
            return await RefreshAsync(key, compute);
        }

        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var generation = Volatile.Read(ref _generation);
            var now = time.GetUtcNow();
            var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            var fresh = new Entry(completion.Task, generation, now.AddSeconds(options.Value.TtlSeconds));

            if (_entries.TryGetValue(key, out var current))
            {
                if (current.Generation == generation && current.ExpiresAt > now)
                {
                    Interlocked.Increment(ref _hits);
                    return await ((Task<T>)current.Result).WaitAsync(ct);
                }
                if (!_entries.TryUpdate(key, fresh, current))
                    continue;
            }
            else if (!_entries.TryAdd(key, fresh))
            {
                continue;
            }

            Interlocked.Increment(ref _misses);
            Trim(generation, now);
            _ = RunAsync(key, fresh, completion, compute);
            return await completion.Task.WaitAsync(ct);
        }
    }

    private async Task<T> RefreshAsync<T>(string key, Func<Task<T>> compute)
    {
        var generation = Volatile.Read(ref _generation);
        Interlocked.Increment(ref _misses);
        var value = await compute().ConfigureAwait(false);
        if (generation == Volatile.Read(ref _generation))
            _entries[key] = new Entry(Task.FromResult(value), generation, time.GetUtcNow().AddSeconds(options.Value.TtlSeconds));
        return value;
    }

    public IDisposable Refreshing()
    {
        _refreshing.Value = true;
        return new RefreshScope(_refreshing);
    }

    private sealed class RefreshScope(AsyncLocal<bool> flag) : IDisposable
    {
        public void Dispose() => flag.Value = false;
    }

    // The computation is not tied to the first caller's cancellation, so one aborted request cannot fail the callers sharing it.
    private async Task RunAsync<T>(string key, Entry entry, TaskCompletionSource<T> completion, Func<Task<T>> compute)
    {
        try
        {
            completion.SetResult(await compute().ConfigureAwait(false));
        }
        catch (Exception e)
        {
            _entries.TryRemove(new KeyValuePair<string, Entry>(key, entry));
            completion.SetException(e);
        }
    }

    private void Trim(long generation, DateTimeOffset now)
    {
        if (_entries.Count <= options.Value.MaxEntries)
            return;
        foreach (var (key, entry) in _entries)
            if (entry.Generation != generation || entry.ExpiresAt <= now)
                _entries.TryRemove(new KeyValuePair<string, Entry>(key, entry));
        if (_entries.Count > options.Value.MaxEntries)
            _entries.Clear();
    }

    public void Invalidate()
    {
        Interlocked.Increment(ref _generation);
        Interlocked.Increment(ref _invalidations);
        _entries.Clear();
        Invalidated?.Invoke();
    }

    public CacheStats GetStats() => new(Volatile.Read(ref _hits), Volatile.Read(ref _misses), Volatile.Read(ref _invalidations), _entries.Count, options.Value.TtlSeconds);
}
