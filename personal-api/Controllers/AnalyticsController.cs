using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using personal_api.Domain;
using personal_api.Domain.Analytics;
using personal_api.Domain.Series;

namespace personal_api.Controllers;

[ApiController]
public class AnalyticsController(IAnalyticsService analytics, IKindStore kinds) : ApiControllerBase
{
    private const int DefaultDays = 30;
    private const int DefaultLag = 7;

    [HttpGet("/analytics/overview")]
    public async Task<IActionResult> Overview([FromQuery] string? days, [FromQuery(Name = "kinds")] string? kindList, CancellationToken ct)
    {
        if (!TryDays(days, out var parsedDays))
            return Invalid(DaysError);

        var keys = SplitKinds(kindList);
        var all = await kinds.ListAsync(ct);
        IReadOnlyList<KindDefinition> selected = all;
        if (keys.Count > 0)
        {
            var (found, missing) = Resolve(all, keys);
            if (missing is not null) return missing;
            selected = found;
        }

        return await Guard(() => analytics.OverviewAsync(selected, parsedDays, ct));
    }

    [HttpGet("/analytics/compare")]
    public async Task<IActionResult> Compare([FromQuery(Name = "kinds")] string? kindList, [FromQuery] string? days, [FromQuery] string? bucket, CancellationToken ct)
    {
        var keys = SplitKinds(kindList);
        var errors = new List<string>();
        if (keys.Count == 0)
            errors.Add("kinds is required: a comma-separated list of kind keys");
        else if (keys.Count > AnalyticsService.MaxKinds)
            errors.Add($"Compare at most {AnalyticsService.MaxKinds} kinds at once");
        if (!TryDays(days, out var parsedDays))
            errors.Add(DaysError);
        if (!TryBucket(bucket, out var parsedBucket))
            errors.Add("bucket must be day or week");
        if (errors.Count > 0)
            return Invalid(errors);

        var (found, missing) = Resolve(await kinds.ListAsync(ct), keys);
        if (missing is not null) return missing;

        return await Guard(() => analytics.CompareAsync(found, parsedDays, parsedBucket, ct));
    }

    [HttpGet("/analytics/pair")]
    public async Task<IActionResult> Pair([FromQuery] string? a, [FromQuery] string? b, [FromQuery] string? days, [FromQuery] string? bucket, [FromQuery] string? lagMin, [FromQuery] string? lagMax, CancellationToken ct)
    {
        var errors = new List<string>();
        var (keyA, keyB) = (a?.Trim() ?? "", b?.Trim() ?? "");
        if (keyA.Length == 0) errors.Add("a is required");
        if (keyB.Length == 0) errors.Add("b is required");
        if (keyA.Length > 0 && keyA == keyB) errors.Add("a and b must be different kinds");
        if (!TryDays(days, out var parsedDays)) errors.Add(DaysError);
        if (!TryBucket(bucket, out var parsedBucket)) errors.Add("bucket must be day or week");
        var lagsParsed = TryInt(lagMin, -DefaultLag, out var min) & TryInt(lagMax, DefaultLag, out var max);
        if (!lagsParsed)
            errors.Add("lagMin and lagMax must be whole numbers");
        else if (Math.Abs(min) > AnalyticsService.MaxLag || Math.Abs(max) > AnalyticsService.MaxLag)
            errors.Add($"lagMin and lagMax must be between -{AnalyticsService.MaxLag} and {AnalyticsService.MaxLag}");
        else if (min > max)
            errors.Add("lagMin must not be greater than lagMax");
        if (errors.Count > 0)
            return Invalid(errors);

        var (found, missing) = Resolve(await kinds.ListAsync(ct), [keyA, keyB]);
        if (missing is not null) return missing;

        return await Guard(() => analytics.PairAsync(found[0], found[1], parsedDays, parsedBucket, min, max, ct));
    }

    private static readonly string DaysError = $"days must be a whole number from 1 to {AnalyticsService.MaxDays}";

    private async Task<IActionResult> Guard<T>(Func<Task<T>> run)
    {
        try
        {
            return Ok(await run());
        }
        catch (Exception e) when (e is TooManyBucketsException or TooManyRecordsException or AnalyticsKindException)
        {
            return Invalid(e.Message);
        }
    }

    private (List<KindDefinition> Found, IActionResult? Missing) Resolve(IReadOnlyList<KindDefinition> all, IReadOnlyList<string> keys)
    {
        var byKey = all.ToDictionary(k => k.Key, StringComparer.Ordinal);
        var unknown = keys.Where(k => !byKey.ContainsKey(k)).ToList();
        if (unknown.Count > 0)
            return ([], NotFound(new { errors = unknown.Select(k => $"Unknown kind '{k}'").ToArray() }));
        return (keys.Select(k => byKey[k]).ToList(), null);
    }

    private static List<string> SplitKinds(string? raw) =>
        (raw ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.Ordinal).ToList();

    private static bool TryDays(string? raw, out int days)
    {
        days = DefaultDays;
        if (string.IsNullOrWhiteSpace(raw)) return true;
        return int.TryParse(raw.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out days) && days is >= 1 and <= AnalyticsService.MaxDays;
    }

    private static bool TryInt(string? raw, int fallback, out int value)
    {
        value = fallback;
        return string.IsNullOrWhiteSpace(raw) || int.TryParse(raw.Trim(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out value);
    }

    private static bool TryBucket(string? raw, out SeriesBucket bucket)
    {
        bucket = SeriesBucket.Day;
        if (string.IsNullOrWhiteSpace(raw)) return true;
        switch (raw.Trim().ToLowerInvariant())
        {
            case "day": return true;
            case "week": bucket = SeriesBucket.Week; return true;
            default: return false;
        }
    }
}
