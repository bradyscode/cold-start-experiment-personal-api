using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using personal_api.Domain.Feed;

namespace personal_api.Controllers;

[ApiController]
public class FeedController(IFeedService feed) : ApiControllerBase
{
    private const int DefaultLimit = 20;
    private const int MaxLimit = 50;

    [HttpGet("/feed")]
    public async Task<IActionResult> Get([FromQuery] string? limit, CancellationToken ct)
    {
        var take = DefaultLimit;
        if (!string.IsNullOrWhiteSpace(limit))
        {
            if (!int.TryParse(limit.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out take))
                return Invalid("limit must be a whole number");
            take = take <= 0 ? DefaultLimit : Math.Min(take, MaxLimit);
        }

        return Ok(await feed.GetAsync(take, ct));
    }
}
