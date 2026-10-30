using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace personal_api.Tests;

public class TestApp : WebApplicationFactory<Program>
{
    private readonly Dictionary<string, string?> _settings = new();
    private readonly bool _ownsDatabase;

    public string DatabasePath { get; }
    public FakeTimeProvider Time { get; } = new(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));

    private bool _keepAppsettingsCors;
    private string _environment = "Testing";

    public TestApp(string? databasePath = null)
    {
        _ownsDatabase = databasePath is null;
        DatabasePath = databasePath ?? Path.Combine(Path.GetTempPath(), $"personal-api-{Guid.NewGuid():N}.db");
    }

    public TestApp WithSettings(Dictionary<string, string?> settings)
    {
        foreach (var (key, value) in settings)
            _settings[key] = value;
        return this;
    }

    public TestApp WithEnvironment(string environment)
    {
        _environment = environment;
        return this;
    }

    public TestApp WithAppsettingsCors()
    {
        _keepAppsettingsCors = true;
        return this;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(_environment);
        var settings = new Dictionary<string, string?>
        {
            ["Database:Provider"] = "Sqlite",
            ["ConnectionStrings:Default"] = $"Data Source={DatabasePath};Pooling=False",
        };
        // Blank slots shadow any array in appsettings files; blank entries are ignored by CorsSettings.
        if (!_keepAppsettingsCors)
            for (var i = 0; i < 16; i++)
                settings[$"Cors:AllowedOrigins:{i}"] = "";
        foreach (var (key, value) in _settings)
            settings[key] = value;
        // UseSetting applies before Program.cs reads configuration; ConfigureAppConfiguration would apply too late.
        foreach (var (key, value) in settings)
            builder.UseSetting(key, value);
        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<TimeProvider>(Time);
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && _ownsDatabase)
        {
            foreach (var path in new[] { DatabasePath, DatabasePath + "-wal", DatabasePath + "-shm" })
            {
                try { File.Delete(path); } catch (IOException) { }
            }
        }
    }
}
