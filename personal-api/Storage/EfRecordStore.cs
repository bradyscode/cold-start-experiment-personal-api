using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using personal_api.Domain;

namespace personal_api.Storage;

public sealed class EfRecordStore(AppDbContext db) : IRecordStore
{
    private const int DefaultLimit = 100;
    private const int MaxLimit = 500;

    public async Task<UpsertResult> UpsertAsync(LifeRecord record, CancellationToken ct)
    {
        try
        {
            return await TryUpsertAsync(record, ct);
        }
        catch (DbUpdateException e) when (record.ExternalId is not null && IsUniqueViolation(e))
        {
            // A concurrent request with the same key inserted first: drop our failed insert and update that row instead.
            db.ChangeTracker.Clear();
            return await TryUpsertAsync(record, ct);
        }
    }

    private async Task<UpsertResult> TryUpsertAsync(LifeRecord record, CancellationToken ct)
    {
        if (record.ExternalId is not null)
        {
            var existing = await db.Records.FirstOrDefaultAsync(r => r.Source == record.Source && r.ExternalId == record.ExternalId, ct);
            if (existing is not null)
            {
                if (existing.Kind != record.Kind)
                    throw new ExternalIdConflictException(record.Source, record.ExternalId, existing.Kind);
                // Keep the original identity and creation time on update.
                db.Entry(existing).CurrentValues.SetValues(record with { Id = existing.Id, CreatedAt = existing.CreatedAt });
                await db.SaveChangesAsync(ct);
                return new UpsertResult(existing, false);
            }
        }

        db.Records.Add(record);
        await db.SaveChangesAsync(ct);
        return new UpsertResult(record, true);
    }

    private static bool IsUniqueViolation(DbUpdateException e) =>
        e.InnerException is SqliteException { SqliteErrorCode: 19 } sqlite
        && (sqlite.SqliteExtendedErrorCode == 2067 || sqlite.Message.Contains("UNIQUE constraint failed", StringComparison.OrdinalIgnoreCase));

    public async Task<IReadOnlyList<LifeRecord>> QueryAsync(RecordQuery query, CancellationToken ct)
    {
        var limit = query.Limit <= 0 ? DefaultLimit : Math.Min(query.Limit, MaxLimit);
        var q = db.Records.AsNoTracking();

        if (query.Kind is not null) q = q.Where(r => r.Kind == query.Kind);
        if (query.From is { } from) q = q.Where(r => r.OccurredAt >= from);
        if (query.To is { } to) q = q.Where(r => r.OccurredAt <= to);

        return await q.OrderByDescending(r => r.OccurredAt).Take(limit).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<LifeRecord>> ListRangeAsync(string? kind, DateTimeOffset from, DateTimeOffset to, int limit, CancellationToken ct)
    {
        var q = db.Records.AsNoTracking().Where(r => r.OccurredAt >= from && r.OccurredAt <= to);
        if (kind is not null) q = q.Where(r => r.Kind == kind);
        return await q.OrderBy(r => r.OccurredAt).Take(limit).ToListAsync(ct);
    }
}
