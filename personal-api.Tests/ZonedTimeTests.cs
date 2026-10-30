using personal_api.Domain;

namespace personal_api.Tests;

public class ZonedTimeTests
{
    private static readonly TimeZoneInfo Chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
    private static readonly TimeZoneInfo Tokyo = TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo");

    private static DateTimeOffset Utc(string iso) => DateTimeOffset.Parse(iso, System.Globalization.CultureInfo.InvariantCulture).ToUniversalTime();

    [Theory]
    [InlineData("2026-06-01T12:00:00", "UTC", "2026-06-01T12:00:00Z")]
    [InlineData("2026-06-01T12:00:00", "America/Chicago", "2026-06-01T17:00:00Z")]
    [InlineData("2026-01-15T12:00:00", "America/Chicago", "2026-01-15T18:00:00Z")]
    [InlineData("2026-06-01T12:00:00", "Asia/Tokyo", "2026-06-01T03:00:00Z")]
    [InlineData("2026-06-01T12:00", "Asia/Tokyo", "2026-06-01T03:00:00Z")]
    [InlineData("2026-06-01T12:00:00.250", "UTC", "2026-06-01T12:00:00.250Z")]
    public void Offset_less_values_are_read_in_the_zone(string text, string zoneId, string expectedUtc)
    {
        var parsed = ZonedTime.Parse(text, TimeZoneInfo.FindSystemTimeZoneById(zoneId));
        Assert.Equal(Utc(expectedUtc), parsed!.Value.ToUniversalTime());
    }

    [Theory]
    [InlineData("2026-06-01", "America/Chicago", "2026-06-01T05:00:00Z")]
    [InlineData("2026-06-01", "Asia/Tokyo", "2026-05-31T15:00:00Z")]
    [InlineData("2026-06-01", "UTC", "2026-06-01T00:00:00Z")]
    public void Date_only_is_local_midnight(string text, string zoneId, string expectedUtc)
    {
        Assert.Equal(Utc(expectedUtc), ZonedTime.Parse(text, TimeZoneInfo.FindSystemTimeZoneById(zoneId))!.Value.ToUniversalTime());
    }

    [Theory]
    [InlineData("2026-06-01T12:00:00Z", "2026-06-01T12:00:00Z")]
    [InlineData("2026-06-01T12:00:00z", "2026-06-01T12:00:00Z")]
    [InlineData("2026-06-01T12:00:00+05:30", "2026-06-01T06:30:00Z")]
    [InlineData("2026-06-01T12:00:00-06:00", "2026-06-01T18:00:00Z")]
    [InlineData("2026-06-01T12:00:00-0600", "2026-06-01T18:00:00Z")]
    [InlineData("2026-06-01T12:00:00.123Z", "2026-06-01T12:00:00.123Z")]
    public void Values_with_an_offset_ignore_the_zone(string text, string expectedUtc)
    {
        foreach (var zone in new[] { TimeZoneInfo.Utc, Chicago, Tokyo })
            Assert.Equal(Utc(expectedUtc), ZonedTime.Parse(text, zone)!.Value.ToUniversalTime());
    }

    [Fact]
    public void An_explicit_offset_is_preserved_on_the_result()
    {
        Assert.Equal(TimeSpan.FromMinutes(330), ZonedTime.Parse("2026-06-01T12:00:00+05:30", Chicago)!.Value.Offset);
    }

    [Fact]
    public void A_time_inside_the_spring_forward_gap_moves_forward_by_the_gap()
    {
        // Chicago skipped 02:00-03:00 on 2026-03-08, so 02:30 becomes 03:30 CDT (08:30Z).
        var parsed = ZonedTime.Parse("2026-03-08T02:30:00", Chicago)!.Value;
        Assert.Equal(Utc("2026-03-08T08:30:00Z"), parsed.ToUniversalTime());
        Assert.Equal(TimeSpan.FromHours(-5), parsed.Offset);
    }

    [Theory]
    [InlineData("2026-03-08T01:59:00", "2026-03-08T07:59:00Z")]
    [InlineData("2026-03-08T03:00:00", "2026-03-08T08:00:00Z")]
    public void Times_either_side_of_the_gap_are_not_moved(string text, string expectedUtc)
    {
        Assert.Equal(Utc(expectedUtc), ZonedTime.Parse(text, Chicago)!.Value.ToUniversalTime());
    }

    [Fact]
    public void An_ambiguous_fall_back_time_takes_the_first_occurrence()
    {
        // Chicago repeats 01:00-02:00 on 2026-11-01; the first 01:30 is CDT (06:30Z), the second is CST (07:30Z).
        var parsed = ZonedTime.Parse("2026-11-01T01:30:00", Chicago)!.Value;
        Assert.Equal(Utc("2026-11-01T06:30:00Z"), parsed.ToUniversalTime());
        Assert.Equal(TimeSpan.FromHours(-5), parsed.Offset);
    }

    [Theory]
    [InlineData("2026-11-01T00:59:00", "2026-11-01T05:59:00Z")]
    [InlineData("2026-11-01T02:00:00", "2026-11-01T08:00:00Z")]
    public void Times_either_side_of_the_ambiguous_hour_use_their_own_offset(string text, string expectedUtc)
    {
        Assert.Equal(Utc(expectedUtc), ZonedTime.Parse(text, Chicago)!.Value.ToUniversalTime());
    }

    [Theory]
    [InlineData("garbage")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("2026-13-01T00:00:00")]
    [InlineData("2026-02-30")]
    [InlineData("2026-06-01T25:00:00")]
    [InlineData("12:00")]
    [InlineData("June 1, 2026")]
    [InlineData("2026-06-01T12:00:00 and more")]
    [InlineData("0001-01-01T00:00:00+05:00")]
    [InlineData("9999-12-31T23:59:59-05:00")]
    public void Garbage_is_null(string? text)
    {
        Assert.Null(ZonedTime.Parse(text, Chicago));
    }

    [Fact]
    public void Surrounding_whitespace_is_ignored()
    {
        Assert.Equal(Utc("2026-06-01T17:00:00Z"), ZonedTime.Parse("  2026-06-01T12:00:00  ", Chicago)!.Value.ToUniversalTime());
    }
}
