using Fatima.Sidecar;
using Xunit;
using static Fatima.Sidecar.Tests.Kit;

namespace Fatima.Sidecar.Tests;

// One test per rule of the Big Five -> FAtiMA mapping (plan section 10).
public class CharacterFactoryTests
{
    [Fact]
    public void Symbols_RoundTrip_AndAreSafeNames()
    {
        foreach (var id in new[] { "player", "ông Marek", "Kẻ Lạ Mặt", "a b", "SELF", "x[1]" })
        {
            var s = CharacterFactory.Sym(id);
            Assert.Matches("^P[0-9A-F]+$", s);
            Assert.Equal(id, CharacterFactory.IdOf(s));
        }
        Assert.Equal("plain", CharacterFactory.IdOf("plain"));
        Assert.Equal("Pxyz", CharacterFactory.IdOf("Pxyz"));
    }

    [Fact]
    public void Thresholds_NeuroHigh_LowersFearDistressAngerReproach()
    {
        var d = CharacterFactory.Thresholds(Tr(neuro: 60));
        foreach (var e in new[] { "Fear", "Distress", "Anger", "Reproach" }) Assert.Equal(-1, d[e]);
        Assert.False(d.ContainsKey("Hate"));
        Assert.Empty(CharacterFactory.Thresholds(Tr(neuro: 59)));
    }

    [Fact]
    public void Thresholds_AgreeHigh_RaisesAngerReproachHate()
    {
        var d = CharacterFactory.Thresholds(Tr(agree: 60));
        foreach (var e in new[] { "Anger", "Reproach", "Hate" }) Assert.Equal(2, d[e]);
        Assert.False(d.ContainsKey("Fear"));
        Assert.Empty(CharacterFactory.Thresholds(Tr(agree: 59)));
    }

    [Fact]
    public void Thresholds_ExtraHigh_LowersJoyLove()
    {
        var d = CharacterFactory.Thresholds(Tr(extra: 60));
        Assert.Equal(-1, d["Joy"]);
        Assert.Equal(-1, d["Love"]);
        Assert.Equal(2, d.Count);
    }

    [Fact]
    public void Thresholds_Combine()
    {
        var d = CharacterFactory.Thresholds(Tr(neuro: 80, agree: 80));
        Assert.Equal(1, d["Anger"]);      // -1 + 2
        Assert.Equal(1, d["Reproach"]);
        Assert.Equal(-1, d["Fear"]);
        Assert.Equal(2, d["Hate"]);
    }

    [Fact]
    public void TickRate_NeuroHigh_FadesSlower()
    {
        Assert.Equal(0.7, CharacterFactory.TickRate(Tr(neuro: 60)));
        Assert.Equal(1.0, CharacterFactory.TickRate(Tr(neuro: 59)));
    }

    [Fact]
    public void PromiseFactor_ConscHigh()
    {
        Assert.Equal(1.3, CharacterFactory.PromiseFactor(Tr(consc: 60)));
        Assert.Equal(1.0, CharacterFactory.PromiseFactor(Tr(consc: 59)));
    }

    [Fact]
    public void TraitsOf_ClampsAndDefaults()
    {
        var t = CharacterFactory.TraitsOf(new NpcIn { Id = "x", Traits = new TraitsDto { Neuro = 250, Open = -4 } });
        Assert.Equal(100, t.Neuro);
        Assert.Equal(0, t.Open);
        Assert.Equal(50, t.Agree);
        Assert.Equal(50, CharacterFactory.TraitsOf(new NpcIn { Id = "y" }).Extra);
    }

    // ---- the mapping seen through the answer ----

    static double Intensity(NpcIn n, string tag, string type, int turn = 1, int reqTurn = 1)
    {
        var r = Make().Appraise(Req("f", reqTurn, new[] { n }, new[] { Ev(turn, "p", tag, n.Id) }));
        return Of(r, n.Id).Emotions.Where(e => e.Type == type && e.Target == "p").Select(e => e.Intensity).DefaultIfEmpty(0).Max();
    }

    [Fact]
    public void Neuro_AddsOneToAnger()
    {
        Assert.InRange(Intensity(Npc("x", Tr(neuro: 70)), "insult", "anger") - Intensity(Npc("x"), "insult", "anger"), 0.8, 1.2);
    }

    [Fact]
    public void Agree_TakesTwoOffAnger()
    {
        Assert.InRange(Intensity(Npc("x"), "insult", "anger") - Intensity(Npc("x", Tr(agree: 70)), "insult", "anger"), 1.8, 2.2);
    }

    [Fact]
    public void Extra_AddsOneToJoy()
    {
        Assert.InRange(Intensity(Npc("x", Tr(extra: 70)), "praise", "joy") - Intensity(Npc("x"), "praise", "joy"), 0.8, 1.2);
    }

    [Fact]
    public void Consc_WeighsPromisesMore()
    {
        var plain = Intensity(Npc("x"), "promise_kept", "admiration");
        var firm = Intensity(Npc("x", Tr(consc: 70)), "promise_kept", "admiration");
        Assert.InRange(firm / plain, 1.25, 1.35);
        // and nothing else: a help is not a promise
        Assert.InRange(Intensity(Npc("x", Tr(consc: 70)), "help", "gratitude"), 3.9, 4.1);
    }

    [Fact]
    public void NeuroHigh_FeelingsFadeSlower()
    {
        var calm = Intensity(Npc("x"), "insult", "anger", 1, 31);
        var anxious = Intensity(Npc("x", Tr(neuro: 70)), "insult", "anger", 1, 31);
        Assert.True(anxious > calm * 1.15, $"{anxious} vs {calm}");
    }

    [Fact]
    public void Fear_IsTheSameForEveryThreat()
    {
        var evs = new[] { Ev(1, "p", "threaten", "x"), Ev(1, "p", "threaten", "x"), Ev(1, "p", "threaten", "x") };
        var r = Make().Appraise(Req("fear", 1, new[] { Npc("x") }, evs));
        var fear = Of(r, "x").Emotions.Where(e => e.Type == "fear").ToList();
        Assert.Single(fear);
        Assert.InRange(fear[0].Intensity, 5.5, 6.5);   // not eaten away by the goal running down
    }

    [Fact]
    public void Love_Hate_AreAboutTheActor()
    {
        Assert.InRange(Intensity(Npc("x"), "confide", "love"), 2.5, 3.5);
        Assert.InRange(Intensity(Npc("x"), "betray", "hate"), 8.5, 9.5);
    }

    [Fact]
    public void Rules_AreAddedPerTag_DirectAndSeen_WhenTheTagIsMet()
    {
        var c = CharacterFactory.Build(Npc("x"), Table, true);
        var ea = c.Rpc.m_emotionalAppraisalAsset;
        Assert.Empty(ea.GetAllAppraisalRules());
        Assert.Equal(4, c.Rpc.m_socialImportanceAsset.GetAttributionRules().Count());
        foreach (var tag in Table.Tags.Values) CharacterFactory.EnsureRules(c, tag);
        CharacterFactory.EnsureRules(c, Table.Tags["help"]);   // twice: still once
        var rules = ea.GetAllAppraisalRules().ToList();
        Assert.Equal(Table.Tags.Count * 2, rules.Count);
        foreach (var tag in Table.Tags.Keys)
        {
            Assert.Contains(rules, r => r.EventMatchingTemplate.ToString().Contains(", " + CharacterFactory.Action(tag) + ","));
            Assert.Contains(rules, r => r.EventMatchingTemplate.ToString().Contains(", " + CharacterFactory.SeenAction(tag) + ","));
        }
    }

    [Fact]
    public void TableLoads_AllTags()
    {
        Assert.Equal(17, Table.Tags.Count);
        Assert.Equal(8, Table.Tags["save"].Intensity);
        Assert.Equal("hate", Table.Tags["betray"].Emotion);
        Assert.Equal(8, Table.Tags["confide"].MutualTrust);
        Assert.Equal(40, Table.DefaultSeed.Trust);
    }
}
