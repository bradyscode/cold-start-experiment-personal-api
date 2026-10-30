using System.Net;

namespace personal_api.Tests;

public class CorsTests
{
    private const string Allowed = "https://app.example.com";

    private static TestApp AppAllowing(params string[] origins)
    {
        var settings = new Dictionary<string, string?>();
        for (var i = 0; i < origins.Length; i++)
            settings[$"Cors:AllowedOrigins:{i}"] = origins[i];
        return new TestApp().WithSettings(settings);
    }

    private static HttpRequestMessage Preflight(string origin, string path = "/feed")
    {
        var request = new HttpRequestMessage(HttpMethod.Options, path);
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "PUT");
        request.Headers.Add("Access-Control-Request-Headers", "content-type");
        return request;
    }

    private static string? AllowOrigin(HttpResponseMessage response) =>
        response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values) ? string.Join(",", values) : null;

    [Fact]
    public async Task Preflight_from_an_allowed_origin_succeeds()
    {
        using var app = AppAllowing(Allowed);

        var response = await app.CreateClient().SendAsync(Preflight(Allowed));

        Assert.True(response.StatusCode is HttpStatusCode.NoContent or HttpStatusCode.OK);
        Assert.Equal(Allowed, AllowOrigin(response));
        var headers = string.Join(",", response.Headers.GetValues("Access-Control-Allow-Headers"));
        Assert.Contains("content-type", headers, StringComparison.OrdinalIgnoreCase);
        var methods = string.Join(",", response.Headers.GetValues("Access-Control-Allow-Methods"));
        Assert.Contains("PUT", methods);
        Assert.Equal("600", string.Join(",", response.Headers.GetValues("Access-Control-Max-Age")));
        Assert.False(response.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    [Fact]
    public async Task Preflight_from_a_disallowed_origin_gets_no_allow_origin_header()
    {
        using var app = AppAllowing(Allowed);

        var response = await app.CreateClient().SendAsync(Preflight("https://evil.example.com"));

        Assert.Null(AllowOrigin(response));
    }

    [Fact]
    public async Task Actual_request_from_an_allowed_origin_includes_allow_origin()
    {
        using var app = AppAllowing(Allowed);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Add("Origin", Allowed);

        var response = await client.GetAsync("/feed");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Allowed, AllowOrigin(response));
    }

    [Fact]
    public async Task No_configured_origins_means_no_cors_headers()
    {
        using var app = new TestApp();

        var preflight = await app.CreateClient().SendAsync(Preflight(Allowed));
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Add("Origin", Allowed);
        var actual = await client.GetAsync("/feed");

        Assert.Null(AllowOrigin(preflight));
        Assert.Null(AllowOrigin(actual));
    }

    [Fact]
    public async Task A_second_configured_origin_is_allowed_and_others_are_not()
    {
        using var app = AppAllowing(Allowed, "http://localhost:5173");

        var second = await app.CreateClient().SendAsync(Preflight("http://localhost:5173"));
        var other = await app.CreateClient().SendAsync(Preflight("http://localhost:5174"));

        Assert.Equal("http://localhost:5173", AllowOrigin(second));
        Assert.Null(AllowOrigin(other));
    }

    [Theory]
    [InlineData("*")]
    [InlineData("https://*.example.com")]
    [InlineData("https://app.example.com/path")]
    [InlineData("https://app.example.com/")]
    [InlineData("app.example.com")]
    [InlineData("/relative")]
    [InlineData("ftp://app.example.com")]
    [InlineData("https://user@app.example.com")]
    [InlineData("https://app.example.com:443")]
    [InlineData("http://app.example.com:80")]
    public void Invalid_origin_setting_fails_startup(string origin)
    {
        using var app = AppAllowing(origin);

        var ex = Assert.ThrowsAny<Exception>(() => app.CreateClient());

        Assert.Contains("Cors:AllowedOrigins", ex.ToString());
    }

    [Fact]
    public async Task Production_does_not_allow_the_development_origin()
    {
        using var app = new TestApp().WithEnvironment("Production").WithAppsettingsCors();

        var response = await app.CreateClient().SendAsync(Preflight("http://localhost:5173"));

        Assert.Null(AllowOrigin(response));
    }

    [Fact]
    public async Task Development_allows_the_vite_dev_origin_from_appsettings()
    {
        using var app = new TestApp().WithEnvironment("Development").WithAppsettingsCors();

        var response = await app.CreateClient().SendAsync(Preflight("http://localhost:5173"));

        Assert.Equal("http://localhost:5173", AllowOrigin(response));
    }

    [Theory]
    [InlineData("http://localhost:5173")]
    [InlineData("https://app.example.com")]
    public void Valid_origin_setting_starts(string origin)
    {
        using var app = AppAllowing(origin);
        app.CreateClient();
    }
}
