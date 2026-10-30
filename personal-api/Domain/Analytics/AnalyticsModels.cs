namespace personal_api.Domain.Analytics;

// Pearson r of b against a with b shifted `Lag` buckets later; null R comes with a plain-language Reason.
public sealed record PairStats(int Lag, double? R, double? R2, int N, double? Slope, double? Intercept, string? Reason);

public sealed record SeriesStats(int N, double? Total, double? Mean, double? Min, double? Max, double? StdDev, double? Slope);

public sealed record DatedValue(string Date, double Value);

public sealed record KindOverview(
    string Kind,
    string DisplayName,
    string? Category,
    string Agg,
    string? Unit,
    string? Better,
    double? Value,
    double? PreviousValue,
    double? Delta,
    double? DeltaPercent,
    double? AvgPerDay,
    int Entries,
    int PreviousEntries,
    int ActiveDays,
    DatedValue? Best,
    DatedValue? Latest,
    DateTimeOffset? LastEntryAt,
    int CurrentStreak,
    int LongestStreak,
    IReadOnlyList<double?> Values,
    IReadOnlyList<double?> PreviousValues,
    IReadOnlyList<int> Counts,
    IReadOnlyList<int> Activity,
    string? Error = null)
{
    // A kind that could not be computed keeps its identity and a message, with no numbers.
    public static KindOverview Failed(KindDefinition kind, string agg, string? unit, string error) =>
        new(kind.Key, kind.DisplayName, kind.Category, agg, unit, kind.Better, null, null, null, null, null, 0, 0, 0, null, null, null, 0, 0, [], [], [], [], error);
}

public sealed record OverviewResult(
    int Days,
    int ActivityDays,
    DateTimeOffset GeneratedAt,
    IReadOnlyList<string> Dates,
    IReadOnlyList<string> PreviousDates,
    IReadOnlyList<string> ActivityDates,
    IReadOnlyList<int> ActivityTotal,
    IReadOnlyList<KindOverview> Kinds);

public sealed record CompareSeries(string Kind, string DisplayName, string? Category, string Agg, string? Unit, IReadOnlyList<double?> Values, SeriesStats Stats);

public sealed record PairResult(string A, string B, int Lag, double? R, double? R2, int N, double? Slope, double? Intercept, string? Reason)
{
    public static PairResult From(string a, string b, PairStats s) => new(a, b, s.Lag, s.R, s.R2, s.N, s.Slope, s.Intercept, s.Reason);
}

public sealed record CompareResult(int Days, string Bucket, IReadOnlyList<string> Dates, IReadOnlyList<CompareSeries> Series, IReadOnlyList<PairResult> Pairs);

public sealed record PairDetail(int Days, string Bucket, IReadOnlyList<string> Dates, CompareSeries A, CompareSeries B, IReadOnlyList<PairResult> Lags, int? BestLag);

// Raised when one kind in a compare or pair request cannot be computed; the message names the kind.
public sealed class AnalyticsKindException(string displayName, string reason) : Exception($"{displayName}: {reason}");
