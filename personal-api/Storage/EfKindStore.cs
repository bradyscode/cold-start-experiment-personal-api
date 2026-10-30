using Microsoft.EntityFrameworkCore;
using personal_api.Domain;

namespace personal_api.Storage;

public sealed class EfKindStore(AppDbContext db) : IKindStore
{
    public async Task<IReadOnlyList<KindDefinition>> ListAsync(CancellationToken ct) =>
        await db.Kinds.AsNoTracking().OrderBy(k => k.Key).ToListAsync(ct);

    public Task<KindDefinition?> GetAsync(string key, CancellationToken ct) =>
        db.Kinds.AsNoTracking().FirstOrDefaultAsync(k => k.Key == key, ct);

    public async Task SaveAsync(KindDefinition kind, CancellationToken ct)
    {
        var existing = await db.Kinds.FirstOrDefaultAsync(k => k.Key == kind.Key, ct);
        if (existing is null)
            db.Kinds.Add(kind);
        else
            db.Entry(existing).CurrentValues.SetValues(kind);
        await db.SaveChangesAsync(ct);
    }
}
