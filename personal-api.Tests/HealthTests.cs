using System.Net;

namespace personal_api.Tests;

public class HealthTests
{
    [Fact]
    public async Task Health_returns_200_without_a_key()
    {
        using var app = new TestApp();
        var response = await app.CreateClient().GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
