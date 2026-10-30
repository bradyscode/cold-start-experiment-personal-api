namespace personal_api.Domain.Feed;

public sealed record FeedChartRef(string Kind, string Bucket, string Agg, int Days);

public sealed record FeedCard(string Id, string Kind, string KindName, string Rule, string Big, string? Unit,
    string Headline, string Detail, DateTimeOffset OccurredAt, int Score, FeedChartRef Chart);

// RecordsByKind holds all of a kind's records (up to the service cap), oldest first; each rule applies its own window.
public sealed record FeedContext(DateTimeOffset Now, TimeZoneInfo Zone, IReadOnlyList<KindDefinition> Kinds,
    IReadOnlyDictionary<string, IReadOnlyList<LifeRecord>> RecordsByKind);
