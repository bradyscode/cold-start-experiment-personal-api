using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace personal_api.Tests;

public class ValueFieldTests
{
    private static async Task<JsonElement> PostRecordAsync(HttpClient client, object body)
    {
        var response = await client.PostAsJsonAsync("/records", body);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<string[]> ErrorsAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToArray();
    }

    private static object KindBody(string key, string? valueField) => new
    {
        key,
        displayName = "Thing",
        defaultUnit = (string?)null,
        valueField,
        fields = new object[]
        {
            new { name = "label", type = "Text", required = false },
            new { name = "amount", type = "Number", required = false },
        },
    };

    [Fact]
    public async Task Post_fills_value_from_the_kinds_value_field()
    {
        using var app = new TestApp();
        var created = await PostRecordAsync(app.CreateClient(), new { kind = "range_session", data = new { rounds = 150 } });
        Assert.Equal(150, created.GetProperty("value").GetDouble());
        Assert.Equal("rounds", created.GetProperty("unit").GetString());
    }

    [Fact]
    public async Task Explicit_value_wins_over_the_value_field()
    {
        using var app = new TestApp();
        var created = await PostRecordAsync(app.CreateClient(), new { kind = "range_session", value = 7, data = new { rounds = 150 } });
        Assert.Equal(7, created.GetProperty("value").GetDouble());
    }

    [Fact]
    public async Task Kind_without_value_field_leaves_value_null()
    {
        using var app = new TestApp();
        var created = await PostRecordAsync(app.CreateClient(), new { kind = "note", data = new { text = "hi" } });
        Assert.Equal(JsonValueKind.Null, created.GetProperty("value").ValueKind);
    }

    [Theory]
    [InlineData("label")]
    [InlineData("missing")]
    public async Task Put_kind_rejects_a_value_field_that_is_not_a_number_field(string valueField)
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsJsonAsync("/kinds/bad_value", KindBody("bad_value", valueField));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(await ErrorsAsync(response), e => e.Contains("valueField"));
    }

    [Fact]
    public async Task Value_field_roundtrips_through_the_kinds_endpoints()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var put = await client.PutAsJsonAsync("/kinds/good_value", KindBody("good_value", "amount"));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal("amount", (await put.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("valueField").GetString());

        var kinds = await client.GetFromJsonAsync<JsonElement>("/kinds");
        var saved = kinds.EnumerateArray().Single(k => k.GetProperty("key").GetString() == "good_value");
        Assert.Equal("amount", saved.GetProperty("valueField").GetString());
        var seeded = kinds.EnumerateArray().Single(k => k.GetProperty("key").GetString() == "workout");
        Assert.Equal("duration_min", seeded.GetProperty("valueField").GetString());
    }
}
