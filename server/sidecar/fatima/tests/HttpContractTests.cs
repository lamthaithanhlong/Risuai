using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Fatima.Sidecar.Tests;

// The process contract of plan section 10, against the real binary: FATIMA_READY, the token, the status codes.
public sealed class HttpContractTests : IDisposable
{
    readonly Process proc;
    readonly HttpClient http;
    readonly int port;
    const string Token = "tok-123";

    public HttpContractTests()
    {
        var dll = Path.Combine(AppContext.BaseDirectory, "Fatima.Sidecar.dll");
        var psi = new ProcessStartInfo("dotnet", $"\"{dll}\"") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.Environment["FATIMA_PORT"] = "0";
        psi.Environment["FATIMA_TOKEN"] = Token;
        psi.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1";
        proc = Process.Start(psi)!;
        var line = Task.Run(() => proc.StandardOutput.ReadLine());
        Assert.True(line.Wait(20000), "no FATIMA_READY within 20 s");
        Assert.StartsWith("FATIMA_READY ", line.Result);
        port = int.Parse(line.Result.Split(' ')[1]);
        http = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{port}"), Timeout = TimeSpan.FromSeconds(20) };
    }

    public void Dispose()
    {
        try { proc.Kill(true); } catch { }
        http.Dispose();
    }

    Task<HttpResponseMessage> Send(HttpMethod m, string path, string body = null, string token = Token)
    {
        var req = new HttpRequestMessage(m, path);
        if (token != null) req.Headers.Add("x-fatima-token", token);
        if (body != null) req.Content = new StringContent(body, Encoding.UTF8, "application/json");
        return http.SendAsync(req);
    }

    const string Good = """
        {"chatId":"h","world":"w","turn":2,"present":["marek"],
         "npcs":[{"id":"marek","name":"Marek","traits":{"open":50,"consc":50,"extra":50,"agree":50,"neuro":50},"importance":5,"speech":"gruff","tags":[],"hasSecret":false,"hasAgenda":false,"seed":{"player":{"trust":60,"affection":50,"debt":0,"grudge":5}}}],
         "events":[{"turn":1,"who":"player","tag":"help","target":"marek"},{"turn":2,"who":"player","tag":"insult","target":"marek"}]}
        """;

    [Fact]
    public async Task Health_NeedsTheToken()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(HttpMethod.Get, "/health", token: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(HttpMethod.Get, "/health", token: "nope")).StatusCode);
        var ok = await Send(HttpMethod.Get, "/health");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var j = JsonDocument.Parse(await ok.Content.ReadAsStringAsync()).RootElement;
        Assert.True(j.GetProperty("ok").GetBoolean());
        Assert.StartsWith("fatima-sidecar/1", j.GetProperty("version").GetString());
    }

    [Fact]
    public async Task Appraise_RoundTrip_AndCache()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(HttpMethod.Post, "/appraise", Good, token: null)).StatusCode);
        var r = await Send(HttpMethod.Post, "/appraise", Good);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var j = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("fatima", j.GetProperty("engine").GetString());
        Assert.Equal("miss", j.GetProperty("cache").GetString());
        var n = j.GetProperty("npcs")[0];
        Assert.Equal("marek", n.GetProperty("id").GetString());
        Assert.Equal("anger", n.GetProperty("emotions")[0].GetProperty("type").GetString());
        Assert.True(n.GetProperty("rel").GetProperty("player").GetProperty("grudge").GetInt32() > 5);   // seed 5, help -2, insult +10
        Assert.True(n.GetProperty("si").TryGetProperty("player", out _));
        var again = JsonDocument.Parse(await (await Send(HttpMethod.Post, "/appraise", Good)).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("hit", again.GetProperty("cache").GetString());
    }

    [Fact]
    public async Task BadJson_Is400()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Post, "/appraise", "{nope")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Post, "/appraise", "{\"npcs\":[{\"id\":\"\"}]}")).StatusCode);
    }

    [Fact]
    public async Task UnknownTag_Is422()
    {
        var bad = Good.Replace("\"insult\"", "\"tickle\"");
        var r = await Send(HttpMethod.Post, "/appraise", bad);
        Assert.Equal((HttpStatusCode)422, r.StatusCode);
        Assert.Contains("tickle", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task BodyOver64K_Is413()
    {
        var big = "{\"chatId\":\"" + new string('x', 70 * 1024) + "\"}";
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await Send(HttpMethod.Post, "/appraise", big)).StatusCode);
    }

    [Fact]
    public async Task Reset_DropsTheCache()
    {
        await Send(HttpMethod.Post, "/appraise", Good);
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Post, "/reset", "{\"chatId\":\"h\"}")).StatusCode);
        var j = JsonDocument.Parse(await (await Send(HttpMethod.Post, "/appraise", Good)).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("miss", j.GetProperty("cache").GetString());
        Assert.Equal(HttpStatusCode.OK, (await Send(HttpMethod.Post, "/reset", "")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(HttpMethod.Post, "/reset", "{x")).StatusCode);
    }
}
