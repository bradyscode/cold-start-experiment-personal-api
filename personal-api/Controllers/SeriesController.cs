using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using personal_api.Domain;
using personal_api.Domain.Feed;
using personal_api.Domain.Series;

namespace personal_api.Controllers;

[ApiController]
public class SeriesController(ISeriesService series, TimeProvider time, IOptions<FeedOptions> feedOptions) : ApiControllerBase
{
    private readonly TimeZoneInfo _zone = TimeZoneInfo.FindSystemTimeZoneById(feedOptions.Value.TimeZone);

    [HttpGet("/series/{kind}")]
    public async Task<IActionResult> Get(string kind, [FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? bucket, [FromQuery] string? agg, CancellationToken ct)
    {
        var parsedFrom = string.IsNullOrWhiteSpace(from) ? null : ZonedTime.Parse(from, _zone);
        var parsedTo = string.IsNullOrWhiteSpace(to) ? null : ZonedTime.Parse(to, _zone);
        if (!ModelState.IsValid || (parsedFrom is null && !string.IsNullOrWhiteSpace(from)) || (parsedTo is null && !string.IsNullOrWhiteSpace(to)))
            return Invalid("from and to must be valid ISO 8601 timestamps");
        if (!TryParse(bucket, SeriesBucket.Day, out var parsedBucket))
            return Invalid("bucket must be day or week");
        if (!TryParse(agg, SeriesAgg.Sum, out var parsedAgg))
            return Invalid("agg must be sum, avg, max or count");

        if (!InSupportedRange(parsedFrom) || !InSupportedRange(parsedTo))
            return Invalid("from and to must be between 1900 and 2100");

        var end = parsedTo ?? time.GetUtcNow();
        var start = parsedFrom ?? end.AddDays(-30);
        if (start > end)
            return Invalid("from must not be after to");

        SeriesResult? result;
        try
        {
            result = await series.GetAsync(kind.Trim(), start, end, parsedBucket, parsedAgg, ct);
        }
        catch (Exception e) when (e is TooManyBucketsException or TooManyRecordsException)
        {
            return Invalid(e.Message);
        }

        return result is null ? NotFound(new { errors = new[] { $"Unknown kind '{kind.Trim()}'" } }) : Ok(result);
    }

    private static bool TryParse<T>(string? raw, T fallback, out T value) where T : struct, Enum
    {
        value = fallback;
        if (string.IsNullOrWhiteSpace(raw))
            return true;
        var name = Enum.GetNames<T>().FirstOrDefault(n => n.Equals(raw.Trim(), StringComparison.OrdinalIgnoreCase));
        return name is not null && Enum.TryParse(name, out value);
    }

    private static bool InSupportedRange(DateTimeOffset? value) => value is null || (value.Value.Year >= 1900 && value.Value.Year <= 2100);
}
