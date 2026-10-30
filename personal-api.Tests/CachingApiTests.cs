using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using personal_api.Caching;
using Microsoft.Extensions.DependencyInjection;

namespace personal_api.Tests;

public class CachingApiTests
{
    private static async Task<JsonElement> GetJsonAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static async Task PostNoteAsync(HttpClient client, string title)
    {
        var response = await client.PostAsJsonAsync("/records", new { kind = "note", title });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Repeated_reads_hit_the_cache()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        await GetJsonAsync(client, "/records?limit=10");
        await GetJsonAsync(client, "/records?limit=10");
        await GetJsonAsync(client, "/feed");
        await GetJsonAsync(client, "/feed");

        var stats = (await GetJsonAsync(client, "/cache/stats")).GetProperty("stats");
        Assert.True(stats.GetProperty("hits").GetInt64() >= 2);
    }

    [Fact]
    public async Task A_new_record_is_visible_immediately_after_a_cached_read()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        Assert.Empty((await GetJsonAsync(client, "/records?kind=note")).EnumerateArray());

        await PostNoteAsync(client, "first");

        var titles = (await GetJsonAsync(client, "/records?kind=note")).EnumerateArray().Select(r => r.GetProperty("title").GetString());
        Assert.Equal(["first"], titles);
    }

    [Fact]
    public async Task Saving_a_kind_is_visible_immediately_after_a_cached_read()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var before = (await GetJsonAsync(client, "/kinds")).GetArrayLength();

        var save = await client.PutAsJsonAsync("/kinds/cache_probe", new { key = "cache_probe", displayName = "Cache probe", fields = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);

        Assert.Equal(before + 1, (await GetJsonAsync(client, "/kinds")).GetArrayLength());
        var created = await client.PostAsJsonAsync("/records", new { kind = "cache_probe", title = "x" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
    }

    [Fact]
    public async Task A_cached_analytics_result_is_replaced_after_a_write()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var first = await GetJsonAsync(client, "/analytics/overview?days=30");
        await PostNoteAsync(client, "x");

        var second = await GetJsonAsync(client, "/analytics/overview?days=30");

        Assert.NotEqual(first.GetRawText(), second.GetRawText());
    }

    [Fact]
    public async Task Cached_results_expire_after_the_ttl()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await GetJsonAsync(client, "/feed");
        var before = (await GetJsonAsync(client, "/cache/stats")).GetProperty("stats").GetProperty("misses").GetInt64();

        app.Time.Advance(TimeSpan.FromSeconds(31));
        await GetJsonAsync(client, "/feed");

        var after = (await GetJsonAsync(client, "/cache/stats")).GetProperty("stats").GetProperty("misses").GetInt64();
        Assert.True(after > before);
    }

    [Fact]
    public async Task Disabling_the_cache_registers_no_cache_and_everything_still_works()
    {
        using var app = new TestApp().WithSettings(new() { ["Cache:Enabled"] = "false" });
        var client = app.CreateClient();

        await PostNoteAsync(client, "plain");

        Assert.Single((await GetJsonAsync(client, "/records?kind=note")).EnumerateArray());
        Assert.False((await GetJsonAsync(client, "/cache/stats")).GetProperty("enabled").GetBoolean());
        Assert.Null(app.Services.GetService<IReadCache>());
    }

    [Fact]
    public async Task Invalid_cache_settings_stop_the_app_from_starting()
    {
        using var app = new TestApp().WithSettings(new() { ["Cache:TtlSeconds"] = "0" });
        Assert.ThrowsAny<Exception>(() => app.CreateClient());
        await Task.CompletedTask;
    }
}
