using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using personal_api.Domain;
using personal_api.Domain.Feed;

namespace personal_api.Controllers;

[ApiController]
public class RecordsController(IRecordStore records, IKindStore kinds, TimeProvider time, IOptions<FeedOptions> feedOptions) : ApiControllerBase
{
    private const int MaxDataBytes = 16 * 1024;

    private readonly TimeZoneInfo _zone = TimeZoneInfo.FindSystemTimeZoneById(feedOptions.Value.TimeZone);

    [HttpPost("/records")]
    public async Task<IActionResult> Create([FromBody] CreateRecordRequest? request, CancellationToken ct)
    {
        if (request is null)
            return Invalid("Request body must be a record");

        var kindKey = request.Kind?.Trim();
        if (string.IsNullOrEmpty(kindKey))
            return Invalid("kind is required");

        var source = string.IsNullOrWhiteSpace(request.Source) ? "manual" : request.Source.Trim();
        var externalId = string.IsNullOrWhiteSpace(request.ExternalId) ? null : request.ExternalId.Trim();

        var errors = new List<string>();
        CheckLength(errors, "source", source, 64);
        CheckLength(errors, "kind", kindKey, 64);
        CheckLength(errors, "title", request.Title?.Trim(), 200);
        CheckLength(errors, "unit", request.Unit?.Trim(), 32);
        CheckLength(errors, "externalId", externalId, 200);
        if (request.Value is { } explicitValue && Math.Abs(explicitValue) > KindValidator.MaxNumber)
            errors.Add(KindValidator.OutOfRange("value"));

        DateTimeOffset? requestedAt = null;
        if (request.OccurredAt is not null)
        {
            requestedAt = ZonedTime.Parse(request.OccurredAt, _zone);
            if (requestedAt is null)
                errors.Add("occurredAt must be an ISO 8601 date and time");
        }

        string? dataJson = null;
        if (request.Data is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined } data)
        {
            dataJson = data.GetRawText();
            if (data.ValueKind != JsonValueKind.Object)
                errors.Add("data must be a JSON object");
            else if (Encoding.UTF8.GetByteCount(dataJson) > MaxDataBytes)
                errors.Add("data must be at most 16 KB");
        }
        if (errors.Count > 0)
            return Invalid(errors);

        var kind = await kinds.GetAsync(kindKey, ct);
        if (kind is null)
            return Invalid($"Unknown kind '{kindKey}'");

        var dataErrors = KindValidator.Validate(kind, dataJson);
        if (dataErrors.Count > 0)
            return Invalid(dataErrors.ToList());

        var now = time.GetUtcNow();
        var occurredAt = (requestedAt ?? now).ToUniversalTime();
        var title = string.IsNullOrWhiteSpace(request.Title) ? $"{kind.DisplayName} {occurredAt:yyyy-MM-dd}" : request.Title.Trim();
        var unit = string.IsNullOrWhiteSpace(request.Unit) ? kind.DefaultUnit : request.Unit.Trim();

        var value = request.Value ?? ValueFromField(kind, request.Data);
        var record = new LifeRecord(Guid.NewGuid(), source, kindKey, occurredAt, value, unit, title, dataJson, externalId, now);
        UpsertResult result;
        try
        {
            result = await records.UpsertAsync(record, ct);
        }
        catch (ExternalIdConflictException e)
        {
            return Conflict(new { errors = new[] { e.Message } });
        }
        var body = RecordResponse.From(result.Record);
        return result.Created ? StatusCode(StatusCodes.Status201Created, body) : Ok(body);
    }

    [HttpGet("/records")]
    public async Task<IActionResult> List([FromQuery] string? kind, [FromQuery] string? from, [FromQuery] string? to, [FromQuery] int limit, CancellationToken ct)
    {
        var start = string.IsNullOrWhiteSpace(from) ? null : ZonedTime.Parse(from, _zone);
        var end = string.IsNullOrWhiteSpace(to) ? null : ZonedTime.Parse(to, _zone);
        if (!ModelState.IsValid || (start is null && !string.IsNullOrWhiteSpace(from)) || (end is null && !string.IsNullOrWhiteSpace(to)))
            return Invalid("kind, from, to and limit must be valid values");
        if (start > end)
            return Invalid("from must not be after to");

        var found = await records.QueryAsync(new RecordQuery(string.IsNullOrWhiteSpace(kind) ? null : kind.Trim(), start, end, limit), ct);
        return Ok(found.Select(RecordResponse.From));
    }

    private static double? ValueFromField(KindDefinition kind, JsonElement? data)
    {
        if (kind.ValueField is null || data is not { ValueKind: JsonValueKind.Object } obj)
            return null;
        return obj.TryGetProperty(kind.ValueField, out var field) && field.ValueKind == JsonValueKind.Number
            && field.TryGetDouble(out var number) && double.IsFinite(number) ? number : null;
    }

    private static void CheckLength(List<string> errors, string name, string? value, int max)
    {
        if (value is not null && value.Length > max)
            errors.Add($"{name} must be at most {max} characters");
    }
}
