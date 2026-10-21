using System.Globalization;
using System.Text;
using Conditions.DTOs;
using EmotionalAppraisal;
using EmotionalAppraisal.DTOs;
using EmotionalAppraisal.OCCModel;
using GAIPS.Rage;
using RolePlayCharacter;
using SocialImportance.DTOs;
using WellFormedNames;

namespace Fatima.Sidecar;

// One NPC as FAtiMA sees it, plus the bookkeeping the sidecar keeps next to it.
public sealed class Character
{
    public string Id;
    public string Sym;
    public TraitsDto Traits;
    public RolePlayCharacterAsset Rpc;
    public double TickRate;                         // 1 = one decay tick per game turn; a neurotic NPC's feelings fade slower
    public double TickAcc;
    public long Cursor;                             // the turn the character's clock has been advanced to
    public int Next;                                // how many of the chat's events have been perceived
    public bool Observer;                           // present in the scene: sees what happens between others
    public Dictionary<string, int[]> Rel = new();   // q -> trust, affection, debt, grudge: how this NPC sees q
    public Dictionary<string, RelDto> Seed;
    public Dictionary<uint, int> CauseTurn = new(); // FAtiMA event id -> the turn of the event, for the emotion's sinceTurn
    public string Sig;
    public uint Events;                              // events recorded in the character's memory so far (FAtiMA ids them 0, 1, 2 ...)
    public HashSet<string> Ruled = new();            // tags whose appraisal rules are already in the character
    public Dictionary<string, int> Beliefs = new();  // what was last told to the KB, so Trust(q) etc. are rewritten only when they change
}

public static class CharacterFactory
{
    public const double High = 60;   // Big Five score from which a trait shapes the emotions

    // FAtiMA names are symbols; story ids carry spaces and diacritics. A symbol is P + the UTF-8 bytes of the id in hex: reversible, no collisions.
    public static string Sym(string id) => "P" + Convert.ToHexString(Encoding.UTF8.GetBytes(id));

    public static string IdOf(string s)
    {
        if (string.IsNullOrEmpty(s) || s[0] != 'P' || s.Length % 2 == 0) return s;
        try { return Encoding.UTF8.GetString(Convert.FromHexString(s.AsSpan(1))); } catch { return s; }
    }

    // Event actions: the act as the one acted upon feels it, and the act as a bystander sees it.
    public static string Action(string tag) => tag.Replace('_', '-');
    public static string SeenAction(string tag) => "Seen-" + Action(tag);

    public static TraitsDto TraitsOf(NpcIn n)
    {
        var t = n.Traits ?? new TraitsDto();
        return new TraitsDto { Open = Clamp(t.Open), Consc = Clamp(t.Consc), Extra = Clamp(t.Extra), Agree = Clamp(t.Agree), Neuro = Clamp(t.Neuro) };
    }

    static double Clamp(double v) => double.IsNaN(v) ? 50 : Math.Min(100, Math.Max(0, v));

    // Threshold per OCC type (FAtiMA: intensity = potential - threshold, so a lower threshold is a stronger feeling). Plan section 10.
    public static Dictionary<string, int> Thresholds(TraitsDto t)
    {
        var d = new Dictionary<string, int>();
        void Add(string e, int v) { d[e] = d.GetValueOrDefault(e) + v; }
        if (t.Neuro >= High) foreach (var e in new[] { "Fear", "Distress", "Anger", "Reproach" }) Add(e, -1);
        if (t.Agree >= High) foreach (var e in new[] { "Anger", "Reproach", "Hate" }) Add(e, 2);
        if (t.Extra >= High) foreach (var e in new[] { "Joy", "Love" }) Add(e, -1);
        return d;
    }

    // FAtiMA's decay is an integer per emotion type, so "slower" is done on the clock: neuro >= 60 advances 0.7 ticks per turn.
    public static double TickRate(TraitsDto t) => t.Neuro >= High ? 0.7 : 1.0;

    // consc >= 60: promises weigh more (kept: admiration, broken: reproach).
    public static double PromiseFactor(TraitsDto t) => t.Consc >= High ? 1.3 : 1.0;

    static string Num(double v) => v.ToString("0.####", CultureInfo.InvariantCulture);

    static AppraisalVariableDTO Var(string name, double v, Name target) => new() { Name = name, Value = (Name)Num(v), Target = target };

    // The OCC variables that make FAtiMA feel `emotion` at strength i about the actor of the event. Fear has no event-appraisal form in OCC (it is
    // a prospect emotion): the Safe goal is reset before the event and the rule lowers its likelihood by the right amount.
    public static List<AppraisalVariableDTO> DirectVars(TagDef t, double i)
    {
        var actor = (Name)"[s]";
        switch (t.Emotion)
        {
            case "gratitude": return new() { Var(OCCAppraisalVariables.DESIRABILITY, i, Name.NIL_SYMBOL), Var(OCCAppraisalVariables.PRAISEWORTHINESS, i, actor) };
            case "anger": return new() { Var(OCCAppraisalVariables.DESIRABILITY, -i, Name.NIL_SYMBOL), Var(OCCAppraisalVariables.PRAISEWORTHINESS, -i, actor) };
            case "joy": return new() { Var(OCCAppraisalVariables.DESIRABILITY, i, Name.NIL_SYMBOL) };
            case "distress": return new() { Var(OCCAppraisalVariables.DESIRABILITY, -i, Name.NIL_SYMBOL) };
            case "admiration": return new() { Var(OCCAppraisalVariables.PRAISEWORTHINESS, i, actor) };
            case "reproach": return new() { Var(OCCAppraisalVariables.PRAISEWORTHINESS, -i, actor) };
            case "love": return new() { Var(OCCAppraisalVariables.LIKE, i / 0.7, Name.NIL_SYMBOL) };   // FAtiMA scales Like by 0.7
            case "hate": return new() { Var(OCCAppraisalVariables.LIKE, -i / 0.7, Name.NIL_SYMBOL) };
            case "fear": return new() { Var(OCCAppraisalVariables.GOALSUCCESSPROBABILITY, FearDelta(i), (Name)SafeGoal) };
            default: throw new ArgumentException("no appraisal form for emotion " + t.Emotion);
        }
    }

    public const string SafeGoal = "Safe";
    public const double SafeSignificance = 10, SafeStart = 0.9;
    public static double FearDelta(double i) => (1 - Math.Min(9, i) / 10) - SafeStart;   // likelihood after = 1 - i/10, fear = (1 - after) * 10

    // A bystander reproaches or admires the actor, at half strength.
    public static List<AppraisalVariableDTO> SeenVars(TagDef t, double i) =>
        new() { Var(OCCAppraisalVariables.PRAISEWORTHINESS, (t.Positive ? 1 : -1) * i / 2, (Name)"[s]") };

    // The rules of one tag, direct (the act on this NPC) and seen (the act between others). Added when the tag is first met: FAtiMA tries every
    // rule against every event, so an NPC that has only met four tags carries four pairs of rules, not seventeen.
    public static void EnsureRules(Character c, TagDef tag)
    {
        if (!c.Ruled.Add(tag.Tag)) return;
        var i = tag.Intensity * (tag.Promise ? PromiseFactor(c.Traits) : 1.0);
        Rule(c.Rpc, $"Event(Action-End,[s],{Action(tag.Tag)},SELF)", DirectVars(tag, i));
        Rule(c.Rpc, $"Event(Action-End,[s],{SeenAction(tag.Tag)},[y])", SeenVars(tag, i));
    }

    static void Rule(RolePlayCharacterAsset rpc, string template, List<AppraisalVariableDTO> vars) =>
        rpc.m_emotionalAppraisalAsset.AddOrUpdateAppraisalRule(new AppraisalRuleDTO
        {
            EventMatchingTemplate = (Name)template,
            Conditions = new ConditionSetDTO(),
            AppraisalVariables = new AppraisalVariables(vars),
        });

    public static Character Build(NpcIn npc, AppraisalTable table, bool observer)
    {
        var t = TraitsOf(npc);
        var sym = Sym(npc.Id);
        var rpc = new RolePlayCharacterAsset { CharacterName = (Name)sym, BodyName = npc.Id, VoiceName = npc.Id };
        rpc.LoadAssociatedAssets(new AssetStorage());
        var ea = rpc.m_emotionalAppraisalAsset;

        foreach (var kv in Thresholds(t))
            ea.AddEmotionDisposition(new EmotionDispositionDTO { Emotion = kv.Key, Decay = 1, Threshold = kv.Value });

        rpc.AddOrUpdateGoal(new GoalDTO { Name = SafeGoal, Significance = (float)SafeSignificance, Likelihood = (float)SafeStart });

        // Social importance of q, from this NPC: base 5; +2 trusted; +1 owed; -2 resented. Sum, min 1 (FAtiMA), capped at 10.
        void Si(string value, params string[] cond) => rpc.m_socialImportanceAsset.AddAttributionRule(new AttributionRuleDTO
        {
            Description = string.Join(" & ", cond.DefaultIfEmpty("base")), Target = (Name)"[t]", Value = (Name)value,
            Conditions = new ConditionSetDTO { ConditionSet = cond },
        });
        Si("5");
        Si("2", "Trust([t]) >= 60");
        Si("1", "Debt([t]) >= 40");
        Si("-2", "Grudge([t]) >= 50");

        rpc.UpdateBelief("Trait(open)", Num(t.Open));
        rpc.UpdateBelief("Trait(consc)", Num(t.Consc));
        rpc.UpdateBelief("Trait(extra)", Num(t.Extra));
        rpc.UpdateBelief("Trait(agree)", Num(t.Agree));
        rpc.UpdateBelief("Trait(neuro)", Num(t.Neuro));

        return new Character
        {
            Id = npc.Id, Sym = sym, Traits = t, Rpc = rpc, TickRate = TickRate(t), Observer = observer,
            Seed = npc.Seed ?? new Dictionary<string, RelDto>(),
        };
    }
}
