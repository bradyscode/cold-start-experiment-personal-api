using System.Net;
using Microsoft.Data.Sqlite;

namespace personal_api.Tests;

public class OpenAccessTests
{
    [Theory]
    [InlineData("/health")]
    [InlineData("/kinds")]
    [InlineData("/feed")]
    [InlineData("/records")]
    [InlineData("/cache/stats")]
    public async Task Requests_need_no_credentials(string path)
    {
        using var app = new TestApp();

        var response = await app.CreateClient().GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task The_removed_auth_endpoint_no_longer_exists()
    {
        using var app = new TestApp();

        var response = await app.CreateClient().PostAsync("/auth/rotate", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_leftover_table_from_the_removed_key_feature_is_dropped_on_start()
    {
        var path = Path.Combine(Path.GetTempPath(), $"personal-api-legacy-{Guid.NewGuid():N}.db");
        using (var first = new TestApp(path))
            Assert.Equal(HttpStatusCode.OK, (await first.CreateClient().GetAsync("/health")).StatusCode);

        await using (var seed = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            await seed.OpenAsync();
            await using var create = seed.CreateCommand();
            create.CommandText = "CREATE TABLE ApiKeys (Id TEXT PRIMARY KEY, Hash TEXT)";
            await create.ExecuteNonQueryAsync();
        }

        using (var second = new TestApp(path))
            Assert.Equal(HttpStatusCode.OK, (await second.CreateClient().GetAsync("/health")).StatusCode);

        await using var check = new SqliteConnection($"Data Source={path};Pooling=False");
        await check.OpenAsync();
        await using var query = check.CreateCommand();
        query.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE name = 'ApiKeys'";
        Assert.Equal(0L, (long)(await query.ExecuteScalarAsync())!);

        foreach (var file in new[] { path, path + "-wal", path + "-shm" })
        {
            try { File.Delete(file); } catch (IOException) { }
        }
    }
}
