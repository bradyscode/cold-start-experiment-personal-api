using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using personal_api.Domain;

namespace personal_api.Storage;

public static class StorageServiceCollectionExtensions
{
    private const string DefaultConnection = "Data Source=data/personal-api.db";

    public static IServiceCollection AddStorage(this IServiceCollection services, IConfiguration configuration)
    {
        var provider = configuration["Database:Provider"] ?? "Sqlite";
        if (provider != "Sqlite")
            throw new NotSupportedException($"Database provider '{provider}' is not supported");

        var connection = configuration.GetConnectionString("Default") ?? DefaultConnection;
        services.AddDbContextPool<AppDbContext>(o => o.UseSqlite(connection));
        services.AddScoped<IRecordStore, EfRecordStore>();
        services.AddScoped<IKindStore, EfKindStore>();
        return services;
    }

    public static async Task EnsureStorageCreatedAsync(this IServiceProvider services, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var dataSource = new SqliteConnectionStringBuilder(db.Database.GetConnectionString()).DataSource;
        var directory = Path.GetDirectoryName(dataSource);
        if (!string.IsNullOrEmpty(directory))
            Directory.CreateDirectory(directory);

        await db.Database.EnsureCreatedAsync(ct);
        await AddMissingKindColumnsAsync(db, ct);
        // Older databases still hold the table from the removed key feature.
        await db.Database.ExecuteSqlRawAsync("DROP TABLE IF EXISTS ApiKeys", ct);
    }

    // EnsureCreated never alters an existing database, so columns added after it was first created are added here (replaced by real migrations later).
    private static readonly string[] KindColumnsAddedLater = ["Category", "DefaultAgg", "Better"];

    private static async Task AddMissingKindColumnsAsync(AppDbContext db, CancellationToken ct)
    {
        var connection = db.Database.GetDbConnection();
        var wasClosed = connection.State != System.Data.ConnectionState.Open;
        if (wasClosed)
            await connection.OpenAsync(ct);
        try
        {
            var existing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            await using (var read = connection.CreateCommand())
            {
                read.CommandText = "SELECT name FROM pragma_table_info('Kinds')";
                await using var reader = await read.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                    existing.Add(reader.GetString(0));
            }

            foreach (var column in KindColumnsAddedLater.Where(c => !existing.Contains(c)))
            {
                await using var alter = connection.CreateCommand();
                alter.CommandText = $"ALTER TABLE Kinds ADD COLUMN {column} TEXT NULL";
                await alter.ExecuteNonQueryAsync(ct);
            }
        }
        finally
        {
            if (wasClosed)
                await connection.CloseAsync();
        }
    }
}
