using System.Text.Json;

namespace Fatima.Sidecar;

public sealed class TagDef
{
    public string Tag;
    public int Trust, Affection, Debt, Grudge;
    public string Emotion;   // lower-case OCC word
    public int Intensity;
    public int MutualTrust;
    public bool Promise => Tag == "promise_kept" || Tag == "promise_broken";
    // True when the act is something the one acted upon would approve of (observers admire it) rather than reproach.
    public bool Positive => Trust + Affection >= 0;
}

// server/node/story/npcs/appraisal.json: the one table both paths read (path B folds it in JS, this sidecar turns it into FAtiMA rules).
public sealed class AppraisalTable
{
    public Dictionary<string, TagDef> Tags { get; } = new(StringComparer.Ordinal);
    public RelDto DefaultSeed { get; private set; } = new() { Trust = 40, Affection = 40, Debt = 0, Grudge = 10 };

    public static AppraisalTable Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var t = new AppraisalTable();
        var root = doc.RootElement;
        if (root.TryGetProperty("default_seed", out var ds))
            t.DefaultSeed = new RelDto { Trust = ds.GetProperty("trust").GetDouble(), Affection = ds.GetProperty("affection").GetDouble(), Debt = ds.GetProperty("debt").GetDouble(), Grudge = ds.GetProperty("grudge").GetDouble() };
        foreach (var p in root.GetProperty("tags").EnumerateObject())
        {
            var o = p.Value;
            t.Tags[p.Name] = new TagDef
            {
                Tag = p.Name,
                Trust = o.GetProperty("trust").GetInt32(),
                Affection = o.GetProperty("affection").GetInt32(),
                Debt = o.GetProperty("debt").GetInt32(),
                Grudge = o.GetProperty("grudge").GetInt32(),
                Emotion = o.GetProperty("emotion").GetString().ToLowerInvariant(),
                Intensity = o.GetProperty("intensity").GetInt32(),
                MutualTrust = o.TryGetProperty("mutual_trust", out var m) ? m.GetInt32() : 0,
            };
        }
        if (t.Tags.Count == 0) throw new InvalidDataException("appraisal table has no tags");
        return t;
    }

    public static AppraisalTable Load(string path) => Parse(File.ReadAllText(path));

    // FATIMA_APPRAISAL, else the repo's copy found by walking up from the dll (bin/Release/net10.0 -> server/sidecar/fatima -> server).
    public static string FindPath()
    {
        var env = Environment.GetEnvironmentVariable("FATIMA_APPRAISAL");
        if (!string.IsNullOrEmpty(env)) return env;
        foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
        {
            for (var d = new DirectoryInfo(start); d != null; d = d.Parent)
            {
                foreach (var rel in new[] { "node/story/npcs/appraisal.json", "server/node/story/npcs/appraisal.json" })
                {
                    var p = Path.Combine(d.FullName, rel);
                    if (File.Exists(p)) return p;
                }
            }
        }
        throw new FileNotFoundException("appraisal.json not found: set FATIMA_APPRAISAL");
    }
}
