namespace personal_api.Domain.Feed.Rules;

public sealed class WeeklyRule : IFeedRule
{
    public const string Name = "weekly";

    public IEnumerable<FeedCard> Evaluate(FeedContext context)
    {
        var weekStart = FeedDays.WeekStart(FeedDays.LocalDate(context.Now, context.Zone));
        foreach (var kind in context.Kinds)
        {
            if (!context.RecordsByKind.TryGetValue(kind.Key, out var all))
                continue;

            var past = all.Where(r => r.OccurredAt <= context.Now).ToList();
            var thisWeek = past.Where(r => FeedDays.LocalDate(r.OccurredAt, context.Zone) >= weekStart).ToList();
            if (thisWeek.Count == 0)
                continue;

            var lastWeek = past.Where(r =>
            {
                var day = FeedDays.LocalDate(r.OccurredAt, context.Zone);
                return day >= weekStart.AddDays(-7) && day < weekStart;
            }).ToList();

            var byValue = FeedFormat.UsesValue(kind, past);
            var agg = byValue ? FeedFormat.EffectiveAgg(kind) : "count";
            var latest = thisWeek[^1];
            var current = Combine(thisWeek, agg);
            if (current is null)
                continue;
            var previous = Combine(lastWeek, agg);
            var word = agg switch { "avg" => " average", "max" => " peak", _ => "" };

            yield return new FeedCard(
                FeedFormat.CardId(Name, kind.Key, latest.OccurredAt, context.Zone),
                kind.Key, kind.DisplayName, Name,
                FeedFormat.Big(current.Value), byValue ? latest.Unit ?? kind.DefaultUnit : "entries",
                $"{kind.DisplayName}{word} this week",
                $"Last week: {(previous is null ? "none" : FeedFormat.Big(previous.Value))}",
                latest.OccurredAt, 50,
                new FeedChartRef(kind.Key, "week", agg, 28));
        }
    }

    // Sum and count are 0 for an empty week; avg and max have no value then.
    private static double? Combine(List<LifeRecord> records, string agg)
    {
        var values = records.Where(r => r.Value is not null).Select(r => r.Value!.Value).ToList();
        return agg switch
        {
            "count" => records.Count,
            "avg" => values.Count == 0 ? null : values.Average(),
            "max" => values.Count == 0 ? null : values.Max(),
            _ => values.Sum(),
        };
    }
}
