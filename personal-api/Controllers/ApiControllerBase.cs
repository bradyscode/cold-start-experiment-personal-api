using Microsoft.AspNetCore.Mvc;

namespace personal_api.Controllers;

public abstract class ApiControllerBase : ControllerBase
{
    protected BadRequestObjectResult Invalid(params string[] errors) => BadRequest(new { errors });

    protected BadRequestObjectResult Invalid(List<string> errors) => BadRequest(new { errors });
}
