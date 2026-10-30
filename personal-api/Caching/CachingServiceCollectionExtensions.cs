using Microsoft.Extensions.DependencyInjection.Extensions;
using personal_api.Domain;
using personal_api.Domain.Analytics;
using personal_api.Domain.Feed;

namespace personal_api.Caching;

public static class CachingServiceCollectionExtensions
{
    public const string UncachedKey = "uncached";

    // Call after the services it wraps are registered. With Cache:Enabled=false nothing is wrapped, which is the baseline for load tests.
    public static IServiceCollection AddReadCaching(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<CacheOptions>()
            .Bind(configuration.GetSection(CacheOptions.SectionName))
            .ValidateOnStart();
        services.AddSingleton<Microsoft.Extensions.Options.IValidateOptions<CacheOptions>, CacheOptionsValidator>();

        if (!configuration.GetValue(CacheOptions.SectionName + ":Enabled", true))
            return services;

        services.AddSingleton<IReadCache, ReadCache>();
        if (configuration.GetValue(Warmup.WarmupOptions.SectionName + ":RefreshAhead", true) && configuration.GetValue(Warmup.WarmupOptions.SectionName + ":Enabled", true))
            services.AddHostedService<Warmup.CacheRefreshService>();
        Decorate<IKindStore, CachedKindStore>(services);
        Decorate<IRecordStore, CachedRecordStore>(services);
        Decorate<IFeedService, CachedFeedService>(services);
        Decorate<IAnalyticsService, CachedAnalyticsService>(services);
        return services;
    }

    // The original registration stays available under UncachedKey so the decorator (and its background computations) can reach it.
    private static void Decorate<TService, TDecorator>(IServiceCollection services)
        where TService : class
        where TDecorator : class, TService
    {
        var original = services.Last(d => d.ServiceType == typeof(TService) && !d.IsKeyedService);
        services.Remove(original);
        services.Add(new ServiceDescriptor(typeof(TService), UncachedKey, original.ImplementationType!, original.Lifetime));
        services.Add(new ServiceDescriptor(typeof(TService), sp => ActivatorUtilities.CreateInstance<TDecorator>(sp), original.Lifetime));
    }

    internal static async Task<TResult> InFreshScopeAsync<TService, TResult>(this IServiceScopeFactory scopes, Func<TService, Task<TResult>> run)
        where TService : class
    {
        await using var scope = scopes.CreateAsyncScope();
        return await run(scope.ServiceProvider.GetRequiredKeyedService<TService>(UncachedKey));
    }

    internal static TService Uncached<TService>(this IServiceProvider services) where TService : class =>
        services.GetRequiredKeyedService<TService>(UncachedKey);
}
