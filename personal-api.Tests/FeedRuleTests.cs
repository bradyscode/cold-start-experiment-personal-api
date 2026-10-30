using personal_api.Domain;
using personal_api.Domain.Feed;
using personal_api.Domain.Feed.Rules;

namespace personal_api.Tests;

public class FeedRuleTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly KindDefinition Kind = new("range_session", "Range session", "rounds", [new("rounds", FieldType.Number, true)], "rounds");

    private static LifeRecord Rec(DateTimeOffset at, double? value, string? unit = "rounds") =>
        new(Guid.NewGuid(), "api", "range_session", at, value, unit, "t", null, null, at);

    private static LifeRecord Day(string date, double? value) => Rec(DateTimeOffset.Parse(date + "T12:00:00Z"), value);

    private static FeedContext Context(params LifeRecord[] records) =>
        new(Now, TimeZoneInfo.Utc, [Kind], new Dictionary<string, IReadOnlyList<LifeRecord>> { [Kind.Key] = records });

    private static LifeRecord[] Filler(int count, double value, string startDate = "2025-12-01") =>
        Enumerable.Range(0, count).Select(i => Rec(DateTimeOffset.Parse(startDate + "T12:00:00Z").AddDays(i), value)).ToArray();

    [Fact]
    public void Personal_best_fires_on_a_new_max_after_a_ten_day_gap()
    {
        var ordered = new[] { Day("2025-12-05", 40), Day("2025-12-06", 50), Day("2025-12-07", 60), Day("2025-12-08", 70), Day("2025-12-10", 1300), Day("2025-12-11", 80), Day("2025-12-20", 1250) };

        var card = Assert.Single(new PersonalBestRule().Evaluate(Context(ordered)));

        Assert.Equal("Best Range session in 10 days", card.Headline);
        Assert.Equal("Last higher was 1,300 on Dec 10", card.Detail);
        Assert.Equal("1,250", card.Big);
        Assert.Equal("rounds", card.Unit);
        Assert.Equal(90, card.Score);
        Assert.Equal("personal_best:range_session:20251220", card.Id);
        Assert.Equal(new FeedChartRef("range_session", "day", "max", 30), card.Chart);
    }

    [Fact]
    public void Personal_best_with_no_earlier_higher_value_is_best_on_record()
    {
        var records = Filler(5, 50).Append(Day("2025-12-20", 52)).ToArray();

        var card = Assert.Single(new PersonalBestRule().Evaluate(Context(records)));

        Assert.Equal("Best Range session on record", card.Headline);
        Assert.Equal("From 6 entries", card.Detail);
        Assert.Equal("52", card.Big);
    }

    [Fact]
    public void Personal_best_does_not_fire_with_four_records()
    {
        var records = Filler(3, 50).Append(Day("2025-12-20", 52)).ToArray();
        Assert.Empty(new PersonalBestRule().Evaluate(Context(records)));
    }

    [Fact]
    public void Personal_best_does_not_fire_on_a_tie()
    {
        var records = Filler(5, 50).Append(Day("2025-12-10", 50)).ToArray().OrderBy(r => r.OccurredAt).ToArray();
        Assert.Empty(new PersonalBestRule().Evaluate(Context(records)));
    }

    [Fact]
    public void Personal_best_does_not_fire_on_a_tie_after_a_long_gap()
    {
        var records = Filler(5, 150).Append(Day("2025-12-20", 150)).ToArray();
        Assert.Empty(new PersonalBestRule().Evaluate(Context(records)));
    }

    [Fact]
    public void Personal_best_fires_when_one_above_an_older_equal_value()
    {
        var records = Sorted(Day("2025-12-01", 150), Day("2025-12-02", 40), Day("2025-12-03", 40), Day("2025-12-04", 40), Day("2025-12-05", 40), Day("2025-12-20", 151));
        var card = Assert.Single(new PersonalBestRule().Evaluate(Context(records)));
        Assert.Equal("Best Range session on record", card.Headline);
        Assert.Equal("From 6 entries", card.Detail);
    }

    [Fact]
    public void Personal_best_does_not_fire_inside_a_three_day_gap()
    {
        var records = new[] { Day("2025-12-01", 40), Day("2025-12-02", 40), Day("2025-12-03", 40), Day("2025-12-04", 40), Day("2025-12-17", 100), Day("2025-12-20", 100) };
        Assert.Empty(new PersonalBestRule().Evaluate(Context(records)));
    }

    [Fact]
    public void Vs_average_fires_at_plus_twenty_percent()
    {
        var records = Filler(5, 10).Append(Day("2025-12-20", 12)).ToArray();

        var card = Assert.Single(new VsAverageRule().Evaluate(Context(records)));

        Assert.Equal("Range session is 20% above your 30-day average", card.Headline);
        Assert.Equal("Average 10", card.Detail);
        Assert.Equal("12", card.Big);
        Assert.Equal(60, card.Score);
        Assert.Equal("vs_average:range_session:20251220", card.Id);
        Assert.Equal(new FeedChartRef("range_session", "day", "avg", 30), card.Chart);
    }

    [Fact]
    public void Vs_average_fires_at_minus_twenty_percent()
    {
        var records = Filler(5, 10).Append(Day("2025-12-20", 8)).ToArray();

        var card = Assert.Single(new VsAverageRule().Evaluate(Context(records)));

        Assert.Equal("Range session is 20% below your 30-day average", card.Headline);
        Assert.Equal("Average 10", card.Detail);
    }

    [Fact]
    public void Vs_average_does_not_fire_at_plus_ten_percent()
    {
        var records = Filler(5, 10).Append(Day("2025-12-20", 11)).ToArray();
        Assert.Empty(new VsAverageRule().Evaluate(Context(records)));
    }

    [Fact]
    public void Vs_average_does_not_fire_with_four_prior_points()
    {
        var records = Filler(4, 10).Append(Day("2025-12-20", 20)).ToArray();
        Assert.Empty(new VsAverageRule().Evaluate(Context(records)));
    }

    [Fact]
    public void Kinds_without_a_value_field_chart_by_count_and_empty_input_yields_nothing()
    {
        var plain = new KindDefinition("note", "Note", null, []);
        var records = Filler(5, 10).Append(Day("2025-12-20", 20)).Select(r => r with { Kind = "note" }).ToArray();
        var context = new FeedContext(Now, TimeZoneInfo.Utc, [plain], new Dictionary<string, IReadOnlyList<LifeRecord>> { ["note"] = records });

        Assert.Equal("count", new VsAverageRule().Evaluate(context).Single().Chart.Agg);
        Assert.Empty(new PersonalBestRule().Evaluate(new FeedContext(Now, TimeZoneInfo.Utc, [plain], new Dictionary<string, IReadOnlyList<LifeRecord>>())));
    }

    private static LifeRecord[] Sorted(params LifeRecord[] records) => records.OrderBy(r => r.OccurredAt).ToArray();

    [Fact]
    public void Personal_best_needs_exactly_five_valued_records()
    {
        Assert.Single(new PersonalBestRule().Evaluate(Context(Filler(4, 50).Append(Day("2025-12-20", 52)).ToArray())));
        Assert.Empty(new PersonalBestRule().Evaluate(Context(Filler(3, 50).Append(Day("2025-12-20", 52)).ToArray())));
    }

    [Fact]
    public void Personal_best_ignores_records_without_a_value_when_counting()
    {
        var records = Filler(3, 50).Append(Day("2025-12-10", null)).Append(Day("2025-12-20", 52)).ToArray();
        Assert.Empty(new PersonalBestRule().Evaluate(Context(records)));
    }

    [Theory]
    [InlineData("2025-12-13", true)]
    [InlineData("2025-12-14", false)]
    public void Personal_best_gap_boundary_is_seven_days(string previousDate, bool fires)
    {
        var records = Sorted(Day("2025-12-01", 10), Day("2025-12-02", 10), Day("2025-12-03", 10), Day("2025-12-04", 10), Day(previousDate, 120), Day("2025-12-20", 110));

        var cards = new PersonalBestRule().Evaluate(Context(records)).ToList();

        Assert.Equal(fires, cards.Count == 1);
        if (fires)
            Assert.Equal("Best Range session in 7 days", cards[0].Headline);
    }

    [Fact]
    public void Personal_best_gap_counts_local_calendar_days()
    {
        var chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
        // 6 days 1 hour apart in UTC, but 7 calendar days apart in Chicago.
        var records = Sorted(Day("2025-12-01", 10), Day("2025-12-02", 10), Day("2025-12-03", 10), Day("2025-12-04", 10),
            Rec(DateTimeOffset.Parse("2025-12-13T23:30:00-06:00"), 120), Rec(DateTimeOffset.Parse("2025-12-20T00:30:00-06:00"), 110));
        var context = new FeedContext(Now, chicago, [Kind], new Dictionary<string, IReadOnlyList<LifeRecord>> { [Kind.Key] = records });

        var card = Assert.Single(new PersonalBestRule().Evaluate(context));

        Assert.Equal("Best Range session in 7 days", card.Headline);
    }

    [Fact]
    public void Personal_best_looks_past_ninety_days_for_the_previous_record()
    {
        var records = Sorted(Day("2025-09-01", 5000), Day("2025-12-01", 50), Day("2025-12-02", 50), Day("2025-12-03", 50), Day("2025-12-04", 50), Day("2025-12-05", 50), Day("2025-12-20", 60));

        var card = Assert.Single(new PersonalBestRule().Evaluate(Context(records)));

        Assert.Equal("Best Range session in 110 days", card.Headline);
        Assert.Equal("Last higher was 5,000 on Sep 1", card.Detail);
    }

    [Fact]
    public void Personal_best_on_record_means_no_higher_value_in_all_of_history()
    {
        var records = Sorted(Day("2020-01-01", 59), Day("2025-12-01", 50), Day("2025-12-02", 50), Day("2025-12-03", 50), Day("2025-12-04", 50), Day("2025-12-20", 60));

        var card = Assert.Single(new PersonalBestRule().Evaluate(Context(records)));

        Assert.Equal("Best Range session on record", card.Headline);
        Assert.Equal("From 6 entries", card.Detail);
    }

    [Fact]
    public void Personal_best_counts_old_records_toward_the_minimum_and_the_entry_total()
    {
        var old = Enumerable.Range(0, 4).Select(i => Day($"2024-0{i + 1}-01", 10)).ToArray();
        var records = old.Append(Day("2025-12-20", 60)).ToArray();

        var card = Assert.Single(new PersonalBestRule().Evaluate(Context(records)));

        Assert.Equal("From 5 entries", card.Detail);
        Assert.Empty(new PersonalBestRule().Evaluate(Context(old.Skip(1).Append(Day("2025-12-20", 60)).ToArray())));
    }

    [Fact]
    public void Personal_best_ties_with_an_old_record_do_not_fire()
    {
        var records = Sorted(Day("2024-01-01", 60), Day("2025-12-01", 50), Day("2025-12-02", 50), Day("2025-12-03", 50), Day("2025-12-04", 50), Day("2025-12-20", 60));
        Assert.Empty(new PersonalBestRule().Evaluate(Context(records)));
    }

    [Fact]
    public void Personal_best_keeps_the_seven_day_minimum_for_a_far_older_previous_record()
    {
        // The previous higher value is 3 days before the latest, even though much older ones exist.
        var records = Sorted(Day("2024-01-01", 5000), Day("2025-12-01", 50), Day("2025-12-02", 50), Day("2025-12-03", 50), Day("2025-12-17", 100), Day("2025-12-20", 90));
        Assert.Empty(new PersonalBestRule().Evaluate(Context(records)));
    }

    [Fact]
    public void Personal_best_for_a_lower_is_better_kind_looks_past_ninety_days()
    {
        var lowerKind = Kind with { Better = "lower" };
        var records = Sorted(Day("2025-01-01", 1), Day("2025-12-01", 50), Day("2025-12-02", 50), Day("2025-12-03", 50), Day("2025-12-04", 50), Day("2025-12-20", 40));
        var context = new FeedContext(Now, TimeZoneInfo.Utc, [lowerKind], new Dictionary<string, IReadOnlyList<LifeRecord>> { [lowerKind.Key] = records });

        var card = Assert.Single(new PersonalBestRule().Evaluate(context));

        Assert.Equal("Lowest Range session in 353 days", card.Headline);
        Assert.Equal("Last lower was 1 on Jan 1", card.Detail);
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(-1, false)]
    [InlineData(1, true)]
    public void Personal_best_is_only_for_a_record_within_ninety_days(int secondsFromEdge, bool fires)
    {
        var latest = Rec(Now.AddDays(-90).AddSeconds(secondsFromEdge), 60);
        var records = Sorted(Day("2025-09-01", 10), Day("2025-09-02", 10), Day("2025-09-03", 10), Day("2025-09-04", 10), latest);
        Assert.Equal(fires, new PersonalBestRule().Evaluate(Context(records)).Any());
    }

    [Fact]
    public void Vs_average_over_999_percent_says_over_999()
    {
        var card = Assert.Single(new VsAverageRule().Evaluate(Context(Filler(5, 1e-9).Append(Day("2025-12-20", 1e12)).ToArray())));

        Assert.Equal("Range session is over 999% above your 30-day average", card.Headline);
        Assert.Equal("Average 0", card.Detail);
        Assert.Equal("1,000,000,000,000", card.Big);
    }

    [Theory]
    [InlineData(1099, "Range session is 999% above your 30-day average")]
    [InlineData(1100, "Range session is over 999% above your 30-day average")]
    [InlineData(1e12, "Range session is over 999% above your 30-day average")]
    public void Vs_average_switches_to_over_999_just_above_the_limit(double latest, string headline)
    {
        var card = Assert.Single(new VsAverageRule().Evaluate(Context(Filler(5, 100).Append(Day("2025-12-20", latest)).ToArray())));
        Assert.Equal(headline, card.Headline);
    }

    [Fact]
    public void Vs_average_below_never_exceeds_100_percent()
    {
        var card = Assert.Single(new VsAverageRule().Evaluate(Context(Filler(5, 1e12).Append(Day("2025-12-20", 0)).ToArray())));
        Assert.Equal("Range session is 100% below your 30-day average", card.Headline);
    }

    [Theory]
    [InlineData(1e12, "1,000,000,000,000")]
    [InlineData(999999999999999, "999,999,999,999,999")]
    [InlineData(1e15, "1E+15")]
    [InlineData(-1e15, "-1E+15")]
    [InlineData(1.7e308, "1.7E+308")]
    public void Big_never_prints_more_than_fifteen_digits(double value, string expected)
    {
        Assert.Equal(expected, FeedFormat.Big(value));
    }

    [Fact]
    public void Vs_average_detail_stays_short_for_a_stored_outlier()
    {
        var records = Filler(5, 1e300).Append(Day("2025-12-20", 1)).ToArray();
        var card = Assert.Single(new VsAverageRule().Evaluate(Context(records)));
        Assert.Equal("Average 1E+300", card.Detail);
        Assert.Equal("Range session is 100% below your 30-day average", card.Headline);
    }

    [Theory]
    [InlineData(115, true)]
    [InlineData(114, false)]
    [InlineData(85, true)]
    [InlineData(86, false)]
    public void Vs_average_threshold_boundary_is_fifteen_percent(double latest, bool fires)
    {
        var records = Filler(5, 100).Append(Day("2025-12-20", latest)).ToArray();
        Assert.Equal(fires, new VsAverageRule().Evaluate(Context(records)).Any());
    }

    [Fact]
    public void Vs_average_rounds_the_percent_away_from_zero()
    {
        var records = Filler(5, 100).Append(Day("2025-12-20", 116.6)).ToArray();

        var card = Assert.Single(new VsAverageRule().Evaluate(Context(records)));

        Assert.Equal("Range session is 17% above your 30-day average", card.Headline);
        Assert.Equal("Average 100", card.Detail);
        Assert.Equal("116.6", card.Big);
    }

    [Fact]
    public void Vs_average_with_a_zero_average_yields_no_card()
    {
        var records = Filler(5, 0).Append(Day("2025-12-20", 5)).ToArray();
        Assert.Empty(new VsAverageRule().Evaluate(Context(records)));
    }

    [Fact]
    public void Vs_average_ignores_records_older_than_thirty_days_before_the_latest()
    {
        var old = Filler(5, 1000, "2025-11-01");
        var recent = new[] { Day("2025-12-10", 10), Day("2025-12-11", 10), Day("2025-12-12", 10), Day("2025-12-13", 10) };
        var latest = Day("2025-12-20", 20);

        Assert.Empty(new VsAverageRule().Evaluate(Context(old.Concat(recent).Append(latest).ToArray())));

        var card = Assert.Single(new VsAverageRule().Evaluate(Context(old.Concat(recent).Append(Day("2025-12-14", 10)).Append(latest).ToArray())));
        Assert.Equal("Average 10", card.Detail);
    }

    [Fact]
    public void Cards_use_the_configured_zone_for_ids_and_dates()
    {
        var chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
        var records = Sorted(Filler(4, 10).Concat([Rec(DateTimeOffset.Parse("2025-12-10T23:30:00-06:00"), 120), Rec(DateTimeOffset.Parse("2025-12-20T23:30:00-06:00"), 110)]).ToArray());
        var context = new FeedContext(Now, chicago, [Kind], new Dictionary<string, IReadOnlyList<LifeRecord>> { [Kind.Key] = records });

        var best = Assert.Single(new PersonalBestRule().Evaluate(context));
        var avg = new VsAverageRule().Evaluate(context).ToList();

        Assert.Equal("personal_best:range_session:20251220", best.Id);
        Assert.Equal("Last higher was 120 on Dec 10", best.Detail);
        Assert.All(avg, c => Assert.Equal("vs_average:range_session:20251220", c.Id));
    }

    private static readonly KindDefinition Note = new("note", "Note", null, []);
    private static readonly TimeZoneInfo Chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

    private static LifeRecord NoteAt(string iso) =>
        new(Guid.NewGuid(), "api", "note", DateTimeOffset.Parse(iso), null, null, "t", null, null, DateTimeOffset.Parse(iso));

    private static LifeRecord ValueAt(string iso, double value) => Rec(DateTimeOffset.Parse(iso), value);

    private static FeedContext Ctx(string now, TimeZoneInfo zone, KindDefinition kind, params LifeRecord[] records) =>
        new(DateTimeOffset.Parse(now), zone, [kind], new Dictionary<string, IReadOnlyList<LifeRecord>> { [kind.Key] = Sorted(records) });

    private static LifeRecord[] Notes(params string[] days) => days.Select(d => NoteAt(d + "T12:00:00Z")).ToArray();

    private static LifeRecord[] NotesBackFrom(string lastDay, int count) =>
        Enumerable.Range(0, count).Select(i => NoteAt(DateTimeOffset.Parse(lastDay + "T12:00:00Z").AddDays(-i).ToString("O"))).ToArray();

    [Fact]
    public void Streak_fires_at_three_consecutive_days_ending_yesterday()
    {
        var card = Assert.Single(new StreakRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note, Notes("2025-12-29", "2025-12-30", "2025-12-31"))));

        Assert.Equal("3-day Note streak", card.Headline);
        Assert.Equal("3", card.Big);
        Assert.Equal("days", card.Unit);
        Assert.Equal("Longest in the last 90 days: 3", card.Detail);
        Assert.Equal(73, card.Score);
        Assert.Equal("streak:note:20251231", card.Id);
        Assert.Equal(new FeedChartRef("note", "day", "count", 30), card.Chart);
        Assert.Equal("streak", card.Rule);
    }

    [Fact]
    public void Streak_does_not_fire_at_two_days()
    {
        Assert.Empty(new StreakRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note, Notes("2025-12-30", "2025-12-31"))));
    }

    [Fact]
    public void Streak_counts_a_day_with_many_records_once()
    {
        var many = Enumerable.Range(0, 5).Select(i => NoteAt($"2025-12-31T0{i}:00:00Z")).ToArray();

        Assert.Empty(new StreakRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note, many.Append(NoteAt("2025-12-30T12:00:00Z")).ToArray())));
        var card = Assert.Single(new StreakRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note, many.Append(NoteAt("2025-12-30T12:00:00Z")).Append(NoteAt("2025-12-29T12:00:00Z")).ToArray())));
        Assert.Equal("3-day Note streak", card.Headline);
    }

    [Fact]
    public void Streak_is_alive_when_the_last_record_was_yesterday_and_dead_two_days_ago()
    {
        Assert.Single(new StreakRule().Evaluate(Ctx("2026-01-01T12:00:00Z", TimeZoneInfo.Utc, Note, Notes("2025-12-29", "2025-12-30", "2025-12-31"))));
        Assert.Empty(new StreakRule().Evaluate(Ctx("2026-01-02T00:00:00Z", TimeZoneInfo.Utc, Note, Notes("2025-12-29", "2025-12-30", "2025-12-31"))));
        Assert.Single(new StreakRule().Evaluate(Ctx("2026-01-01T12:00:00Z", TimeZoneInfo.Utc, Note, Notes("2025-12-30", "2025-12-31", "2026-01-01"))));
    }

    [Fact]
    public void Streak_is_broken_by_a_gap_day()
    {
        var card = Assert.Single(new StreakRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note,
            Notes("2025-12-24", "2025-12-25", "2025-12-26", "2025-12-27", "2025-12-29", "2025-12-30", "2025-12-31"))));

        Assert.Equal("3-day Note streak", card.Headline);
        Assert.Equal("Longest in the last 90 days: 4", card.Detail);
    }

    [Fact]
    public void Streak_ignores_records_after_now()
    {
        Assert.Empty(new StreakRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note, Notes("2025-12-31", "2026-01-02", "2026-01-03"))));
    }

    [Theory]
    [InlineData(3, 73)]
    [InlineData(29, 99)]
    [InlineData(30, 100)]
    [InlineData(45, 100)]
    public void Streak_score_is_seventy_plus_length_capped_at_thirty(int days, int score)
    {
        var card = Assert.Single(new StreakRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note, NotesBackFrom("2025-12-31", days))));

        Assert.Equal(score, card.Score);
        Assert.Equal($"{days}-day Note streak", card.Headline);
    }

    [Theory]
    [InlineData("2025-10-04", 4, 4)]
    [InlineData("2025-10-03", 4, 3)]
    public void Streak_longest_window_covers_exactly_the_last_ninety_local_days(string oldRunStart, int oldRunDays, int expectedLongest)
    {
        var old = Enumerable.Range(0, oldRunDays).Select(i => NoteAt(DateTimeOffset.Parse(oldRunStart + "T12:00:00Z").AddDays(i).ToString("O")));
        var records = old.Concat(Notes("2025-12-29", "2025-12-30", "2025-12-31")).ToArray();

        var card = Assert.Single(new StreakRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note, records)));

        Assert.Equal($"Longest in the last 90 days: {expectedLongest}", card.Detail);
    }

    [Fact]
    public void Streak_longest_is_never_below_the_current_streak()
    {
        var card = Assert.Single(new StreakRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note, NotesBackFrom("2025-12-31", 95))));

        Assert.Equal("Longest in the last 90 days: 95", card.Detail);
    }

    [Fact]
    public void Streak_cuts_days_in_the_configured_zone()
    {
        // Chicago local days Jun 29, Jun 30 only; in UTC the 00:30 and 23:30 records on Jun 30 would be two days.
        var split = new[] { NoteAt("2026-06-29T12:00:00-05:00"), NoteAt("2026-06-30T00:30:00-05:00"), NoteAt("2026-06-30T23:30:00-05:00") };
        Assert.Empty(new StreakRule().Evaluate(Ctx("2026-07-02T03:00:00Z", Chicago, Note, split)));
        Assert.Single(new StreakRule().Evaluate(Ctx("2026-07-02T03:00:00Z", TimeZoneInfo.Utc, Note, split)));

        var three = new[] { NoteAt("2026-06-28T23:30:00-05:00"), NoteAt("2026-06-29T23:30:00-05:00"), NoteAt("2026-06-30T23:30:00-05:00") };
        var card = Assert.Single(new StreakRule().Evaluate(Ctx("2026-07-02T03:00:00Z", Chicago, Note, three)));
        Assert.Equal("streak:note:20260630", card.Id);
    }

    [Fact]
    public void Milestone_fires_when_the_latest_record_takes_the_total_from_95_to_105()
    {
        var card = Assert.Single(new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind,
            ValueAt("2020-01-01T12:00:00Z", 85), ValueAt("2025-12-20T12:00:00Z", 10), ValueAt("2025-12-30T12:00:00Z", 10))));

        Assert.Equal("100 rounds of Range session", card.Headline);
        Assert.Equal("Counting since Jan 1, 2020", card.Detail);
        Assert.Equal("100", card.Big);
        Assert.Equal("rounds", card.Unit);
        Assert.Equal(85, card.Score);
        Assert.Equal("milestone", card.Rule);
        Assert.Equal("milestone:range_session:20251230", card.Id);
        Assert.Equal(new FeedChartRef("range_session", "day", "sum", 30), card.Chart);
    }

    [Theory]
    [InlineData(10, true)]
    [InlineData(9, false)]
    public void Milestone_needs_the_total_to_reach_the_threshold_exactly(double latest, bool fires)
    {
        var cards = new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-12-01T12:00:00Z", 90), ValueAt("2025-12-30T12:00:00Z", latest))).ToList();

        Assert.Equal(fires, cards.Count == 1);
    }

    [Fact]
    public void Milestone_does_not_fire_when_the_total_was_already_past_the_threshold()
    {
        Assert.Empty(new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-12-01T12:00:00Z", 100), ValueAt("2025-12-30T12:00:00Z", 5))));
    }

    [Fact]
    public void Milestone_emits_one_card_for_the_highest_threshold_crossed()
    {
        var card = Assert.Single(new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-12-01T12:00:00Z", 5), ValueAt("2025-12-30T12:00:00Z", 1000))));

        Assert.Equal("1,000 rounds of Range session", card.Headline);
        Assert.Equal("Counting since Dec 1, 2025", card.Detail);
        Assert.Equal("1,000", card.Big);
    }

    [Theory]
    [InlineData("2025-12-18T12:00:00Z", true)]
    [InlineData("2025-12-17T12:00:00Z", false)]
    public void Milestone_needs_the_crossing_record_within_fourteen_days(string at, bool fires)
    {
        var cards = new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-01-01T12:00:00Z", 95), ValueAt(at, 10))).ToList();

        Assert.Equal(fires, cards.Count == 1);
    }

    [Fact]
    public void Milestone_age_uses_local_days_in_the_configured_zone()
    {
        // Chicago local Dec 17 is 15 days before Jan 1; the UTC date (Dec 18) would be 14.
        var old = ValueAt("2025-12-17T23:30:00-06:00", 10);
        Assert.Empty(new MilestoneRule().Evaluate(Ctx("2026-01-01T12:00:00Z", Chicago, Kind, ValueAt("2025-01-01T12:00:00Z", 95), old)));
        Assert.Single(new MilestoneRule().Evaluate(Ctx("2026-01-01T12:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-01-01T12:00:00Z", 95), old)));

        var card = Assert.Single(new MilestoneRule().Evaluate(Ctx("2026-01-01T12:00:00Z", Chicago, Kind, ValueAt("2025-01-01T12:00:00Z", 95), ValueAt("2025-12-18T23:30:00-06:00", 10))));
        Assert.Equal("milestone:range_session:20251218", card.Id);
    }

    [Fact]
    public void Milestone_ignores_records_after_now()
    {
        Assert.Empty(new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-12-01T12:00:00Z", 85), ValueAt("2025-12-30T12:00:00Z", 10), ValueAt("2026-01-02T12:00:00Z", 10))));
    }

    [Theory]
    [InlineData(10, true)]
    [InlineData(9, false)]
    public void Milestone_counts_entries_for_kinds_without_a_value_field(int count, bool fires)
    {
        var records = NotesBackFrom("2025-12-30", count);

        var cards = new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note, records)).ToList();

        Assert.Equal(fires, cards.Count == 1);
        if (fires)
        {
            Assert.Equal("10 entries of Note", cards[0].Headline);
            Assert.Equal("Counting since Dec 21, 2025", cards[0].Detail);
            Assert.Equal("entries", cards[0].Unit);
            Assert.Equal(new FeedChartRef("note", "day", "count", 30), cards[0].Chart);
        }
    }

    [Fact]
    public void Milestone_counts_entries_when_a_valued_kind_has_no_valued_records()
    {
        var records = Enumerable.Range(0, 10).Select(i => Rec(DateTimeOffset.Parse("2025-12-30T12:00:00Z").AddHours(-i), null)).ToArray();

        var card = Assert.Single(new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, records)));

        Assert.Equal("10 entries of Range session", card.Headline);
        Assert.Equal("count", card.Chart.Agg);
    }

    [Fact]
    public void Weekly_reports_this_week_total_and_last_week_detail()
    {
        var card = Assert.Single(new WeeklyRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind,
            ValueAt("2025-12-21T12:00:00Z", 100), ValueAt("2025-12-22T12:00:00Z", 3), ValueAt("2025-12-28T12:00:00Z", 4),
            ValueAt("2025-12-29T12:00:00Z", 5), ValueAt("2025-12-31T12:00:00Z", 7), ValueAt("2026-01-02T12:00:00Z", 1000))));

        Assert.Equal("Range session this week", card.Headline);
        Assert.Equal("12", card.Big);
        Assert.Equal("rounds", card.Unit);
        Assert.Equal("Last week: 7", card.Detail);
        Assert.Equal(50, card.Score);
        Assert.Equal("weekly", card.Rule);
        Assert.Equal("weekly:range_session:20251231", card.Id);
        Assert.Equal(new FeedChartRef("range_session", "week", "sum", 28), card.Chart);
    }

    [Fact]
    public void Weekly_week_starts_on_monday_at_local_midnight()
    {
        Assert.Empty(new WeeklyRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-12-28T23:59:00Z", 5))));

        var card = Assert.Single(new WeeklyRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-12-29T00:00:00Z", 5))));
        Assert.Equal("5", card.Big);
    }

    [Fact]
    public void Weekly_on_a_sunday_still_counts_monday_through_sunday_and_monday_starts_a_new_week()
    {
        var sunday = Assert.Single(new WeeklyRule().Evaluate(Ctx("2026-01-04T23:59:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-12-29T00:00:00Z", 5), ValueAt("2026-01-04T23:00:00Z", 2))));
        Assert.Equal("7", sunday.Big);

        Assert.Empty(new WeeklyRule().Evaluate(Ctx("2026-01-05T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2026-01-04T23:59:00Z", 5))));
        var monday = Assert.Single(new WeeklyRule().Evaluate(Ctx("2026-01-05T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2026-01-04T23:59:00Z", 5), ValueAt("2026-01-05T00:00:00Z", 2))));
        Assert.Equal("Last week: 5", monday.Detail);
    }

    [Fact]
    public void Weekly_last_week_starts_on_the_previous_monday()
    {
        var included = Assert.Single(new WeeklyRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-12-22T00:00:00Z", 3), ValueAt("2025-12-30T12:00:00Z", 1))));
        Assert.Equal("Last week: 3", included.Detail);

        var excluded = Assert.Single(new WeeklyRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-12-21T23:59:00Z", 3), ValueAt("2025-12-30T12:00:00Z", 1))));
        Assert.Equal("Last week: 0", excluded.Detail);
    }

    [Fact]
    public void Weekly_zero_last_week_prints_zero_and_no_records_this_week_means_no_card()
    {
        var card = Assert.Single(new WeeklyRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, ValueAt("2025-12-30T12:00:00Z", 5))));
        Assert.Equal("Last week: 0", card.Detail);

        Assert.Empty(new WeeklyRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind)));
    }

    [Fact]
    public void Weekly_counts_entries_for_kinds_without_values()
    {
        var card = Assert.Single(new WeeklyRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Note,
            NoteAt("2025-12-30T12:00:00Z"), NoteAt("2025-12-30T13:00:00Z"), NoteAt("2025-12-31T12:00:00Z"), NoteAt("2025-12-23T12:00:00Z"), NoteAt("2025-12-24T12:00:00Z"))));

        Assert.Equal("3", card.Big);
        Assert.Equal("entries", card.Unit);
        Assert.Equal("Last week: 2", card.Detail);
        Assert.Equal(new FeedChartRef("note", "week", "count", 28), card.Chart);
    }

    [Fact]
    public void Weekly_cuts_the_week_in_the_configured_zone()
    {
        // 23:59 Chicago Sunday is Monday in UTC, so UTC would count both records in the same week.
        var records = new[] { ValueAt("2025-12-28T23:59:00-06:00", 9), ValueAt("2025-12-29T00:00:00-06:00", 5) };

        var card = Assert.Single(new WeeklyRule().Evaluate(Ctx("2026-01-01T00:00:00Z", Chicago, Kind, records)));
        Assert.Equal("5", card.Big);
        Assert.Equal("Last week: 9", card.Detail);

        var utc = Assert.Single(new WeeklyRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, records)));
        Assert.Equal("14", utc.Big);
    }

    [Fact]
    public void Milestone_counting_since_uses_the_first_record_in_the_configured_zone()
    {
        // 2025-12-01 23:30 Chicago is already Dec 2 in UTC.
        var records = new[] { ValueAt("2025-12-01T23:30:00-06:00", 90), ValueAt("2025-12-30T12:00:00Z", 10) };

        var chicago = Assert.Single(new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", Chicago, Kind, records)));
        var utc = Assert.Single(new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind, records)));

        Assert.Equal("Counting since Dec 1, 2025", chicago.Detail);
        Assert.Equal("Counting since Dec 2, 2025", utc.Detail);
    }

    [Fact]
    public void Milestone_counting_since_ignores_records_after_now()
    {
        var card = Assert.Single(new MilestoneRule().Evaluate(Ctx("2026-01-01T00:00:00Z", TimeZoneInfo.Utc, Kind,
            ValueAt("2025-12-05T12:00:00Z", 90), ValueAt("2025-12-30T12:00:00Z", 10), ValueAt("2026-02-01T12:00:00Z", 1))));
        Assert.Equal("Counting since Dec 5, 2025", card.Detail);
    }

    [Fact]
    public void Long_date_formats_month_day_and_year_in_the_zone()
    {
        Assert.Equal("Jun 1, 2026", FeedFormat.LongDate(DateTimeOffset.Parse("2026-06-01T12:00:00Z"), TimeZoneInfo.Utc));
        Assert.Equal("May 31, 2026", FeedFormat.LongDate(DateTimeOffset.Parse("2026-06-01T03:00:00Z"), Chicago));
    }
}
