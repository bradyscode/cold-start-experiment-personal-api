using personal_api.Domain;

namespace personal_api.Kinds;

public static class KindSeeder
{
    private static FieldDefinition Num(string name, string label, bool required = false, double? min = null, double? max = null, bool integer = false) =>
        new(name, FieldType.Number, required, label, Min: min, Max: max, Integer: integer);
    // Mood and energy are whole-number feelings; Stars allows half-star ratings for things you review.
    private static FieldDefinition Rating(string name, string label, bool required = false) => Num(name, label, required, 1, 5, true);
    private static FieldDefinition Stars(string name, string label, bool required = false) => Num(name, label, required, 1, 5);
    private static FieldDefinition Count(string name, string label, bool required = false) => Num(name, label, required, 0, integer: true);
    private static FieldDefinition Amount(string name, string label, bool required = false) => Num(name, label, required, 0);
    // Up to a week, so overnight hikes and ultra runs fit.
    private static FieldDefinition Minutes(string name, string label, bool required = false) => Num(name, label, required, 0, 10080);
    private static FieldDefinition Hours(string name, string label, bool required = false) => Num(name, label, required, 0, 24);
    private static FieldDefinition Level(string name, string label, bool required = false) => Num(name, label, required, 0, 100, true);
    private static FieldDefinition HeartRate(string name, string label, bool required = false) => Num(name, label, required, 20, 250, true);
    private static FieldDefinition Text(string name, string label, bool required = false) => new(name, FieldType.Text, required, label);
    private static FieldDefinition Pick(string name, string label, string[] options, bool required = false) => new(name, FieldType.Choice, required, label, options);
    private static FieldDefinition Flag(string name, string label, bool required = false) => new(name, FieldType.Boolean, required, label);
    private static FieldDefinition Day(string name, string label) => new(name, FieldType.Date, false, label);

    private static KindDefinition Kind(string key, string name, string category, string? unit, FieldDefinition[] fields, string? valueField, string agg, string better) =>
        new(key, name, unit, fields, valueField, category, agg, better);

    private const string Health = "Health", Fitness = "Fitness", Code = "Code", Hobbies = "Hobbies", Media = "Reading and media", Money = "Money", Life = "Life";

    public static readonly IReadOnlyList<KindDefinition> Catalog =
    [
        // The four original built-ins keep their original leading fields so existing data and forms stay valid.
        Kind("note", "Note", Life, null, [new("text", FieldType.Text, false)], null, "count", "none"),
        Kind("range_session", "Range session", Hobbies, "rounds",
        [
            new("rounds", FieldType.Number, true, Min: 0), new("caliber", FieldType.Text, false), new("firearms", FieldType.Text, false), new("cost", FieldType.Number, false),
            Amount("best_group_in", "Best group (inches)"), Amount("distance_yds", "Distance (yards)"), Minutes("duration_min", "Duration (minutes)"), Stars("rating", "Rating (1-5)"),
        ], "rounds", "sum", "none"),
        Kind("workout", "Workout", Fitness, "min",
        [
            new("type", FieldType.Text, true), new("duration_min", FieldType.Number, true),
            Num("rpe", "Effort (1-10)", min: 1, max: 10, integer: true), Text("location", "Location"),
        ], "duration_min", "sum", "higher"),
        Kind("book_finished", "Book finished", Media, "pages",
        [
            new("author", FieldType.Text, false), new("pages", FieldType.Number, false), Stars("rating", "Rating (1-5)"),
        ], "pages", "sum", "none"),

        // Health: body and daily readings from the watch or by hand
        Kind("sleep", "Sleep", Health, "hours", [Hours("hours", "Hours slept", true), Level("score", "Sleep score (0-100)")], "hours", "sum", "higher"),
        Kind("resting_hr", "Resting heart rate", Health, "bpm", [HeartRate("bpm", "Beats per minute", true)], "bpm", "avg", "lower"),
        Kind("hrv", "Heart rate variability", Health, "ms", [Amount("hrv_ms", "HRV (milliseconds)", true)], "hrv_ms", "avg", "higher"),
        Kind("steps", "Steps", Health, "steps", [Count("steps", "Steps", true)], "steps", "sum", "higher"),
        Kind("weight", "Weight", Health, "lb", [Num("weight", "Weight (pounds)", true, 0, 1500), Num("body_fat_pct", "Body fat (percent)", min: 0, max: 100)], "weight", "avg", "none"),
        Kind("body_battery", "Body battery", Health, "points", [Level("level", "Level (0-100)", true)], "level", "avg", "higher"),
        Kind("stress", "Stress", Health, "points", [Level("level", "Level (0-100)", true)], "level", "avg", "lower"),
        Kind("blood_pressure", "Blood pressure", Health, "mmHg",
            [Num("systolic", "Systolic", true, 30, 300, true), Num("diastolic", "Diastolic", true, 30, 300, true), HeartRate("pulse", "Pulse")], "systolic", "avg", "lower"),
        Kind("water", "Water", Health, "oz", [Amount("ounces", "Ounces", true)], "ounces", "sum", "higher"),
        Kind("nutrition", "Meal", Health, "kcal",
        [
            Amount("calories", "Calories", true), Amount("protein_g", "Protein (grams)"), Amount("carbs_g", "Carbs (grams)"), Amount("fat_g", "Fat (grams)"),
            Pick("meal", "Meal", ["breakfast", "lunch", "dinner", "snack"]),
        ], "calories", "sum", "none"),
        Kind("caffeine", "Caffeine", Health, "mg", [Amount("caffeine_mg", "Caffeine (milligrams)", true)], "caffeine_mg", "sum", "none"),
        Kind("alcohol", "Alcohol", Health, "drinks", [Num("drinks", "Drinks", true, 0, 100)], "drinks", "sum", "lower"),
        Kind("mood", "Mood", Health, "of 5", [Rating("rating", "Mood (1-5)", true), Text("note", "What was behind it")], "rating", "avg", "higher"),
        Kind("energy", "Energy", Health, "of 5", [Rating("rating", "Energy (1-5)", true)], "rating", "avg", "higher"),
        Kind("meditation", "Meditation", Health, "min", [Minutes("minutes", "Minutes", true)], "minutes", "sum", "higher"),

        // Fitness
        Kind("run", "Run", Fitness, "mi",
            [Amount("distance_mi", "Distance (miles)", true), Minutes("duration_min", "Duration (minutes)"), HeartRate("avg_hr", "Average heart rate")], "distance_mi", "sum", "higher"),
        Kind("hike", "Hike", Fitness, "mi",
            [Amount("distance_mi", "Distance (miles)", true), Amount("elevation_ft", "Climb (feet)"), Minutes("duration_min", "Duration (minutes)")], "distance_mi", "sum", "higher"),
        Kind("bike_ride", "Bike ride", Fitness, "mi",
            [Amount("distance_mi", "Distance (miles)", true), Minutes("duration_min", "Duration (minutes)")], "distance_mi", "sum", "higher"),
        Kind("active_minutes", "Active minutes", Fitness, "min", [Minutes("minutes", "Minutes", true)], "minutes", "sum", "higher"),
        Kind("vo2max", "VO2 max", Fitness, "ml/kg/min", [Amount("vo2max", "VO2 max", true)], "vo2max", "max", "higher"),

        // Code: collected automatically from GitHub and Claude Code, or logged by hand
        Kind("github_commit", "Commit", Code, null,
            [Text("repo", "Repository"), Text("message", "Message"), Count("additions", "Lines added"), Count("deletions", "Lines removed")], null, "count", "none"),
        Kind("github_actions_run", "Actions run", Code, null,
            [Text("repo", "Repository"), Text("workflow", "Workflow"), Pick("status", "Result", ["success", "failure", "cancelled", "skipped"]), Amount("duration_s", "Duration (seconds)")], null, "count", "none"),
        Kind("pull_request", "Pull request", Code, null,
            [Text("repo", "Repository"), Text("title", "Title"), Pick("state", "State", ["opened", "merged", "closed"])], null, "count", "none"),
        Kind("claude_usage", "Claude usage", Code, "tokens",
        [
            Count("total_tokens", "Total tokens", true), Count("input_tokens", "Input tokens"), Count("output_tokens", "Output tokens"),
            Count("cache_read_tokens", "Cache read tokens"), Count("cache_write_tokens", "Cache write tokens"), Count("messages", "Messages"),
            Amount("cost_usd", "Estimated cost (USD)"), Text("model", "Model"), Text("project", "Project"),
        ], "total_tokens", "sum", "none"),
        Kind("coding_session", "Coding session", Code, "hours", [Hours("hours", "Hours", true), Text("project", "Project")], "hours", "sum", "higher"),

        // Hobbies: guns, tools, woodworking, golf
        Kind("reloading_session", "Reloading session", Hobbies, "rounds",
            [Count("rounds_loaded", "Rounds loaded", true), Text("caliber", "Caliber"), Text("powder", "Powder and charge"), Amount("cost", "Cost ($)")], "rounds_loaded", "sum", "none"),
        Kind("ammo_purchase", "Ammo purchase", Hobbies, "rounds",
            [Count("rounds", "Rounds", true), Text("caliber", "Caliber"), Amount("cost", "Cost ($)"), Text("vendor", "Vendor")], "rounds", "sum", "none"),
        Kind("gun_cleaning", "Gun cleaning", Hobbies, null,
            [Text("firearm", "Firearm", true), Count("rounds_since_last", "Rounds since last cleaning"), Minutes("minutes", "Minutes")], null, "count", "none"),
        Kind("golf_round", "Golf round", Hobbies, "strokes",
        [
            Text("course", "Course", true), Pick("tees", "Tees", ["black", "blue", "white", "gold", "red"]), Num("holes", "Holes played", min: 1, max: 36, integer: true), Num("par", "Par", min: 27, max: 80, integer: true),
            Num("score", "Score", true, 18, 200, true), Count("putts", "Putts"), Count("fairways_hit", "Fairways hit"), Count("fairways_total", "Fairways possible"),
            Count("gir", "Greens in regulation"), Count("penalties", "Penalty strokes"), Text("weather", "Weather"), Stars("rating", "Rating (1-5)"), Amount("cost", "Cost ($)"),
        ], "score", "avg", "lower"),
        Kind("golf_range_session", "Golf range session", Hobbies, "balls",
            [Count("balls", "Balls hit", true), Text("focus", "Focus"), Minutes("duration_min", "Duration (minutes)"), Amount("cost", "Cost ($)"), Stars("rating", "Rating (1-5)")], "balls", "sum", "none"),
        Kind("shop_session", "Shop session", Hobbies, "hours",
            [Hours("hours", "Hours in the shop", true), Text("project", "Project"), Text("tools", "Tools used")], "hours", "sum", "higher"),
        Kind("project_finished", "Project finished", Hobbies, "hours",
            [Text("name", "Project", true), Amount("hours", "Hours spent"), Amount("cost", "Materials cost ($)"), Text("wood", "Wood or material")], "hours", "sum", "none"),
        Kind("tool_maintenance", "Tool maintenance", Hobbies, null,
        [
            Text("tool", "Tool", true), Pick("task", "Task", ["sharpen", "clean", "oil", "calibrate", "replace blade", "repair"]),
            Minutes("minutes", "Minutes"), Amount("cost", "Cost ($)"),
        ], null, "count", "none"),
        Kind("home_project", "Home project", Hobbies, "hours",
            [Text("project", "Project", true), Amount("hours", "Hours", true), Amount("cost", "Cost ($)")], "hours", "sum", "none"),

        // Reading and media
        Kind("reading_session", "Reading session", Media, "min",
            [Minutes("minutes", "Minutes", true), Count("pages", "Pages"), Text("title", "Title")], "minutes", "sum", "higher"),
        Kind("media_log", "Media", Media, null,
        [
            Pick("type", "Type", ["movie", "show", "game", "podcast", "album", "other"], true), Text("title", "Title", true),
            Pick("status", "Status", ["started", "finished", "dropped"]), Stars("rating", "Rating (1-5)"), Num("year", "Year", min: 1800, max: 2200, integer: true),
        ], null, "count", "none"),

        // Money
        Kind("purchase", "Purchase", Money, "USD",
        [
            Text("item", "Item", true), Amount("amount", "Cost ($)", true),
            Pick("category", "Category", ["tools", "guns and ammo", "lumber", "electronics", "clothing", "home", "food", "other"]),
            Text("vendor", "Vendor"), Day("warranty_until", "Warranty until"),
        ], "amount", "sum", "none"),
        Kind("expense", "Expense", Money, "USD",
        [
            Amount("amount", "Amount ($)", true),
            Pick("category", "Category", ["housing", "food", "transport", "fun", "health", "bills", "other"]), Text("note", "Note"),
        ], "amount", "sum", "none"),

        // Life
        Kind("travel", "Trip", Life, "nights",
        [
            Text("destination", "Destination", true), Num("nights", "Nights", true, 0, 3650, true), Pick("purpose", "Purpose", ["leisure", "work", "family"]),
            Amount("cost", "Cost ($)"), Text("companions", "Who with"),
        ], "nights", "sum", "none"),
        Kind("journal", "Journal entry", Life, null, [Text("text", "What happened", true), Text("highlight", "Highlight")], null, "count", "none"),
        Kind("habit", "Habit check-in", Life, null, [Text("habit", "Habit", true), Flag("done", "Done")], null, "count", "none"),
        Kind("screen_time", "Screen time", Life, "hours", [Hours("hours", "Hours", true)], "hours", "sum", "lower"),
    ];

    public static async Task SeedAsync(IKindStore kinds, CancellationToken ct)
    {
        foreach (var kind in Catalog)
        {
            var existing = await kinds.GetAsync(kind.Key, ct);
            if (existing is null)
                await kinds.SaveAsync(kind, ct);
            else if (existing.Category is null && existing.DefaultAgg is null && existing.Better is null)
            {
                // Only trackers saved before metadata existed are touched; a changed value field means the user reshaped it, so skip the aggregation.
                var agg = existing.ValueField == kind.ValueField ? kind.DefaultAgg : null;
                await kinds.SaveAsync(existing with { Category = kind.Category, DefaultAgg = agg, Better = kind.Better }, ct);
            }
        }
    }
}
