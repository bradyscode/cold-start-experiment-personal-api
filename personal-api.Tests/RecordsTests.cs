using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace personal_api.Tests;

public class RecordsTests
{
    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    private static async Task<string[]> ErrorsAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToArray();
    }

    private static async Task<JsonElement> BodyAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    private static async Task<JsonElement> ListAsync(HttpClient client, string query = "") =>
        await client.GetFromJsonAsync<JsonElement>("/records" + query);

    [Fact]
    public async Task Post_valid_record_returns_201_and_defaults_source_to_manual()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var response = await client.PostAsJsonAsync("/records", new { kind = "note", data = new { text = "hello" } });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await BodyAsync(response);
        Assert.Equal("manual", body.GetProperty("source").GetString());
        Assert.Equal("note", body.GetProperty("kind").GetString());
        Assert.Equal(JsonValueKind.Object, body.GetProperty("data").ValueKind);
        Assert.Equal("hello", body.GetProperty("data").GetProperty("text").GetString());
        Assert.NotEqual(Guid.Empty, body.GetProperty("id").GetGuid());
        Assert.Equal(app.Time.GetUtcNow(), body.GetProperty("occurredAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task Post_with_an_out_of_range_number_in_data_is_not_a_server_error()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var response = await client.PostAsync("/records", Json("""{"kind":"range_session","data":{"rounds":1e999}}"""));

        Assert.True((int)response.StatusCode < 500, $"got {(int)response.StatusCode}");
        if (response.StatusCode == HttpStatusCode.Created)
            Assert.Equal(JsonValueKind.Null, (await BodyAsync(response)).GetProperty("value").ValueKind);
    }

    [Fact]
    public async Task Post_applies_title_and_unit_defaults_and_trims_fields()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var response = await client.PostAsJsonAsync("/records", new
        {
            kind = " range_session ",
            source = "  ",
            title = " ",
            unit = "",
            externalId = "   ",
            occurredAt = "2026-03-05T23:30:00-05:00",
            data = new { rounds = 3 },
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await BodyAsync(response);
        Assert.Equal("manual", body.GetProperty("source").GetString());
        Assert.Equal("range_session", body.GetProperty("kind").GetString());
        Assert.Equal("2026-03-06", body.GetProperty("title").GetString()!.Split(' ')[^1]);
        Assert.StartsWith("Range", body.GetProperty("title").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("externalId").ValueKind);
    }

    [Fact]
    public async Task Post_blank_unit_falls_back_to_kind_default_unit()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/kinds/with_unit",
            new { key = "with_unit", displayName = "With Unit", defaultUnit = "km", fields = Array.Empty<object>() })).StatusCode);

        var response = await client.PostAsJsonAsync("/records", new { kind = "with_unit", unit = " " });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("km", (await BodyAsync(response)).GetProperty("unit").GetString());
        Assert.Equal("With Unit " + app.Time.GetUtcNow().ToString("yyyy-MM-dd"), (await BodyAsync(await client.PostAsJsonAsync("/records", new { kind = "with_unit" }))).GetProperty("title").GetString());
    }

    [Fact]
    public async Task Post_unknown_kind_returns_400_with_message()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PostAsJsonAsync("/records", new { kind = "nope_kind" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(await ErrorsAsync(response), e => e.Contains("nope_kind"));
    }

    [Theory]
    [InlineData("null")]
    [InlineData("{not json")]
    [InlineData("{}")]
    [InlineData("{\"kind\":null}")]
    [InlineData("{\"kind\":\"  \"}")]
    public async Task Post_with_bad_body_or_blank_kind_returns_400(string json)
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PostAsync("/records", Json(json));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Fact]
    public async Task Post_missing_required_kind_field_returns_400_naming_the_field()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PostAsJsonAsync("/records", new { kind = "range_session", data = new { } });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(await ErrorsAsync(response), e => e.Contains("rounds"));
    }

    [Fact]
    public async Task Post_same_source_and_externalId_twice_returns_201_then_200_and_one_row()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var first = await client.PostAsJsonAsync("/records", new { kind = "note", source = "import", externalId = "abc", title = "one" });
        var second = await client.PostAsJsonAsync("/records", new { kind = "note", source = "import", externalId = " abc ", title = "two" });

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        var rows = await ListAsync(client);
        Assert.Equal(1, rows.GetArrayLength());
        Assert.Equal("two", rows[0].GetProperty("title").GetString());
        Assert.Equal((await BodyAsync(first)).GetProperty("id").GetGuid(), (await BodyAsync(second)).GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task Post_data_that_is_an_array_returns_400()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PostAsync("/records", Json("{\"kind\":\"note\",\"data\":[1,2]}"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Theory]
    [InlineData("\"text\"")]
    [InlineData("42")]
    public async Task Post_data_that_is_a_scalar_returns_400(string data)
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PostAsync("/records", Json($"{{\"kind\":\"note\",\"data\":{data}}}"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_data_over_16KB_returns_400()
    {
        using var app = new TestApp();
        var data = "{\"text\":\"" + new string('x', 17000) + "\"}";
        var response = await app.CreateClient().PostAsync("/records", Json($"{{\"kind\":\"note\",\"data\":{data}}}"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Fact]
    public async Task Post_data_just_under_16KB_is_accepted()
    {
        using var app = new TestApp();
        var data = "{\"text\":\"" + new string('x', 16000) + "\"}";
        var response = await app.CreateClient().PostAsync("/records", Json($"{{\"kind\":\"note\",\"data\":{data}}}"));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Theory]
    [InlineData("source", 65)]
    [InlineData("kind", 65)]
    [InlineData("title", 201)]
    [InlineData("unit", 33)]
    [InlineData("externalId", 201)]
    public async Task Post_over_length_field_returns_400(string field, int length)
    {
        using var app = new TestApp();
        var values = new Dictionary<string, object?> { ["kind"] = "note", [field] = new string('a', length) };
        var response = await app.CreateClient().PostAsJsonAsync("/records", values);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Fact]
    public async Task Offset_timestamp_roundtrips_as_same_instant()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var instant = new DateTimeOffset(2026, 5, 1, 12, 0, 0, TimeSpan.FromHours(2));

        var response = await client.PostAsJsonAsync("/records", new { kind = "note", occurredAt = "2026-05-01T12:00:00+02:00" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(instant, (await BodyAsync(response)).GetProperty("occurredAt").GetDateTimeOffset());

        var rows = await ListAsync(client);
        var stored = rows[0].GetProperty("occurredAt").GetDateTimeOffset();
        Assert.Equal(instant, stored);
        Assert.Equal(TimeSpan.Zero, stored.Offset);
    }

    private static async Task PostAsync(HttpClient client, string kind, string at, object? data = null)
    {
        var r = await client.PostAsJsonAsync("/records", new { kind, occurredAt = at, data });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
    }

    [Fact]
    public async Task Get_filters_by_kind_and_range_and_orders_newest_first()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await PostAsync(client, "note", "2026-01-01T00:00:00Z");
        await PostAsync(client, "note", "2026-01-03T00:00:00Z");
        await PostAsync(client, "note", "2026-01-02T00:00:00Z");
        await PostAsync(client, "range_session", "2026-01-02T12:00:00Z", new { rounds = 2 });

        var all = await ListAsync(client, "?kind=note");
        Assert.Equal(new[] { 3, 2, 1 }, all.EnumerateArray().Select(r => r.GetProperty("occurredAt").GetDateTimeOffset().Day).ToArray());

        var ranged = await ListAsync(client, "?kind=note&from=2026-01-02T00:00:00Z&to=2026-01-03T00:00:00Z");
        Assert.Equal(2, ranged.GetArrayLength());

        var everything = await ListAsync(client);
        Assert.Equal(4, everything.GetArrayLength());
        Assert.Equal("range_session", (await ListAsync(client, "?kind=range_session"))[0].GetProperty("kind").GetString());
        Assert.Equal(JsonValueKind.Object, (await ListAsync(client, "?kind=range_session"))[0].GetProperty("data").ValueKind);
    }

    [Fact]
    public async Task Get_limit_above_500_is_clamped()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        for (var i = 0; i < 501; i++)
            Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/records", new { kind = "note", externalId = $"e{i}" })).StatusCode);

        Assert.Equal(500, (await ListAsync(client, "?limit=10000")).GetArrayLength());
        Assert.Equal(100, (await ListAsync(client)).GetArrayLength());
        Assert.Equal(100, (await ListAsync(client, "?limit=0")).GetArrayLength());
        Assert.Equal(5, (await ListAsync(client, "?limit=5")).GetArrayLength());
    }

    [Fact]
    public async Task Get_from_after_to_returns_400()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().GetAsync("/records?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }
}
