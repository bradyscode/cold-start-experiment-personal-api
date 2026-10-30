using Microsoft.Extensions.Options;

namespace personal_api.Security;

public sealed class CorsSettings
{
    public const string SectionName = "Cors";
    public const string PolicyName = "WebApp";

    public string[] AllowedOrigins { get; set; } = [];

    public string[] Origins => AllowedOrigins.Where(o => !string.IsNullOrWhiteSpace(o)).ToArray();
}

public sealed class CorsSettingsValidator : IValidateOptions<CorsSettings>
{
    public ValidateOptionsResult Validate(string? name, CorsSettings options)
    {
        var failures = options.Origins
            .Where(o => !IsOrigin(o))
            .Select(o => $"Cors:AllowedOrigins entry '{o}' must be an absolute origin like https://app.example.com (scheme, host, optional port; no path, trailing slash or wildcard)")
            .ToList();
        return failures.Count > 0 ? ValidateOptionsResult.Fail(failures) : ValidateOptionsResult.Success;
    }

    // Default ports (https://host:443) are rejected: browsers omit them from the Origin header, so they would never match.
    private static bool IsOrigin(string value) =>
        !value.Contains('*') &&
        Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme is "http" or "https" &&
        uri.UserInfo.Length == 0 &&
        string.Equals(value, uri.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase);
}
