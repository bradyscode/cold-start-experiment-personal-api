using System.Globalization;
using System.Text.RegularExpressions;

namespace personal_api.Domain;

public static partial class ZonedTime
{
    // Date, optional time, optional Z or numeric offset.
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?)?(Z|[+-]\d{2}(:?\d{2})?)?$", RegexOptions.IgnoreCase)]
    private static partial Regex IsoShape();

    // Values with Z or an offset keep it; offset-less values are read as wall-clock time in `zone`. Null when the text is not an ISO 8601 date or date and time.
    public static DateTimeOffset? Parse(string? text, TimeZoneInfo zone)
    {
        var trimmed = text?.Trim();
        if (string.IsNullOrEmpty(trimmed))
            return null;
        var match = IsoShape().Match(trimmed);
        if (!match.Success)
            return null;

        try
        {
            if (match.Groups[4].Success)
                return DateTimeOffset.TryParse(trimmed, CultureInfo.InvariantCulture, DateTimeStyles.None, out var explicitOffset) ? explicitOffset : null;

            if (!DateTime.TryParse(trimmed, CultureInfo.InvariantCulture, DateTimeStyles.None, out var wall))
                return null;
            wall = DateTime.SpecifyKind(wall, DateTimeKind.Unspecified);

            if (zone.IsInvalidTime(wall))
            {
                // A wall time skipped by a spring-forward moves ahead by the gap: read it with the pre-change offset.
                var instant = new DateTimeOffset(wall, zone.BaseUtcOffset).ToUniversalTime();
                return TimeZoneInfo.ConvertTime(instant, zone);
            }
            var offset = zone.IsAmbiguousTime(wall) ? zone.GetAmbiguousTimeOffsets(wall).Max() : zone.GetUtcOffset(wall);
            return new DateTimeOffset(wall, offset);
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }
}
