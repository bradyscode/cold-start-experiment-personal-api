namespace personal_api.Domain.Feed.Rules;

public sealed class PersonalBestRule : IFeedRule
{
    public const string Name = "personal_best";
    private const int MinRecords = 5;
    private const int MinGapDays = 7;
    private const int FreshDays = 90;

    public IEnumerable<FeedCard> Evaluate(FeedContext context)
    {
        var freshFrom = context.Now.AddDays(-FreshDays);
        foreach (var kind in context.Kinds)
        {
            var better = kind.Better ?? "higher";
            if (better == "none")
                continue;
            var lower = better == "lower";
            if (!context.RecordsByKind.TryGetValue(kind.Key, out var all))
                continue;

            var valued = all.Where(r => r.Value is not null && r.OccurredAt <= context.Now).ToList();
            if (valued.Count < MinRecords)
                continue;

            // The card is for a recent record, but "previous" searches the kind's whole history.
            var latest = valued[^1];
            if (latest.OccurredAt < freshFrom)
                continue;
            var earlier = valued.Take(valued.Count - 1);
            var previous = lower ? earlier.LastOrDefault(r => r.Value <= latest.Value) : earlier.LastOrDefault(r => r.Value >= latest.Value);
            var gapDays = previous is null ? (int?)null : FeedDays.Gap(previous.OccurredAt, latest.OccurredAt, context.Zone);
            if (previous is not null && previous.Value == latest.Value)
                continue;
            if (gapDays < MinGapDays)
                continue;

            yield return new FeedCard(
                FeedFormat.CardId(Name, kind.Key, latest.OccurredAt, context.Zone),
                kind.Key, kind.DisplayName, Name,
                FeedFormat.Big(latest.Value!.Value), latest.Unit,
                gapDays is null ? $"{(lower ? "Lowest" : "Best")} {kind.DisplayName} on record" : $"{(lower ? "Lowest" : "Best")} {kind.DisplayName} in {gapDays} days",
                previous is null ? $"From {valued.Count} entries" : $"Last {(lower ? "lower" : "higher")} was {FeedFormat.Big(previous.Value!.Value)} on {FeedFormat.ShortDate(previous.OccurredAt, context.Zone)}",
                latest.OccurredAt, 90, FeedFormat.Chart(kind, lower ? "avg" : "max"));
        }
    }
}
