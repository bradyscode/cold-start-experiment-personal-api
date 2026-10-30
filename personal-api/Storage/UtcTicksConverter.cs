using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace personal_api.Storage;

public sealed class UtcTicksConverter() : ValueConverter<DateTimeOffset, long>(
    v => v.UtcTicks,
    v => new DateTimeOffset(v, TimeSpan.Zero));
