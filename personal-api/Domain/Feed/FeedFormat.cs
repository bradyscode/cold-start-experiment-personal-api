using System.Globalization;

namespace personal_api.Domain.Feed;

public static class FeedFormat
{
    // 1250 -> "1,250", 8.24 -> "8.2"; values of 1e15 or more switch to scientific form so a stored outlier cannot print hundreds of digits.
    public static string Big(double value) => double.IsFinite(value) && Math.Abs(value) >= 1e15
        ? value.ToString("0.##E+0", CultureInfo.InvariantCulture)
        : value.ToString("#,##0.#", CultureInfo.InvariantCulture);

    public static string ShortDate(DateTimeOffset instant, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTime(instant, zone).ToString("MMM d", CultureInfo.InvariantCulture);

    // Jun 1, 2026
    public static string LongDate(DateTimeOffset instant, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTime(instant, zone).ToString("MMM d, yyyy", CultureInfo.InvariantCulture);

    public static string CardId(string rule, string kind, DateTimeOffset occurredAt, TimeZoneInfo zone) =>
        $"{rule}:{kind}:{TimeZoneInfo.ConvertTime(occurredAt, zone).ToString("yyyyMMdd", CultureInfo.InvariantCulture)}";

    public static FeedChartRef Chart(KindDefinition kind, string valueAgg) =>
        new(kind.Key, "day", kind.ValueField is null ? "count" : valueAgg, 30);

    // How a kind's values combine: its DefaultAgg, else sum when it has a value field, else count.
    public static string EffectiveAgg(KindDefinition kind) =>
        kind.DefaultAgg ?? (kind.ValueField is null ? "count" : "sum");

    // A kind totals by value when it has a value field, is not set to count entries, and has at least one valued record; otherwise by record count.
    public static bool UsesValue(KindDefinition kind, IEnumerable<LifeRecord> records) =>
        kind.ValueField is not null && EffectiveAgg(kind) != "count" && records.Any(r => r.Value is not null);
}
