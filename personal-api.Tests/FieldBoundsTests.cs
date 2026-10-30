using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using personal_api.Domain;
using personal_api.Kinds;

namespace personal_api.Tests;

public class FieldBoundsTests
{
    private static KindDefinition KindWith(FieldDefinition field) => new("k", "K", null, [field]);

    private static FieldDefinition Rating => new("n", FieldType.Number, false, Min: 1, Max: 5, Integer: true);

    private static IReadOnlyList<string> Check(FieldDefinition field, string literal) =>
        KindValidator.Validate(KindWith(field), "{\"n\":" + literal + "}");

    [Theory]
    [InlineData("1")]
    [InlineData("5")]
    [InlineData("3")]
    [InlineData("5.0")]
    public void Values_inside_the_bounds_pass(string literal) => Assert.Empty(Check(Rating, literal));

    [Theory]
    [InlineData("0", "n must be at least 1")]
    [InlineData("-1", "n must be at least 1")]
    [InlineData("6", "n must be at most 5")]
    [InlineData("5.5", "n must be a whole number")]
    [InlineData("2.5", "n must be a whole number")]
    public void Values_outside_the_bounds_are_reported(string literal, string message) =>
        Assert.Equal([message], Check(Rating, literal));

    [Theory]
    [InlineData("0.4", "n must be at least 0.5")]
    [InlineData("10.1", "n must be at most 10")]
    public void Fractional_bounds_use_invariant_formatting(string literal, string message) =>
        Assert.Equal([message], Check(new("n", FieldType.Number, false, Min: 0.5, Max: 10), literal));

    [Theory]
    [InlineData("0.5")]
    [InlineData("10")]
    public void Bounds_are_inclusive(string literal) =>
        Assert.Empty(Check(new("n", FieldType.Number, false, Min: 0.5, Max: 10), literal));

    [Theory]
    [InlineData("1000000000000", true)]
    [InlineData("-1000000000000", true)]
    [InlineData("1000000000000.001", false)]
    [InlineData("-1000000000000.001", false)]
    [InlineData("1e308", false)]
    [InlineData("1e999", false)]
    [InlineData("-1e999", false)]
    public void The_trillion_bound_applies_to_unbounded_number_fields(string literal, bool ok)
    {
        var errors = Check(new("n", FieldType.Number, false), literal);
        if (ok) Assert.Empty(errors);
        else Assert.Equal(["n must be between -1000000000000 and 1000000000000"], errors);
    }

    [Fact]
    public void The_trillion_bound_wins_over_a_wider_declared_max()
    {
        var errors = Check(new("n", FieldType.Number, false, Max: 1e15), "1e14");
        Assert.Equal(["n must be between -1000000000000 and 1000000000000"], errors);
    }

    [Fact]
    public void Bounds_do_not_apply_to_absent_optional_values()
    {
        Assert.Empty(KindValidator.Validate(KindWith(Rating), "{}"));
        Assert.Empty(KindValidator.Validate(KindWith(Rating), "{\"n\":null}"));
    }

    [Fact]
    public void A_wrong_type_reports_the_type_not_a_range()
    {
        Assert.Equal(["Field 'n' must be a number."], Check(Rating, "\"x\""));
    }

    [Fact]
    public void Fields_stored_without_bounds_deserialize_as_unbounded()
    {
        var json = "{\"Name\":\"n\",\"Type\":\"Number\",\"Required\":false,\"Label\":null,\"Options\":null}";
        var field = JsonSerializer.Deserialize<FieldDefinition>(json, new JsonSerializerOptions { Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() } })!;
        Assert.Null(field.Min);
        Assert.Null(field.Max);
        Assert.False(field.Integer);
    }

    // ---- PUT /kinds validation ----

    private static object Body(params object[] fields) => new { key = "thing", displayName = "Thing", defaultUnit = (string?)null, fields };

    private static async Task<string[]> ErrorsAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToArray();
    }

    [Fact]
    public async Task Put_roundtrips_min_max_and_integer()
    {
        using var app = new TestApp();
        var client = app.CreateClient();

        var put = await client.PutAsJsonAsync("/kinds/thing", Body(new { name = "n", type = "Number", required = false, min = 1, max = 5, integer = true }));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var kinds = await client.GetFromJsonAsync<JsonElement>("/kinds");
        var field = kinds.EnumerateArray().Single(k => k.GetProperty("key").GetString() == "thing").GetProperty("fields")[0];
        Assert.Equal(1, field.GetProperty("min").GetDouble());
        Assert.Equal(5, field.GetProperty("max").GetDouble());
        Assert.True(field.GetProperty("integer").GetBoolean());
    }

    [Fact]
    public async Task Min_equal_to_max_is_allowed()
    {
        using var app = new TestApp();
        var put = await app.CreateClient().PutAsJsonAsync("/kinds/thing", Body(new { name = "n", type = "Number", required = false, min = 3, max = 3 }));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
    }

    [Fact]
    public async Task Min_above_max_is_rejected_naming_the_field()
    {
        using var app = new TestApp();
        var put = await app.CreateClient().PutAsJsonAsync("/kinds/thing", Body(new { name = "n", type = "Number", required = false, min = 3.5, max = 3 }));
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        Assert.Equal(["Field 'n' min must not be greater than max"], await ErrorsAsync(put));
    }

    [Theory]
    [InlineData("Text", "\"min\":1")]
    [InlineData("Text", "\"max\":1")]
    [InlineData("Boolean", "\"integer\":true")]
    [InlineData("Date", "\"min\":0")]
    public async Task Bounds_on_a_non_number_field_are_rejected(string type, string extra)
    {
        using var app = new TestApp();
        var json = "{\"key\":\"thing\",\"displayName\":\"Thing\",\"fields\":[{\"name\":\"f\",\"type\":\"" + type + "\",\"required\":false," + extra + "}]}";
        var put = await app.CreateClient().PutAsync("/kinds/thing", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        Assert.Equal(["Field 'f' can only have min, max or integer when it is a Number field"], await ErrorsAsync(put));
    }

    [Fact]
    public async Task Integer_false_on_a_text_field_is_fine()
    {
        using var app = new TestApp();
        var put = await app.CreateClient().PutAsJsonAsync("/kinds/thing", Body(new { name = "f", type = "Text", required = false, integer = false }));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
    }

    [Fact]
    public async Task Records_are_validated_against_the_saved_bounds_end_to_end()
    {
        using var app = new TestApp();
        var client = app.CreateClient();
        await client.PutAsJsonAsync("/kinds/thing", Body(new { name = "n", type = "Number", required = true, min = 1, max = 5, integer = true }));

        var bad = await client.PostAsJsonAsync("/records", new { kind = "thing", data = new { n = 6 } });
        var good = await client.PostAsJsonAsync("/records", new { kind = "thing", data = new { n = 5 } });

        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(["n must be at most 5"], await ErrorsAsync(bad));
        Assert.Equal(HttpStatusCode.Created, good.StatusCode);
    }

    // ---- catalog ----

    [Fact]
    public void Every_catalog_bound_is_consistent()
    {
        var fields = KindSeeder.Catalog.SelectMany(k => k.Fields.Select(f => (Kind: k.Key, Field: f))).ToList();
        foreach (var (kind, f) in fields)
        {
            var name = $"{kind}.{f.Name}";
            if (f.Min is not null && f.Max is not null)
                Assert.True(f.Min <= f.Max, $"{name}: min {f.Min} > max {f.Max}");
            if (f.Min is not null || f.Max is not null || f.Integer)
                Assert.Equal(FieldType.Number, f.Type);
            if (f.Integer)
            {
                if (f.Min is { } min) Assert.True(min == Math.Floor(min), $"{name}: integer field with fractional min");
                if (f.Max is { } max) Assert.True(max == Math.Floor(max), $"{name}: integer field with fractional max");
            }
            foreach (var bound in new[] { f.Min, f.Max }.OfType<double>())
                Assert.True(Math.Abs(bound) <= KindValidator.MaxNumber, $"{name}: bound beyond the trillion limit");
        }
    }

    [Theory]
    [InlineData("mood", "rating", 1, 5, true)]
    [InlineData("energy", "rating", 1, 5, true)]
    [InlineData("workout", "rpe", 1, 10, true)]
    [InlineData("sleep", "hours", 0, 24, false)]
    [InlineData("sleep", "score", 0, 100, true)]
    [InlineData("body_battery", "level", 0, 100, true)]
    [InlineData("resting_hr", "bpm", 20, 250, true)]
    [InlineData("blood_pressure", "systolic", 30, 300, true)]
    [InlineData("blood_pressure", "pulse", 20, 250, true)]
    [InlineData("golf_round", "holes", 1, 36, true)]
    [InlineData("golf_round", "par", 27, 80, true)]
    [InlineData("golf_round", "score", 18, 200, true)]
    [InlineData("travel", "nights", 0, 3650, true)]
    [InlineData("weight", "weight", 0, 1500, false)]
    [InlineData("weight", "body_fat_pct", 0, 100, false)]
    [InlineData("run", "duration_min", 0, 10080, false)]
    [InlineData("alcohol", "drinks", 0, 100, false)]
    [InlineData("coding_session", "hours", 0, 24, false)]
    public void Catalog_fields_carry_the_documented_bounds(string kind, string field, double min, double max, bool integer)
    {
        var f = KindSeeder.Catalog.Single(k => k.Key == kind).Fields.Single(x => x.Name == field);
        Assert.Equal((min, max, integer), (f.Min, f.Max, f.Integer));
    }

    [Theory]
    [InlineData("steps", "steps")]
    [InlineData("ammo_purchase", "rounds")]
    [InlineData("claude_usage", "total_tokens")]
    [InlineData("golf_round", "putts")]
    public void Count_fields_are_whole_numbers_from_zero(string kind, string field)
    {
        var f = KindSeeder.Catalog.Single(k => k.Key == kind).Fields.Single(x => x.Name == field);
        Assert.Equal((0.0, null, true), (f.Min, f.Max, f.Integer));
    }

    [Theory]
    [InlineData("purchase", "amount")]
    [InlineData("expense", "amount")]
    [InlineData("claude_usage", "cost_usd")]
    [InlineData("golf_round", "cost")]
    public void Money_fields_are_not_negative(string kind, string field)
    {
        Assert.Equal(0.0, KindSeeder.Catalog.Single(k => k.Key == kind).Fields.Single(x => x.Name == field).Min);
    }

    [Fact]
    public void The_original_range_session_keeps_leading_fields_working()
    {
        var kind = KindSeeder.Catalog.Single(k => k.Key == "range_session");
        Assert.Equal(0.0, kind.Fields[0].Min);
        Assert.False(kind.Fields[0].Integer);
        Assert.Empty(KindValidator.Validate(kind, "{\"rounds\":150}"));
        Assert.Equal(["rounds must be at least 0"], KindValidator.Validate(kind, "{\"rounds\":-1}"));
        var workout = KindSeeder.Catalog.Single(k => k.Key == "workout");
        Assert.All(workout.Fields.Take(2), f => Assert.Null(f.Max));
    }
}
