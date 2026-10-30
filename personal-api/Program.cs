using System.Text.Json.Serialization;
using personal_api.Caching;
using personal_api.Domain;
using personal_api.Domain.Feed;
using personal_api.Domain.Feed.Rules;
using personal_api.Domain.Series;
using personal_api.Kinds;
using personal_api.Security;
using personal_api.Storage;
using personal_api.Warmup;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddStorage(builder.Configuration);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddOptions<FeedOptions>()
    .Bind(builder.Configuration.GetSection(FeedOptions.SectionName))
    .ValidateOnStart();
builder.Services.AddSingleton<Microsoft.Extensions.Options.IValidateOptions<FeedOptions>, FeedOptionsValidator>();
builder.Services.AddOptions<CorsSettings>()
    .Bind(builder.Configuration.GetSection(CorsSettings.SectionName))
    .ValidateOnStart();
builder.Services.AddSingleton<Microsoft.Extensions.Options.IValidateOptions<CorsSettings>, CorsSettingsValidator>();
builder.Services.AddCors();
builder.Services.AddOptions<Microsoft.AspNetCore.Cors.Infrastructure.CorsOptions>()
    .Configure<Microsoft.Extensions.Options.IOptions<CorsSettings>>((cors, settings) =>
        cors.AddPolicy(CorsSettings.PolicyName, policy => policy
            .WithOrigins(settings.Value.Origins)
            .AllowAnyHeader()
            .WithMethods("GET", "POST", "PUT", "OPTIONS")
            .SetPreflightMaxAge(TimeSpan.FromMinutes(10))));
builder.Services.AddScoped<ISeriesService, SeriesService>();
builder.Services.AddScoped<personal_api.Domain.Analytics.IAnalyticsService, personal_api.Domain.Analytics.AnalyticsService>();
builder.Services.AddSingleton<IFeedRule, PersonalBestRule>();
builder.Services.AddSingleton<IFeedRule, VsAverageRule>();
builder.Services.AddSingleton<IFeedRule, StreakRule>();
builder.Services.AddSingleton<IFeedRule, MilestoneRule>();
builder.Services.AddSingleton<IFeedRule, WeeklyRule>();
builder.Services.AddScoped<IFeedService, FeedService>();
builder.Services.AddOptions<WarmupOptions>()
    .Bind(builder.Configuration.GetSection(WarmupOptions.SectionName))
    .ValidateOnStart();
builder.Services.AddSingleton<Microsoft.Extensions.Options.IValidateOptions<WarmupOptions>, WarmupOptionsValidator>();
builder.Services.AddSingleton<CacheWarmer>();
builder.Services.AddReadCaching(builder.Configuration);
builder.Services.AddControllers(o => o.SuppressImplicitRequiredAttributeForNonNullableReferenceTypes = true)
    .ConfigureApiBehaviorOptions(o => o.SuppressModelStateInvalidFilter = true)
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

await app.Services.EnsureStorageCreatedAsync();
using (var scope = app.Services.CreateScope())
{
    await KindSeeder.SeedAsync(scope.ServiceProvider.GetRequiredService<IKindStore>(), CancellationToken.None);
}

// Runs before the server listens, so the first request already meets compiled code, an open connection pool and a filled cache.
if (app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<WarmupOptions>>().Value.Enabled)
    await app.Services.GetRequiredService<CacheWarmer>().WarmAsync(CancellationToken.None);

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Development serves plain HTTP to the dev web app; a redirect would break the CORS preflight.
if (!app.Environment.IsDevelopment())
    app.UseHttpsRedirection();

app.UseCors(CorsSettings.PolicyName);

app.MapControllers();

app.Run();

public partial class Program { }
