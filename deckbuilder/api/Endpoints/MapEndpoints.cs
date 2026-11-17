using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace DuelistCity.Content.Endpoints;

public static class MapEndpoints
{
    public static void MapMaps(this IEndpointRouteBuilder app)
    {
        var maps = app.MapGroup("/api/maps");

        // Public maps, plus the caller's own when signed in.
        maps.MapGet("/", async (ClaimsPrincipal user, ContentDb db) =>
        {
            var owner = user.UserId();
            var visible = await db.Maps.Where(map => map.IsPublic || (owner != "" && map.OwnerId == owner)).ToListAsync();
            return visible.OrderByDescending(map => map.UpdatedAt).Select(ToDto);
        });

        maps.MapGet("/{id}", async (string id, ClaimsPrincipal user, ContentDb db) =>
        {
            var map = await db.Maps.FindAsync(id);
            if (map is null || (!map.IsPublic && map.OwnerId != user.UserId())) return Results.NotFound();
            return Results.Ok(ToDto(map));
        });

        maps.MapPost("/", async (MapInput input, ClaimsPrincipal user, ContentDb db) =>
        {
            if (Rules.CheckMap(input) is { } problem) return Results.BadRequest(new { error = problem });
            var map = new GameMap { OwnerId = user.UserId(), OwnerName = user.UserName() };
            Apply(map, input);
            db.Maps.Add(map);
            await db.SaveChangesAsync();
            return Results.Created($"/api/maps/{map.Id}", ToDto(map));
        }).RequireAuthorization();

        maps.MapPut("/{id}", async (string id, MapInput input, ClaimsPrincipal user, ContentDb db) =>
        {
            var map = await db.Maps.FindAsync(id);
            if (map is null || map.OwnerId != user.UserId()) return Results.NotFound();
            if (Rules.CheckMap(input) is { } problem) return Results.BadRequest(new { error = problem });
            Apply(map, input);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(map));
        }).RequireAuthorization();

        maps.MapDelete("/{id}", async (string id, ClaimsPrincipal user, ContentDb db) =>
        {
            var map = await db.Maps.FindAsync(id);
            if (map is null || map.OwnerId != user.UserId()) return Results.NotFound();
            db.Maps.Remove(map);
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization();
    }

    private static void Apply(GameMap map, MapInput input)
    {
        map.Name = input.Name!.Trim();
        map.Size = input.Size;
        map.Tiles = string.Join(',', input.Tiles!);
        map.IsPublic = input.IsPublic;
        map.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private static MapDto ToDto(GameMap map) => new(
        map.Id, map.Name, map.Size, map.Tiles.Split(','), map.IsPublic, map.OwnerId, map.OwnerName, map.UpdatedAt);
}
