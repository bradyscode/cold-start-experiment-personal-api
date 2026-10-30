namespace personal_api.Domain.Feed;

public interface IFeedRule
{
    IEnumerable<FeedCard> Evaluate(FeedContext context);
}

public interface IFeedService
{
    Task<IReadOnlyList<FeedCard>> GetAsync(int limit, CancellationToken ct);
}
