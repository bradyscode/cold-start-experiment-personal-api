using personal_api.Domain;

namespace personal_api.Tests;

public class KindValidatorTests
{
    private static readonly KindDefinition RangeSession = new(
        "range_session", "Range Session", null,
        [
            new FieldDefinition("rounds", FieldType.Number, true),
            new FieldDefinition("caliber", FieldType.Choice, false, Options: ["9mm", ".22 LR"]),
            new FieldDefinition("suppressed", FieldType.Boolean, false),
        ]);

    [Fact]
    public void Missing_required_field_is_reported()
    {
        var errors = KindValidator.Validate(RangeSession, "{}");
        var error = Assert.Single(errors);
        Assert.Contains("rounds", error);
    }

    [Fact]
    public void Wrong_type_is_reported()
    {
        var errors = KindValidator.Validate(RangeSession, "{\"rounds\":\"lots\"}");
        Assert.Contains(errors, e => e.Contains("rounds"));
    }

    [Fact]
    public void Choice_outside_options_is_reported()
    {
        var errors = KindValidator.Validate(RangeSession, "{\"rounds\":10,\"caliber\":\"7mm\"}");
        Assert.Contains(errors, e => e.Contains("caliber"));
    }

    [Fact]
    public void Valid_data_returns_no_errors()
    {
        var errors = KindValidator.Validate(RangeSession, "{\"rounds\":10,\"caliber\":\"9mm\",\"suppressed\":true}");
        Assert.Empty(errors);
    }

    [Fact]
    public void Unknown_extra_fields_are_allowed()
    {
        var errors = KindValidator.Validate(RangeSession, "{\"rounds\":10,\"mood\":\"great\"}");
        Assert.Empty(errors);
    }

    [Fact]
    public void Non_object_json_is_reported()
    {
        Assert.NotEmpty(KindValidator.Validate(RangeSession, "[1,2]"));
    }

    [Fact]
    public void Null_data_with_no_required_fields_is_valid()
    {
        var optionalOnly = new KindDefinition("note", "Note", null, [new FieldDefinition("text", FieldType.Text, false)]);
        Assert.Empty(KindValidator.Validate(optionalOnly, null));
    }
}
