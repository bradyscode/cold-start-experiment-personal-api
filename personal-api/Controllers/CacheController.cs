using Microsoft.AspNetCore.Mvc;
using personal_api.Caching;

namespace personal_api.Controllers;

[ApiController]
public class CacheController(IServiceProvider services) : ApiControllerBase
{
    [HttpGet("/cache/stats")]
    public IActionResult Stats() =>
        services.GetService<IReadCache>() is { } cache
            ? Ok(new { enabled = true, stats = cache.GetStats() })
            : Ok(new { enabled = false });
}
