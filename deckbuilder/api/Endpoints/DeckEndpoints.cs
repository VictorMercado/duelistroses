using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace DuelistCity.Content.Endpoints;

public static class DeckEndpoints
{
    public static void MapDecks(this IEndpointRouteBuilder app)
    {
        var decks = app.MapGroup("/api/decks");

        decks.MapGet("/starter", (Catalog catalog) => catalog.StarterDecks);

        // The caller's own decks.
        decks.MapGet("/", async (ClaimsPrincipal user, ContentDb db, Catalog catalog) =>
        {
            var owner = user.UserId();
            var mine = await db.Decks.Where(deck => deck.OwnerId == owner).ToListAsync();
            return mine.OrderByDescending(deck => deck.UpdatedAt).Select(deck => ToDto(deck, catalog));
        }).RequireAuthorization();

        // One deck: a starter, a public deck, or the caller's own. This is the
        // endpoint the game server imports a deck through, with the player's token.
        decks.MapGet("/{id}", async (string id, ClaimsPrincipal user, ContentDb db, Catalog catalog) =>
        {
            if (catalog.StarterDecks.FirstOrDefault(deck => deck.Id == id) is { } starter) return Results.Ok(starter);
            var deck = await db.Decks.FindAsync(id);
            if (deck is null || (!deck.IsPublic && deck.OwnerId != user.UserId())) return Results.NotFound();
            return Results.Ok(ToDto(deck, catalog));
        });

        decks.MapPost("/", async (DeckInput input, ClaimsPrincipal user, ContentDb db, Catalog catalog) =>
        {
            if (Rules.CheckDeck(input, catalog) is { } problem) return Results.BadRequest(new { error = problem });
            var deck = new Deck { OwnerId = user.UserId(), OwnerName = user.UserName() };
            Apply(deck, input);
            db.Decks.Add(deck);
            await db.SaveChangesAsync();
            return Results.Created($"/api/decks/{deck.Id}", ToDto(deck, catalog));
        }).RequireAuthorization();

        decks.MapPut("/{id}", async (string id, DeckInput input, ClaimsPrincipal user, ContentDb db, Catalog catalog) =>
        {
            var deck = await db.Decks.FindAsync(id);
            if (deck is null || deck.OwnerId != user.UserId()) return Results.NotFound();
            if (Rules.CheckDeck(input, catalog) is { } problem) return Results.BadRequest(new { error = problem });
            Apply(deck, input);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(deck, catalog));
        }).RequireAuthorization();

        decks.MapDelete("/{id}", async (string id, ClaimsPrincipal user, ContentDb db) =>
        {
            var deck = await db.Decks.FindAsync(id);
            if (deck is null || deck.OwnerId != user.UserId()) return Results.NotFound();
            db.Decks.Remove(deck);
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization();
    }

    private static void Apply(Deck deck, DeckInput input)
    {
        deck.Name = input.Name!.Trim();
        deck.LeaderNum = input.LeaderNum;
        deck.Cards = string.Join(',', input.Cards!.Order());
        deck.IsPublic = input.IsPublic;
        deck.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private static DeckDto ToDto(Deck deck, Catalog catalog)
    {
        var cards = deck.CardNumbers();
        return new DeckDto(deck.Id, deck.Name, deck.LeaderNum, cards, deck.IsPublic,
            catalog.DeckCost(cards), deck.OwnerId, deck.OwnerName, deck.UpdatedAt);
    }
}
