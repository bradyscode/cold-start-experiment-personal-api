using Microsoft.Extensions.Options;

namespace personal_api.Caching;

public sealed class CacheOptions
{
    public const string SectionName = "Cache";

    public bool Enabled { get; set; } = true;
    public int TtlSeconds { get; set; } = 30;
    public int MaxEntries { get; set; } = 512;
}

public sealed class CacheOptionsValidator : IValidateOptions<CacheOptions>
{
    public ValidateOptionsResult Validate(string? name, CacheOptions options)
    {
        if (options.TtlSeconds is < 1 or > 3600)
            return ValidateOptionsResult.Fail("Cache:TtlSeconds must be between 1 and 3600");
        if (options.MaxEntries is < 1 or > 100_000)
            return ValidateOptionsResult.Fail("Cache:MaxEntries must be between 1 and 100000");
        return ValidateOptionsResult.Success;
    }
}
