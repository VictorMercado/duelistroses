using System.Security.Claims;

namespace DuelistCity.Content.Endpoints;

/// <summary>Validation shared by the endpoints, and who is calling.</summary>
public static class Rules
{
    public const int DeckSize = 40;
    public const int MaxCopies = 3;

    public static readonly string[] Terrains =
        ["normal", "sogen", "forest", "wasteland", "mountain", "umi", "yami", "toon", "crush", "labyrinth"];

    public static string UserId(this ClaimsPrincipal user) => user.FindFirstValue("sub") ?? "";
    public static string UserName(this ClaimsPrincipal user) => user.FindFirstValue("name") ?? "Duelist";

    /// <summary>Returns what is wrong with a deck, or null when it is legal.</summary>
    public static string? CheckDeck(DeckInput input, Catalog catalog)
    {
        var name = input.Name?.Trim() ?? "";
        if (name.Length is 0 or > 40) return "A deck needs a name of 1 to 40 characters.";
        var cards = input.Cards ?? [];
        if (cards.Length != DeckSize) return $"A deck has exactly {DeckSize} cards; this one has {cards.Length}.";

        foreach (var group in cards.GroupBy(num => num))
        {
            if (!catalog.Cards.TryGetValue(group.Key, out var card)) return $"Card {group.Key} does not exist.";
            if (group.Count() > MaxCopies) return $"A deck holds at most {MaxCopies} copies of a card ({card.Name}).";
        }

        if (!catalog.Cards.TryGetValue(input.LeaderNum, out var leader) || leader.Kind != "monster")
            return "The deck leader must be a monster.";
        return null;
    }

    public static string? CheckMap(MapInput input)
    {
        var name = input.Name?.Trim() ?? "";
        if (name.Length is 0 or > 40) return "A map needs a name of 1 to 40 characters.";
        if (input.Size is < 5 or > 13 || input.Size % 2 == 0) return "A map is 5, 7, 9, 11 or 13 squares wide.";
        var tiles = input.Tiles ?? [];
        if (tiles.Length != input.Size * input.Size) return $"A {input.Size}x{input.Size} map needs {input.Size * input.Size} tiles.";
        var unknown = tiles.FirstOrDefault(tile => !Terrains.Contains(tile));
        return unknown is null ? null : $"\"{unknown}\" is not a terrain.";
    }
}
