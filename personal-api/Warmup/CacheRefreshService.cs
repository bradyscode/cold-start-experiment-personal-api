using Microsoft.Extensions.Options;
using personal_api.Caching;

namespace personal_api.Warmup;

// Eager caching: refreshes entries before they expire, and a moment after a write clears the cache, so readers rarely wait on a miss.
public sealed class CacheRefreshService(IReadCache cache, CacheWarmer warmer, IOptions<CacheOptions> cacheOptions, ILogger<CacheRefreshService> logger) : BackgroundService
{
    private static readonly TimeSpan Debounce = TimeSpan.FromSeconds(1);
    private readonly SemaphoreSlim _invalidated = new(0);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        cache.Invalidated += OnInvalidated;
        logger.LogInformation("Cache refresh service started");
        try
        {
            var refreshEvery = TimeSpan.FromSeconds(Math.Max(1, cacheOptions.Value.TtlSeconds * 0.75));
            while (!stoppingToken.IsCancellationRequested)
            {
                var afterWrite = await _invalidated.WaitAsync(refreshEvery, stoppingToken);
                if (afterWrite)
                {
                    // Wait for a burst of writes to settle, then drop the extra signals it produced.
                    do { await Task.Delay(Debounce, stoppingToken); } while (_invalidated.CurrentCount > 0 && DrainSignals());
                }
                logger.LogInformation("Refreshing the cache ({Reason})", afterWrite ? "after a write" : "before expiry");
                try
                {
                    using (cache.Refreshing())
                        await warmer.WarmAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception e)
                {
                    logger.LogWarning(e, "Cache refresh failed; will retry");
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        finally
        {
            cache.Invalidated -= OnInvalidated;
        }
    }

    private void OnInvalidated() => _invalidated.Release();

    private bool DrainSignals()
    {
        while (_invalidated.Wait(0)) { }
        return true;
    }
}
