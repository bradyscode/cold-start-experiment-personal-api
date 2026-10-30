using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace personal_api.Domain.Feed;

public sealed class FeedService(IRecordStore records, IKindStore kinds, IEnumerable<IFeedRule> rules, IOptions<FeedOptions> options, TimeProvider time, ILogger<FeedService> logger) : IFeedService
{
    public const int MaxRecordsPerKind = 20000;
    private static readonly DateTimeOffset Epoch = new(1900, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private readonly TimeZoneInfo _zone = TimeZoneInfo.FindSystemTimeZoneById(options.Value.TimeZone);

    public async Task<IReadOnlyList<FeedCard>> GetAsync(int limit, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var definitions = await kinds.ListAsync(ct);
        var byKind = new Dictionary<string, IReadOnlyList<LifeRecord>>();
        foreach (var kind in definitions)
        {
            var found = await records.ListRangeAsync(kind.Key, Epoch, now, MaxRecordsPerKind + 1, ct);
            if (found.Count > MaxRecordsPerKind)
            {
                logger.LogWarning("Skipping feed cards for kind {Kind}: more than {Max} records", kind.Key, MaxRecordsPerKind);
                continue;
            }
            byKind[kind.Key] = found;
        }

        var context = new FeedContext(now, _zone, definitions, byKind);
        return rules.SelectMany(r => r.Evaluate(context))
            .GroupBy(c => (c.Kind, c.Rule))
            .Select(g => g.OrderByDescending(c => c.OccurredAt).First())
            .OrderByDescending(c => c.Score)
            .ThenByDescending(c => c.OccurredAt)
            .Take(limit)
            .ToList();
    }
}
