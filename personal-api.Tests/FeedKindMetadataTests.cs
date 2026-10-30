using personal_api.Domain;
using personal_api.Domain.Feed;
using personal_api.Domain.Feed.Rules;

namespace personal_api.Tests;

public class FeedKindMetadataTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static KindDefinition MakeKind(string key, string name, string unit, string? agg, string? better) =>
        new(key, name, unit, [new("v", FieldType.Number, true)], "v", "Health", agg, better);

    private static LifeRecord Rec(string kind, string date, double? value, string? unit) =>
        new(Guid.NewGuid(), "api", kind, DateTimeOffset.Parse(date + "T12:00:00Z"), value, unit, "t", null, null, DateTimeOffset.Parse(date + "T12:00:00Z"));

    private static FeedContext Context(KindDefinition kind, params LifeRecord[] records) =>
        new(Now, TimeZoneInfo.Utc, [kind], new Dictionary<string, IReadOnlyList<LifeRecord>> { [kind.Key] = records });

    // ---- weekly ----

    [Fact]
    public void Weekly_for_an_averaged_kind_shows_the_average_not_the_sum()
    {
        var kind = MakeKind("weight", "Weight", "lb", "avg", "none");
        var card = Assert.Single(new WeeklyRule().Evaluate(Context(kind,
            Rec("weight", "2025-12-23", 190, "lb"), Rec("weight", "2025-12-26", 188, "lb"),
            Rec("weight", "2025-12-29", 180, "lb"), Rec("weight", "2025-12-30", 182, "lb"), Rec("weight", "2025-12-31", 184, "lb"))));

        Assert.Equal("Weight average this week", card.Headline);
        Assert.Equal("182", card.Big);
        Assert.Equal("lb", card.Unit);
        Assert.Equal("Last week: 189", card.Detail);
        Assert.Equal(new FeedChartRef("weight", "week", "avg", 28), card.Chart);
    }

    [Fact]
    public void Weekly_for_an_averaged_kind_says_none_when_last_week_had_no_readings()
    {
        var kind = MakeKind("weight", "Weight", "lb", "avg", "none");
        var card = Assert.Single(new WeeklyRule().Evaluate(Context(kind, Rec("weight", "2025-12-30", 180, "lb"))));
        Assert.Equal("Last week: none", card.Detail);
    }

    [Fact]
    public void Weekly_for_a_max_kind_shows_the_peak()
    {
        var kind = MakeKind("vo2max", "VO2 max", "ml/kg/min", "max", "higher");
        var card = Assert.Single(new WeeklyRule().Evaluate(Context(kind,
            Rec("vo2max", "2025-12-23", 50, "ml/kg/min"), Rec("vo2max", "2025-12-30", 48, "ml/kg/min"), Rec("vo2max", "2025-12-31", 52, "ml/kg/min"))));

        Assert.Equal("VO2 max peak this week", card.Headline);
        Assert.Equal("52", card.Big);
        Assert.Equal("Last week: 50", card.Detail);
        Assert.Equal("max", card.Chart.Agg);
    }

    [Fact]
    public void Weekly_for_a_count_kind_with_a_value_field_counts_entries()
    {
        var kind = MakeKind("github_commit", "Commit", "lines", "count", null);
        var card = Assert.Single(new WeeklyRule().Evaluate(Context(kind,
            Rec("github_commit", "2025-12-29", 500, "lines"), Rec("github_commit", "2025-12-30", 700, "lines"))));

        Assert.Equal("2", card.Big);
        Assert.Equal("entries", card.Unit);
        Assert.Equal("count", card.Chart.Agg);
    }

    [Fact]
    public void Weekly_for_a_default_sum_kind_is_unchanged()
    {
        var kind = MakeKind("steps", "Steps", "steps", "sum", "higher");
        var card = Assert.Single(new WeeklyRule().Evaluate(Context(kind,
            Rec("steps", "2025-12-29", 8000, "steps"), Rec("steps", "2025-12-30", 9000, "steps"))));

        Assert.Equal("Steps this week", card.Headline);
        Assert.Equal("17,000", card.Big);
        Assert.Equal("sum", card.Chart.Agg);
    }

    // ---- milestone ----

    private static LifeRecord[] CrossingHundred(string kind) =>
        [Rec(kind, "2025-12-01", 60, "x"), Rec(kind, "2025-12-28", 45, "x")];

    [Fact]
    public void Milestone_fires_for_a_summed_kind()
    {
        var kind = MakeKind("steps", "Steps", "x", "sum", "higher");
        Assert.Single(new MilestoneRule().Evaluate(Context(kind, CrossingHundred("steps"))));
    }

    [Theory]
    [InlineData("avg")]
    [InlineData("max")]
    public void Milestone_never_fires_for_averaged_or_peak_kinds(string agg)
    {
        var kind = MakeKind("weight", "Weight", "x", agg, "none");
        Assert.Empty(new MilestoneRule().Evaluate(Context(kind, CrossingHundred("weight"))));
    }

    [Fact]
    public void Milestone_for_a_count_kind_counts_entries_even_when_values_exist()
    {
        var kind = MakeKind("github_commit", "Commit", "lines", "count", null);
        var records = Enumerable.Range(0, 10).Select(i => Rec("github_commit", $"2025-12-{10 + i:00}", 1000, "lines")).ToArray();
        var card = Assert.Single(new MilestoneRule().Evaluate(Context(kind, records)));

        Assert.Equal("10", card.Big);
        Assert.Equal("entries", card.Unit);
    }

    // ---- personal best ----

    private static LifeRecord[] LowSeries(string kind) =>
    [
        Rec(kind, "2025-12-05", 100, "bpm"), Rec(kind, "2025-12-06", 90, "bpm"), Rec(kind, "2025-12-07", 80, "bpm"),
        Rec(kind, "2025-12-08", 70, "bpm"), Rec(kind, "2025-12-10", 48, "bpm"), Rec(kind, "2025-12-11", 75, "bpm"),
        Rec(kind, "2025-12-20", 50, "bpm"),
    ];

    [Fact]
    public void Personal_best_for_a_lower_is_better_kind_fires_on_a_new_low()
    {
        var kind = MakeKind("resting_hr", "Resting heart rate", "bpm", "avg", "lower");
        var card = Assert.Single(new PersonalBestRule().Evaluate(Context(kind, LowSeries("resting_hr"))));

        Assert.Equal("Lowest Resting heart rate in 10 days", card.Headline);
        Assert.Equal("Last lower was 48 on Dec 10", card.Detail);
        Assert.Equal("50", card.Big);
        Assert.Equal("avg", card.Chart.Agg);
    }

    [Fact]
    public void Personal_best_for_a_lower_is_better_kind_on_record_says_lowest()
    {
        var kind = MakeKind("resting_hr", "Resting heart rate", "bpm", "avg", "lower");
        var records = Enumerable.Range(0, 5).Select(i => Rec("resting_hr", $"2025-12-{1 + i:00}", 100, "bpm"))
            .Append(Rec("resting_hr", "2025-12-20", 60, "bpm")).ToArray();

        var card = Assert.Single(new PersonalBestRule().Evaluate(Context(kind, records)));

        Assert.Equal("Lowest Resting heart rate on record", card.Headline);
        Assert.Equal("From 6 entries", card.Detail);
    }

    [Fact]
    public void Personal_best_does_not_fire_on_a_tie_for_a_lower_is_better_kind()
    {
        var kind = MakeKind("resting_hr", "Resting heart rate", "bpm", "avg", "lower");
        var records = LowSeries("resting_hr").SkipLast(1).Append(Rec("resting_hr", "2025-12-20", 48, "bpm")).ToArray();
        Assert.Empty(new PersonalBestRule().Evaluate(Context(kind, records)));
    }

    [Fact]
    public void Personal_best_never_fires_for_a_kind_with_no_direction()
    {
        var kind = MakeKind("weight", "Weight", "lb", "avg", "none");
        var records = Enumerable.Range(0, 5).Select(i => Rec("weight", $"2025-12-{1 + i:00}", 100, "lb"))
            .Append(Rec("weight", "2025-12-20", 150, "lb")).ToArray();
        Assert.Empty(new PersonalBestRule().Evaluate(Context(kind, records)));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("higher")]
    public void Personal_best_for_a_higher_is_better_or_unspecified_kind_still_says_best(string? better)
    {
        var kind = MakeKind("sleep", "Sleep", "hours", "sum", better);
        var records = Enumerable.Range(0, 5).Select(i => Rec("sleep", $"2025-12-{1 + i:00}", 6, "hours"))
            .Append(Rec("sleep", "2025-12-20", 8, "hours")).ToArray();

        var card = Assert.Single(new PersonalBestRule().Evaluate(Context(kind, records)));
        Assert.Equal("Best Sleep on record", card.Headline);
    }
}
