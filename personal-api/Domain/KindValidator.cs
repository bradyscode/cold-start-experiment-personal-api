using System.Text.Json;

namespace personal_api.Domain;

public static class KindValidator
{
    public const double MaxNumber = 1e12;

    public static string OutOfRange(string name) => $"{name} must be between -1000000000000 and 1000000000000";

    public static IReadOnlyList<string> Validate(KindDefinition kind, string? dataJson)
    {
        var errors = new List<string>();

        JsonDocument? doc = null;
        try
        {
            if (!string.IsNullOrWhiteSpace(dataJson))
                doc = JsonDocument.Parse(dataJson);
        }
        catch (JsonException)
        {
            return ["Data is not valid JSON."];
        }

        using (doc)
        {
            var root = doc?.RootElement;
            if (root is { ValueKind: JsonValueKind.Null })
                root = null;

            if (root is { ValueKind: not JsonValueKind.Object })
                return ["Data must be a JSON object."];

            foreach (var field in kind.Fields)
            {
                JsonElement value = default;
                var present = root is { } obj && obj.TryGetProperty(field.Name, out value) && value.ValueKind != JsonValueKind.Null;

                if (!present)
                {
                    if (field.Required)
                        errors.Add($"Field '{field.Name}' is required.");
                    continue;
                }

                var error = CheckType(field, value) ?? (field.Type == FieldType.Number ? CheckNumber(field, value) : null);
                if (error is not null)
                    errors.Add(error);
            }
        }

        return errors;
    }

    private static string? CheckNumber(FieldDefinition field, JsonElement value)
    {
        if (!value.TryGetDouble(out var number) || !double.IsFinite(number) || Math.Abs(number) > MaxNumber)
            return OutOfRange(field.Name);
        if (field.Integer && number != Math.Floor(number))
            return $"{field.Name} must be a whole number";
        if (field.Min is { } min && number < min)
            return FormattableString.Invariant($"{field.Name} must be at least {min}");
        if (field.Max is { } max && number > max)
            return FormattableString.Invariant($"{field.Name} must be at most {max}");
        return null;
    }

    private static string? CheckType(FieldDefinition field, JsonElement value) => field.Type switch
    {
        FieldType.Text when value.ValueKind != JsonValueKind.String => $"Field '{field.Name}' must be text.",
        FieldType.Number when value.ValueKind != JsonValueKind.Number => $"Field '{field.Name}' must be a number.",
        FieldType.Boolean when value.ValueKind is not (JsonValueKind.True or JsonValueKind.False) => $"Field '{field.Name}' must be true or false.",
        FieldType.Date when value.ValueKind != JsonValueKind.String || !DateTimeOffset.TryParse(value.GetString(), out _) => $"Field '{field.Name}' must be a date.",
        FieldType.Choice when value.ValueKind != JsonValueKind.String || field.Options is null || !field.Options.Contains(value.GetString()!) =>
            $"Field '{field.Name}' must be one of: {string.Join(", ", field.Options ?? [])}.",
        _ => null,
    };
}
