using Microsoft.Extensions.Options;

namespace personal_api.Domain.Feed;

public sealed class FeedOptions
{
    public const string SectionName = "Feed";

    public string TimeZone { get; set; } = "UTC";
}

public sealed class FeedOptionsValidator : IValidateOptions<FeedOptions>
{
    public ValidateOptionsResult Validate(string? name, FeedOptions options)
    {
        try
        {
            TimeZoneInfo.FindSystemTimeZoneById(options.TimeZone);
            return ValidateOptionsResult.Success;
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException or ArgumentException)
        {
            return ValidateOptionsResult.Fail($"Feed:TimeZone '{options.TimeZone}' is not a known IANA or Windows time zone id");
        }
    }
}
