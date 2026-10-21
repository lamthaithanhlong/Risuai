using System.Text.Json;
using Fatima.Sidecar;
using Xunit;
using static Fatima.Sidecar.Tests.Kit;

namespace Fatima.Sidecar.Tests;

// The JS fold (path B) and this sidecar must agree on the relationship numbers. server/node/story/npcs/build/golden.json is written from the JS
// fold (npcPsych.cjs foldRelations): {about, vectors:[{name, seed:[{p,q,trust,affection,debt,grudge}], traits:{id: Big Five}, events:[{who,tag,target}],
// expect:{p:{q:{trust,affection,debt,grudge}}}}]}. Intensity scaling is off here: the golden numbers are the plain table fold. The JS fold skips an
// unknown tag, an empty name and who == target; the sidecar refuses the first two (422/400), so those events are dropped before the call.
public class GoldenTests
{
    static string Find()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d != null; d = d.Parent)
        {
            foreach (var rel in new[] { "server/node/story/npcs/build/golden.json", "node/story/npcs/build/golden.json" })
            {
                var p = Path.Combine(d.FullName, rel);
                if (File.Exists(p)) return p;
            }
        }
        return null;
    }

    static RelDto ToRel(JsonElement e) => new()
    {
        Trust = e.GetProperty("trust").GetDouble(),
        Affection = e.GetProperty("affection").GetDouble(),
        Debt = e.GetProperty("debt").GetDouble(),
        Grudge = e.GetProperty("grudge").GetDouble(),
    };

    [SkippableFact]
    public void FoldAgreesWithTheJsFoldWithinTwo()
    {
        var path = Find();
        Skip.If(path == null, "server/node/story/npcs/build/golden.json is absent (written by the JS side): golden test skipped");
        var vectors = JsonDocument.Parse(File.ReadAllText(path)).RootElement.GetProperty("vectors");
        var n = 0;
        foreach (var v in vectors.EnumerateArray())
        {
            n++;
            var name = v.GetProperty("name").GetString();
            var traits = new Dictionary<string, TraitsDto>();
            foreach (var kv in v.GetProperty("traits").EnumerateObject()) traits[kv.Name] = JsonSerializer.Deserialize<TraitsDto>(kv.Value.GetRawText(), Wire.Json);
            var seeds = new Dictionary<string, Dictionary<string, RelDto>>();
            foreach (var s in v.GetProperty("seed").EnumerateArray())
            {
                var p = s.GetProperty("p").GetString();
                if (!seeds.ContainsKey(p)) seeds[p] = new();
                seeds[p][s.GetProperty("q").GetString()] = ToRel(s);
            }
            var expect = v.GetProperty("expect");
            var ids = new SortedSet<string>(traits.Keys.Concat(seeds.Keys).Concat(expect.EnumerateObject().Select(o => o.Name)));
            var events = new List<EventIn>();
            var turn = 0;
            foreach (var e in v.GetProperty("events").EnumerateArray())
            {
                var who = e.GetProperty("who").GetString(); var tag = e.GetProperty("tag").GetString(); var target = e.GetProperty("target").GetString();
                if (string.IsNullOrEmpty(who) || string.IsNullOrEmpty(target) || who == target || !Table.Tags.ContainsKey(tag)) continue;
                events.Add(Ev(++turn, who, tag, target));
            }
            var npcs = ids.Select(id => Npc(id, traits.GetValueOrDefault(id), seeds.GetValueOrDefault(id))).ToList();
            var r = Make(false).Appraise(Req("golden" + n, Math.Max(1, turn), npcs, events, ids.ToArray()));
            foreach (var p in expect.EnumerateObject())
                foreach (var q in p.Value.EnumerateObject())
                {
                    var got = Of(r, p.Name).Rel[q.Name];
                    var want = ToRel(q.Value);
                    void Near(string dim, double g, double w) => Assert.True(Math.Abs(g - w) <= 2, $"vector '{name}' rel({p.Name}->{q.Name}).{dim}: sidecar {g} vs js {w}");
                    Near("trust", got.Trust, want.Trust);
                    Near("affection", got.Affection, want.Affection);
                    Near("debt", got.Debt, want.Debt);
                    Near("grudge", got.Grudge, want.Grudge);
                }
        }
        Assert.True(n > 0, "golden.json has no vectors");
    }
}
