using personal_api.Domain;
using personal_api.Domain.Analytics;
using personal_api.Domain.Series;

namespace personal_api.Caching;

public sealed class CachedAnalyticsService(IReadCache cache, IServiceScopeFactory scopes) : IAnalyticsService
{
    private static string Keys(IEnumerable<KindDefinition> kinds) => string.Join(',', kinds.Select(k => k.Key));

    public Task<OverviewResult> OverviewAsync(IReadOnlyList<KindDefinition> kinds, int days, CancellationToken ct) =>
        cache.GetOrCreateAsync($"overview:{days}:{Keys(kinds)}", () => scopes.InFreshScopeAsync<IAnalyticsService, OverviewResult>(s => s.OverviewAsync(kinds, days, CancellationToken.None)), ct);

    public Task<CompareResult> CompareAsync(IReadOnlyList<KindDefinition> kinds, int days, SeriesBucket bucket, CancellationToken ct) =>
        cache.GetOrCreateAsync($"compare:{days}:{bucket}:{Keys(kinds)}", () => scopes.InFreshScopeAsync<IAnalyticsService, CompareResult>(s => s.CompareAsync(kinds, days, bucket, CancellationToken.None)), ct);

    public Task<PairDetail> PairAsync(KindDefinition a, KindDefinition b, int days, SeriesBucket bucket, int lagMin, int lagMax, CancellationToken ct) =>
        cache.GetOrCreateAsync($"pair:{a.Key}:{b.Key}:{days}:{bucket}:{lagMin}:{lagMax}", () => scopes.InFreshScopeAsync<IAnalyticsService, PairDetail>(s => s.PairAsync(a, b, days, bucket, lagMin, lagMax, CancellationToken.None)), ct);
}
