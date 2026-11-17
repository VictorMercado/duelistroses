using DuelistCity.Content;
using DuelistCity.Content.Endpoints;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

// Duelist City content service.
//
// Owns everything that is content rather than gameplay: the card catalog, every
// image, texture and sound, and the decks and maps players build. The game
// server holds none of it; it reads cards, decks and maps from this API and
// points its client at /assets.
//
// It has no accounts of its own. Players sign in on the game server, which
// issues the tokens; this service only verifies them, using the signing keys
// the game server publishes (standard OpenID Connect discovery).

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<Catalog>();
builder.Services.AddDbContext<ContentDb>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Content")));

var authority = builder.Configuration["Auth:Authority"]!.TrimEnd('/');
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = authority;
        options.Audience = builder.Configuration["Auth:Audience"];
        options.RequireHttpsMetadata = authority.StartsWith("https://", StringComparison.Ordinal);
        // Keep the token's own claim names ("sub", "name").
        options.MapInboundClaims = false;
        options.TokenValidationParameters.NameClaimType = "name";
    });
builder.Services.AddAuthorization();

// The game client and the deck builder are served from other origins. Tokens
// travel in the Authorization header, never in cookies, so any origin may call.
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
{
    if (origins.Length > 0) policy.WithOrigins(origins); else policy.AllowAnyOrigin();
    policy.AllowAnyHeader().AllowAnyMethod().WithExposedHeaders(HeaderNames.ETag);
}));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    // Creates the schema on first run. Move to migrations before the first
    // schema change that has to keep existing data.
    scope.ServiceProvider.GetRequiredService<ContentDb>().Database.EnsureCreated();
}

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    ServeUnknownFileTypes = true, // fonts and audio containers
    OnPrepareResponse = context =>
    {
        var headers = context.Context.Response.Headers;
        // Textures are loaded into WebGL from another origin, which needs CORS.
        headers.AccessControlAllowOrigin = "*";
        if (context.Context.Request.Path.StartsWithSegments("/assets"))
            headers.CacheControl = "public, max-age=86400";
    }
});
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => new { ok = true });

// The whole catalog in one cacheable response: cards and fusion recipes.
app.MapGet("/api/cards", (HttpContext http, Catalog catalog) =>
{
    var etag = $"\"{catalog.Version}\"";
    http.Response.Headers.ETag = etag;
    http.Response.Headers.CacheControl = "public, max-age=60";
    if (http.Request.Headers.IfNoneMatch == etag) return Results.StatusCode(StatusCodes.Status304NotModified);
    return Results.Text(catalog.CardsJson, "application/json");
});

app.MapGet("/api/terrains", () => Rules.Terrains);
app.MapDecks();
app.MapMaps();

// The deck builder is a single page app; unknown paths are its routes.
app.MapFallbackToFile("index.html");

app.Run();
