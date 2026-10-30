using personal_api.Domain.Analytics;

namespace personal_api.Tests;

public class AnalyticsMathTests
{
    private static double?[] D(params double[] values) => values.Select(v => (double?)v).ToArray();

    private static void AssertFiniteOrNull(PairStats s)
    {
        foreach (var v in new[] { s.R, s.R2, s.Slope, s.Intercept })
            Assert.True(v is null || double.IsFinite(v.Value), $"non-finite output {v}");
    }

    [Fact]
    public void Perfect_positive_line_is_plus_one()
    {
        var s = AnalyticsMath.Pearson(D(1, 2, 3, 4, 5, 6), D(3, 5, 7, 9, 11, 13));
        Assert.Equal(1.0, s.R!.Value, 12);
        Assert.Equal(1.0, s.R2!.Value, 12);
        Assert.Equal(2.0, s.Slope!.Value, 12);
        Assert.Equal(1.0, s.Intercept!.Value, 12);
        Assert.Equal(6, s.N);
        Assert.Null(s.Reason);
    }

    [Fact]
    public void Perfect_negative_line_is_minus_one()
    {
        var s = AnalyticsMath.Pearson(D(1, 2, 3, 4, 5), D(10, 8, 6, 4, 2));
        Assert.Equal(-1.0, s.R!.Value, 12);
        Assert.Equal(1.0, s.R2!.Value, 12);
        Assert.Equal(-2.0, s.Slope!.Value, 12);
    }

    [Fact]
    public void Hand_computed_example_matches_to_six_decimals()
    {
        // x mean 3, y mean 4: Sxy = 6, Sxx = 10, Syy = 6, so r = 6 / sqrt(60).
        var s = AnalyticsMath.Pearson(D(1, 2, 3, 4, 5), D(2, 4, 5, 4, 5));
        Assert.Equal(0.774597, Math.Round(s.R!.Value, 6));
        Assert.Equal(0.6, Math.Round(s.R2!.Value, 6));
        Assert.Equal(0.6, Math.Round(s.Slope!.Value, 6));
        Assert.Equal(2.2, Math.Round(s.Intercept!.Value, 6));
        Assert.Equal(5, s.N);
    }

    [Fact]
    public void Constant_series_has_no_r_and_says_no_variation()
    {
        foreach (var (a, b) in new[] { (D(4, 4, 4, 4, 4, 4), D(1, 2, 3, 4, 5, 6)), (D(1, 2, 3, 4, 5, 6), D(0.1, 0.1, 0.1, 0.1, 0.1, 0.1)) })
        {
            var s = AnalyticsMath.Pearson(a, b);
            Assert.Null(s.R);
            Assert.Null(s.R2);
            Assert.Equal("no variation", s.Reason);
            Assert.Equal(6, s.N);
        }
    }

    [Fact]
    public void Fewer_than_five_overlapping_buckets_has_no_r()
    {
        var s = AnalyticsMath.Pearson(D(1, 2, 3, 4), D(2, 4, 6, 9), bucketNoun: "days");
        Assert.Null(s.R);
        Assert.Equal(4, s.N);
        Assert.Equal("fewer than 5 overlapping days", s.Reason);
    }

    [Fact]
    public void Nulls_are_skipped_pairwise()
    {
        double?[] a = [1, null, 3, 4, 5, 6, 7];
        double?[] b = [2, 9, null, 8, 10, 12, 14];
        var s = AnalyticsMath.Pearson(a, b);
        Assert.Equal(5, s.N);
        Assert.Equal(1.0, s.R!.Value, 12);
    }

    [Fact]
    public void Five_overlapping_after_skipping_is_enough_but_four_is_not()
    {
        double?[] a = [1, 2, 3, 4, 5, null];
        double?[] b = [1, 3, 2, 5, null, 6];
        var s = AnalyticsMath.Pearson(a, b);
        Assert.Equal(4, s.N);
        Assert.Null(s.R);
    }

    [Fact]
    public void Lag_pairs_a_with_b_shifted_later_and_finds_the_known_best_lag()
    {
        double[] a = [1, 5, 2, 8, 3, 9, 4, 7, 6, 10, 2, 5, 8, 1, 9, 3];
        // b repeats a two buckets later.
        var b = new double?[a.Length];
        for (var i = 0; i < a.Length; i++) b[i] = i >= 2 ? a[i - 2] : 0;
        var aa = a.Select(v => (double?)v).ToArray();

        var lag2 = AnalyticsMath.Pearson(aa, b, 2);
        Assert.Equal(2, lag2.Lag);
        Assert.Equal(1.0, lag2.R!.Value, 12);
        Assert.Equal(a.Length - 2, lag2.N);

        var profile = Enumerable.Range(-4, 9).Select(l => AnalyticsMath.Pearson(aa, b, l)).ToList();
        Assert.Equal(2, AnalyticsMath.BestLag(profile)!.Lag);
        Assert.True(Math.Abs(profile.Single(p => p.Lag == 0).R!.Value) < 0.9);
    }

    [Fact]
    public void Negative_lag_shifts_the_other_way()
    {
        double?[] a = [0, 0, 1, 5, 2, 8, 3, 9, 4, 7];
        double?[] b = [1, 5, 2, 8, 3, 9, 4, 7, 0, 0];
        var s = AnalyticsMath.Pearson(a, b, -2);
        Assert.Equal(1.0, s.R!.Value, 12);
        Assert.Equal(8, s.N);
    }

    [Fact]
    public void Best_lag_prefers_the_strongest_absolute_r_then_the_smallest_lag()
    {
        var lags = new List<PairStats>
        {
            new(-1, -0.8, 0.64, 10, null, null, null),
            new(0, 0.5, 0.25, 10, null, null, null),
            new(1, 0.8, 0.64, 10, null, null, null),
            new(3, null, null, 3, null, null, "fewer than 5 overlapping days"),
        };
        Assert.Equal(-1, AnalyticsMath.BestLag(lags)!.Lag);
        Assert.Null(AnalyticsMath.BestLag([new(0, null, null, 2, null, null, "x")]));
        Assert.Equal(0, AnalyticsMath.BestLag([new(2, 0.7, 0.49, 9, null, null, null), new(0, -0.7, 0.49, 9, null, null, null)])!.Lag);
    }

    [Fact]
    public void NaN_and_infinity_never_reach_the_output()
    {
        double?[] withBad = [1, double.NaN, 3, double.PositiveInfinity, 5, 6, 7, double.NegativeInfinity];
        double?[] other = [2, 2, 6, 2, 10, 12, 14, 3];
        var s = AnalyticsMath.Pearson(withBad, other);
        Assert.Equal(5, s.N);
        Assert.Equal(1.0, s.R!.Value, 12);
        AssertFiniteOrNull(s);

        var huge = AnalyticsMath.Pearson(D(1e300, -1e300, 1e300, -1e300, 5e299, 1e300), D(1e300, -1e300, 9e299, -1e300, 4e299, 1e300));
        AssertFiniteOrNull(huge);
        Assert.NotNull(huge.R);
        Assert.InRange(huge.R!.Value, -1, 1);

        var tiny = AnalyticsMath.Pearson(D(1e-300, 2e-300, 3e-300, 4e-300, 5e-300), D(2, 4, 6, 8, 10));
        AssertFiniteOrNull(tiny);
        Assert.Equal(1.0, tiny.R!.Value, 9);

        var empty = AnalyticsMath.Pearson([], []);
        Assert.Null(empty.R);
        Assert.Equal(0, empty.N);
        AssertFiniteOrNull(empty);
    }

    [Fact]
    public void R_is_clamped_to_the_unit_interval()
    {
        var rnd = new Random(3);
        for (var t = 0; t < 200; t++)
        {
            var a = Enumerable.Range(0, 12).Select(_ => (double?)rnd.NextDouble() * 1000).ToArray();
            var b = a.Select(v => (double?)(v * 3.3 + 7)).ToArray();
            var s = AnalyticsMath.Pearson(a, b);
            Assert.InRange(s.R!.Value, -1, 1);
            Assert.InRange(s.R2!.Value, 0, 1);
        }
    }

    [Fact]
    public void Describe_reports_total_mean_min_max_sample_stddev_and_trend()
    {
        var s = AnalyticsMath.Describe(D(2, 4, 4, 4, 5, 5, 7, 9));
        Assert.Equal(8, s.N);
        Assert.Equal(40, s.Total);
        Assert.Equal(5, s.Mean);
        Assert.Equal(2, s.Min);
        Assert.Equal(9, s.Max);
        // Sum of squared deviations is 32, so the sample std dev is sqrt(32 / 7).
        Assert.Equal(Math.Sqrt(32.0 / 7), s.StdDev!.Value, 12);
        Assert.True(s.Slope > 0);

        Assert.Equal(2.0, AnalyticsMath.Describe(D(1, 3, 5, 7)).Slope!.Value, 12);
    }

    [Fact]
    public void Describe_skips_missing_values_and_handles_empty_and_single()
    {
        var s = AnalyticsMath.Describe([null, 3, double.NaN, 5, null]);
        Assert.Equal(2, s.N);
        Assert.Equal(4, s.Mean);
        Assert.Equal(8, s.Total);

        var none = AnalyticsMath.Describe([null, null]);
        Assert.Equal(0, none.N);
        Assert.Null(none.Mean);
        Assert.Null(none.Total);
        Assert.Null(none.StdDev);
        Assert.Null(none.Slope);

        var one = AnalyticsMath.Describe(D(7));
        Assert.Equal(7, one.Mean);
        Assert.Null(one.StdDev);
        Assert.Null(one.Slope);
    }

    [Theory]
    [InlineData(new[] { 0, 1, 1, 0, 1, 1, 1 }, 3, 3)]
    [InlineData(new[] { 1, 1, 1, 1, 0, 1, 0 }, 1, 4)]
    [InlineData(new[] { 1, 1, 0, 0 }, 0, 2)]
    [InlineData(new[] { 2, 3, 1 }, 3, 3)]
    [InlineData(new int[0], 0, 0)]
    [InlineData(new[] { 0, 0, 0 }, 0, 0)]
    public void Streaks_count_active_days_and_allow_today_to_be_empty(int[] counts, int current, int longest)
    {
        Assert.Equal((current, longest), AnalyticsMath.Streaks(counts));
    }
}
