namespace personal_api.Domain.Feed.Rules;

public sealed class StreakRule : IFeedRule
{
    public const string Name = "streak";
    private const int MinDays = 3;
    private const int WindowDays = 90;

    public IEnumerable<FeedCard> Evaluate(FeedContext context)
    {
        var today = FeedDays.LocalDate(context.Now, context.Zone);
        foreach (var kind in context.Kinds)
        {
            if (!context.RecordsByKind.TryGetValue(kind.Key, out var all))
                continue;

            var past = all.Where(r => r.OccurredAt <= context.Now).ToList();
            if (past.Count == 0)
                continue;

            var days = past.Select(r => FeedDays.LocalDate(r.OccurredAt, context.Zone)).Distinct().Order().ToList();
            if ((today - days[^1]).Days > 1)
                continue;

            var length = RunEndingAt(days, days.Count - 1);
            if (length < MinDays)
                continue;

            var windowStart = today.AddDays(-(WindowDays - 1));
            var longest = Math.Max(length, LongestRun(days.Where(d => d >= windowStart).ToList()));
            var latest = past[^1];
            yield return new FeedCard(
                FeedFormat.CardId(Name, kind.Key, latest.OccurredAt, context.Zone),
                kind.Key, kind.DisplayName, Name,
                FeedFormat.Big(length), "days",
                $"{length}-day {kind.DisplayName} streak",
                $"Longest in the last {WindowDays} days: {longest}",
                latest.OccurredAt, 70 + Math.Min(length, 30),
                new FeedChartRef(kind.Key, "day", "count", 30));
        }
    }

    private static int RunEndingAt(List<DateTime> days, int index)
    {
        var run = 1;
        while (index - run >= 0 && (days[index - run + 1] - days[index - run]).Days == 1)
            run++;
        return run;
    }

    private static int LongestRun(List<DateTime> days)
    {
        var longest = 0;
        var run = 0;
        for (var i = 0; i < days.Count; i++)
        {
            run = i > 0 && (days[i] - days[i - 1]).Days == 1 ? run + 1 : 1;
            longest = Math.Max(longest, run);
        }
        return longest;
    }
}
