namespace personal_api.Domain.Feed;

public static class FeedDays
{
    public static DateTime LocalDate(DateTimeOffset instant, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTime(instant, zone).Date;

    // Whole local calendar days from earlier to later.
    public static int Gap(DateTimeOffset earlier, DateTimeOffset later, TimeZoneInfo zone) =>
        (LocalDate(later, zone) - LocalDate(earlier, zone)).Days;

    // Monday of the local week containing the date.
    public static DateTime WeekStart(DateTime localDate) =>
        localDate.AddDays(-(((int)localDate.DayOfWeek + 6) % 7));
}
