using System.Diagnostics;
using System.Text.Json;
using Fatima.Sidecar;
using Xunit;
using static Fatima.Sidecar.Tests.Kit;

namespace Fatima.Sidecar.Tests;

public class AppraiserTests
{
    // ---- the relationship fold: appraisal.json deltas x trait modulators, clamped 0..100, rounded half up ----

    static RelOut Fold(string tag, TraitsDto t, RelDto seed, bool scaling = false)
    {
        var a = Make(scaling);
        var r = a.Appraise(Req("fold", 1, new[] { Npc("x", t, new() { ["a"] = seed }) }, new[] { Ev(1, "a", tag, "x") }, "x"));
        return Of(r, "x").Rel["a"];
    }

    [Fact]
    public void Betray_AtNeutralTraits_IsTheTableDelta()
    {
        var r = Fold("betray", Tr(), Rel(60, 50, 0, 5));   // plan: trust 60 -> 30, affection 50 -> 38
        Assert.Equal(30, r.Trust);
        Assert.Equal(38, r.Affection);
        Assert.Equal(30, r.Grudge);                       // +25 x (1.5 - 50/100)
    }

    [Fact]
    public void Help_RaisesDebtAndTrust()
    {
        var r = Fold("help", Tr(), Rel(40, 40, 0, 10));
        Assert.Equal(8, r.Debt);                          // +8 x (0.6 + 0.5 x 0.8)
        Assert.Equal(46, r.Trust);
        Assert.Equal(43, r.Affection);
        Assert.Equal(8, r.Grudge);
    }

    [Fact]
    public void Clamps_AtBothEnds()
    {
        Assert.Equal(0, Fold("betray", Tr(), Rel(5, 5, 0, 5)).Trust);
        Assert.Equal(100, Fold("help", Tr(), Rel(98, 50, 95, 5)).Trust);
        Assert.Equal(100, Fold("help", Tr(), Rel(98, 50, 95, 5)).Debt);
        Assert.Equal(0, Fold("reconcile", Tr(), Rel(50, 50, 0, 4)).Grudge);
    }

    [Fact]
    public void TraitModulators_BendTheDeltas()
    {
        // trust loss x (0.5 + neuro/100): betray -30 -> -45 at neuro 100, -15 at neuro 0
        Assert.Equal(55, Fold("betray", Tr(neuro: 100), Rel(100, 50, 0, 0)).Trust);
        Assert.Equal(85, Fold("betray", Tr(neuro: 0), Rel(100, 50, 0, 0)).Trust);
        // grudge gain x (1.5 - agree/100): insult +10 -> 15 at agree 0, 5 at agree 100
        Assert.Equal(15, Fold("insult", Tr(agree: 0), Rel(50, 50, 0, 0)).Grudge);
        Assert.Equal(5, Fold("insult", Tr(agree: 100), Rel(50, 50, 0, 0)).Grudge);
        // affection gain x (0.5 + extra/100): gift +4 -> 6 / 2
        Assert.Equal(56, Fold("gift", Tr(extra: 100), Rel(50, 50, 0, 0)).Affection);
        Assert.Equal(52, Fold("gift", Tr(extra: 0), Rel(50, 50, 0, 0)).Affection);
        // debt gain x (0.6 + consc/100 x 0.8): save +20 -> 28 at consc 100, 12 at consc 0
        Assert.Equal(28, Fold("save", Tr(consc: 100), Rel(50, 50, 0, 0)).Debt);
        Assert.Equal(12, Fold("save", Tr(consc: 0), Rel(50, 50, 0, 0)).Debt);
        // a loss is not helped by the gain modulators: insult affection -5 stays -5 whatever extra is
        Assert.Equal(45, Fold("insult", Tr(extra: 100), Rel(50, 50, 0, 0)).Affection);
    }

    [Fact]
    public void Rounding_IsHalfUp_LikeJsMathRound()
    {
        Assert.Equal(3, Appraiser.Fold(2.5));
        Assert.Equal(1, Appraiser.Fold(0.5));
        Assert.Equal(0, Appraiser.Fold(-0.4));
        Assert.Equal(100, Appraiser.Fold(250));
        // extra 25: gift affection +4 x 0.75 = 3 -> 53; extra 30: 4 x 0.8 = 3.2 -> 53; extra 12.5: 4 x .625 = 2.5 -> 52.5 -> 53 (half up)
        Assert.Equal(53, Fold("gift", Tr(extra: 12.5), Rel(50, 50, 0, 0)).Affection);
    }

    [Fact]
    public void IntensityScaling_UsesWhatFatimaAppraised()
    {
        // betray: hate 9 -> scale 0.75 + 0.05 x 9 = 1.2 -> trust loss 36
        Assert.Equal(64, Fold("betray", Tr(), Rel(100, 50, 0, 0), scaling: true).Trust);
        Assert.Equal(70, Fold("betray", Tr(), Rel(100, 50, 0, 0), scaling: false).Trust);
    }

    [Fact]
    public void Mutual_ConfideRaisesTheConfiderTrustInTheTarget()
    {
        var a = Make(false);
        var r = a.Appraise(Req("mutual", 1, new[] { Npc("x") }, new[] { Ev(1, "x", "confide", "b") }, "x"));
        Assert.Equal(48, Of(r, "x").Rel["b"].Trust);   // default seed 40 + mutual 8
    }

    [Fact]
    public void UnseededPairs_StartFromTheDefaultSeed()
    {
        var a = Make(false);
        var r = a.Appraise(Req("seed", 1, new[] { Npc("x") }, new[] { Ev(1, "z", "praise", "x") }, "x"));
        var z = Of(r, "x").Rel["z"];
        Assert.Equal((41, 43, 0, 9), (z.Trust, z.Affection, z.Debt, z.Grudge));
        Assert.Contains("player", Of(r, "x").Rel.Keys);
    }

    // ---- emotions ----

    static double Peak(AppraiseResponse r, string id, string type, string target = null) =>
        Of(r, id).Emotions.Where(e => e.Type == type && (target == null || e.Target == target)).Select(e => e.Intensity).DefaultIfEmpty(0).Max();

    [Fact]
    public void Emotions_AreOneRowPerTypeAndTarget_StrongestWins()
    {
        var a = Make();
        var evs = Enumerable.Range(1, 4).Select(i => Ev(1, "p", "insult", "x")).ToList();
        var r = a.Appraise(Req("agg", 1, new[] { Npc("x") }, evs, "x"));
        var anger = Of(r, "x").Emotions.Where(e => e.Type == "anger").ToList();
        Assert.Single(anger);
        Assert.Equal("p", anger[0].Target);
        Assert.True(anger[0].Intensity >= 1);
        Assert.All(Of(r, "x").Emotions, e => Assert.True(e.Intensity >= 1));
        Assert.All(Of(r, "x").Emotions, e => Assert.Equal(e.Type, e.Type.ToLowerInvariant()));
    }

    [Fact]
    public void Emotions_DecayAcrossTurns()
    {
        var a = Make();
        var ev = new[] { Ev(1, "p", "insult", "x") };
        var now = Peak(a.Appraise(Req("decay", 1, new[] { Npc("x") }, ev, "x")), "x", "anger");
        var later = Peak(a.Appraise(Req("decay", 16, new[] { Npc("x") }, ev, "x")), "x", "anger");
        var gone = a.Appraise(Req("decay", 90, new[] { Npc("x") }, ev, "x"));
        Assert.InRange(now, 5.5, 6.5);
        Assert.InRange(later, now * 0.45, now * 0.55);   // half-life 15 ticks
        Assert.Equal(0, Peak(gone, "x", "anger"));
        Assert.True(Math.Abs(Of(gone, "x").Mood) < 1, "mood fades more slowly (half-life 60) but fades");
    }

    [Fact]
    public void Mood_FollowsTheEvents()
    {
        var a = Make();
        var bad = Of(a.Appraise(Req("m1", 1, new[] { Npc("x") }, new[] { Ev(1, "p", "harm", "x") }, "x")), "x").Mood;
        var good = Of(a.Appraise(Req("m2", 1, new[] { Npc("x") }, new[] { Ev(1, "p", "save", "x") }, "x")), "x").Mood;
        Assert.True(bad < -1 && bad >= -10);
        Assert.True(good > 1 && good <= 10);
    }

    [Fact]
    public void Observers_OnlyFeelWhatTheySee()
    {
        var a = Make();
        var evs = new[] { Ev(1, "p", "betray", "b") };
        var r = a.Appraise(Req("obs", 1, new[] { Npc("seen"), Npc("away") }, evs, "seen"));
        Assert.True(Peak(r, "seen", "reproach", "p") >= 1);   // present: sees it, at half strength
        Assert.Empty(Of(r, "away").Emotions);                 // not in the scene: nothing
        Assert.Empty(Of(r, "away").Rel.Where(kv => kv.Key == "b" || kv.Value.Trust != 40));
    }

    [Fact]
    public void SocialImportance_FollowsTrustDebtGrudge()
    {
        var a = Make(false);
        var seed = new Dictionary<string, RelDto> { ["friend"] = Rel(70, 50, 0, 0), ["owed"] = Rel(50, 50, 45, 0), ["foe"] = Rel(30, 30, 0, 60), ["both"] = Rel(70, 50, 45, 60) };
        var r = Of(a.Appraise(Req("si", 1, new[] { Npc("x", null, seed) }, new EventIn[0], "x")), "x");
        Assert.Equal(7, r.Si["friend"]);
        Assert.Equal(6, r.Si["owed"]);
        Assert.Equal(3, r.Si["foe"]);
        Assert.Equal(6, r.Si["both"]);   // 5 + 2 + 1 - 2
        Assert.Equal(5, r.Si["player"]);
    }

    [Fact]
    public void SocialImportance_FollowsTheEventsToo()
    {
        var a = Make(false);
        var seed = new Dictionary<string, RelDto> { ["p"] = Rel(62, 50, 0, 5) };
        var before = Of(a.Appraise(Req("si2", 1, new[] { Npc("x", null, seed) }, new EventIn[0], "x")), "x").Si["p"];
        var after = Of(a.Appraise(Req("si2", 2, new[] { Npc("x", null, seed) }, new[] { Ev(2, "p", "lie", "x") }, "x")), "x").Si["p"];
        Assert.Equal(7, before);
        Assert.Equal(5, after);   // trust 62 -> 47: no longer trusted
    }

    // ---- the prefix cache: it only skips work ----

    static List<EventIn> Story(int n) =>
        Enumerable.Range(0, n).Select(i => Ev(1 + i / 3, i % 3 == 0 ? "player" : i % 3 == 1 ? "marek" : "ba",
            new[] { "help", "insult", "confide", "threaten", "praise", "lie" }[i % 6], i % 3 == 0 ? "marek" : i % 3 == 1 ? "player" : "marek")).ToList();

    static NpcIn[] Cast() => new[]
    {
        Npc("marek", Tr(consc: 70, agree: 30, neuro: 70), new() { ["player"] = Rel(60, 50, 0, 5) }),
        Npc("ba", Tr(extra: 70, agree: 65)),
        Npc("player_friend", Tr()),
    };

    [Fact]
    public void SameRequestTwice_IsAHit_AndIdentical()
    {
        var a = Make();
        var first = a.Appraise(Req("hit", 12, Cast(), Story(30), "marek", "ba"));
        var second = a.Appraise(Req("hit", 12, Cast(), Story(30), "marek", "ba"));
        Assert.Equal("miss", first.Cache);
        Assert.Equal("hit", second.Cache);
        Assert.Equal(Body(first), Body(second));
    }

    [Fact]
    public void ExtendedEvents_PerceiveOnlyTheTail_AndEqualAColdRebuild()
    {
        var a = Make();
        a.Appraise(Req("ext", 10, Cast(), Story(24), "marek", "ba"));
        var warm = a.Appraise(Req("ext", 13, Cast(), Story(30), "marek", "ba"));
        var cold = Make().Appraise(Req("ext", 13, Cast(), Story(30), "marek", "ba"));
        Assert.Equal("extended", warm.Cache);
        Assert.Equal("miss", cold.Cache);
        Assert.Equal(Body(cold), Body(warm));
    }

    [Fact]
    public void ManySmallSteps_EqualOneCold()
    {
        var a = Make();
        AppraiseResponse last = null;
        for (var n = 3; n <= 30; n += 3) last = a.Appraise(Req("steps", 1 + n / 3 + 4, Cast(), Story(n), "marek", "ba"));
        var cold = Make().Appraise(Req("steps", 1 + 30 / 3 + 4, Cast(), Story(30), "marek", "ba"));
        Assert.Equal(Body(cold), Body(last));
    }

    [Fact]
    public void ShorterEvents_AfterAReroll_RebuildAndEqualACold()
    {
        var a = Make();
        a.Appraise(Req("reroll", 13, Cast(), Story(30), "marek", "ba"));
        var rerolled = a.Appraise(Req("reroll", 11, Cast(), Story(21), "marek", "ba"));
        var cold = Make().Appraise(Req("reroll", 11, Cast(), Story(21), "marek", "ba"));
        Assert.Equal("miss", rerolled.Cache);
        Assert.Equal(Body(cold), Body(rerolled));
    }

    [Fact]
    public void ChangedEventInTheMiddle_Rebuilds()
    {
        var a = Make();
        a.Appraise(Req("mid", 13, Cast(), Story(30), "marek", "ba"));
        var evs = Story(30);
        evs[5].Tag = "betray";
        var r = a.Appraise(Req("mid", 13, Cast(), evs, "marek", "ba"));
        Assert.Equal("miss", r.Cache);
        Assert.Equal(Body(Make().Appraise(Req("mid", 13, Cast(), evs, "marek", "ba"))), Body(r));
    }

    [Fact]
    public void AChangedNpc_IsRebuilt_TheOthersKept()
    {
        var a = Make();
        a.Appraise(Req("chg", 12, Cast(), Story(30), "marek", "ba"));
        var cast = Cast();
        cast[1] = Npc("ba", Tr(extra: 20, agree: 65));   // ba's traits moved
        var r = a.Appraise(Req("chg", 12, cast, Story(30), "marek", "ba"));
        Assert.Equal("extended", r.Cache);
        Assert.Equal(Body(Make().Appraise(Req("chg", 12, cast, Story(30), "marek", "ba"))), Body(r));
    }

    [Fact]
    public void LeavingTheScene_ChangesWhatAnNpcSaw()
    {
        var a = Make();
        a.Appraise(Req("leave", 12, Cast(), Story(30), "marek", "ba"));
        var r = a.Appraise(Req("leave", 12, Cast(), Story(30), "marek"));   // ba left
        Assert.Equal(Body(Make().Appraise(Req("leave", 12, Cast(), Story(30), "marek"))), Body(r));
    }

    [Fact]
    public void ATurnGoingBack_Rebuilds()
    {
        var a = Make();
        a.Appraise(Req("back", 20, Cast(), Story(9), "marek", "ba"));
        var r = a.Appraise(Req("back", 6, Cast(), Story(9), "marek", "ba"));
        Assert.Equal("extended", r.Cache);   // npcs rebuilt behind a prefix that still matches
        Assert.Equal(Body(Make().Appraise(Req("back", 6, Cast(), Story(9), "marek", "ba"))), Body(r));
    }

    [Fact]
    public void AllCores_And_OneCore_GiveTheSameAnswer()
    {
        var evs = Story(150).Take(150).ToList();
        for (var round = 0; round < 5; round++)
        {
            var par = new Appraiser(Table, new AppraiserOptions { Parallel = true }).Appraise(Req("p", 60, Cast(), evs, "marek", "ba", "player_friend"));
            var one = new Appraiser(Table, new AppraiserOptions { Parallel = false }).Appraise(Req("p", 60, Cast(), evs, "marek", "ba", "player_friend"));
            Assert.Equal(Body(one), Body(par));
        }
    }

    [Fact]
    public void Chats_AreIndependent_AndResetDropsThem()
    {
        var a = Make();
        a.Appraise(Req("one", 3, Cast(), Story(9), "marek"));
        a.Appraise(Req("two", 3, Cast(), Story(9), "marek"));
        Assert.Equal(2, a.Chats);
        a.Reset("one");
        Assert.Equal(1, a.Chats);
        Assert.Equal("miss", a.Appraise(Req("one", 3, Cast(), Story(9), "marek")).Cache);
        a.Reset(null);
        Assert.Equal(0, a.Chats);
    }

    [Fact]
    public void TheCacheIsBounded()
    {
        var a = new Appraiser(Table, new AppraiserOptions { MaxChats = 3 });
        for (var i = 0; i < 8; i++) a.Appraise(Req("c" + i, 1, new[] { Npc("x") }, new EventIn[0]));
        Assert.Equal(3, a.Chats);
    }

    // ---- refusals ----

    [Fact]
    public void UnknownTag_Throws()
    {
        var a = Make();
        var e = Assert.Throws<UnknownTagException>(() => a.Appraise(Req("bad", 1, new[] { Npc("x") }, new[] { Ev(1, "p", "tickle", "x") })));
        Assert.Equal("tickle", e.Tag);
    }

    [Fact]
    public void BadShapes_Throw()
    {
        var a = Make();
        Assert.Throws<BadRequestException>(() => a.Appraise(Req("bad", 1, new[] { Npc("") }, new EventIn[0])));
        Assert.Throws<BadRequestException>(() => a.Appraise(Req("bad", 1, new[] { Npc("x"), Npc("x") }, new EventIn[0])));
        Assert.Throws<BadRequestException>(() => a.Appraise(Req("bad", 1, new[] { Npc("x") }, new[] { Ev(1, "", "help", "x") })));
        Assert.Throws<BadRequestException>(() => a.Appraise(Req("bad", 1, new[] { Npc("x") }, Enumerable.Range(0, 601).Select(i => Ev(1, "p", "help", "x")))));
    }

    [Fact]
    public void EventsOnNobody_AndSelfActs_AreHarmless()
    {
        var a = Make();
        var r = a.Appraise(Req("odd", 1, new[] { Npc("x") }, new[] { Ev(1, "x", "praise", "x"), Ev(1, "p", "help", "nobody") }));
        Assert.Empty(Of(r, "x").Emotions);   // x is not in the scene: it saw nothing of p and nobody
        Assert.Equal(0, Of(r, "x").Mood);
    }

    [Fact]
    public void NoNpcs_NoEvents_IsAnEmptyAnswer()
    {
        var r = Make().Appraise(new AppraiseRequest { ChatId = "e", World = "w", Turn = 0 });
        Assert.Empty(r.Npcs);
        Assert.Equal("fatima", r.Engine);
    }

    [Fact]
    public void UnicodeIds_Survive()
    {
        var a = Make();
        var r = a.Appraise(Req("uni", 1, new[] { Npc("ông Marek") }, new[] { Ev(1, "Kẻ Lạ Mặt", "insult", "ông Marek") }, "ông Marek"));
        var x = Of(r, "ông Marek");
        Assert.Contains(x.Emotions, e => e.Type == "anger" && e.Target == "Kẻ Lạ Mặt");
        Assert.Contains("Kẻ Lạ Mặt", x.Rel.Keys);
    }

    [Fact]
    public void TheWholeTable_EveryTagAnswersItsOwnEmotion_AtTheTableIntensity()
    {
        foreach (var t in Table.Tags.Values)
        {
            var r = Make().Appraise(Req("t-" + t.Tag, 1, new[] { Npc("x") }, new[] { Ev(1, "p", t.Tag, "x") }));
            var e = Of(r, "x").Emotions.FirstOrDefault(m => m.Type == t.Emotion && m.Target == "p");
            Assert.True(e != null, $"{t.Tag}: no {t.Emotion}");
            Assert.InRange(e.Intensity, t.Intensity - 0.6, t.Intensity + 0.6);
        }
    }

    // ---- timing: plan wants p95 <= 40 ms for 6 npcs x 120 events; asserted loosely ----

    [Fact]
    public void Latency_SixNpcs_120Events()
    {
        var table = Table;
        var tags = table.Tags.Keys.ToArray();
        var ids = new[] { "player", "n1", "n2", "n3", "n4", "n5", "n6" };
        EventIn[] Events(int n) => Enumerable.Range(0, n).Select(i =>
        {
            var who = ids[i % 7]; var to = ids[(i * 3 + 1) % 7]; if (to == who) to = ids[(i + 1) % 7];
            return Ev(1 + i / 4, who, tags[(i * 5) % tags.Length], to);
        }).ToArray();
        NpcIn[] cast() => ids.Skip(1).Select(i => Npc(i, Tr(neuro: 40 + i.Length * 3), new() { ["player"] = Rel(50, 50, 0, 10) })).ToArray();
        var a = Make();
        a.Appraise(Req("warm", 5, cast(), Events(10), ids.Skip(1).ToArray()));   // JIT
        var cold = new List<double>(); var ext = new List<double>();
        for (var k = 0; k < 40; k++)
        {
            var sw = Stopwatch.StartNew();
            a.Reset("lat"); a.Appraise(Req("lat", 31, cast(), Events(120), ids.Skip(1).ToArray()));   // full rebuild: the worst case
            cold.Add(sw.Elapsed.TotalMilliseconds);
        }
        a.Reset("lat2"); a.Appraise(Req("lat2", 31, cast(), Events(116), ids.Skip(1).ToArray()));
        for (var k = 0; k < 40; k++)
        {
            var ev = Events(120).ToList();
            var sw = Stopwatch.StartNew();
            a.Appraise(Req("lat2", 31 + k, cast(), ev, ids.Skip(1).ToArray()));                      // next turn, nothing new
            ext.Add(sw.Elapsed.TotalMilliseconds);
        }
        double P(List<double> l, double q) => l.OrderBy(x => x).ElementAt((int)Math.Min(l.Count - 1, Math.Ceiling(l.Count * q) - 1));
        Console.WriteLine($"latency 6 npcs x 120 events: rebuild p50 {P(cold, .5):F1} p95 {P(cold, .95):F1} ms; next turn p50 {P(ext, .5):F2} p95 {P(ext, .95):F2} ms");
        Assert.True(P(cold, .95) < 110, $"rebuild p95 {P(cold, .95):F1} ms");
        Assert.True(P(ext, .95) < 40, $"extension p95 {P(ext, .95):F1} ms");
    }
}
