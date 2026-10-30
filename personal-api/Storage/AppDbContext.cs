using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using personal_api.Domain;

namespace personal_api.Storage;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    private static readonly JsonSerializerOptions FieldJson = new() { Converters = { new JsonStringEnumConverter() } };

    public DbSet<LifeRecord> Records => Set<LifeRecord>();
    public DbSet<KindDefinition> Kinds => Set<KindDefinition>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // SQLite cannot order DateTimeOffset, so store UTC ticks.
        configurationBuilder.Properties<DateTimeOffset>().HaveConversion<UtcTicksConverter>();
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<LifeRecord>(e =>
        {
            e.ToTable("Records");
            e.HasKey(r => r.Id);
            e.HasIndex(r => new { r.Source, r.ExternalId }).IsUnique();
            e.HasIndex(r => new { r.Kind, r.OccurredAt });
        });

        modelBuilder.Entity<KindDefinition>(e =>
        {
            e.ToTable("Kinds");
            e.HasKey(k => k.Key);
            e.Property(k => k.Fields).HasConversion(
                fields => JsonSerializer.Serialize(fields, FieldJson),
                json => JsonSerializer.Deserialize<List<FieldDefinition>>(json, FieldJson)!);
        });
    }
}
