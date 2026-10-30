using System.Globalization;
using Microsoft.Extensions.Options;
using personal_api.Domain.Feed;

namespace personal_api.Domain.Series;

public sealed class SeriesService(IRecordStore records, IKindStore kinds, IOptions<FeedOptions> options) : ISeriesService
{
    public const int MaxBuckets = 400;
    public const int MaxRecords = 20000;

    private readonly TimeZoneInfo _zone = TimeZoneInfo.FindSystemTimeZoneById(options.Value.TimeZone);

    public async Task<SeriesResult?> GetAsync(string kind, DateTimeOffset from, DateTimeOffset to, SeriesBucket bucket, SeriesAgg agg, CancellationToken ct)
    {
        var definition = await kinds.GetAsync(kind, ct);
        if (definition is null)
            return null;

        var buckets = BucketStarts(from, to, bucket);
        var starts = buckets.Select(b => b.Start).ToList();
        var found = await records.ListRangeAsync(kind, starts[0], to, MaxRecords + 1, ct);
        if (found.Count > MaxRecords)
            throw new TooManyRecordsException(MaxRecords);

        var groups = new List<List<LifeRecord>>(starts.Count);
        for (var i = 0; i < starts.Count; i++) groups.Add([]);
        foreach (var record in found)
        {
            var index = starts.BinarySearch(record.OccurredAt);
            if (index < 0) index = ~index - 1;
            if (index >= 0) groups[index].Add(record);
        }

        var points = starts.Select((start, i) => new SeriesPoint(start, buckets[i].Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), Aggregate(groups[i], agg), groups[i].Count)).ToList();
        return new SeriesResult(kind, bucket.ToString().ToLowerInvariant(), agg.ToString().ToLowerInvariant(), agg == SeriesAgg.Count ? null : definition.DefaultUnit, points);
    }

    private static double? Aggregate(List<LifeRecord> group, SeriesAgg agg)
    {
        if (agg == SeriesAgg.Count)
            return group.Count;

        var values = group.Where(r => r.Value is not null).Select(r => r.Value!.Value).ToList();
        if (agg == SeriesAgg.Sum)
            return values.Sum();
        if (values.Count == 0)
            return null;
        return agg == SeriesAgg.Avg ? values.Average() : values.Max();
    }

    // UTC instants of each bucket start, from the bucket containing `from` to the one containing `to`.
    private List<(DateTime Date, DateTimeOffset Start)> BucketStarts(DateTimeOffset from, DateTimeOffset to, SeriesBucket bucket)
    {
        var step = bucket == SeriesBucket.Week ? 7 : 1;
        var date = TimeZoneInfo.ConvertTime(from, _zone).Date;
        if (bucket == SeriesBucket.Week)
            date = date.AddDays(-(((int)date.DayOfWeek + 6) % 7));

        var starts = new List<(DateTime Date, DateTimeOffset Start)>();
        for (; ; date = date.AddDays(step))
        {
            var start = LocalMidnightUtc(date);
            if (start > to) break;
            if (starts.Count == MaxBuckets) throw new TooManyBucketsException(MaxBuckets);
            starts.Add((date, start));
        }
        return starts;
    }

    // Some zones skip midnight on a DST change; use the first valid local time of that day.
    private DateTimeOffset LocalMidnightUtc(DateTime localDate)
    {
        var local = DateTime.SpecifyKind(localDate, DateTimeKind.Unspecified);
        while (_zone.IsInvalidTime(local)) local = local.AddMinutes(30);
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, _zone), TimeSpan.Zero);
    }
}
