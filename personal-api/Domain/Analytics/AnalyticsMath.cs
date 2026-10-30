namespace personal_api.Domain.Analytics;

public static class AnalyticsMath
{
    public const int MinOverlap = 5;

    // Pairs a[i] with b[i + lag]; buckets where either side is missing or non-finite are skipped.
    public static PairStats Pearson(IReadOnlyList<double?> a, IReadOnlyList<double?> b, int lag = 0, string bucketNoun = "buckets")
    {
        var xs = new List<double>();
        var ys = new List<double>();
        for (var i = 0; i < a.Count; i++)
        {
            var j = i + lag;
            if (j < 0 || j >= b.Count) continue;
            if (a[i] is not { } x || b[j] is not { } y || !double.IsFinite(x) || !double.IsFinite(y)) continue;
            xs.Add(x);
            ys.Add(y);
        }

        var n = xs.Count;
        if (n < MinOverlap)
            return new PairStats(lag, null, null, n, null, null, $"fewer than {MinOverlap} overlapping {bucketNoun}");
        // Scaling by the largest magnitude keeps sums of squares finite for huge or tiny values (r is scale-free) and turns a constant series into exact ones.
        var scaleX = Math.Max(xs.Max(Math.Abs), double.Epsilon);
        var scaleY = Math.Max(ys.Max(Math.Abs), double.Epsilon);
        var meanX = xs.Sum(v => v / scaleX) / n;
        var meanY = ys.Sum(v => v / scaleY) / n;
        double sxx = 0, syy = 0, sxy = 0;
        for (var i = 0; i < n; i++)
        {
            var dx = xs[i] / scaleX - meanX;
            var dy = ys[i] / scaleY - meanY;
            sxx += dx * dx;
            syy += dy * dy;
            sxy += dx * dy;
        }
        if (sxx <= 0 || syy <= 0)
            return new PairStats(lag, null, null, n, null, null, "no variation");

        var r = Math.Clamp(sxy / Math.Sqrt(sxx * syy), -1, 1);
        double? slope = sxy / sxx * (scaleY / scaleX);
        double? intercept = meanY * scaleY - slope * meanX * scaleX;
        if (!double.IsFinite(slope.Value) || !double.IsFinite(intercept.Value)) (slope, intercept) = (null, null);
        return double.IsFinite(r)
            ? new PairStats(lag, r, r * r, n, slope, intercept, null)
            : new PairStats(lag, null, null, n, null, null, "values out of range");
    }

    public static SeriesStats Describe(IReadOnlyList<double?> values)
    {
        var points = new List<(int Index, double Value)>();
        for (var i = 0; i < values.Count; i++)
            if (values[i] is { } v && double.IsFinite(v)) points.Add((i, v));

        var n = points.Count;
        if (n == 0)
            return new SeriesStats(0, null, null, null, null, null, null);

        var total = points.Sum(p => p.Value);
        var mean = total / n;
        var min = points.Min(p => p.Value);
        var max = points.Max(p => p.Value);
        if (n < 2)
            return new SeriesStats(n, Finite(total), Finite(mean), min, max, null, null);

        var stdDev = Math.Sqrt(points.Sum(p => (p.Value - mean) * (p.Value - mean)) / (n - 1));
        var meanIndex = points.Average(p => (double)p.Index);
        var sxx = points.Sum(p => (p.Index - meanIndex) * (p.Index - meanIndex));
        double? slope = sxx > 0 ? points.Sum(p => (p.Index - meanIndex) * (p.Value - mean)) / sxx : null;
        return new SeriesStats(n, Finite(total), Finite(mean), min, max, Finite(stdDev), Finite(slope));
    }

    // Counts are oldest first. The current streak may end yesterday, since today is often not logged yet.
    public static (int Current, int Longest) Streaks(IReadOnlyList<int> counts)
    {
        int longest = 0, run = 0;
        foreach (var c in counts)
        {
            run = c > 0 ? run + 1 : 0;
            longest = Math.Max(longest, run);
        }

        var end = counts.Count - 1;
        if (end >= 0 && counts[end] == 0) end--;
        var current = 0;
        for (var i = end; i >= 0 && counts[i] > 0; i--) current++;
        return (current, longest);
    }

    public static PairStats? BestLag(IReadOnlyList<PairStats> lags) =>
        lags.Where(l => l.R is not null)
            .OrderByDescending(l => Math.Round(Math.Abs(l.R!.Value), 9))
            .ThenBy(l => Math.Abs(l.Lag))
            .ThenBy(l => l.Lag)
            .FirstOrDefault();

    private static double? Finite(double? v) => v is { } x && double.IsFinite(x) ? x : null;
}
