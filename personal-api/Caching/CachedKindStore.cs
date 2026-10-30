using personal_api.Domain;

namespace personal_api.Caching;

public sealed class CachedKindStore(IServiceProvider services, IServiceScopeFactory scopes, IReadCache cache) : IKindStore
{
    public Task<IReadOnlyList<KindDefinition>> ListAsync(CancellationToken ct) =>
        cache.GetOrCreateAsync("kinds:list", () => scopes.InFreshScopeAsync<IKindStore, IReadOnlyList<KindDefinition>>(s => s.ListAsync(CancellationToken.None)), ct);

    public Task<KindDefinition?> GetAsync(string key, CancellationToken ct) =>
        cache.GetOrCreateAsync($"kinds:get:{key}", () => scopes.InFreshScopeAsync<IKindStore, KindDefinition?>(s => s.GetAsync(key, CancellationToken.None)), ct);

    public async Task SaveAsync(KindDefinition kind, CancellationToken ct)
    {
        try
        {
            await services.Uncached<IKindStore>().SaveAsync(kind, ct);
        }
        finally
        {
            cache.Invalidate();
        }
    }
}
