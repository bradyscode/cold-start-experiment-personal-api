namespace personal_api.Domain.Feed.Rules;

public sealed class VsAverageRule : IFeedRule
{
    public const string Name = "vs_average";
    private const int MinPrior = 5;
    private const int WindowDays = 30;
    private const double Threshold = 0.15;
    private const int MaxPercent = 999;

    public IEnumerable<FeedCard> Evaluate(FeedContext context)
    {
        foreach (var kind in context.Kinds)
        {
            if (!context.RecordsByKind.TryGetValue(kind.Key, out var all))
                continue;

            var valued = all.Where(r => r.Value is not null && r.OccurredAt <= context.Now).ToList();
            if (valued.Count == 0)
                continue;

            var latest = valued[^1];
            var windowStart = latest.OccurredAt.AddDays(-WindowDays);
            var prior = valued.Take(valued.Count - 1).Where(r => r.OccurredAt >= windowStart).ToList();
            if (prior.Count < MinPrior)
                continue;

            var average = prior.Average(r => r.Value!.Value);
            if (average == 0)
                continue;

            var change = (latest.Value!.Value - average) / Math.Abs(average);
            if (Math.Abs(change) < Threshold)
                continue;

            var pct = Math.Round(Math.Abs(change) * 100, MidpointRounding.AwayFromZero);
            var size = pct > MaxPercent ? $"over {MaxPercent}%" : $"{pct:0}%";
            yield return new FeedCard(
                FeedFormat.CardId(Name, kind.Key, latest.OccurredAt, context.Zone),
                kind.Key, kind.DisplayName, Name,
                FeedFormat.Big(latest.Value.Value), latest.Unit,
                $"{kind.DisplayName} is {size} {(change > 0 ? "above" : "below")} your 30-day average",
                $"Average {FeedFormat.Big(average)}",
                latest.OccurredAt, 60, FeedFormat.Chart(kind, "avg"));
        }
    }
}
