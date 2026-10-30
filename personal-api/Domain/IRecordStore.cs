namespace personal_api.Domain;

public interface IRecordStore
{
    // Throws ExternalIdConflictException when the (source, externalId) key already belongs to a record of another kind.
    Task<UpsertResult> UpsertAsync(LifeRecord record, CancellationToken ct);

    // Newest OccurredAt first.
    Task<IReadOnlyList<LifeRecord>> QueryAsync(RecordQuery query, CancellationToken ct);

    // Oldest first, inclusive on both ends, at most `limit` rows.
    Task<IReadOnlyList<LifeRecord>> ListRangeAsync(string? kind, DateTimeOffset from, DateTimeOffset to, int limit, CancellationToken ct);
}

public sealed class ExternalIdConflictException(string source, string externalId, string existingKind)
    : Exception($"externalId '{externalId}' from source '{source}' is already used by a record of kind '{existingKind}'.");
