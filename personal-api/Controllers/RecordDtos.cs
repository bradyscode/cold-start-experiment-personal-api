using System.Text.Json;
using personal_api.Domain;

namespace personal_api.Controllers;

public sealed record CreateRecordRequest(string? Kind, string? Source, string? OccurredAt, double? Value, string? Unit, string? Title, JsonElement? Data, string? ExternalId);

public sealed record RecordResponse(Guid Id, string Source, string Kind, DateTimeOffset OccurredAt, double? Value, string? Unit, string Title, JsonElement? Data, string? ExternalId, DateTimeOffset CreatedAt)
{
    public static RecordResponse From(LifeRecord r)
    {
        JsonElement? data = null;
        if (!string.IsNullOrWhiteSpace(r.DataJson))
        {
            using var doc = JsonDocument.Parse(r.DataJson);
            data = doc.RootElement.Clone();
        }
        return new(r.Id, r.Source, r.Kind, r.OccurredAt, r.Value, r.Unit, r.Title, data, r.ExternalId, r.CreatedAt);
    }
}
