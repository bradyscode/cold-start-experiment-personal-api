namespace personal_api.Domain.Series;

public interface ISeriesService
{
    // Null when the kind does not exist; throws TooManyBucketsException or TooManyRecordsException when the range is too wide.
    Task<SeriesResult?> GetAsync(string kind, DateTimeOffset from, DateTimeOffset to, SeriesBucket bucket, SeriesAgg agg, CancellationToken ct);
}
