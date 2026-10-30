using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using personal_api.Domain;
using personal_api.Kinds;
using personal_api.Storage;

namespace personal_api.Tests;

public class KindMetadataTests
{
    private static readonly string[] Aggs = ["sum", "avg", "max", "count"];
    private static readonly string[] Betters = ["higher", "lower", "none"];

    private static object Body(string key, string? category = null, string? defaultAgg = null, string? better = null, string? valueField = "hours") =>
        new
        {
            key,
            displayName = "Thing",
            defaultUnit = "h",
            valueField,
            category,
            defaultAgg,
            better,
            fields = new object[] { new { name = "hours", type = "Number", required = true } },
        };

    private static async Task<string[]> ErrorsAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToArray();
    }

    private static KindDefinition CatalogKind(string key) => KindSeeder.Catalog.Single(k => k.Key == key);

    [Fact]
    public async Task Put_roundtrips_category_default_agg_and_better()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var put = await client.PutAsJsonAsync("/kinds/thing", Body("thing", "Health", "avg", "lower"));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var kinds = await client.GetFromJsonAsync<JsonElement>("/kinds");
        var saved = kinds.EnumerateArray().Single(k => k.GetProperty("key").GetString() == "thing");
        Assert.Equal("Health", saved.GetProperty("category").GetString());
        Assert.Equal("avg", saved.GetProperty("defaultAgg").GetString());
        Assert.Equal("lower", saved.GetProperty("better").GetString());
    }

    [Fact]
    public async Task Put_trims_category_and_lowercases_agg_and_better()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var put = await client.PutAsJsonAsync("/kinds/thing", Body("thing", "  Health  ", "AVG", "Lower"));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var saved = (await client.GetFromJsonAsync<JsonElement>("/kinds")).EnumerateArray().Single(k => k.GetProperty("key").GetString() == "thing");
        Assert.Equal("Health", saved.GetProperty("category").GetString());
        Assert.Equal("avg", saved.GetProperty("defaultAgg").GetString());
        Assert.Equal("lower", saved.GetProperty("better").GetString());
    }

    [Fact]
    public async Task Put_treats_a_blank_category_as_none()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync("/kinds/thing", Body("thing", "   "))).StatusCode);

        var saved = (await client.GetFromJsonAsync<JsonElement>("/kinds")).EnumerateArray().Single(k => k.GetProperty("key").GetString() == "thing");
        Assert.Equal(JsonValueKind.Null, saved.GetProperty("category").ValueKind);
    }

    [Theory]
    [InlineData("median", null, "defaultAgg")]
    [InlineData(null, "best", "better")]
    [InlineData("sum", "sideways", "better")]
    public async Task Put_rejects_unknown_agg_or_better(string? agg, string? better, string expectedFragment)
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsJsonAsync("/kinds/thing", Body("thing", defaultAgg: agg, better: better));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(await ErrorsAsync(response), e => e.Contains(expectedFragment));
    }

    [Fact]
    public async Task Put_rejects_a_category_longer_than_40_characters()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsJsonAsync("/kinds/thing", Body("thing", new string('c', 41)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(await ErrorsAsync(response), e => e.Contains("category"));
    }

    [Theory]
    [InlineData("sum")]
    [InlineData("avg")]
    [InlineData("max")]
    public async Task Put_rejects_a_value_based_agg_without_a_value_field(string agg)
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsJsonAsync("/kinds/thing", Body("thing", defaultAgg: agg, valueField: null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(await ErrorsAsync(response), e => e.Contains("defaultAgg") && e.Contains("valueField"));
    }

    [Fact]
    public async Task Put_allows_count_without_a_value_field()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().PutAsJsonAsync("/kinds/thing", Body("thing", defaultAgg: "count", valueField: null));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ---- the built-in catalog ----

    [Fact]
    public void Catalog_has_a_rich_set_of_trackers_across_categories()
    {
        Assert.True(KindSeeder.Catalog.Count >= 40, $"expected at least 40 kinds, got {KindSeeder.Catalog.Count}");
        var categories = KindSeeder.Catalog.GroupBy(k => k.Category).ToDictionary(g => g.Key!, g => g.Count());
        foreach (var expected in new[] { "Health", "Fitness", "Code", "Hobbies", "Reading and media", "Money", "Life" })
            Assert.True(categories.TryGetValue(expected, out var n) && n >= 2, $"category '{expected}' needs at least two kinds");
    }

    [Fact]
    public void Catalog_entries_are_all_valid()
    {
        var keyPattern = new Regex("^[a-z][a-z0-9_]{1,40}$");
        var fieldPattern = new Regex("^[a-z][a-z0-9_]*$");
        Assert.Equal(KindSeeder.Catalog.Count, KindSeeder.Catalog.Select(k => k.Key).Distinct().Count());

        foreach (var kind in KindSeeder.Catalog)
        {
            Assert.Matches(keyPattern, kind.Key);
            Assert.False(string.IsNullOrWhiteSpace(kind.DisplayName), kind.Key);
            Assert.False(string.IsNullOrWhiteSpace(kind.Category), $"{kind.Key} needs a category");
            Assert.True(kind.Category!.Length <= 40, kind.Key);
            Assert.Equal(kind.Fields.Count, kind.Fields.Select(f => f.Name).Distinct().Count());
            foreach (var field in kind.Fields)
            {
                Assert.Matches(fieldPattern, field.Name);
                if (field.Type == FieldType.Choice)
                    Assert.True(field.Options is { Count: > 0 }, $"{kind.Key}.{field.Name} needs options");
            }

            if (kind.ValueField is not null)
            {
                Assert.Contains(kind.Fields, f => f.Name == kind.ValueField && f.Type == FieldType.Number);
                Assert.False(string.IsNullOrWhiteSpace(kind.DefaultUnit), $"{kind.Key} charts a value so it needs a unit");
            }

            if (kind.DefaultAgg is not null)
                Assert.Contains(kind.DefaultAgg, Aggs);
            if (kind.DefaultAgg is "sum" or "avg" or "max")
                Assert.NotNull(kind.ValueField);
            if (kind.Better is not null)
                Assert.Contains(kind.Better, Betters);
            if (kind.ValueField is not null)
                Assert.NotNull(kind.DefaultAgg);
        }
    }

    [Theory]
    [InlineData("sleep", "sum", "higher")]
    [InlineData("weight", "avg", "none")]
    [InlineData("resting_hr", "avg", "lower")]
    [InlineData("steps", "sum", "higher")]
    [InlineData("mood", "avg", "higher")]
    [InlineData("golf_round", "avg", "lower")]
    [InlineData("claude_usage", "sum", "none")]
    [InlineData("purchase", "sum", "none")]
    public void Catalog_metadata_matches_how_each_metric_should_be_read(string key, string agg, string better)
    {
        var kind = CatalogKind(key);
        Assert.Equal(agg, kind.DefaultAgg);
        Assert.Equal(better, kind.Better);
    }

    [Theory]
    [InlineData("github_commit")]
    [InlineData("github_actions_run")]
    [InlineData("note")]
    public void Event_kinds_are_counted_not_summed(string key)
    {
        var kind = CatalogKind(key);
        Assert.Null(kind.ValueField);
        Assert.True(kind.DefaultAgg is null or "count");
    }

    [Fact]
    public void Catalog_covers_the_sources_the_user_named()
    {
        var keys = KindSeeder.Catalog.Select(k => k.Key).ToHashSet();
        foreach (var expected in new[]
                 {
                     "sleep", "resting_hr", "steps", "weight", "workout", "run", "range_session", "golf_round",
                     "shop_session", "tool_maintenance", "book_finished", "reading_session", "github_commit",
                     "claude_usage", "purchase", "mood", "note",
                 })
            Assert.Contains(expected, keys);
    }

    [Fact]
    public async Task A_fresh_database_gets_the_whole_catalog_through_the_api()
    {
        using var app = new TestApp();
        var kinds = await app.CreateClient().GetFromJsonAsync<JsonElement>("/kinds");
        var served = kinds.EnumerateArray().Select(k => k.GetProperty("key").GetString()).ToHashSet();
        Assert.True(KindSeeder.Catalog.All(k => served.Contains(k.Key)));
        var sleep = kinds.EnumerateArray().Single(k => k.GetProperty("key").GetString() == "sleep");
        Assert.Equal("Health", sleep.GetProperty("category").GetString());
        Assert.Equal("sum", sleep.GetProperty("defaultAgg").GetString());
    }

    // ---- seeding behaviour on a database that already has the original four built-ins ----

    private static async Task<T> WithStoreAsync<T>(TestApp app, Func<IKindStore, Task<T>> action)
    {
        using var scope = app.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<IKindStore>());
    }

    [Fact]
    public async Task Seeding_backfills_metadata_on_a_built_in_saved_before_metadata_existed()
    {
        using var app = new TestApp();
        var legacy = new KindDefinition("workout", "Workout", "min",
            [new("type", FieldType.Text, true), new("duration_min", FieldType.Number, true)], "duration_min");

        var after = await WithStoreAsync(app, async store =>
        {
            await store.SaveAsync(legacy, default);
            await KindSeeder.SeedAsync(store, default);
            return await store.GetAsync("workout", default);
        });

        Assert.Equal("Fitness", after!.Category);
        Assert.Equal("sum", after.DefaultAgg);
        Assert.Equal(legacy.Fields.Count, after.Fields.Count);
    }

    [Fact]
    public async Task Seeding_never_overwrites_metadata_or_fields_the_user_set()
    {
        using var app = new TestApp();
        var custom = new KindDefinition("workout", "My workouts", "min", [new("only_field", FieldType.Text, false)], null, "Mine", "count", "none");

        var after = await WithStoreAsync(app, async store =>
        {
            await store.SaveAsync(custom, default);
            await KindSeeder.SeedAsync(store, default);
            return await store.GetAsync("workout", default);
        });

        Assert.Equal("Mine", after!.Category);
        Assert.Equal("count", after.DefaultAgg);
        Assert.Equal("none", after.Better);
        Assert.Equal("My workouts", after.DisplayName);
        Assert.Single(after.Fields);
    }

    [Fact]
    public async Task Seeding_twice_adds_nothing_new()
    {
        using var app = new TestApp();
        var count = await WithStoreAsync(app, async store =>
        {
            await KindSeeder.SeedAsync(store, default);
            await KindSeeder.SeedAsync(store, default);
            return (await store.ListAsync(default)).Count;
        });
        Assert.Equal(KindSeeder.Catalog.Count, count);
    }

    // ---- upgrading a database created before the metadata columns existed ----

    [Fact]
    public async Task An_old_database_without_the_metadata_columns_is_upgraded_in_place()
    {
        var path = Path.Combine(Path.GetTempPath(), $"personal-api-meta-{Guid.NewGuid():N}.db");
        try
        {
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = $"Data Source={path};Pooling=False",
            }).Build();

            await using (var first = new ServiceCollection().AddSingleton<IConfiguration>(config).AddStorage(config).BuildServiceProvider())
            {
                await first.EnsureStorageCreatedAsync();
                using var scope = first.CreateScope();
                await scope.ServiceProvider.GetRequiredService<IKindStore>().SaveAsync(
                    new KindDefinition("old_thing", "Old thing", "x", [new("x", FieldType.Number, false)], "x"), default);
            }

            await using (var raw = new SqliteConnection($"Data Source={path};Pooling=False"))
            {
                await raw.OpenAsync();
                foreach (var column in new[] { "Category", "DefaultAgg", "Better" })
                {
                    await using var drop = raw.CreateCommand();
                    drop.CommandText = $"ALTER TABLE Kinds DROP COLUMN {column}";
                    await drop.ExecuteNonQueryAsync();
                }
            }

            await using var second = new ServiceCollection().AddSingleton<IConfiguration>(config).AddStorage(config).BuildServiceProvider();
            await second.EnsureStorageCreatedAsync();
            await second.EnsureStorageCreatedAsync();

            using var scope2 = second.CreateScope();
            var old = await scope2.ServiceProvider.GetRequiredService<IKindStore>().GetAsync("old_thing", default);
            Assert.NotNull(old);
            Assert.Null(old!.Category);
            Assert.Null(old.DefaultAgg);
            Assert.Equal("x", old.ValueField);

            await using var check = new SqliteConnection($"Data Source={path};Pooling=False");
            await check.OpenAsync();
            await using var cmd = check.CreateCommand();
            cmd.CommandText = "SELECT name FROM pragma_table_info('Kinds')";
            var columns = new List<string>();
            await using (var reader = await cmd.ExecuteReaderAsync())
                while (await reader.ReadAsync())
                    columns.Add(reader.GetString(0));
            Assert.Contains("Category", columns);
            Assert.Contains("DefaultAgg", columns);
            Assert.Contains("Better", columns);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            foreach (var file in new[] { path, path + "-wal", path + "-shm" })
                try { File.Delete(file); } catch (IOException) { }
        }
    }

    [Theory]
    [InlineData("alcohol", """{"drinks":0.5}""")]
    [InlineData("media_log", """{"type":"movie","title":"x","rating":4.5}""")]
    [InlineData("golf_round", """{"course":"c","score":72,"rating":3.5}""")]
    [InlineData("hike", """{"distance_mi":30,"duration_min":4000}""")]
    [InlineData("run", """{"distance_mi":100,"duration_min":1900}""")]
    [InlineData("travel", """{"destination":"x","nights":400}""")]
    public void Catalog_accepts_realistic_edge_values(string key, string json) =>
        Assert.Empty(KindValidator.Validate(CatalogKind(key), json));

    [Theory]
    [InlineData("mood", """{"rating":4.5}""")]
    [InlineData("mood", """{"rating":6}""")]
    [InlineData("sleep", """{"hours":25}""")]
    [InlineData("hike", """{"distance_mi":3,"duration_min":10081}""")]
    public void Catalog_still_rejects_values_that_are_clearly_wrong(string key, string json) =>
        Assert.NotEmpty(KindValidator.Validate(CatalogKind(key), json));
}
