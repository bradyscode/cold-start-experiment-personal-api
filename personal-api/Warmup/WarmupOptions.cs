using Microsoft.Extensions.Options;

namespace personal_api.Warmup;

public sealed class WarmupOptions
{
    public const string SectionName = "Warmup";

    public bool Enabled { get; set; } = true;
    // Keep the cache filled: refresh before entries expire and shortly after a write clears them.
    public bool RefreshAhead { get; set; } = true;
    public int Connections { get; set; } = 8;
    public string OverviewDays { get; set; } = "7,30,90,365";

    public IReadOnlyList<int> ParseOverviewDays() =>
        OverviewDays.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(d => int.TryParse(d, out var n) ? n : 0).Where(n => n is >= 1 and <= 365).Distinct().ToList();
}

public sealed class WarmupOptionsValidator : IValidateOptions<WarmupOptions>
{
    public ValidateOptionsResult Validate(string? name, WarmupOptions options)
    {
        if (options.Connections is < 0 or > 64)
            return ValidateOptionsResult.Fail("Warmup:Connections must be between 0 and 64");
        var parts = options.OverviewDays.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Any(p => !int.TryParse(p, out var n) || n is < 1 or > 365))
            return ValidateOptionsResult.Fail("Warmup:OverviewDays must be a comma-separated list of whole numbers from 1 to 365");
        return ValidateOptionsResult.Success;
    }
}
