namespace personal_api.Domain;

public interface IKindStore
{
    Task<IReadOnlyList<KindDefinition>> ListAsync(CancellationToken ct);
    Task<KindDefinition?> GetAsync(string key, CancellationToken ct);

    // Insert or replace by Key.
    Task SaveAsync(KindDefinition kind, CancellationToken ct);
}
