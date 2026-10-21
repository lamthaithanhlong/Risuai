using System.Text.Json;
using Fatima.Sidecar;

namespace Fatima.Sidecar.Tests;

public static class Kit
{
    public static readonly AppraisalTable Table = AppraisalTable.Load(AppraisalTable.FindPath());

    public static TraitsDto Tr(double open = 50, double consc = 50, double extra = 50, double agree = 50, double neuro = 50) =>
        new() { Open = open, Consc = consc, Extra = extra, Agree = agree, Neuro = neuro };

    public static NpcIn Npc(string id, TraitsDto t = null, Dictionary<string, RelDto> seed = null) =>
        new() { Id = id, Name = id, Traits = t ?? Tr(), Importance = 50, Speech = "plain", Tags = new(), Seed = seed ?? new() };

    public static RelDto Rel(double trust, double affection, double debt, double grudge) => new() { Trust = trust, Affection = affection, Debt = debt, Grudge = grudge };

    public static EventIn Ev(int turn, string who, string tag, string target) => new() { Turn = turn, Who = who, Tag = tag, Target = target };

    public static AppraiseRequest Req(string chat, int turn, IEnumerable<NpcIn> npcs, IEnumerable<EventIn> events, params string[] present) => new()
    {
        ChatId = chat, World = "w", Turn = turn, Present = present.ToList(), Npcs = npcs.ToList(), Events = events.ToList(),
    };

    public static Appraiser Make(bool scaling = true) => new(Table, new AppraiserOptions { IntensityScaling = scaling });

    // The answer without the timing and the cache label: two answers that mean the same compare equal.
    public static string Body(AppraiseResponse r) => JsonSerializer.Serialize(r.Npcs, Wire.Json);

    public static NpcOut Of(AppraiseResponse r, string id) => r.Npcs.Single(n => n.Id == id);
}
