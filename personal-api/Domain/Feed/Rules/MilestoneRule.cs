namespace personal_api.Domain.Feed.Rules;

public sealed class MilestoneRule : IFeedRule
{
    public const string Name = "milestone";
    private const int MaxAgeDays = 14;
    private static readonly int[] Thresholds = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

    public IEnumerable<FeedCard> Evaluate(FeedContext context)
    {
        foreach (var kind in context.Kinds)
        {
            // Running totals mean nothing for averaged or peak readings such as weight or heart rate.
            if (FeedFormat.EffectiveAgg(kind) is "avg" or "max")
                continue;
            if (!context.RecordsByKind.TryGetValue(kind.Key, out var all))
                continue;

            var past = all.Where(r => r.OccurredAt <= context.Now).ToList();
            if (past.Count == 0)
                continue;

            var latest = past[^1];
            if (FeedDays.Gap(latest.OccurredAt, context.Now, context.Zone) > MaxAgeDays)
                continue;

            var byValue = FeedFormat.UsesValue(kind, past);
            var after = byValue ? past.Sum(r => r.Value ?? 0) : past.Count;
            var before = byValue ? after - (latest.Value ?? 0) : past.Count - 1;
            var crossed = Thresholds.Where(t => before < t && t <= after).ToList();
            if (crossed.Count == 0)
                continue;

            var threshold = crossed[^1];
            var unit = byValue ? latest.Unit ?? kind.DefaultUnit ?? "units" : "entries";
            yield return new FeedCard(
                FeedFormat.CardId(Name, kind.Key, latest.OccurredAt, context.Zone),
                kind.Key, kind.DisplayName, Name,
                FeedFormat.Big(threshold), unit,
                $"{FeedFormat.Big(threshold)} {unit} of {kind.DisplayName}",
                $"Counting since {FeedFormat.LongDate(past[0].OccurredAt, context.Zone)}",
                latest.OccurredAt, 85,
                new FeedChartRef(kind.Key, "day", byValue ? "sum" : "count", 30));
        }
    }
}
