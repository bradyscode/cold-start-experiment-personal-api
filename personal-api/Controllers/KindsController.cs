using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using personal_api.Domain;

namespace personal_api.Controllers;

[ApiController]
public partial class KindsController(IKindStore kinds) : ApiControllerBase
{
    private const int MaxCategoryLength = 40;
    private static readonly HashSet<string> Aggregations = ["sum", "avg", "max", "count"];
    private static readonly HashSet<string> Directions = ["higher", "lower", "none"];

    [GeneratedRegex("^[a-z][a-z0-9_]{1,40}$")]
    private static partial Regex KeyPattern();

    [HttpGet("/kinds")]
    public async Task<IReadOnlyList<KindDefinition>> List(CancellationToken ct) => await kinds.ListAsync(ct);

    [HttpPut("/kinds/{key}")]
    public async Task<IActionResult> Put(string key, [FromBody] KindDefinition? kind, CancellationToken ct)
    {
        if (kind is null)
            return Invalid("Request body must be a kind definition");

        var errors = Validate(key, kind);
        if (errors.Count > 0)
            return Invalid(errors);

        var normalized = kind with
        {
            Fields = kind.Fields ?? [],
            Category = string.IsNullOrWhiteSpace(kind.Category) ? null : kind.Category.Trim(),
            DefaultAgg = kind.DefaultAgg?.Trim().ToLowerInvariant(),
            Better = kind.Better?.Trim().ToLowerInvariant(),
        };
        await kinds.SaveAsync(normalized, ct);
        return Ok(normalized);
    }

    private static void ValidateBounds(FieldDefinition field, List<string> errors)
    {
        if (field.Min is null && field.Max is null && !field.Integer)
            return;
        if (field.Type != FieldType.Number)
        {
            errors.Add($"Field '{field.Name}' can only have min, max or integer when it is a Number field");
            return;
        }
        if (field.Min is { } min && !double.IsFinite(min))
            errors.Add($"Field '{field.Name}' min must be a finite number");
        if (field.Max is { } max && !double.IsFinite(max))
            errors.Add($"Field '{field.Name}' max must be a finite number");
        else if (field.Min is { } low && field.Max is { } high && double.IsFinite(low) && low > high)
            errors.Add($"Field '{field.Name}' min must not be greater than max");
    }

    private static List<string> Validate(string routeKey, KindDefinition kind)
    {
        var errors = new List<string>();
        if (kind.Key != routeKey)
            errors.Add("Key in the body must match the key in the route");
        if (!KeyPattern().IsMatch(routeKey))
            errors.Add("Key must match ^[a-z][a-z0-9_]{1,40}$");

        if (string.IsNullOrWhiteSpace(kind.DisplayName))
            errors.Add("displayName is required");

        var names = new HashSet<string>();
        foreach (var field in kind.Fields ?? [])
        {
            if (string.IsNullOrWhiteSpace(field?.Name))
            {
                errors.Add("Field names must not be blank");
                continue;
            }
            if (!Enum.IsDefined(field.Type))
                errors.Add($"Field '{field.Name}' has an unknown type");
            if (!names.Add(field.Name))
                errors.Add($"Duplicate field name '{field.Name}'");
            if (field.Type == FieldType.Choice && field.Options is not { Count: > 0 })
                errors.Add($"Choice field '{field.Name}' needs at least one option");
            ValidateBounds(field, errors);
        }
        if (kind.ValueField is not null && !(kind.Fields ?? []).Any(f => f?.Name == kind.ValueField && f.Type == FieldType.Number))
            errors.Add($"valueField '{kind.ValueField}' must name a Number field of the kind");

        if (kind.Category is { } category && category.Trim().Length > MaxCategoryLength)
            errors.Add($"category must be at most {MaxCategoryLength} characters");

        var agg = kind.DefaultAgg?.Trim().ToLowerInvariant();
        if (agg is not null && !Aggregations.Contains(agg))
            errors.Add("defaultAgg must be one of sum, avg, max, count");
        else if (agg is "sum" or "avg" or "max" && kind.ValueField is null)
            errors.Add($"defaultAgg '{agg}' needs a valueField (only count works without one)");

        var better = kind.Better?.Trim().ToLowerInvariant();
        if (better is not null && !Directions.Contains(better))
            errors.Add("better must be one of higher, lower, none");
        return errors;
    }
}
