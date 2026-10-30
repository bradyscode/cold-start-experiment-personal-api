using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using personal_api.Domain;
using personal_api.Kinds;

namespace personal_api.Tests;

public class KindsTests
{
    private static object Kind(string key, object[]? fields = null) =>
        new { key, displayName = "Thing", defaultUnit = (string?)null, fields };

    private static object Field(string name, string type = "Text", bool required = false, string[]? options = null) =>
        new { name, type, required, options };

    private static async Task<string[]> ErrorsAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToArray();
    }

    [Fact]
    public async Task Get_kinds_lists_the_seeded_kinds()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var kinds = await client.GetFromJsonAsync<JsonElement>("/kinds");
        var keys = kinds.EnumerateArray().Select(k => k.GetProperty("key").GetString()).ToList();
        Assert.Contains("note", keys);
        Assert.Contains("range_session", keys);
        Assert.Contains("workout", keys);
        Assert.Contains("book_finished", keys);
        var rangeSession = kinds.EnumerateArray().Single(k => k.GetProperty("key").GetString() == "range_session");
        Assert.Equal("Number", rangeSession.GetProperty("fields")[0].GetProperty("type").GetString());
    }

    [Fact]
    public async Task Put_kind_creates_a_new_kind_that_Get_returns()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var body = Kind("woodworking_project", [Field("hours", "Number", true), Field("wood", "Choice", options: ["oak", "pine"])]);

        var put = await client.PutAsJsonAsync("/kinds/woodworking_project", body);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var kinds = await client.GetFromJsonAsync<JsonElement>("/kinds");
        var saved = kinds.EnumerateArray().Single(k => k.GetProperty("key").GetString() == "woodworking_project");
        Assert.Equal(2, saved.GetProperty("fields").GetArrayLength());
        Assert.Equal("Choice", saved.GetProperty("fields")[1].GetProperty("type").GetString());
    }

    [Fact]
    public async Task Put_kind_with_no_fields_is_valid()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/kinds/empty_one", Kind("empty_one"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/kinds/empty_two", Kind("empty_two", []))).StatusCode);
    }

    [Fact]
    public async Task Put_with_mismatched_key_returns_400()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsJsonAsync("/kinds/one_key", Kind("other_key"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Theory]
    [InlineData("Bad")]
    [InlineData("1abc")]
    [InlineData("a")]
    [InlineData("has-dash")]
    public async Task Put_with_invalid_key_returns_400(string key)
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsJsonAsync($"/kinds/{key}", Kind(key));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Fact]
    public async Task Put_with_null_body_returns_400()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsync("/kinds/some_kind", new StringContent("null", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_with_unparseable_body_returns_400()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsync("/kinds/some_kind", new StringContent("{not json", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_with_duplicate_field_names_returns_400()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsJsonAsync("/kinds/dupes", Kind("dupes", [Field("a"), Field("a", "Number")]));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Fact]
    public async Task Put_with_blank_field_name_returns_400()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsJsonAsync("/kinds/blank", Kind("blank", [Field("  ")]));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Put_with_choice_field_lacking_options_returns_400(bool emptyList)
    {
        using var app = new TestApp();
        var field = Field("pick", "Choice", options: emptyList ? [] : null);
        var response = await app.CreateClient().PutAsJsonAsync("/kinds/choosy", Kind("choosy", [field]));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.NotEmpty(await ErrorsAsync(response));
    }

    [Fact]
    public async Task Seeder_does_not_overwrite_an_edited_kind()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var edited = Kind("workout", [Field("only_field")]);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/kinds/workout", edited)).StatusCode);

        using (var scope = app.Services.CreateScope())
            await KindSeeder.SeedAsync(scope.ServiceProvider.GetRequiredService<IKindStore>(), CancellationToken.None);

        var kinds = await client.GetFromJsonAsync<JsonElement>("/kinds");
        var workout = kinds.EnumerateArray().Single(k => k.GetProperty("key").GetString() == "workout");
        Assert.Equal(1, workout.GetProperty("fields").GetArrayLength());
        Assert.Equal("only_field", workout.GetProperty("fields")[0].GetProperty("name").GetString());
    }

    private static async Task AssertRejectedAndNotSavedAsync(HttpClient client, string key, string json, string? errorFragment = null)
    {
        var response = await client.PutAsync($"/kinds/{key}", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsAsync(response);
        if (errorFragment is not null)
            Assert.Contains(errors, e => e.Contains(errorFragment, StringComparison.OrdinalIgnoreCase));
        var kinds = await client.GetFromJsonAsync<JsonElement>("/kinds");
        Assert.DoesNotContain(kinds.EnumerateArray(), k => k.GetProperty("key").GetString() == key);
    }

    [Fact]
    public async Task Put_with_undefined_field_type_returns_400_naming_the_field()
    {
        using var app = new TestApp();
        await AssertRejectedAndNotSavedAsync(app.CreateClient(), "bad_type",
            """{"key":"bad_type","displayName":"Thing","fields":[{"name":"weird","type":99,"required":false}]}""", "weird");
    }

    [Fact]
    public async Task Put_with_missing_displayName_returns_400_and_saves_nothing()
    {
        using var app = new TestApp();
        await AssertRejectedAndNotSavedAsync(app.CreateClient(), "no_name", "{\"key\":\"no_name\",\"fields\":[]}", "displayName");
    }

    [Fact]
    public async Task Put_with_null_displayName_returns_400_and_saves_nothing()
    {
        using var app = new TestApp();
        await AssertRejectedAndNotSavedAsync(app.CreateClient(), "null_name", "{\"key\":\"null_name\",\"displayName\":null}", "displayName");
    }

    [Fact]
    public async Task Put_with_blank_displayName_returns_400_and_saves_nothing()
    {
        using var app = new TestApp();
        await AssertRejectedAndNotSavedAsync(app.CreateClient(), "blank_name", "{\"key\":\"blank_name\",\"displayName\":\"   \"}", "displayName");
    }

    [Fact]
    public async Task Put_with_too_long_key_returns_400()
    {
        using var app = new TestApp();
        var key = "a" + new string('b', 41);
        await AssertRejectedAndNotSavedAsync(app.CreateClient(), key, System.Text.Json.JsonSerializer.Serialize(Kind(key)));
    }

    [Fact]
    public async Task Put_with_uppercase_key_matching_body_returns_400()
    {
        using var app = new TestApp();
        await AssertRejectedAndNotSavedAsync(app.CreateClient(), "Upper_Case", System.Text.Json.JsonSerializer.Serialize(Kind("Upper_Case")));
    }
}
