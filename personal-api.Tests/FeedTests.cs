using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using personal_api.Caching;
using personal_api.Domain;
using personal_api.Domain.Feed;
using personal_api.Storage;

namespace personal_api.Tests;

public class FeedTests
{
    private static async Task PostAsync(HttpClient client, string kind, string occurredAt, double value)
    {
        object data = kind == "workout" ? new { type = "run", duration_min = value } : new { rounds = value };
        var response = await client.PostAsJsonAsync("/records", new { kind, occurredAt, data });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task SeedAsync(HttpClient client)
    {
        foreach (var day in Enumerable.Range(1, 5))
        {
            await PostAsync(client, "range_session", $"2025-12-{day:00}T12:00:00Z", 50);
            await PostAsync(client, "workout", $"2025-12-{day:00}T12:00:00Z", 30);
        }
        await PostAsync(client, "range_session", "2025-12-20T12:00:00Z", 100);
        await PostAsync(client, "workout", "2025-12-25T12:00:00Z", 36);
    }

    private static async Task<JsonElement[]> FeedAsync(HttpClient client, string query = "")
    {
        var response = await client.GetAsync("/feed" + query);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.EnumerateArray().Select(e => e.Clone()).ToArray();
    }

    [Fact]
    public async Task Empty_feed_returns_an_empty_array()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().GetAsync("/feed");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("[]", (await response.Content.ReadAsStringAsync()).Trim());
    }

    [Fact]
    public async Task Cards_are_ordered_by_score_then_newest_with_the_documented_shape()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await SeedAsync(client);

        var cards = await FeedAsync(client);

        // Range sessions have no "best" direction (more rounds is not better), so only workouts get a personal-best card.
        Assert.Equal(["personal_best:workout:20251225", "vs_average:workout:20251225", "vs_average:range_session:20251220"],
            cards.Select(c => c.GetProperty("id").GetString()));
        Assert.Equal([90, 60, 60], cards.Select(c => c.GetProperty("score").GetInt32()));
        var first = cards[0];
        Assert.Equal("workout", first.GetProperty("kind").GetString());
        Assert.Equal("Workout", first.GetProperty("kindName").GetString());
        Assert.Equal("personal_best", first.GetProperty("rule").GetString());
        Assert.Equal("36", first.GetProperty("big").GetString());
        Assert.Equal("Best Workout on record", first.GetProperty("headline").GetString());
        Assert.Equal("max", first.GetProperty("chart").GetProperty("agg").GetString());
        Assert.Equal(30, first.GetProperty("chart").GetProperty("days").GetInt32());
        Assert.Equal(new DateTimeOffset(2025, 12, 25, 12, 0, 0, TimeSpan.Zero), first.GetProperty("occurredAt").GetDateTimeOffset());
    }

    [Fact]
    public async Task There_is_one_card_per_kind_and_rule()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await SeedAsync(client);

        var cards = await FeedAsync(client);

        Assert.Equal(cards.Length, cards.Select(c => (c.GetProperty("kind").GetString(), c.GetProperty("rule").GetString())).Distinct().Count());
    }

    [Theory]
    [InlineData("", 3)]
    [InlineData("?limit=2", 2)]
    [InlineData("?limit=0", 3)]
    [InlineData("?limit=-3", 3)]
    [InlineData("?limit=500", 3)]
    public async Task Limit_defaults_to_twenty_and_is_capped_at_fifty(string query, int expected)
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await SeedAsync(client);

        Assert.Equal(expected, (await FeedAsync(client, query)).Length);
    }

    [Fact]
    public async Task Non_numeric_limit_is_a_bad_request()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().GetAsync("/feed?limit=abc");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Single(doc.RootElement.GetProperty("errors").EnumerateArray());
    }

    [Fact]
    public async Task Ids_are_deterministic_across_requests()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await SeedAsync(client);

        var a = (await FeedAsync(client)).Select(c => c.GetProperty("id").GetString());
        var b = (await FeedAsync(client)).Select(c => c.GetProperty("id").GetString());

        Assert.Equal(a, b);
    }

    private static LifeRecord Rec(string kind, DateTimeOffset at, double value) =>
        new(Guid.NewGuid(), "test", kind, at, value, null, "t", null, null, at);

    private static IEnumerable<LifeRecord> QualifyingRecords(string kind) =>
        Enumerable.Range(1, 5).Select(d => Rec(kind, new DateTimeOffset(2025, 12, d, 12, 0, 0, TimeSpan.Zero), 10))
            .Append(Rec(kind, new DateTimeOffset(2025, 12, 20, 12, 0, 0, TimeSpan.Zero), 20));

    private static async Task SeedKindsAsync(TestApp app, int count)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        for (var i = 0; i < count; i++)
        {
            var key = $"kind_{i:00}";
            db.Kinds.Add(new KindDefinition(key, key, null, []));
            db.Records.AddRange(QualifyingRecords(key));
        }
        await db.SaveChangesAsync();
        app.Services.GetService<IReadCache>()?.Invalidate();
    }

    [Fact]
    public async Task Limit_default_is_20_and_max_is_50()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await SeedKindsAsync(app, 60);

        Assert.Equal(20, (await FeedAsync(client)).Length);
        Assert.Equal(50, (await FeedAsync(client, "?limit=500")).Length);
        Assert.Equal(7, (await FeedAsync(client, "?limit=7")).Length);
        Assert.Equal(20, (await FeedAsync(client, "?limit=0")).Length);
        Assert.Equal(20, (await FeedAsync(client, "?limit=-3")).Length);

        var bad = await client.GetAsync("/feed?limit=abc");
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        using var doc = JsonDocument.Parse(await bad.Content.ReadAsStringAsync());
        Assert.NotEmpty(doc.RootElement.GetProperty("errors").EnumerateArray());
    }

    [Fact]
    public async Task Card_ids_and_details_use_the_configured_time_zone()
    {
        using var app = new TestApp().WithSettings(new() { ["Feed:TimeZone"] = "America/Chicago" });
        var client = app.CreateClient();
        for (var d = 1; d <= 4; d++)
            await PostAsync(client, "workout", $"2025-12-{d:00}T12:00:00Z", 10);
        await PostAsync(client, "workout", "2025-12-10T23:30:00-06:00", 120);
        await PostAsync(client, "workout", "2025-12-20T23:30:00-06:00", 110);

        var cards = await FeedAsync(client);

        var best = cards.Single(c => c.GetProperty("rule").GetString() == "personal_best");
        Assert.Equal("personal_best:workout:20251220", best.GetProperty("id").GetString());
        Assert.Equal("Last higher was 120 on Dec 10", best.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task A_kind_with_more_than_20000_records_is_skipped_and_other_kinds_still_produce_cards()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var at = new DateTimeOffset(2025, 12, 1, 0, 0, 0, TimeSpan.Zero);
            db.Records.AddRange(Enumerable.Range(0, 20001).Select(i => Rec("workout", at.AddSeconds(i), i == 20000 ? 100 : 30)));
            db.Records.AddRange(QualifyingRecords("range_session"));
            await db.SaveChangesAsync();
        }
        app.Services.GetService<IReadCache>()?.Invalidate();

        var cards = await FeedAsync(client);

        Assert.NotEmpty(cards);
        Assert.All(cards, c => Assert.Equal("range_session", c.GetProperty("kind").GetString()));
    }

    private sealed class DuplicatingRule : IFeedRule
    {
        public IEnumerable<FeedCard> Evaluate(FeedContext context)
        {
            var chart = new FeedChartRef("note", "day", "count", 30);
            var at = new DateTimeOffset(2025, 12, 20, 0, 0, 0, TimeSpan.Zero);
            yield return new FeedCard("dup:note:20251219", "note", "Note", "dup", "1", null, "old", "", at.AddDays(-1), 60, chart);
            yield return new FeedCard("dup:note:20251220", "note", "Note", "dup", "2", null, "new", "", at, 60, chart);
        }
    }

    private sealed class FakeKinds : IKindStore
    {
        public Task<IReadOnlyList<KindDefinition>> ListAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<KindDefinition>>([new KindDefinition("note", "Note", null, [])]);
        public Task<KindDefinition?> GetAsync(string key, CancellationToken ct) => Task.FromResult<KindDefinition?>(null);
        public Task SaveAsync(KindDefinition kind, CancellationToken ct) => Task.CompletedTask;
    }

    private sealed class FakeRecords : IRecordStore
    {
        public Task<UpsertResult> UpsertAsync(LifeRecord record, CancellationToken ct) => throw new NotSupportedException();
        public Task<IReadOnlyList<LifeRecord>> QueryAsync(RecordQuery query, CancellationToken ct) => throw new NotSupportedException();
        public Task<IReadOnlyList<LifeRecord>> ListRangeAsync(string? kind, DateTimeOffset from, DateTimeOffset to, int limit, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<LifeRecord>>([]);
    }

    [Fact]
    public async Task Engine_keeps_one_card_per_kind_and_rule()
    {
        var service = new FeedService(new FakeRecords(), new FakeKinds(), [new DuplicatingRule()], Options.Create(new FeedOptions()),
            new Microsoft.Extensions.Time.Testing.FakeTimeProvider(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)), NullLogger<FeedService>.Instance);

        var cards = await service.GetAsync(20, CancellationToken.None);

        var card = Assert.Single(cards);
        Assert.Equal("new", card.Headline);
    }

    [Fact]
    public async Task All_five_rule_types_can_appear_in_one_response()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await SeedAsync(client);
        foreach (var at in new[] { "2025-12-24", "2025-12-25", "2025-12-26", "2025-12-27", "2025-12-28", "2025-12-29", "2025-12-30", "2025-12-31" })
            Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/records", new { kind = "note", occurredAt = at + "T12:00:00Z" })).StatusCode);
        foreach (var at in new[] { "2025-12-31T13:00:00Z", "2025-12-31T14:00:00Z" })
            Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/records", new { kind = "note", occurredAt = at })).StatusCode);

        var cards = await FeedAsync(client);

        var noteRules = cards.Where(c => c.GetProperty("kind").GetString() == "note").Select(c => c.GetProperty("rule").GetString()!).Order().ToArray();
        Assert.Equal(["milestone", "streak", "weekly"], noteRules);
        Assert.Equal(["milestone", "personal_best", "streak", "vs_average", "weekly"], cards.Select(c => c.GetProperty("rule").GetString()!).Distinct().Order());
        var streak = cards.Single(c => c.GetProperty("rule").GetString() == "streak");
        Assert.Equal("8-day Note streak", streak.GetProperty("headline").GetString());
        Assert.Equal("days", streak.GetProperty("unit").GetString());
    }
}
