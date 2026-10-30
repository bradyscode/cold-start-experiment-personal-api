namespace personal_api.Domain.Series;

public enum SeriesBucket { Day, Week }

public enum SeriesAgg { Sum, Avg, Max, Count }

public sealed record SeriesPoint(DateTimeOffset Start, string Date, double? Value, int Count);

public sealed record SeriesResult(string Kind, string Bucket, string Agg, string? Unit, IReadOnlyList<SeriesPoint> Points);

public sealed class TooManyBucketsException(int max) : Exception($"The range covers more than {max} buckets; narrow it or use bucket=week");

public sealed class TooManyRecordsException(int max) : Exception($"Too many records in this range (more than {max}). Narrow the date range.");
