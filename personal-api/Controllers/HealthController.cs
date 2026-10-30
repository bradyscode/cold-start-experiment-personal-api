using Microsoft.AspNetCore.Mvc;

namespace personal_api.Controllers;

[ApiController]
public class HealthController : ControllerBase
{
    [HttpGet("/health")]
    public IActionResult Get() => Ok(new { status = "ok" });
}
