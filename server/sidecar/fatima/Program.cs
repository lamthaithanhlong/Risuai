using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Fatima.Sidecar;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

// FAtiMA sidecar (plan section 10): loopback HTTP, one token header, `FATIMA_READY <port>` on stdout once it listens.
//   FATIMA_PORT=0 FATIMA_TOKEN=secret dotnet bin/Release/net10.0/Fatima.Sidecar.dll
const int MaxBody = 64 * 1024;
var started = DateTime.UtcNow;
var port = int.TryParse(Environment.GetEnvironmentVariable("FATIMA_PORT"), out var p) ? p : 0;
var token = Environment.GetEnvironmentVariable("FATIMA_TOKEN") ?? "";

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Logging.AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Warning);
builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = MaxBody);
var app = builder.Build();

var appraiser = new Appraiser(AppraisalTable.Load(AppraisalTable.FindPath()), new AppraiserOptions { Parallel = Environment.GetEnvironmentVariable("FATIMA_PARALLEL") != "0" });

// the token: when FATIMA_TOKEN is set every request must carry it
app.Use(async (ctx, next) =>
{
    if (token.Length > 0)
    {
        var got = ctx.Request.Headers["x-fatima-token"].ToString();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(got), Encoding.UTF8.GetBytes(token)))
        {
            ctx.Response.StatusCode = 401;
            await ctx.Response.WriteAsJsonAsync(new { error = "bad token" });
            return;
        }
    }
    await next();
});

app.MapGet("/health", () => Results.Json(new
{
    ok = true,
    version = "fatima-sidecar/1 toolkit/56b7cbd",
    chats = appraiser.Chats,
    uptimeMs = (long)(DateTime.UtcNow - started).TotalMilliseconds,
}));

async Task<(string body, IResult err)> ReadBody(HttpRequest req)
{
    using var ms = new MemoryStream();
    var buf = new byte[8192];
    int n;
    while ((n = await req.Body.ReadAsync(buf)) > 0)
    {
        ms.Write(buf, 0, n);
        if (ms.Length > MaxBody) return (null, Results.Json(new { error = "body over 64 KB" }, statusCode: 413));
    }
    return (Encoding.UTF8.GetString(ms.ToArray()), null);
}

app.MapPost("/appraise", async (HttpRequest http) =>
{
    var (body, err) = await ReadBody(http);
    if (err != null) return err;
    AppraiseRequest req;
    try { req = JsonSerializer.Deserialize<AppraiseRequest>(body, Wire.Json); }
    catch (JsonException e) { return Results.Json(new { error = "bad json: " + e.Message }, statusCode: 400); }
    if (req == null) return Results.Json(new { error = "empty body" }, statusCode: 400);
    try { return Results.Json(appraiser.Appraise(req), Wire.Json); }
    catch (UnknownTagException e) { return Results.Json(new { error = e.Message, tag = e.Tag }, statusCode: 422); }
    catch (BadRequestException e) { return Results.Json(new { error = e.Message }, statusCode: 400); }
});

app.MapPost("/reset", async (HttpRequest http) =>
{
    var (body, err) = await ReadBody(http);
    if (err != null) return err;
    string chatId = null;
    if (!string.IsNullOrWhiteSpace(body))
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("chatId", out var c) && c.ValueKind == JsonValueKind.String) chatId = c.GetString();
        }
        catch (JsonException e) { return Results.Json(new { error = "bad json: " + e.Message }, statusCode: 400); }
    }
    appraiser.Reset(chatId);
    return Results.Json(new { ok = true, chats = appraiser.Chats });
});

// The client that spawned us hands over its pid: if it dies without a chance to stop us (kill -9, a crash), we go with it.
if (int.TryParse(Environment.GetEnvironmentVariable("FATIMA_PARENT_PID"), out var parent) && parent > 1)
{
    var watch = new Timer(_ =>
    {
        try { System.Diagnostics.Process.GetProcessById(parent); }
        catch (ArgumentException) { Environment.Exit(0); }
    }, null, TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(3));
    app.Lifetime.ApplicationStopping.Register(() => watch.Dispose());
}

await app.StartAsync();
var addr = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>().Addresses.First();
Console.Out.WriteLine("FATIMA_READY " + new Uri(addr).Port);
Console.Out.Flush();
await app.WaitForShutdownAsync();
