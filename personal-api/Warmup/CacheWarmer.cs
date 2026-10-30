using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using personal_api.Domain;
using personal_api.Domain.Analytics;
using personal_api.Domain.Feed;
using personal_api.Storage;

namespace personal_api.Warmup;

// Runs the common read paths once: JIT-compiles them, builds the EF model, opens pooled connections and, when the cache is on, fills it.
public sealed class CacheWarmer(IServiceScopeFactory scopes, IOptions<WarmupOptions> options, ILogger<CacheWarmer> logger)
{
    private const int DefaultFeedLimit = 20;

    public async Task WarmAsync(CancellationToken ct)
    {
        var started = Stopwatch.GetTimestamp();
        await using var scope = scopes.CreateAsyncScope();
        var services = scope.ServiceProvider;

        await Step("connections", () => OpenConnectionsAsync(services, ct));
        IReadOnlyList<KindDefinition> kinds = [];
        await Step("kinds", async () => kinds = await services.GetRequiredService<IKindStore>().ListAsync(ct));
        await Step("records", () => services.GetRequiredService<IRecordStore>().QueryAsync(new RecordQuery(null, null, null, 0), ct));
        await Step("feed", () => services.GetRequiredService<IFeedService>().GetAsync(DefaultFeedLimit, ct));
        foreach (var days in options.Value.ParseOverviewDays())
            await Step($"overview {days}d", () => services.GetRequiredService<IAnalyticsService>().OverviewAsync(kinds, days, ct));

        logger.LogInformation("Warm-up finished in {Elapsed:0} ms", Stopwatch.GetElapsedTime(started).TotalMilliseconds);

        async Task Step(string name, Func<Task> run)
        {
            try
            {
                await run();
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception e)
            {
                logger.LogWarning(e, "Warm-up step {Step} failed; continuing", name);
            }
        }
    }

    // Several scopes at once, so the SQLite pool already holds that many open connections when the first burst of requests arrives.
    private async Task OpenConnectionsAsync(IServiceProvider services, CancellationToken ct)
    {
        var count = options.Value.Connections;
        if (count <= 0)
            return;
        var tasks = Enumerable.Range(0, count).Select(async _ =>
        {
            await using var scope = services.GetRequiredService<IServiceScopeFactory>().CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.ExecuteSqlRawAsync("SELECT 1", ct);
        });
        await Task.WhenAll(tasks);
    }
}
