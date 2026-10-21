using System.Text.Json;
using System.Text.Json.Serialization;

namespace Fatima.Sidecar;

// Wire types of POST /appraise (plan section 10). JSON is camelCase both ways.
public static class Wire
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };
}

public class TraitsDto
{
    // Big Five, 0..100. A missing trait is the middle.
    public double Open { get; set; } = 50;
    public double Consc { get; set; } = 50;
    public double Extra { get; set; } = 50;
    public double Agree { get; set; } = 50;
    public double Neuro { get; set; } = 50;
}

public class RelDto
{
    public double Trust { get; set; }
    public double Affection { get; set; }
    public double Debt { get; set; }
    public double Grudge { get; set; }
}

public class NpcIn
{
    public string Id { get; set; }
    public string Name { get; set; }
    public TraitsDto Traits { get; set; }
    public double Importance { get; set; }
    public string Speech { get; set; }
    public List<string> Tags { get; set; }
    public bool HasSecret { get; set; }
    public bool HasAgenda { get; set; }
    public Dictionary<string, RelDto> Seed { get; set; }
}

public class EventIn
{
    public int Turn { get; set; }
    public string Who { get; set; }
    public string Tag { get; set; }
    public string Target { get; set; }
}

public class AppraiseRequest
{
    public string ChatId { get; set; }
    public string World { get; set; }
    public int Turn { get; set; }
    public List<string> Present { get; set; }
    public List<NpcIn> Npcs { get; set; }
    public List<EventIn> Events { get; set; }
}

public class EmotionOut
{
    public string Type { get; set; }
    public double Intensity { get; set; }
    // Id of whom the emotion is about; "" when it is about nobody.
    public string Target { get; set; }
    public int SinceTurn { get; set; }
}

public class RelOut
{
    public int Trust { get; set; }
    public int Affection { get; set; }
    public int Debt { get; set; }
    public int Grudge { get; set; }
}

public class NpcOut
{
    public string Id { get; set; }
    public double Mood { get; set; }
    public List<EmotionOut> Emotions { get; set; }
    public Dictionary<string, double> Si { get; set; }
    public Dictionary<string, RelOut> Rel { get; set; }
}

public class AppraiseResponse
{
    public double Ms { get; set; }
    public string Engine { get; set; } = "fatima";
    // miss: built from nothing; extended: only the new tail (or a new turn) was perceived; hit: nothing to do.
    public string Cache { get; set; }
    public List<NpcOut> Npcs { get; set; }
}

public class UnknownTagException : Exception
{
    public string Tag { get; }
    public UnknownTagException(string tag) : base("unknown tag: " + tag) { Tag = tag; }
}

public class BadRequestException : Exception
{
    public BadRequestException(string msg) : base(msg) { }
}
