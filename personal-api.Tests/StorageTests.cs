using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using personal_api.Domain;
using personal_api.Storage;

namespace personal_api.Tests;

public sealed class StorageTests : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly AppDbContext _db;

    public StorageTests()
    {
        _connection.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options);
        _db.Database.EnsureCreated();
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }

    private static LifeRecord Rec(string title, string kind = "weight", DateTimeOffset? at = null, string? externalId = null, string source = "manual") =>
        new(Guid.NewGuid(), source, kind, at ?? DateTimeOffset.UtcNow, null, null, title, null, externalId, DateTimeOffset.UtcNow);

    [Fact]
    public async Task Upsert_with_same_source_and_externalId_updates_not_duplicates()
    {
        var store = new EfRecordStore(_db);
        var first = await store.UpsertAsync(Rec("one", externalId: "x1"), default);
        var second = await store.UpsertAsync(Rec("two", externalId: "x1"), default);

        Assert.True(first.Created);
        Assert.False(second.Created);
        var rows = await store.QueryAsync(new RecordQuery(null, null, null), default);
        var row = Assert.Single(rows);
        Assert.Equal("two", row.Title);
        Assert.Equal(first.Record.Id, row.Id);
    }

    [Fact]
    public async Task Upsert_without_externalId_always_inserts()
    {
        var store = new EfRecordStore(_db);
        await store.UpsertAsync(Rec("one"), default);
        await store.UpsertAsync(Rec("two"), default);

        Assert.Equal(2, (await store.QueryAsync(new RecordQuery(null, null, null), default)).Count);
    }

    [Fact]
    public async Task Query_filters_by_kind_and_date_and_orders_newest_first()
    {
        var store = new EfRecordStore(_db);
        var t = new DateTimeOffset(2026, 1, 10, 0, 0, 0, TimeSpan.Zero);
        await store.UpsertAsync(Rec("old", at: t.AddDays(-5)), default);
        await store.UpsertAsync(Rec("mid", at: t), default);
        await store.UpsertAsync(Rec("new", at: t.AddDays(5)), default);
        await store.UpsertAsync(Rec("other", kind: "sleep", at: t), default);

        var all = await store.QueryAsync(new RecordQuery("weight", null, null), default);
        Assert.Equal(["new", "mid", "old"], all.Select(r => r.Title));

        var ranged = await store.QueryAsync(new RecordQuery("weight", t.AddDays(-1), t.AddDays(1)), default);
        Assert.Equal(["mid"], ranged.Select(r => r.Title));
    }

    [Fact]
    public async Task Query_clamps_limit_to_500()
    {
        var store = new EfRecordStore(_db);
        for (var i = 0; i < 501; i++)
            _db.Add(Rec($"r{i}", at: DateTimeOffset.UtcNow.AddMinutes(-i)));
        await _db.SaveChangesAsync();

        Assert.Equal(500, (await store.QueryAsync(new RecordQuery(null, null, null, 10000), default)).Count);
        Assert.Equal(100, (await store.QueryAsync(new RecordQuery(null, null, null, 0), default)).Count);
        Assert.Equal(100, (await store.QueryAsync(new RecordQuery(null, null, null, -5), default)).Count);
    }

    [Fact]
    public async Task Instant_roundtrips_with_offset()
    {
        var store = new EfRecordStore(_db);
        var expected = DateTimeOffset.Parse("2026-01-01T10:00:00-06:00");
        await store.UpsertAsync(Rec("t", at: expected), default);

        var actual = Assert.Single(await store.QueryAsync(new RecordQuery(null, null, null), default));
        Assert.Equal(expected.UtcDateTime, actual.OccurredAt.UtcDateTime);
    }

    [Fact]
    public async Task Kind_save_then_get_roundtrips_fields_and_replaces_on_second_save()
    {
        var store = new EfKindStore(_db);
        var kind = new KindDefinition("mood", "Mood", "pts",
        [
            new FieldDefinition("score", FieldType.Number, true, "Score"),
            new FieldDefinition("feel", FieldType.Choice, false, null, ["good", "bad"]),
        ]);
        await store.SaveAsync(kind, default);

        var loaded = await store.GetAsync("mood", default);
        Assert.NotNull(loaded);
        Assert.Equal("Mood", loaded.DisplayName);
        Assert.Equal("pts", loaded.DefaultUnit);
        Assert.Equal(2, loaded.Fields.Count);
        Assert.Equal(FieldType.Choice, loaded.Fields[1].Type);
        Assert.Equal(["good", "bad"], loaded.Fields[1].Options);

        await store.SaveAsync(kind with { DisplayName = "Mood v2", Fields = [] }, default);
        var replaced = await store.GetAsync("mood", default);
        Assert.Equal("Mood v2", replaced!.DisplayName);
        Assert.Empty(replaced.Fields);
        Assert.Single(await store.ListAsync(default));
        Assert.Null(await store.GetAsync("missing", default));
    }

    [Fact]
    public void Unsupported_provider_throws()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Database:Provider"] = "Oracle" })
            .Build();

        var ex = Assert.Throws<NotSupportedException>(() => new ServiceCollection().AddStorage(config));
        Assert.Equal("Database provider 'Oracle' is not supported", ex.Message);
    }
}
