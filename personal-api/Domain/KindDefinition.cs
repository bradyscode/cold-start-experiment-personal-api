namespace personal_api.Domain;

public enum FieldType { Text, Number, Boolean, Date, Choice }

public sealed record FieldDefinition(string Name, FieldType Type, bool Required, string? Label = null, IReadOnlyList<string>? Options = null, double? Min = null, double? Max = null, bool Integer = false);

// Category groups trackers in the UI; DefaultAgg (sum|avg|max|count) says how a day's values combine; Better (higher|lower|none) says which direction is a personal best.
public sealed record KindDefinition(
    string Key, string DisplayName, string? DefaultUnit, IReadOnlyList<FieldDefinition> Fields,
    string? ValueField = null, string? Category = null, string? DefaultAgg = null, string? Better = null);
