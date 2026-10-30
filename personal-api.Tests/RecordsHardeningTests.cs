using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace personal_api.Tests;

public class RecordsHardeningTests
{
    private const string Between = " must be between -1000000000000 and 1000000000000";

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static async Task<string[]> ErrorsAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToArray();
    }

    private static async Task<JsonElement> BodyAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    private static async Task<int> CountAsync(HttpClient client, string query = "") =>
        (await client.GetFromJsonAsync<JsonElement>("/records" + query)).GetArrayLength();

    private static async Task MakeFreeKindAsync(HttpClient client)
    {
        var put = await client.PutAsJsonAsync("/kinds/free", new
        {
            key = "free", displayName = "Free", defaultUnit = (string?)null, valueField = "n",
            fields = new object[] { new { name = "n", type = "Number", required = false } },
        });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
    }

    private static TestApp InZone(string zone) => new TestApp().WithSettings(new() { ["Feed:TimeZone"] = zone });

    // ---- B1: huge numbers ----

    [Theory]
    [InlineData("1000000000000", 1e12)]
    [InlineData("-1000000000000", -1e12)]
    [InlineData("999999999999.5", 999999999999.5)]
    [InlineData("0", 0.0)]
    public async Task A_number_field_at_or_inside_the_limit_is_stored(string literal, double expected)
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await MakeFreeKindAsync(client);

        var response = await client.PostAsync("/records", Json("{\"kind\":\"free\",\"data\":{\"n\":" + literal + "}}"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(expected, (await BodyAsync(response)).GetProperty("value").GetDouble());
    }

    [Theory]
    [InlineData("1000000000000.001")]
    [InlineData("-1000000000000.001")]
    [InlineData("1000000000001")]
    [InlineData("1e13")]
    [InlineData("1e20")]
    [InlineData("1e308")]
    [InlineData("-1e308")]
    [InlineData("1e999")]
    [InlineData("-1e999")]
    [InlineData("99999999999999999999")]
    public async Task A_number_field_beyond_the_limit_is_rejected_and_nothing_is_stored(string literal)
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await MakeFreeKindAsync(client);

        var response = await client.PostAsync("/records", Json("{\"kind\":\"free\",\"data\":{\"n\":" + literal + "}}"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(["n" + Between], await ErrorsAsync(response));
        Assert.Equal(0, await CountAsync(client));
    }

    [Theory]
    [InlineData("1000000000000", true)]
    [InlineData("-1000000000000", true)]
    [InlineData("1000000000000.001", false)]
    [InlineData("-1000000000000.001", false)]
    [InlineData("1e308", false)]
    [InlineData("-1e308", false)]
    public async Task The_value_property_is_limited_the_same_way(string literal, bool accepted)
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var response = await client.PostAsync("/records", Json("{\"kind\":\"note\",\"value\":" + literal + "}"));

        if (accepted)
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        else
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(["value" + Between], await ErrorsAsync(response));
        }
    }

    [Fact]
    public async Task A_value_property_that_overflows_a_double_is_a_client_error()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PostAsync("/records", Json("""{"kind":"note","value":1e999}"""));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    // ---- B3: externalId across kinds ----

    [Fact]
    public async Task The_same_external_id_with_another_kind_is_a_conflict_and_leaves_the_record_alone()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var first = await client.PostAsJsonAsync("/records", new { kind = "note", source = "import", externalId = "dup1", title = "original", data = new { text = "keep me" } });
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await client.PostAsJsonAsync("/records", new { kind = "workout", source = "import", externalId = " dup1 ", title = "changed", data = new { type = "run", duration_min = 30 } });

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal(["externalId 'dup1' from source 'import' is already used by a record of kind 'note'."], await ErrorsAsync(second));
        var rows = await client.GetFromJsonAsync<JsonElement>("/records");
        var row = Assert.Single(rows.EnumerateArray());
        Assert.Equal("note", row.GetProperty("kind").GetString());
        Assert.Equal("original", row.GetProperty("title").GetString()!);
        Assert.Equal((await BodyAsync(first)).GetProperty("id").GetGuid(), row.GetProperty("id").GetGuid());
        Assert.Equal("keep me", row.GetProperty("data").GetProperty("text").GetString());
    }

    [Fact]
    public async Task The_same_external_id_with_the_same_kind_updates_the_record()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await client.PostAsJsonAsync("/records", new { kind = "note", source = "import", externalId = "dup1", title = "one" });

        var again = await client.PostAsJsonAsync("/records", new { kind = "note", source = "import", externalId = "dup1", title = "two" });

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal("two", (await BodyAsync(again)).GetProperty("title").GetString()!);
        Assert.Equal(1, await CountAsync(client));
    }

    [Fact]
    public async Task The_same_external_id_from_another_source_creates_a_new_record_even_for_another_kind()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await client.PostAsJsonAsync("/records", new { kind = "note", source = "import", externalId = "dup1" });

        var other = await client.PostAsJsonAsync("/records", new { kind = "workout", source = "other", externalId = "dup1", data = new { type = "run", duration_min = 30 } });

        Assert.Equal(HttpStatusCode.Created, other.StatusCode);
        Assert.Equal(2, await CountAsync(client));
    }

    // ---- B4: concurrent same externalId ----

    [Fact]
    public async Task Parallel_posts_with_the_same_external_id_create_exactly_one_row()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        for (var round = 0; round < 5; round++)
        {
            var id = $"race-{round}";
            var responses = await Task.WhenAll(Enumerable.Range(0, 20).Select(i =>
                client.PostAsJsonAsync("/records", new { kind = "note", source = "import", externalId = id, title = $"try {i}" })));

            var statuses = responses.Select(r => r.StatusCode).ToList();
            Assert.All(statuses, s => Assert.True(s is HttpStatusCode.OK or HttpStatusCode.Created, $"round {round}: got {s}"));
            Assert.Equal(1, statuses.Count(s => s == HttpStatusCode.Created));
            Assert.Equal(1, await CountAsync(client, $"?limit=500&kind=note&to=2100-01-01T00:00:00Z") - round);
            Assert.Single(responses.Select(r => BodyAsync(r).Result.GetProperty("id").GetGuid()).Distinct());
        }
    }

    // ---- B5: offset-less timestamps ----

    [Theory]
    [InlineData("America/Chicago", "2026-06-01T12:00:00", "2026-06-01T17:00:00Z")]
    [InlineData("America/Chicago", "2026-01-15T12:00:00", "2026-01-15T18:00:00Z")]
    [InlineData("Asia/Tokyo", "2026-06-01T12:00:00", "2026-06-01T03:00:00Z")]
    [InlineData("UTC", "2026-06-01T12:00:00", "2026-06-01T12:00:00Z")]
    [InlineData("America/Chicago", "2026-06-01", "2026-06-01T05:00:00Z")]
    [InlineData("America/Chicago", "2026-03-08T02:30:00", "2026-03-08T08:30:00Z")]
    [InlineData("America/Chicago", "2026-11-01T01:30:00", "2026-11-01T06:30:00Z")]
    [InlineData("America/Chicago", "2026-06-01T12:00:00Z", "2026-06-01T12:00:00Z")]
    [InlineData("America/Chicago", "2026-06-01T12:00:00+05:30", "2026-06-01T06:30:00Z")]
    [InlineData("Asia/Tokyo", "2026-06-01T12:00:00-06:00", "2026-06-01T18:00:00Z")]
    public async Task Occurred_at_without_an_offset_is_read_in_the_feed_time_zone(string zone, string occurredAt, string expectedUtc)
    {
        using var app = InZone(zone);

        var response = await app.CreateClient().PostAsJsonAsync("/records", new { kind = "note", occurredAt });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(DateTimeOffset.Parse(expectedUtc), (await BodyAsync(response)).GetProperty("occurredAt").GetDateTimeOffset());
    }

    [Theory]
    [InlineData("garbage")]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("2026-13-01T00:00:00")]
    [InlineData("2026-06-01T25:00:00")]
    [InlineData("yesterday")]
    public async Task Garbage_occurred_at_is_a_400_naming_the_field(string occurredAt)
    {
        using var app = new TestApp();

        var response = await app.CreateClient().PostAsJsonAsync("/records", new { kind = "note", occurredAt });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(["occurredAt must be an ISO 8601 date and time"], await ErrorsAsync(response));
    }

    [Fact]
    public async Task A_non_string_occurred_at_is_a_client_error()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PostAsync("/records", Json("""{"kind":"note","occurredAt":12345}"""));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_missing_or_null_occurred_at_uses_the_server_clock()
    {
        using var app = InZone("America/Chicago");
        var client = app.CreateClient();

        var missing = await client.PostAsJsonAsync("/records", new { kind = "note" });
        var nullAt = await client.PostAsync("/records", Json("""{"kind":"note","occurredAt":null}"""));

        Assert.Equal(app.Time.GetUtcNow(), (await BodyAsync(missing)).GetProperty("occurredAt").GetDateTimeOffset());
        Assert.Equal(app.Time.GetUtcNow(), (await BodyAsync(nullAt)).GetProperty("occurredAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Records_from_and_to_without_an_offset_are_read_in_the_feed_time_zone()
    {
        using var app = InZone("America/Chicago");
        var client = app.CreateClient();
        await client.PostAsJsonAsync("/records", new { kind = "note", occurredAt = "2026-06-01T04:59:00Z", title = "before" });
        await client.PostAsJsonAsync("/records", new { kind = "note", occurredAt = "2026-06-01T05:00:00Z", title = "midnight" });
        await client.PostAsJsonAsync("/records", new { kind = "note", occurredAt = "2026-06-02T04:59:59Z", title = "last second" });
        await client.PostAsJsonAsync("/records", new { kind = "note", occurredAt = "2026-06-02T05:00:01Z", title = "after" });

        var local = await client.GetFromJsonAsync<JsonElement>("/records?from=2026-06-01&to=2026-06-02");
        var titles = local.EnumerateArray().Select(r => r.GetProperty("title").GetString()!).Order().ToArray();
        Assert.Equal(["last second", "midnight"], titles);

        var explicitUtc = await client.GetFromJsonAsync<JsonElement>("/records?from=2026-06-01T00:00:00Z&to=2026-06-02T00:00:00Z");
        Assert.Equal(["before", "midnight"], explicitUtc.EnumerateArray().Select(r => r.GetProperty("title").GetString()!).Order().ToArray());
    }

    [Fact]
    public async Task Series_from_and_to_without_an_offset_are_read_in_the_feed_time_zone()
    {
        using var app = InZone("America/Chicago");
        var client = app.CreateClient();
        await client.PostAsJsonAsync("/records", new { kind = "note", occurredAt = "2026-06-01T05:00:00Z" });

        var body = await client.GetFromJsonAsync<JsonElement>("/series/note?from=2026-06-01T00:00:00&to=2026-06-02T00:30:00&agg=count");

        var points = body.GetProperty("points").EnumerateArray().ToArray();
        Assert.Equal(["2026-06-01", "2026-06-02"], points.Select(p => p.GetProperty("date").GetString()!).ToArray());
        Assert.Equal(DateTimeOffset.Parse("2026-06-01T05:00:00Z"), points[0].GetProperty("start").GetDateTimeOffset());
        Assert.Equal(1, points[0].GetProperty("count").GetInt32());
    }

    [Theory]
    [InlineData("/records?from=garbage")]
    [InlineData("/records?to=2026-06-01T25:00:00")]
    [InlineData("/series/note?to=garbage")]
    [InlineData("/series/note?from=2026-06-01T25:00:00")]
    [InlineData("/series/note?from=1899-12-31T00:00:00")]
    [InlineData("/series/note?to=2101-01-01T00:00:00")]
    public async Task Bad_or_out_of_range_query_times_are_400(string url)
    {
        using var app = new TestApp();
        var response = await app.CreateClient().GetAsync(url);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Theory]
    [InlineData("/series/note?from=1900-01-01T00:00:00&to=1900-01-02T00:00:00", HttpStatusCode.OK)]
    [InlineData("/series/note?from=2099-12-30T00:00:00&to=2101-01-01T00:00:00", HttpStatusCode.BadRequest)]
    [InlineData("/series/note?from=2099-12-30T00:00:00&to=2100-01-02T00:00:00", HttpStatusCode.OK)]
    public async Task The_supported_year_range_still_applies_to_offset_less_values(string url, HttpStatusCode expected)
    {
        using var app = new TestApp();
        var response = await app.CreateClient().GetAsync(url);
        Assert.Equal(expected, response.StatusCode);
    }
}
