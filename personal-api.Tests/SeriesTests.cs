using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using personal_api.Domain;
using personal_api.Storage;

namespace personal_api.Tests;

public class SeriesTests
{
    private static async Task PostAsync(HttpClient client, string occurredAt, double? value, string kind = "note")
    {
        var response = await client.PostAsJsonAsync("/records", new { kind, occurredAt, value });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task<JsonElement> SeriesAsync(HttpClient client, string query, string kind = "note")
    {
        var response = await client.GetAsync($"/series/{kind}?{query}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static JsonElement[] Points(JsonElement body) => body.GetProperty("points").EnumerateArray().ToArray();

    private static async Task<string[]> ErrorsAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToArray();
    }

    [Fact]
    public async Task Day_buckets_sum_values_and_fill_empty_days()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await PostAsync(client, "2026-03-01T10:00:00Z", 2);
        await PostAsync(client, "2026-03-01T15:00:00Z", 3);
        await PostAsync(client, "2026-03-03T08:00:00Z", 4);

        var body = await SeriesAsync(client, "from=2026-03-01T00:00:00Z&to=2026-03-03T12:00:00Z");

        Assert.Equal("note", body.GetProperty("kind").GetString());
        Assert.Equal("day", body.GetProperty("bucket").GetString());
        Assert.Equal("sum", body.GetProperty("agg").GetString());
        var points = Points(body);
        Assert.Equal([5d, 0d, 4d], points.Select(p => p.GetProperty("value").GetDouble()));
        Assert.Equal([2, 0, 1], points.Select(p => p.GetProperty("count").GetInt32()));
        Assert.Equal(new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero), points[0].GetProperty("start").GetDateTimeOffset());
        Assert.Equal(new DateTimeOffset(2026, 3, 3, 0, 0, 0, TimeSpan.Zero), points[2].GetProperty("start").GetDateTimeOffset());
    }

    [Fact]
    public async Task Avg_and_max_use_null_for_empty_buckets()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await PostAsync(client, "2026-03-01T10:00:00Z", 2);
        await PostAsync(client, "2026-03-01T15:00:00Z", 4);
        await PostAsync(client, "2026-03-01T16:00:00Z", null);

        var avg = Points(await SeriesAsync(client, "from=2026-03-01T00:00:00Z&to=2026-03-02T12:00:00Z&agg=avg"));
        Assert.Equal(3d, avg[0].GetProperty("value").GetDouble());
        Assert.Equal(3, avg[0].GetProperty("count").GetInt32());
        Assert.Equal(JsonValueKind.Null, avg[1].GetProperty("value").ValueKind);
        Assert.Equal(0, avg[1].GetProperty("count").GetInt32());

        var max = Points(await SeriesAsync(client, "from=2026-03-01T00:00:00Z&to=2026-03-02T12:00:00Z&agg=MAX"));
        Assert.Equal(4d, max[0].GetProperty("value").GetDouble());
        Assert.Equal(JsonValueKind.Null, max[1].GetProperty("value").ValueKind);
    }

    [Fact]
    public async Task Count_agg_ignores_values()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await PostAsync(client, "2026-03-01T10:00:00Z", 100);
        await PostAsync(client, "2026-03-01T11:00:00Z", null);

        var body = await SeriesAsync(client, "from=2026-03-01T00:00:00Z&to=2026-03-02T12:00:00Z&agg=count");

        Assert.Equal("count", body.GetProperty("agg").GetString());
        var points = Points(body);
        Assert.Equal([2d, 0d], points.Select(p => p.GetProperty("value").GetDouble()));
        Assert.Equal([2, 0], points.Select(p => p.GetProperty("count").GetInt32()));
    }

    [Fact]
    public async Task Week_buckets_start_on_Monday()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await PostAsync(client, "2026-03-01T10:00:00Z", 1); // Sunday, belongs to the week of Feb 23
        await PostAsync(client, "2026-03-02T10:00:00Z", 2); // Monday
        await PostAsync(client, "2026-03-08T23:00:00Z", 4); // Sunday of the same week

        var body = await SeriesAsync(client, "from=2026-03-01T00:00:00Z&to=2026-03-10T00:00:00Z&bucket=week");

        Assert.Equal("week", body.GetProperty("bucket").GetString());
        var points = Points(body);
        Assert.Equal(
            [new DateTimeOffset(2026, 2, 23, 0, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 3, 2, 0, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 3, 9, 0, 0, 0, TimeSpan.Zero)],
            points.Select(p => p.GetProperty("start").GetDateTimeOffset()));
        Assert.Equal([1d, 6d, 0d], points.Select(p => p.GetProperty("value").GetDouble()));
    }

    [Fact]
    public async Task Time_zone_moves_a_late_evening_record_to_the_local_day()
    {
        using var app = new TestApp().WithSettings(new() { ["Feed:TimeZone"] = "America/Chicago" });
        var client = app.CreateClient();
        await PostAsync(client, "2026-03-05T23:30:00-05:00", 7); // 22:30 Chicago on Mar 5, already Mar 6 in UTC

        var points = Points(await SeriesAsync(client, "from=2026-03-05T12:00:00Z&to=2026-03-06T12:00:00Z"));

        Assert.Equal(2, points.Length);
        Assert.Equal(new DateTimeOffset(2026, 3, 5, 6, 0, 0, TimeSpan.Zero), points[0].GetProperty("start").GetDateTimeOffset());
        Assert.Equal(7d, points[0].GetProperty("value").GetDouble());
        Assert.Equal(1, points[0].GetProperty("count").GetInt32());
        Assert.Equal(0, points[1].GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task Day_buckets_stay_one_per_local_day_across_a_DST_change()
    {
        using var app = new TestApp().WithSettings(new() { ["Feed:TimeZone"] = "America/Chicago" });
        var client = app.CreateClient();

        var points = Points(await SeriesAsync(client, "from=2026-03-07T12:00:00Z&to=2026-03-09T20:00:00Z"));

        Assert.Equal(
            [new DateTimeOffset(2026, 3, 7, 6, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 3, 8, 6, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 3, 9, 5, 0, 0, TimeSpan.Zero)],
            points.Select(p => p.GetProperty("start").GetDateTimeOffset()));
    }

    private static string[] Dates(JsonElement[] points) => points.Select(p => p.GetProperty("date").GetString()!).ToArray();

    [Fact]
    public async Task Points_carry_a_date_property_matching_the_UTC_day()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var points = Points(await SeriesAsync(client, "from=2026-03-01T10:00:00Z&to=2026-03-03T12:00:00Z"));

        Assert.True(points[0].TryGetProperty("date", out _));
        Assert.Equal(["2026-03-01", "2026-03-02", "2026-03-03"], Dates(points));
    }

    [Fact]
    public async Task Date_is_the_local_day_and_differs_from_the_UTC_date_of_start_in_Chicago()
    {
        using var app = new TestApp().WithSettings(new() { ["Feed:TimeZone"] = "America/Chicago" });
        var client = app.CreateClient();
        await PostAsync(client, "2026-03-05T23:30:00-05:00", 7);

        var points = Points(await SeriesAsync(client, "from=2026-03-05T12:00:00Z&to=2026-03-06T12:00:00Z"));

        Assert.Equal(["2026-03-05", "2026-03-06"], Dates(points));
        Assert.Equal(1, points[0].GetProperty("count").GetInt32());
        Assert.Equal(new DateTime(2026, 3, 5), points[0].GetProperty("start").GetDateTimeOffset().UtcDateTime.Date);
        Assert.Equal("2026-03-05", points[0].GetProperty("date").GetString());
        var winter = Points(await SeriesAsync(client, "from=2025-12-20T12:00:00Z&to=2025-12-20T13:00:00Z"));
        Assert.Equal(new DateTimeOffset(2025, 12, 20, 6, 0, 0, TimeSpan.Zero), winter[0].GetProperty("start").GetDateTimeOffset());
        Assert.Equal(["2025-12-20"], Dates(winter));
    }

    [Fact]
    public async Task Dates_have_no_gaps_or_duplicates_across_spring_forward()
    {
        using var app = new TestApp().WithSettings(new() { ["Feed:TimeZone"] = "America/Chicago" });
        var client = app.CreateClient();

        var points = Points(await SeriesAsync(client, "from=2026-03-06T12:00:00Z&to=2026-03-11T12:00:00Z"));

        Assert.Equal(["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11"], Dates(points));
    }

    [Fact]
    public async Task Week_dates_are_the_local_Monday()
    {
        using var app = new TestApp().WithSettings(new() { ["Feed:TimeZone"] = "America/Chicago" });
        var client = app.CreateClient();

        // Sun Mar 8 03:00Z is still Sat Mar 7 in Chicago, so the first week starts Mon Mar 2.
        var points = Points(await SeriesAsync(client, "from=2026-03-08T03:00:00Z&to=2026-03-17T12:00:00Z&bucket=week"));

        Assert.Equal(["2026-03-02", "2026-03-09", "2026-03-16"], Dates(points));
    }

    [Fact]
    public async Task Date_is_the_local_day_in_a_zone_ahead_of_UTC()
    {
        using var app = new TestApp().WithSettings(new() { ["Feed:TimeZone"] = "Asia/Tokyo" });
        var client = app.CreateClient();

        var points = Points(await SeriesAsync(client, "from=2026-03-05T20:00:00Z&to=2026-03-06T20:00:00Z"));

        Assert.Equal(new DateTimeOffset(2026, 3, 5, 15, 0, 0, TimeSpan.Zero), points[0].GetProperty("start").GetDateTimeOffset());
        Assert.Equal(["2026-03-06", "2026-03-07"], Dates(points));
    }

    [Fact]
    public async Task Empty_range_returns_all_empty_buckets_not_an_error()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var sum = Points(await SeriesAsync(client, "from=2026-03-01T00:00:00Z&to=2026-03-03T12:00:00Z"));
        Assert.Equal(3, sum.Length);
        Assert.All(sum, p =>
        {
            Assert.Equal(0d, p.GetProperty("value").GetDouble());
            Assert.Equal(0, p.GetProperty("count").GetInt32());
        });

        var avg = Points(await SeriesAsync(client, "from=2026-03-01T00:00:00Z&to=2026-03-03T12:00:00Z&agg=avg"));
        Assert.All(avg, p => Assert.Equal(JsonValueKind.Null, p.GetProperty("value").ValueKind));
    }

    [Fact]
    public async Task Defaults_cover_the_last_30_days_up_to_now()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var points = Points(await SeriesAsync(client, ""));

        Assert.Equal(31, points.Length);
        Assert.Equal(app.Time.GetUtcNow().Date, points[^1].GetProperty("start").GetDateTimeOffset().UtcDateTime);
    }

    [Fact]
    public async Task Unit_comes_from_the_kind()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var kinds = await client.GetFromJsonAsync<JsonElement>("/kinds");
        var withUnit = kinds.EnumerateArray().First(k => k.GetProperty("defaultUnit").ValueKind == JsonValueKind.String);

        var body = await SeriesAsync(client, "from=2026-03-01T00:00:00Z&to=2026-03-01T12:00:00Z", withUnit.GetProperty("key").GetString()!);

        Assert.Equal(withUnit.GetProperty("defaultUnit").GetString(), body.GetProperty("unit").GetString());
    }

    [Fact]
    public async Task Count_agg_has_no_unit_but_sum_keeps_the_kind_unit()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var range = "from=2026-03-01T00:00:00Z&to=2026-03-01T12:00:00Z";

        var count = await SeriesAsync(client, range + "&agg=count", "range_session");
        var sum = await SeriesAsync(client, range + "&agg=sum", "range_session");

        Assert.Equal(JsonValueKind.Null, count.GetProperty("unit").ValueKind);
        Assert.Equal("rounds", sum.GetProperty("unit").GetString());
    }

    [Fact]
    public async Task Unknown_kind_returns_404()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var response = await client.GetAsync("/series/nope");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(["Unknown kind 'nope'"], await ErrorsAsync(response));
    }

    [Theory]
    [InlineData("bucket=month")]
    [InlineData("agg=median")]
    [InlineData("from=not-a-date")]
    [InlineData("bucket=day,week")]
    [InlineData("agg=sum,avg")]
    [InlineData("bucket=1")]
    [InlineData("from=0001-01-01T00:00:00Z")]
    [InlineData("to=9999-12-31T23:59:59Z")]
    [InlineData("from=0001-01-01T00:00:00Z&to=9999-12-31T23:59:59Z")]
    public async Task Bad_bucket_or_agg_returns_400(string query)
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var response = await client.GetAsync($"/series/note?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Fact]
    public async Task More_than_400_buckets_returns_400()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var tooMany = await client.GetAsync("/series/note?from=2025-01-01T00:00:00Z&to=2026-03-01T00:00:00Z");
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(tooMany));

        var exactly400 = await client.GetAsync("/series/note?from=2025-01-01T00:00:00Z&to=2026-02-04T00:00:00Z");
        Assert.Equal(HttpStatusCode.OK, exactly400.StatusCode);
    }

    private static async Task SeedAsync(TestApp app, int count)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var at = new DateTimeOffset(2026, 3, 1, 10, 0, 0, TimeSpan.Zero);
        db.Records.AddRange(Enumerable.Range(0, count).Select(i =>
            new LifeRecord(Guid.NewGuid(), "test", "note", at.AddSeconds(i), 1, null, "n", null, null, at)));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task More_than_20000_records_in_range_returns_400()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await SeedAsync(app, 20001);

        var response = await client.GetAsync("/series/note?from=2026-03-01T00:00:00Z&to=2026-03-02T00:00:00Z");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(["Too many records in this range (more than 20000). Narrow the date range."], await ErrorsAsync(response));
    }

    [Fact]
    public async Task Exactly_20000_records_in_range_returns_200()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await SeedAsync(app, 20000);

        var body = await SeriesAsync(client, "from=2026-03-01T00:00:00Z&to=2026-03-02T00:00:00Z");

        Assert.Equal(20000, Points(body).Sum(p => p.GetProperty("count").GetInt32()));
    }

    [Fact]
    public async Task From_after_to_returns_400()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var response = await client.GetAsync("/series/note?from=2026-03-02T00:00:00Z&to=2026-03-01T00:00:00Z");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Fact]
    public void Invalid_time_zone_fails_at_startup()
    {
        using var app = new TestApp().WithSettings(new() { ["Feed:TimeZone"] = "Mars/Olympus" });

        var ex = Assert.ThrowsAny<Exception>(() => app.CreateClient());

        Assert.Contains("Feed:TimeZone", ex.ToString());
    }
}
