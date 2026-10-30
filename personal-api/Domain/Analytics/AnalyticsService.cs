using personal_api.Domain.Series;

namespace personal_api.Domain.Analytics;

public interface IAnalyticsService
{
    Task<OverviewResult> OverviewAsync(IReadOnlyList<KindDefinition> kinds, int days, CancellationToken ct);
    Task<CompareResult> CompareAsync(IReadOnlyList<KindDefinition> kinds, int days, SeriesBucket bucket, CancellationToken ct);
    Task<PairDetail> PairAsync(KindDefinition a, KindDefinition b, int days, SeriesBucket bucket, int lagMin, int lagMax, CancellationToken ct);
}

public sealed class AnalyticsService(ISeriesService series, IRecordStore records, TimeProvider time) : IAnalyticsService
{
    public const int MaxKinds = 12;
    public const int MaxDays = 365;
    public const int MaxLag = 30;
    private const int ShortActivityDays = 26 * 7;
    private const int LongActivityDays = 53 * 7;
    // Below the series bucket cap with room for the extra partial day at each end.
    private const int ChunkDays = 360;
    public const string TooManyRecordsMessage = "Too many records to chart (more than 20,000). Try a shorter range.";
    private static readonly DateTimeOffset Epoch = new(1900, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // Kinds declare defaultAgg; without one, kinds that chart a value are summed and the rest are counted.
    public static SeriesAgg AggFor(KindDefinition kind) => kind.DefaultAgg?.ToLowerInvariant() switch
    {
        "sum" when kind.ValueField is not null => SeriesAgg.Sum,
        "avg" when kind.ValueField is not null => SeriesAgg.Avg,
        "max" when kind.ValueField is not null => SeriesAgg.Max,
        "count" => SeriesAgg.Count,
        _ => kind.ValueField is null ? SeriesAgg.Count : SeriesAgg.Sum,
    };

    private static string Name(SeriesAgg agg) => agg.ToString().ToLowerInvariant();

    public async Task<OverviewResult> OverviewAsync(IReadOnlyList<KindDefinition> kinds, int days, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var activityDays = days <= 30 ? ShortActivityDays : LongActivityDays;
        var span = Math.Max(2 * days, activityDays);

        var summaries = new List<KindOverview>(kinds.Count);
        List<string>? spanDates = null;
        int[]? activityTotal = null;
        foreach (var kind in kinds)
        {
            var agg = AggFor(kind);
            List<SeriesPoint> points;
            try
            {
                points = await DailyAsync(kind.Key, agg, span, now, ct);
            }
            catch (TooManyRecordsException)
            {
                summaries.Add(KindOverview.Failed(kind, Name(agg), agg == SeriesAgg.Count ? null : kind.DefaultUnit, TooManyRecordsMessage));
                continue;
            }
            if (points.Count < span)
                continue;
            spanDates ??= points.Select(p => p.Date).ToList();
            activityTotal ??= new int[activityDays];

            var current = points.Skip(span - days).ToList();
            var previous = points.Skip(span - 2 * days).Take(days).ToList();
            var activity = points.Skip(span - activityDays).Select(p => p.Count).ToList();
            for (var i = 0; i < activityDays; i++) activityTotal[i] += activity[i];

            var last = await records.QueryAsync(new RecordQuery(kind.Key, null, now, 1), ct);
            summaries.Add(Summarize(kind, agg, days, current, previous, points, activity, last.Count > 0 ? last[0].OccurredAt : null));
        }

        spanDates ??= [];
        return new OverviewResult(
            days,
            activityDays,
            now,
            spanDates.Skip(span - days).ToList(),
            spanDates.Skip(span - 2 * days).Take(days).ToList(),
            spanDates.Skip(span - activityDays).ToList(),
            activityTotal ?? [],
            summaries);
    }

    private static KindOverview Summarize(KindDefinition kind, SeriesAgg agg, int days, List<SeriesPoint> current, List<SeriesPoint> previous, List<SeriesPoint> all, List<int> activity, DateTimeOffset? lastEntryAt)
    {
        var value = PeriodValue(agg, current);
        var previousValue = PeriodValue(agg, previous);
        double? delta = value is not null && previousValue is not null ? value - previousValue : null;
        double? deltaPercent = delta is not null && previousValue is not null and not 0 ? delta / Math.Abs(previousValue.Value) * 100 : null;
        var additive = agg is SeriesAgg.Sum or SeriesAgg.Count;
        var lowerIsBetter = string.Equals(kind.Better, "lower", StringComparison.OrdinalIgnoreCase);

        var present = current.Where(p => p.Count > 0 && p.Value is not null).ToList();
        var best = present.Count == 0 ? null : (lowerIsBetter ? present.MinBy(p => p.Value) : present.MaxBy(p => p.Value));
        var latest = all.LastOrDefault(p => p.Count > 0 && p.Value is not null);
        var (currentStreak, longestStreak) = AnalyticsMath.Streaks(all.Select(p => p.Count).ToList());

        return new KindOverview(
            kind.Key,
            kind.DisplayName,
            kind.Category,
            Name(agg),
            agg == SeriesAgg.Count ? null : kind.DefaultUnit,
            kind.Better,
            value,
            previousValue,
            delta,
            deltaPercent,
            additive && value is not null ? value / days : null,
            current.Sum(p => p.Count),
            previous.Sum(p => p.Count),
            current.Count(p => p.Count > 0),
            best is null ? null : new DatedValue(best.Date, best.Value!.Value),
            latest is null ? null : new DatedValue(latest.Date, latest.Value!.Value),
            lastEntryAt,
            currentStreak,
            longestStreak,
            current.Select(p => CleanValue(agg, p)).ToList(),
            previous.Select(p => CleanValue(agg, p)).ToList(),
            current.Select(p => p.Count).ToList(),
            activity);
    }

    // Sum and count treat an empty day as a real zero; avg and max have no value on an empty day.
    private static double? CleanValue(SeriesAgg agg, SeriesPoint p) =>
        agg is SeriesAgg.Sum or SeriesAgg.Count ? p.Value ?? 0 : p.Value;

    private static double? PeriodValue(SeriesAgg agg, List<SeriesPoint> points)
    {
        switch (agg)
        {
            case SeriesAgg.Sum:
            case SeriesAgg.Count:
                return points.Sum(p => p.Value ?? 0);
            case SeriesAgg.Max:
                return points.Select(p => p.Value).Max();
            default:
                // Day averages weighted by their entry counts approximate the mean of every entry in the period.
                var valued = points.Where(p => p.Value is not null && p.Count > 0).ToList();
                var weight = valued.Sum(p => p.Count);
                return weight == 0 ? null : valued.Sum(p => p.Value!.Value * p.Count) / weight;
        }
    }

    // The last `days` daily buckets ending today, fetched in chunks so long spans stay under the series bucket cap.
    private async Task<List<SeriesPoint>> DailyAsync(string kind, SeriesAgg agg, int days, DateTimeOffset now, CancellationToken ct)
    {
        var result = new List<SeriesPoint>(days);
        var to = now;
        var remaining = days;
        while (remaining > 0)
        {
            var take = Math.Min(remaining, ChunkDays);
            var chunk = (await series.GetAsync(kind, to.AddDays(-take - 1), to, SeriesBucket.Day, agg, ct))?.Points ?? [];
            var tail = chunk.Skip(Math.Max(0, chunk.Count - take)).ToList();
            result.InsertRange(0, tail);
            remaining -= tail.Count;
            if (tail.Count == 0) break;
            // Records up to one tick before this chunk's first bucket fill the previous chunk's last bucket completely.
            to = tail[0].Start.AddTicks(-1);
        }
        return result;
    }

    public async Task<CompareResult> CompareAsync(IReadOnlyList<KindDefinition> kinds, int days, SeriesBucket bucket, CancellationToken ct)
    {
        var aligned = await AlignedAsync(kinds, days, bucket, ct);
        var noun = Noun(bucket);
        var pairs = new List<PairResult>();
        for (var i = 0; i < aligned.Series.Count; i++)
            for (var j = i + 1; j < aligned.Series.Count; j++)
                pairs.Add(PairResult.From(aligned.Series[i].Kind, aligned.Series[j].Kind, AnalyticsMath.Pearson(aligned.Tracked[i], aligned.Tracked[j], 0, noun)));
        return new CompareResult(days, Name(bucket), aligned.Dates, aligned.Series, pairs);
    }

    public async Task<PairDetail> PairAsync(KindDefinition a, KindDefinition b, int days, SeriesBucket bucket, int lagMin, int lagMax, CancellationToken ct)
    {
        var aligned = await AlignedAsync([a, b], days, bucket, ct);
        var (sa, sb) = (aligned.Series[0], aligned.Series[1]);
        var noun = Noun(bucket);
        var lags = Enumerable.Range(lagMin, lagMax - lagMin + 1).Select(l => AnalyticsMath.Pearson(aligned.Tracked[0], aligned.Tracked[1], l, noun)).ToList();
        return new PairDetail(days, Name(bucket), aligned.Dates, sa, sb, lags.Select(l => PairResult.From(a.Key, b.Key, l)).ToList(), AnalyticsMath.BestLag(lags)?.Lag);
    }

    private static string Noun(SeriesBucket bucket) => bucket == SeriesBucket.Week ? "weeks" : "days";

    private static string Name(SeriesBucket bucket) => bucket.ToString().ToLowerInvariant();

    // Series is what the charts show (zero-filled); Tracked hides buckets before each kind's first ever entry, so
    // correlations never count the days before a tracker existed as real zeros.
    private async Task<(List<string> Dates, List<CompareSeries> Series, List<List<double?>> Tracked)> AlignedAsync(IReadOnlyList<KindDefinition> kinds, int days, SeriesBucket bucket, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var buckets = bucket == SeriesBucket.Week ? (days + 6) / 7 : days;
        var lookback = bucket == SeriesBucket.Week ? buckets * 7 + 7 : days + 1;
        var fetched = new List<(KindDefinition Kind, SeriesAgg Agg, Dictionary<string, SeriesPoint> ByDate, DateTimeOffset? FirstEntry)>();
        List<SeriesPoint>? frame = null;
        foreach (var kind in kinds)
        {
            var agg = AggFor(kind);
            SeriesResult result;
            try
            {
                result = (await series.GetAsync(kind.Key, now.AddDays(-lookback), now, bucket, agg, ct))!;
            }
            catch (Exception e) when (e is TooManyRecordsException or TooManyBucketsException)
            {
                throw new AnalyticsKindException(kind.DisplayName, e.Message);
            }
            var points = result.Points.Skip(Math.Max(0, result.Points.Count - buckets)).ToList();
            frame ??= points;
            var first = await records.ListRangeAsync(kind.Key, Epoch, now, 1, ct);
            fetched.Add((kind, agg, points.ToDictionary(p => p.Date), first.Count > 0 ? first[0].OccurredAt : null));
        }
        frame ??= [];
        var dates = frame.Select(p => p.Date).ToList();

        var list = new List<CompareSeries>();
        var tracked = new List<List<double?>>();
        foreach (var f in fetched)
        {
            var values = dates.Select(d => f.ByDate.TryGetValue(d, out var p) ? CleanValue(f.Agg, p) : (f.Agg is SeriesAgg.Sum or SeriesAgg.Count ? 0 : null)).ToList();
            list.Add(new CompareSeries(f.Kind.Key, f.Kind.DisplayName, f.Kind.Category, Name(f.Agg), f.Agg == SeriesAgg.Count ? null : f.Kind.DefaultUnit, values, AnalyticsMath.Describe(values)));
            var start = FirstTrackedIndex(f.FirstEntry, frame, f.ByDate);
            tracked.Add(values.Select((v, i) => i >= start ? v : null).ToList());
        }
        return (dates, list, tracked);
    }

    // Started before the range: every bucket counts. Started inside it: the first bucket with an entry, since none came earlier.
    private static int FirstTrackedIndex(DateTimeOffset? firstEntry, List<SeriesPoint> frame, Dictionary<string, SeriesPoint> byDate)
    {
        if (firstEntry is null || frame.Count == 0) return frame.Count;
        if (firstEntry < frame[0].Start) return 0;
        var index = frame.FindIndex(p => byDate.TryGetValue(p.Date, out var own) && own.Count > 0);
        return index < 0 ? frame.Count : index;
    }
}
