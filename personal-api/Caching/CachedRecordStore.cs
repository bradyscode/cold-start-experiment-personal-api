using personal_api.Domain;

namespace personal_api.Caching;

// Only QueryAsync is cached; the feed and analytics read through ListRangeAsync and are cached a level up.
public sealed class CachedRecordStore(IServiceProvider services, IServiceScopeFactory scopes, IReadCache cache) : IRecordStore
{
    public async Task<UpsertResult> UpsertAsync(LifeRecord record, CancellationToken ct)
    {
        try
        {
            return await services.Uncached<IRecordStore>().UpsertAsync(record, ct);
        }
        finally
        {
            cache.Invalidate();
        }
    }

    public Task<IReadOnlyList<LifeRecord>> QueryAsync(RecordQuery query, CancellationToken ct) =>
        cache.GetOrCreateAsync($"records:{query.Kind}|{query.From?.UtcTicks}|{query.To?.UtcTicks}|{query.Limit}",
            () => scopes.InFreshScopeAsync<IRecordStore, IReadOnlyList<LifeRecord>>(s => s.QueryAsync(query, CancellationToken.None)), ct);

    public Task<IReadOnlyList<LifeRecord>> ListRangeAsync(string? kind, DateTimeOffset from, DateTimeOffset to, int limit, CancellationToken ct) =>
        services.Uncached<IRecordStore>().ListRangeAsync(kind, from, to, limit, ct);
}
