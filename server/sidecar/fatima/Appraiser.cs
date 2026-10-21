using System.Diagnostics;
using System.Text;
using RolePlayCharacter;

namespace Fatima.Sidecar;

public sealed class AppraiserOptions
{
    // The relationship dimensions move by delta * (0.75 + 0.05 * intensity FAtiMA appraised for the act). Off: delta * 1, the plain table fold
    // (the golden test compares that with the JS fold, path B).
    public bool IntensityScaling = true;
    public int MaxChats = 16;
    public int MaxNpcs = 40;
    public int MaxEvents = 600;
    // Longest stretch of idle turns one clock advance spends decay ticks on (a long-lost chat does not stall the process).
    public int MaxTurnGap = 2000;
    // NPCs are independent of one another: a request's NPCs are advanced on all cores.
    public bool Parallel = true;
}

// Pure function of (npcs, present, events, turn). The per-chat cache only skips work: a request whose events extend the cached list perceives
// the tail; anything else rebuilds, so a reroll that took lines away answers exactly like a cold start.
public sealed class Appraiser
{
    sealed class ChatEntry
    {
        public readonly object Gate = new();
        public string World;
        public List<EventIn> Events;
        public Dictionary<string, Character> Runs = new();
        public long Used;
    }

    readonly AppraisalTable table;
    readonly AppraiserOptions opt;
    readonly Dictionary<string, ChatEntry> chats = new();
    long clock;
    // FAtiMA keeps static serialization tables that are not safe to build from two threads, and it is a one-user tool: one appraisal at a time.
    static readonly object Engine = new();

    public Appraiser(AppraisalTable table, AppraiserOptions opt = null)
    {
        this.table = table;
        this.opt = opt ?? new AppraiserOptions();
    }

    public AppraisalTable Table => table;
    public int Chats { get { lock (chats) return chats.Count; } }

    public void Reset(string chatId)
    {
        lock (chats) { if (chatId == null) chats.Clear(); else chats.Remove(chatId); }
    }

    ChatEntry EntryOf(string chatId)
    {
        lock (chats)
        {
            if (!chats.TryGetValue(chatId, out var e))
            {
                e = new ChatEntry();
                chats[chatId] = e;
                while (chats.Count > opt.MaxChats)
                {
                    var old = chats.Where(kv => kv.Value != e).OrderBy(kv => kv.Value.Used).First().Key;
                    chats.Remove(old);
                }
            }
            e.Used = ++clock;
            return e;
        }
    }

    static bool Same(EventIn a, EventIn b) => a.Turn == b.Turn && a.Who == b.Who && a.Tag == b.Tag && a.Target == b.Target;

    static bool IsPrefix(List<EventIn> cached, List<EventIn> now)
    {
        if (cached == null || cached.Count > now.Count) return false;
        for (var i = 0; i < cached.Count; i++) if (!Same(cached[i], now[i])) return false;
        return true;
    }

    static string SigOf(NpcIn n, TraitsDto t, bool observer)
    {
        var sb = new StringBuilder();
        sb.Append(n.Id).Append('|').Append(t.Open).Append(',').Append(t.Consc).Append(',').Append(t.Extra).Append(',').Append(t.Agree).Append(',').Append(t.Neuro)
          .Append('|').Append(observer ? 'o' : '-');
        if (n.Seed != null)
            foreach (var kv in n.Seed.OrderBy(k => k.Key, StringComparer.Ordinal))
                sb.Append('|').Append(kv.Key).Append('=').Append(kv.Value.Trust).Append(',').Append(kv.Value.Affection).Append(',').Append(kv.Value.Debt).Append(',').Append(kv.Value.Grudge);
        return sb.ToString();
    }

    void Validate(AppraiseRequest req)
    {
        if (req.Npcs.Count > opt.MaxNpcs) throw new BadRequestException("too many npcs");
        if (req.Events.Count > opt.MaxEvents) throw new BadRequestException("too many events");
        var ids = new HashSet<string>();
        foreach (var n in req.Npcs)
        {
            if (string.IsNullOrEmpty(n?.Id)) throw new BadRequestException("npc without id");
            if (!ids.Add(n.Id)) throw new BadRequestException("duplicate npc " + n.Id);
        }
        foreach (var e in req.Events)
        {
            if (e == null || string.IsNullOrEmpty(e.Who) || string.IsNullOrEmpty(e.Target)) throw new BadRequestException("event without who/target");
            if (string.IsNullOrEmpty(e.Tag) || !table.Tags.ContainsKey(e.Tag)) throw new UnknownTagException(e.Tag ?? "");
        }
    }

    public AppraiseResponse Appraise(AppraiseRequest req)
    {
        var sw = Stopwatch.StartNew();
        req.Npcs ??= new();
        req.Events ??= new();
        req.Present ??= new();
        Validate(req);

        var entry = EntryOf(req.ChatId ?? "");
        string label;
        var outNpcs = new List<NpcOut>(req.Npcs.Count);
        lock (Engine)
        lock (entry.Gate)
        {
            var prefix = entry.World == req.World && IsPrefix(entry.Events, req.Events);
            if (!prefix) entry.Runs = new();
            var work = !prefix;
            var present = new HashSet<string>(req.Present);
            var runs = new Dictionary<string, Character>();
            long first = req.Events.Count > 0 ? req.Events[0].Turn : req.Turn;

            var list = new List<Character>(req.Npcs.Count);
            var fresh = new HashSet<Character>();
            foreach (var n in req.Npcs)
            {
                var t = CharacterFactory.TraitsOf(n);
                var observer = present.Contains(n.Id);
                var sig = SigOf(n, t, observer);
                entry.Runs.TryGetValue(n.Id, out var run);
                if (run != null && (run.Sig != sig || run.Cursor > req.Turn || !TailOk(run, req.Events))) run = null;
                if (run == null)
                {
                    run = CharacterFactory.Build(n, table, observer);   // serial: FAtiMA's asset loading shares static tables
                    run.Sig = sig;
                    run.Cursor = first;
                    if (prefix) work = true;
                }
                if (run.Next < req.Events.Count || run.Cursor != req.Turn) work = true;
                list.Add(run);
                runs[n.Id] = run;
            }

            var reports = new NpcOut[list.Count];
            void One(int i)
            {
                var run = list[i];
                for (; run.Next < req.Events.Count; run.Next++) ApplyEvent(run, req.Events[run.Next]);
                if (run.Cursor != req.Turn) Advance(run, req.Turn);
                reports[i] = Report(run, req, present);
            }
            if (opt.Parallel && list.Count > 1 && list.Sum(r => req.Events.Count - r.Next) > 120)
            {
                try { System.Threading.Tasks.Parallel.For(0, list.Count, One); }
                catch (AggregateException e) { System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(e.InnerExceptions[0]).Throw(); }
            }
            else for (var i = 0; i < list.Count; i++) One(i);

            entry.World = req.World;
            entry.Events = req.Events.Select(e => new EventIn { Turn = e.Turn, Who = e.Who, Tag = e.Tag, Target = e.Target }).ToList();
            entry.Runs = runs;
            label = !prefix ? "miss" : work ? "extended" : "hit";

            outNpcs.AddRange(reports);
        }
        return new AppraiseResponse { Ms = Math.Round(sw.Elapsed.TotalMilliseconds, 2), Cache = label, Npcs = outNpcs };
    }

    static bool TailOk(Character c, List<EventIn> events)
    {
        for (var i = c.Next; i < events.Count; i++) if (events[i].Turn < c.Cursor) return false;
        return true;
    }

    void Advance(Character c, long to)
    {
        var gap = to - c.Cursor;
        if (gap <= 0) return;
        for (long i = 0, n = Math.Min(gap, opt.MaxTurnGap); i < n; i++)
        {
            c.TickAcc += c.TickRate;
            if (c.TickAcc >= 1 - 1e-9) { c.Rpc.Update(); c.TickAcc -= 1; }
        }
        c.Cursor = to;
    }

    void ApplyEvent(Character c, EventIn e)
    {
        Advance(c, e.Turn);
        if (e.Who == e.Target) return;
        var tag = table.Tags[e.Tag];
        if (e.Target == c.Id || (e.Who != c.Id && c.Observer)) CharacterFactory.EnsureRules(c, tag);
        if (e.Target == c.Id)
        {
            if (tag.Emotion == "fear")   // the prospect of harm starts from the same footing every time, so every threat feels the same
                c.Rpc.AddOrUpdateGoal(new EmotionalAppraisal.DTOs.GoalDTO { Name = CharacterFactory.SafeGoal, Significance = (float)CharacterFactory.SafeSignificance, Likelihood = (float)CharacterFactory.SafeStart });
            // FAtiMA numbers the events it records 0, 1, 2 ... : the emotions of this one carry the next number
            var id = c.Events++;
            c.Rpc.Perceive(EventHelper.ActionEnd(CharacterFactory.Sym(e.Who), CharacterFactory.Action(e.Tag), c.Sym));
            double intensity = 0;
            foreach (var em in c.Rpc.GetAllActiveEmotions())
            {
                if (em.CauseEventId != id) continue;
                intensity = Math.Max(intensity, em.Intensity);
                c.CauseTurn[id] = e.Turn;
            }
            var scale = opt.IntensityScaling ? 0.75 + 0.05 * intensity : 1.0;
            Bump(c, e.Who, tag.Trust, tag.Affection, tag.Debt, tag.Grudge, scale);
        }
        else if (e.Who == c.Id)
        {
            // the actor trusted the target: how the actor sees the target moves too (no appraisal of its own to scale by)
            if (tag.MutualTrust != 0) Bump(c, e.Target, tag.MutualTrust, 0, 0, 0, opt.IntensityScaling ? 0.75 + 0.05 * tag.Intensity : 1.0);
        }
        else if (c.Observer)
        {
            c.Events++;
            c.Rpc.Perceive(EventHelper.ActionEnd(CharacterFactory.Sym(e.Who), CharacterFactory.SeenAction(e.Tag), CharacterFactory.Sym(e.Target)));
        }
    }

    int[] RelOf(Character c, string q)
    {
        if (c.Rel.TryGetValue(q, out var r)) return r;
        r = SeedOf(c, q);
        c.Rel[q] = r;
        return r;
    }

    int[] SeedOf(Character c, string q)
    {
        var s = c.Seed.TryGetValue(q, out var given) ? given : table.DefaultSeed;
        return new[] { Fold(s.Trust), Fold(s.Affection), Fold(s.Debt), Fold(s.Grudge) };
    }

    // Math.round of JS (half up), clamped 0..100: the same integer the JS fold stores.
    public static int Fold(double v) => (int)Math.Min(100, Math.Max(0, Math.Floor(v + 0.5)));

    // Trait modulators of appraisal.json: grudge gain x (1.5 - agree/100), trust loss x (0.5 + neuro/100), affection gain x (0.5 + extra/100),
    // debt gain x (0.6 + consc/100 * 0.8).
    void Bump(Character c, string q, int trust, int affection, int debt, int grudge, double scale)
    {
        var r = RelOf(c, q);
        var t = c.Traits;
        double Mod(int dim, int d) => dim switch
        {
            0 => d < 0 ? 0.5 + t.Neuro / 100 : 1,
            1 => d > 0 ? 0.5 + t.Extra / 100 : 1,
            2 => d > 0 ? 0.6 + t.Consc / 100 * 0.8 : 1,
            _ => d > 0 ? 1.5 - t.Agree / 100 : 1,
        };
        var deltas = new[] { trust, affection, debt, grudge };
        for (var k = 0; k < 4; k++)
            if (deltas[k] != 0) r[k] = Fold(r[k] + deltas[k] * scale * Mod(k, deltas[k]));
    }

    static readonly HashSet<string> NoTarget = new() { "", "SELF", "*", "-" };

    NpcOut Report(Character c, AppraiseRequest req, HashSet<string> present)
    {
        // emotions: FAtiMA keeps one instance per event; fold them by (type, target), strongest wins
        var best = new Dictionary<(string, string), EmotionOut>();
        foreach (var e in c.Rpc.GetAllActiveEmotions())
        {
            var type = e.Type.ToLowerInvariant().Replace('-', '_');
            var target = e.Target ?? "";
            if (NoTarget.Contains(target) || target == c.Sym)
            {
                target = "";
                // joy, distress and fear are about the event, not a person; every event here is somebody's act on this NPC, so they are about the actor
                if ((type == "joy" || type == "distress" || type == "fear") && !string.IsNullOrEmpty(e.CauseEventName))
                    target = CharacterFactory.IdOf(WellFormedNames.Name.BuildName(e.CauseEventName).GetNTerm(2).ToString());
            }
            else target = CharacterFactory.IdOf(target);
            if (e.Intensity < 1) continue;
            var key = (type, target);
            var since = c.CauseTurn.TryGetValue(e.CauseEventId, out var tt) ? tt : req.Turn;
            if (!best.TryGetValue(key, out var cur) || e.Intensity > cur.Intensity)
                best[key] = new EmotionOut { Type = type, Intensity = Math.Round(Math.Min(10, e.Intensity), 2), Target = target, SinceTurn = since };
        }
        var emotions = best.Values.OrderByDescending(x => x.Intensity).ThenBy(x => x.Type, StringComparer.Ordinal).ThenBy(x => x.Target, StringComparer.Ordinal).Take(12).ToList();

        // the others as this NPC sees them: seeded ones, the ones the events touched, the scene, and the player
        var qs = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var k in c.Seed.Keys) qs.Add(k);
        foreach (var k in c.Rel.Keys) qs.Add(k);
        foreach (var k in present) qs.Add(k);
        qs.Add("player");
        qs.Remove(c.Id);

        var rel = new Dictionary<string, RelOut>();
        var si = new Dictionary<string, double>();
        var changed = false;
        foreach (var q in qs)
        {
            var r = c.Rel.TryGetValue(q, out var have) ? have : SeedOf(c, q);
            rel[q] = new RelOut { Trust = r[0], Affection = r[1], Debt = r[2], Grudge = r[3] };
            var qs2 = CharacterFactory.Sym(q);
            string[] names = { "Trust", "Affection", "Debt", "Grudge" };
            for (var k = 0; k < 4; k++)
            {
                var key = names[k] + "|" + q;
                if (c.Beliefs.TryGetValue(key, out var v) && v == r[k]) continue;
                c.Rpc.UpdateBelief($"{names[k]}({qs2})", r[k].ToString());
                c.Beliefs[key] = r[k];
                changed = true;
            }
        }
        if (changed) c.Rpc.m_socialImportanceAsset.InvalidateCachedSI();
        foreach (var q in qs)
            si[q] = Math.Min(10, c.Rpc.m_socialImportanceAsset.GetSocialImportance(CharacterFactory.Sym(q), c.Sym));

        return new NpcOut { Id = c.Id, Mood = Math.Round(Math.Min(10, Math.Max(-10, c.Rpc.Mood)), 2), Emotions = emotions, Si = si, Rel = rel };
    }
}
