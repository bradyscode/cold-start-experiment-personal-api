using personal_api.Domain.Feed;

namespace personal_api.Caching;

public sealed class CachedFeedService(IReadCache cache, IServiceScopeFactory scopes) : IFeedService
{
    public Task<IReadOnlyList<FeedCard>> GetAsync(int limit, CancellationToken ct) =>
        cache.GetOrCreateAsync($"feed:{limit}", () => scopes.InFreshScopeAsync<IFeedService, IReadOnlyList<FeedCard>>(s => s.GetAsync(limit, CancellationToken.None)), ct);
}
