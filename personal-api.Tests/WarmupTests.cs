using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using personal_api.Caching;

namespace personal_api.Tests;

public class WarmupTests
{
    private static async Task<JsonElement> StatsAsync(HttpClient client)
    {
        var response = await client.GetAsync("/cache/stats");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone().GetProperty("stats");
    }

    [Fact]
    public async Task The_first_requests_are_served_from_a_cache_filled_at_startup()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var before = await StatsAsync(client);

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/feed")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/analytics/overview?days=30")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/kinds")).StatusCode);

        var after = await StatsAsync(client);
        Assert.Equal(before.GetProperty("misses").GetInt64(), after.GetProperty("misses").GetInt64());
        Assert.True(after.GetProperty("hits").GetInt64() >= before.GetProperty("hits").GetInt64() + 3);
    }

    [Fact]
    public async Task Disabling_the_warmup_leaves_the_cache_empty_at_startup()
    {
        using var app = new TestApp().WithSettings(new() { ["Warmup:Enabled"] = "false" });
        var client = app.CreateClient();

        var stats = await StatsAsync(client);

        Assert.Equal(0, stats.GetProperty("hits").GetInt64());
        Assert.Equal(0, stats.GetProperty("entries").GetInt32());
    }

    [Fact]
    public async Task A_write_is_followed_by_a_background_refresh_that_refills_the_cache()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        var created = await client.PostAsJsonAsync("/records", new { kind = "note", title = "x" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);

        var deadline = DateTime.UtcNow.AddSeconds(15);
        var refilled = false;
        while (DateTime.UtcNow < deadline && !refilled)
        {
            refilled = (await StatsAsync(client)).GetProperty("entries").GetInt32() >= 4;
            if (!refilled) await Task.Delay(200);
        }

        Assert.True(refilled, "the cache was not refilled after the write: " + (await StatsAsync(client)).GetRawText());
    }

    [Fact]
    public async Task Refreshing_replaces_an_entry_without_clearing_it_first()
    {
        using var app = new TestApp();
        var cache = app.Services.GetRequiredService<IReadCache>();
        var n = 0;
        Task<int> Compute() => Task.FromResult(++n);

        Assert.Equal(1, await cache.GetOrCreateAsync("probe", Compute, CancellationToken.None));
        using (cache.Refreshing())
            Assert.Equal(2, await cache.GetOrCreateAsync("probe", Compute, CancellationToken.None));

        Assert.Equal(2, await cache.GetOrCreateAsync("probe", Compute, CancellationToken.None));
        Assert.Equal(2, n);
    }

    [Fact]
    public async Task Invalid_warmup_settings_stop_the_app_from_starting()
    {
        using var app = new TestApp().WithSettings(new() { ["Warmup:OverviewDays"] = "30,abc" });
        Assert.ThrowsAny<Exception>(() => app.CreateClient());
        await Task.CompletedTask;
    }
}
