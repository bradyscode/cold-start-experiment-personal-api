namespace personal_api.Domain;

public sealed record LifeRecord(Guid Id, string Source, string Kind, DateTimeOffset OccurredAt, double? Value, string? Unit, string Title, string? DataJson, string? ExternalId, DateTimeOffset CreatedAt);

public sealed record RecordQuery(string? Kind, DateTimeOffset? From, DateTimeOffset? To, int Limit = 100);

public sealed record UpsertResult(LifeRecord Record, bool Created);
