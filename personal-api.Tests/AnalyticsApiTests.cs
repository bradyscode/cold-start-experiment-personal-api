using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using personal_api.Domain;
using personal_api.Storage;

namespace personal_api.Tests;

// TestApp's clock is 2026-01-01T00:00Z, so "today" is 2026-01-01 in UTC.
public class AnalyticsApiTests
{
    private static readonly DateTimeOffset Today = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static async Task SaveKindAsync(TestApp app, string key, string? valueField, string? agg, string? better = null, string? unit = "km")
    {
        using var scope = app.Services.CreateScope();
        var fields = valueField is null ? new List<FieldDefinition>() : [new(valueField, FieldType.Number, false)];
        await scope.ServiceProvider.GetRequiredService<IKindStore>()
            .SaveAsync(new KindDefinition(key, key.ToUpperInvariant(), unit, fields, valueField, "Test", agg, better), default);
    }

    private static async Task AddAsync(TestApp app, string kind, DateTimeOffset at, double? value = null)
    {
        using var scope = app.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<IRecordStore>()
            .UpsertAsync(new LifeRecord(Guid.NewGuid(), "test", kind, at, value, null, "t", null, null, at), default);
    }

    private static async Task<JsonElement> GetOkAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"{response.StatusCode}: {text}");
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private static async Task<(HttpStatusCode Status, string[] Errors)> GetErrorAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return (response.StatusCode, doc.RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToArray());
    }

    private static JsonElement KindOf(JsonElement overview, string key) =>
        overview.GetProperty("kinds").EnumerateArray().Single(k => k.GetProperty("kind").GetString() == key);

    private static double?[] Nums(JsonElement array) =>
        array.EnumerateArray().Select(v => v.ValueKind == JsonValueKind.Null ? (double?)null : v.GetDouble()).ToArray();

    private static string[] Strings(JsonElement array) => array.EnumerateArray().Select(v => v.GetString()!).ToArray();

    // ---- overview ----

    [Fact]
    public async Task Overview_sums_the_current_and_previous_periods_for_a_value_kind()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "dist", "km", "sum", "higher");
        await AddAsync(app, "dist", Today.AddHours(-12), 5); // 2025-12-31 12:00
        await AddAsync(app, "dist", Today.AddHours(-11), 2); // same day
        await AddAsync(app, "dist", Today.AddDays(-3), 4);   // 2025-12-29 00:00
        await AddAsync(app, "dist", Today.AddDays(-9), 10);  // previous period (2025-12-23)
        var client = app.CreateClient();

        var body = await GetOkAsync(client, "/analytics/overview?days=7&kinds=dist");

        Assert.Equal(7, body.GetProperty("days").GetInt32());
        Assert.Equal(["2025-12-26", "2025-12-27", "2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01"], Strings(body.GetProperty("dates")));
        Assert.Equal("2025-12-19", Strings(body.GetProperty("previousDates"))[0]);
        Assert.Equal("2025-12-25", Strings(body.GetProperty("previousDates"))[6]);
        var dist = KindOf(body, "dist");
        Assert.Equal("sum", dist.GetProperty("agg").GetString());
        Assert.Equal("km", dist.GetProperty("unit").GetString());
        Assert.Equal("higher", dist.GetProperty("better").GetString());
        Assert.Equal("Test", dist.GetProperty("category").GetString());
        Assert.Equal(11, dist.GetProperty("value").GetDouble());
        Assert.Equal(10, dist.GetProperty("previousValue").GetDouble());
        Assert.Equal(1, dist.GetProperty("delta").GetDouble());
        Assert.Equal(10, dist.GetProperty("deltaPercent").GetDouble(), 9);
        Assert.Equal(11 / 7.0, dist.GetProperty("avgPerDay").GetDouble(), 9);
        Assert.Equal([0d, 0, 0, 4, 0, 7, 0], Nums(dist.GetProperty("values")));
        Assert.Equal([0, 0, 0, 1, 0, 2, 0], dist.GetProperty("counts").EnumerateArray().Select(c => c.GetInt32()));
        Assert.Equal(3, dist.GetProperty("entries").GetInt32());
        Assert.Equal(1, dist.GetProperty("previousEntries").GetInt32());
        Assert.Equal(2, dist.GetProperty("activeDays").GetInt32());
        Assert.Equal("2025-12-31", dist.GetProperty("best").GetProperty("date").GetString());
        Assert.Equal(7, dist.GetProperty("best").GetProperty("value").GetDouble());
        Assert.Equal("2025-12-31", dist.GetProperty("latest").GetProperty("date").GetString());
        Assert.Equal(new DateTimeOffset(2025, 12, 31, 13, 0, 0, TimeSpan.Zero), dist.GetProperty("lastEntryAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Overview_counts_entries_for_kinds_without_a_value_and_has_no_unit()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "ping", null, null, unit: "pages");
        await AddAsync(app, "ping", Today.AddHours(-30), 99);
        await AddAsync(app, "ping", Today.AddHours(-29));
        var body = await GetOkAsync(app.CreateClient(), "/analytics/overview?days=7&kinds=ping");
        var ping = KindOf(body, "ping");
        Assert.Equal("count", ping.GetProperty("agg").GetString());
        Assert.Equal(JsonValueKind.Null, ping.GetProperty("unit").ValueKind);
        Assert.Equal(2, ping.GetProperty("value").GetDouble());
        Assert.Equal(0, ping.GetProperty("previousValue").GetDouble());
        Assert.Equal(JsonValueKind.Null, ping.GetProperty("deltaPercent").ValueKind);
        Assert.Equal(2, ping.GetProperty("delta").GetDouble());
    }

    [Fact]
    public async Task Overview_averages_avg_kinds_and_leaves_empty_days_null()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "wt", "kg", "avg", "none", "kg");
        await AddAsync(app, "wt", Today.AddHours(-12), 80);
        await AddAsync(app, "wt", Today.AddHours(-11), 82);
        await AddAsync(app, "wt", Today.AddHours(-36), 84);
        var body = await GetOkAsync(app.CreateClient(), "/analytics/overview?days=7&kinds=wt");
        var wt = KindOf(body, "wt");
        Assert.Equal("avg", wt.GetProperty("agg").GetString());
        Assert.Equal(82, wt.GetProperty("value").GetDouble(), 9);
        Assert.Equal(JsonValueKind.Null, wt.GetProperty("previousValue").ValueKind);
        Assert.Equal(JsonValueKind.Null, wt.GetProperty("delta").ValueKind);
        Assert.Equal(JsonValueKind.Null, wt.GetProperty("avgPerDay").ValueKind);
        var values = Nums(wt.GetProperty("values"));
        Assert.Equal([null, null, null, null, 84, 81, null], values);
    }

    [Fact]
    public async Task Overview_best_day_is_the_lowest_when_lower_is_better()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "hr", "bpm", "avg", "lower", "bpm");
        await AddAsync(app, "hr", Today.AddHours(-12), 60);
        await AddAsync(app, "hr", Today.AddHours(-36), 52);
        await AddAsync(app, "hr", Today.AddHours(-60), 58);
        var hr = KindOf(await GetOkAsync(app.CreateClient(), "/analytics/overview?days=7&kinds=hr"), "hr");
        Assert.Equal("2025-12-30", hr.GetProperty("best").GetProperty("date").GetString());
        Assert.Equal(52, hr.GetProperty("best").GetProperty("value").GetDouble());
    }

    [Fact]
    public async Task Overview_one_year_spans_two_years_of_days_without_hitting_the_bucket_cap()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "dist", "km", "sum");
        await AddAsync(app, "dist", Today.AddDays(-400).AddHours(1), 3);
        await AddAsync(app, "dist", Today.AddDays(-365).AddHours(1), 1);
        await AddAsync(app, "dist", Today.AddDays(-364).AddHours(1), 2);
        var body = await GetOkAsync(app.CreateClient(), "/analytics/overview?days=365&kinds=dist");
        var dates = Strings(body.GetProperty("dates"));
        var previous = Strings(body.GetProperty("previousDates"));
        Assert.Equal(365, dates.Length);
        Assert.Equal(365, previous.Length);
        Assert.Equal("2026-01-01", dates[^1]);
        Assert.Equal("2025-01-02", dates[0]);
        Assert.Equal("2025-01-01", previous[^1]);
        Assert.Equal(dates.Length, dates.Distinct().Count());
        var dist = KindOf(body, "dist");
        Assert.Equal(2, dist.GetProperty("value").GetDouble());
        Assert.Equal(4, dist.GetProperty("previousValue").GetDouble());
        Assert.Equal(371, body.GetProperty("activityDays").GetInt32());
        Assert.Equal(371, Strings(body.GetProperty("activityDates")).Length);
        Assert.Equal(371, dist.GetProperty("activity").GetArrayLength());
    }

    [Fact]
    public async Task Overview_activity_covers_26_weeks_for_short_ranges_and_totals_all_kinds()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "a", null, null);
        await SaveKindAsync(app, "b", null, null);
        await AddAsync(app, "a", Today.AddDays(-100).AddHours(3));
        await AddAsync(app, "b", Today.AddDays(-100).AddHours(4));
        await AddAsync(app, "b", Today.AddHours(-1));
        var body = await GetOkAsync(app.CreateClient(), "/analytics/overview?days=30&kinds=a,b");
        Assert.Equal(182, body.GetProperty("activityDays").GetInt32());
        var dates = Strings(body.GetProperty("activityDates"));
        var total = body.GetProperty("activityTotal").EnumerateArray().Select(v => v.GetInt32()).ToArray();
        Assert.Equal(182, total.Length);
        Assert.Equal("2026-01-01", dates[^1]);
        Assert.Equal(2, total[Array.IndexOf(dates, Today.AddDays(-100).ToString("yyyy-MM-dd"))]);
        Assert.Equal(1, total[Array.IndexOf(dates, "2025-12-31")]);
        Assert.Equal(3, total.Sum());
    }

    [Fact]
    public async Task Overview_streaks_count_consecutive_days_with_entries()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "a", null, null);
        foreach (var d in new[] { 1, 2, 3, 6, 7, 8, 9, 10 })
            await AddAsync(app, "a", Today.AddDays(-d).AddHours(5));
        var a = KindOf(await GetOkAsync(app.CreateClient(), "/analytics/overview?days=7&kinds=a"), "a");
        Assert.Equal(3, a.GetProperty("currentStreak").GetInt32());
        Assert.Equal(5, a.GetProperty("longestStreak").GetInt32());
    }

    [Fact]
    public async Task Overview_without_kinds_returns_every_kind_and_honours_the_local_time_zone()
    {
        using var app = new TestApp().WithSettings(new() { ["Feed:TimeZone"] = "America/Chicago" });
        await SaveKindAsync(app, "zz", null, null);
        // 22:30 in Chicago on Dec 30, already Dec 31 in UTC.
        await AddAsync(app, "zz", new DateTimeOffset(2025, 12, 31, 4, 30, 0, TimeSpan.Zero));
        var body = await GetOkAsync(app.CreateClient(), "/analytics/overview?days=7");
        Assert.True(body.GetProperty("kinds").GetArrayLength() > 1);
        Assert.Equal("2025-12-31", Strings(body.GetProperty("dates"))[^1]);
        var zz = KindOf(body, "zz");
        Assert.Equal("2025-12-30", zz.GetProperty("latest").GetProperty("date").GetString());
    }

    [Theory]
    [InlineData("/analytics/overview?days=0")]
    [InlineData("/analytics/overview?days=366")]
    [InlineData("/analytics/overview?days=abc")]
    public async Task Overview_rejects_bad_days(string url)
    {
        using var app = new TestApp();
        var (status, errors) = await GetErrorAsync(app.CreateClient(), url);
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains(errors, e => e.Contains("days"));
    }

    [Fact]
    public async Task Unknown_kinds_are_404_with_errors()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        foreach (var url in new[] { "/analytics/overview?kinds=note,nope", "/analytics/compare?kinds=note,nope", "/analytics/pair?a=note&b=nope" })
        {
            var (status, errors) = await GetErrorAsync(client, url);
            Assert.Equal(HttpStatusCode.NotFound, status);
            Assert.Contains(errors, e => e.Contains("nope"));
        }
    }

    // More than SeriesService.MaxRecords (20,000) in one chunk makes the series call throw for this kind only.
    private static async Task SeedTooManyAsync(TestApp app, string kind)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Records.AddRange(Enumerable.Range(0, 20_001).Select(i =>
        {
            var at = Today.AddDays(-2).AddSeconds(i);
            return new LifeRecord(Guid.NewGuid(), "test", kind, at, 1, null, "t", null, null, at);
        }));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Overview_isolates_a_kind_with_too_many_records()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "big", "v", "sum");
        await SaveKindAsync(app, "ok", "v", "sum");
        await SeedTooManyAsync(app, "big");
        await AddAsync(app, "ok", Today.AddHours(-5), 3);
        var client = app.CreateClient();

        foreach (var url in new[] { "/analytics/overview?days=7&kinds=big,ok", "/analytics/overview?days=7" })
        {
            var body = await GetOkAsync(client, url);
            var big = KindOf(body, "big");
            Assert.Equal("Too many records to chart (more than 20,000). Try a shorter range.", big.GetProperty("error").GetString());
            Assert.Equal(JsonValueKind.Null, big.GetProperty("value").ValueKind);
            Assert.Equal(0, big.GetProperty("values").GetArrayLength());
            Assert.Equal(0, big.GetProperty("activity").GetArrayLength());
            var ok = KindOf(body, "ok");
            Assert.Equal(JsonValueKind.Null, ok.GetProperty("error").ValueKind);
            Assert.Equal(3, ok.GetProperty("value").GetDouble());
            Assert.Equal(1, body.GetProperty("activityTotal").EnumerateArray().Sum(v => v.GetInt32()));
        }
    }

    [Fact]
    public async Task Compare_and_pair_name_the_kind_with_too_many_records()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "big", "v", "sum");
        await SaveKindAsync(app, "ok", "v", "sum");
        await SeedTooManyAsync(app, "big");
        var client = app.CreateClient();
        foreach (var url in new[] { "/analytics/compare?kinds=ok,big&days=7", "/analytics/pair?a=ok&b=big&days=7" })
        {
            var (status, errors) = await GetErrorAsync(client, url);
            Assert.Equal(HttpStatusCode.BadRequest, status);
            Assert.Contains(errors, e => e.StartsWith("BIG: ") && e.Contains("20000"));
        }
    }

    // ---- compare ----

    [Fact]
    public async Task Compare_aligns_series_by_date_and_correlates_every_pair()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "a", "v", "sum");
        await SaveKindAsync(app, "b", "v", "sum");
        await SaveKindAsync(app, "c", null, null);
        for (var d = 0; d < 10; d++)
        {
            await AddAsync(app, "a", Today.AddDays(-d).AddHours(-12), d % 3 + 1);
            await AddAsync(app, "b", Today.AddDays(-d).AddHours(-12), 2 * (d % 3 + 1));
        }
        var body = await GetOkAsync(app.CreateClient(), "/analytics/compare?kinds=a,b,c&days=10&bucket=day");

        Assert.Equal("day", body.GetProperty("bucket").GetString());
        var dates = Strings(body.GetProperty("dates"));
        Assert.Equal(10, dates.Length);
        Assert.Equal("2026-01-01", dates[^1]);
        var series = body.GetProperty("series").EnumerateArray().ToArray();
        Assert.Equal(["a", "b", "c"], series.Select(s => s.GetProperty("kind").GetString()));
        foreach (var s in series) Assert.Equal(10, s.GetProperty("values").GetArrayLength());
        Assert.Equal("count", series[2].GetProperty("agg").GetString());

        var pairs = body.GetProperty("pairs").EnumerateArray().ToArray();
        Assert.Equal(3, pairs.Length);
        var ab = pairs.Single(p => p.GetProperty("a").GetString() == "a" && p.GetProperty("b").GetString() == "b");
        // Today's bucket has no records, so it is zero in both and stays on the line b = 2a.
        Assert.Equal(1.0, ab.GetProperty("r").GetDouble(), 9);
        Assert.Equal(10, ab.GetProperty("n").GetInt32());
        Assert.Equal(JsonValueKind.Null, ab.GetProperty("reason").ValueKind);
        var ac = pairs.Single(p => p.GetProperty("b").GetString() == "c" && p.GetProperty("a").GetString() == "a");
        Assert.Equal(JsonValueKind.Null, ac.GetProperty("r").ValueKind);
        // c has never been logged, so there are no days after both started.
        Assert.Equal("fewer than 5 overlapping days", ac.GetProperty("reason").GetString());

        var stats = series[0].GetProperty("stats");
        Assert.Equal(10, stats.GetProperty("n").GetInt32());
        Assert.True(stats.GetProperty("stdDev").GetDouble() > 0);
        Assert.Equal(0, stats.GetProperty("min").GetDouble());
        Assert.Equal(3, stats.GetProperty("max").GetDouble());
    }

    [Fact]
    public async Task Compare_skips_empty_buckets_for_avg_kinds_and_needs_five_overlapping()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "w", "v", "avg");
        await SaveKindAsync(app, "s", "v", "sum");
        for (var d = 1; d <= 4; d++) await AddAsync(app, "w", Today.AddDays(-d).AddHours(1), d);
        await AddAsync(app, "s", Today.AddDays(-2).AddHours(1), 1);
        var body = await GetOkAsync(app.CreateClient(), "/analytics/compare?kinds=w,s&days=30");
        var pair = body.GetProperty("pairs").EnumerateArray().Single();
        // w has values on 4 days, but s only started 2 days ago, so 2 days overlap.
        Assert.Equal(2, pair.GetProperty("n").GetInt32());
        Assert.Equal(JsonValueKind.Null, pair.GetProperty("r").ValueKind);
        Assert.Equal("fewer than 5 overlapping days", pair.GetProperty("reason").GetString());
        var w = body.GetProperty("series").EnumerateArray().First();
        Assert.Equal(4, w.GetProperty("stats").GetProperty("n").GetInt32());
        Assert.Equal(26, Nums(w.GetProperty("values")).Count(v => v is null));
    }

    [Fact]
    public async Task Compare_week_buckets_start_on_monday_and_cover_the_range()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "a", null, null);
        await SaveKindAsync(app, "b", null, null);
        var body = await GetOkAsync(app.CreateClient(), "/analytics/compare?kinds=a,b&days=90&bucket=week");
        var dates = Strings(body.GetProperty("dates"));
        Assert.Equal(13, dates.Length);
        Assert.All(dates, d => Assert.Equal(DayOfWeek.Monday, DateTime.Parse(d).DayOfWeek));
        Assert.Equal("2025-12-29", dates[^1]);
    }

    [Theory]
    [InlineData("/analytics/compare", "kinds")]
    [InlineData("/analytics/compare?kinds=", "kinds")]
    [InlineData("/analytics/compare?kinds=a,b,c,d,e,f,g,h,i,j,k,l,m", "12")]
    [InlineData("/analytics/compare?kinds=note&bucket=month", "bucket")]
    [InlineData("/analytics/compare?kinds=note&days=999", "days")]
    [InlineData("/analytics/pair?a=note", "b")]
    [InlineData("/analytics/pair?a=note&b=note", "different")]
    [InlineData("/analytics/pair?a=note&b=workout&lagMin=3&lagMax=1", "lagMin")]
    [InlineData("/analytics/pair?a=note&b=workout&lagMin=-31", "30")]
    [InlineData("/analytics/pair?a=note&b=workout&lagMax=x", "lag")]
    public async Task Compare_and_pair_reject_bad_input(string url, string fragment)
    {
        using var app = new TestApp();
        var (status, errors) = await GetErrorAsync(app.CreateClient(), url);
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Contains(errors, e => e.Contains(fragment));
    }

    [Fact]
    public async Task Compare_ignores_duplicate_kinds()
    {
        using var app = new TestApp();
        var body = await GetOkAsync(app.CreateClient(), "/analytics/compare?kinds=note,%20note,workout&days=7");
        Assert.Equal(2, body.GetProperty("series").GetArrayLength());
        Assert.Equal(1, body.GetProperty("pairs").GetArrayLength());
    }

    [Fact]
    public async Task Correlation_ignores_days_before_either_tracker_started()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "a", "v", "sum");
        await SaveKindAsync(app, "b", "v", "sum");
        double[] av = [5, 1, 4, 2, 6, 3];
        double[] bv = [2, 6, 1, 5, 3, 4];
        for (var i = 0; i < av.Length; i++)
        {
            await AddAsync(app, "a", Today.AddDays(-(i + 1)).AddHours(1), av[i]);
            await AddAsync(app, "b", Today.AddDays(-(i + 1)).AddHours(1), bv[i]);
        }
        var body = await GetOkAsync(app.CreateClient(), "/analytics/compare?kinds=a,b&days=90");
        var pair = body.GetProperty("pairs").EnumerateArray().Single();
        // With the 84 empty days before both started counted as zeros, r would be about 0.9; from the first entries on, it is 7 days.
        Assert.Equal(7, pair.GetProperty("n").GetInt32());
        Assert.True(Math.Abs(pair.GetProperty("r").GetDouble()) < 0.5);
        // The overlay still shows the whole range, zeros included.
        Assert.Equal(90, body.GetProperty("series")[0].GetProperty("values").GetArrayLength());
        Assert.Equal(0, Nums(body.GetProperty("series")[0].GetProperty("values"))[0]);
    }

    [Fact]
    public async Task Correlation_window_starts_at_the_later_tracker()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "early", null, null);
        await SaveKindAsync(app, "late", null, null);
        // early started long before the range, so the window is set by late's first entry 10 days ago.
        await AddAsync(app, "early", Today.AddDays(-200));
        for (var d = 1; d <= 25; d += 2) await AddAsync(app, "early", Today.AddDays(-d).AddHours(2));
        for (var d = 10; d >= 1; d -= 3) await AddAsync(app, "late", Today.AddDays(-d).AddHours(2));
        var body = await GetOkAsync(app.CreateClient(), "/analytics/compare?kinds=early,late&days=30");
        Assert.Equal(11, body.GetProperty("pairs")[0].GetProperty("n").GetInt32());

        var pair = await GetOkAsync(app.CreateClient(), "/analytics/pair?a=early&b=late&days=30&lagMin=-2&lagMax=0");
        Assert.Equal([9, 10, 11], pair.GetProperty("lags").EnumerateArray().Select(l => l.GetProperty("n").GetInt32()));
    }

    [Fact]
    public async Task A_tracker_with_history_before_the_range_uses_the_whole_range()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "a", null, null);
        await SaveKindAsync(app, "b", null, null);
        await AddAsync(app, "a", Today.AddDays(-100));
        await AddAsync(app, "b", Today.AddDays(-120));
        await AddAsync(app, "a", Today.AddDays(-3).AddHours(2));
        var body = await GetOkAsync(app.CreateClient(), "/analytics/compare?kinds=a,b&days=30");
        Assert.Equal(30, body.GetProperty("pairs")[0].GetProperty("n").GetInt32());
    }

    // ---- pair ----

    [Fact]
    public async Task Pair_returns_aligned_values_a_lag_profile_and_the_best_lag()
    {
        using var app = new TestApp();
        await SaveKindAsync(app, "a", "v", "sum");
        await SaveKindAsync(app, "b", "v", "sum");
        double[] pattern = [1, 5, 2, 8, 3, 9, 4, 7, 6, 10, 2, 5, 8, 1, 9, 3, 6, 2, 7, 4];
        // a on day i, b on day i + 2 with the same value: b follows a two days later.
        for (var i = 0; i < pattern.Length; i++)
        {
            var dayIndex = 29 - (pattern.Length + 2) + i; // keep both inside the last 30 days
            await AddAsync(app, "a", Today.AddDays(-(29 - dayIndex)).AddHours(-12), pattern[i]);
            await AddAsync(app, "b", Today.AddDays(-(29 - dayIndex - 2)).AddHours(-12), pattern[i]);
        }
        var body = await GetOkAsync(app.CreateClient(), "/analytics/pair?a=a&b=b&days=30&bucket=day");

        Assert.Equal(30, Strings(body.GetProperty("dates")).Length);
        Assert.Equal(30, body.GetProperty("a").GetProperty("values").GetArrayLength());
        var lags = body.GetProperty("lags").EnumerateArray().ToArray();
        Assert.Equal(Enumerable.Range(-7, 15), lags.Select(l => l.GetProperty("lag").GetInt32()));
        Assert.Equal(2, body.GetProperty("bestLag").GetInt32());
        var lag2 = lags.Single(l => l.GetProperty("lag").GetInt32() == 2);
        Assert.Equal(1.0, lag2.GetProperty("r").GetDouble(), 9);
        // Both start about 3 weeks ago: 22 day pairs from a's first entry, not the 28 a zero-filled range would give.
        Assert.Equal(22, lag2.GetProperty("n").GetInt32());
        foreach (var l in lags)
            if (l.GetProperty("r").ValueKind == JsonValueKind.Number)
                Assert.InRange(l.GetProperty("r").GetDouble(), -1, 1);
    }

    [Fact]
    public async Task Pair_with_no_data_has_no_best_lag()
    {
        using var app = new TestApp();
        var body = await GetOkAsync(app.CreateClient(), "/analytics/pair?a=note&b=workout&lagMin=-2&lagMax=2");
        Assert.Equal(5, body.GetProperty("lags").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("bestLag").ValueKind);
        Assert.All(body.GetProperty("lags").EnumerateArray(), l => Assert.Equal("fewer than 5 overlapping days", l.GetProperty("reason").GetString()));
    }
}
