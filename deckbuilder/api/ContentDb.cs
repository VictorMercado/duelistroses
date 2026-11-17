using Microsoft.EntityFrameworkCore;

namespace DuelistCity.Content;

/// <summary>What players create: decks and maps. Card data is not stored here.</summary>
public sealed class ContentDb(DbContextOptions<ContentDb> options) : DbContext(options)
{
    public DbSet<Deck> Decks => Set<Deck>();
    public DbSet<GameMap> Maps => Set<GameMap>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Deck>().HasIndex(deck => deck.OwnerId);
        model.Entity<GameMap>().HasIndex(map => map.OwnerId);
    }
}

public sealed class Deck
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");
    /// <summary>The "sub" claim of the game server's token for whoever built it.</summary>
    public string OwnerId { get; set; } = "";
    public string OwnerName { get; set; } = "";
    public string Name { get; set; } = "";
    public int LeaderNum { get; set; }
    /// <summary>Card numbers, comma separated. Always 40 of them.</summary>
    public string Cards { get; set; } = "";
    public bool IsPublic { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public int[] CardNumbers() => Cards.Length == 0 ? [] : Cards.Split(',').Select(int.Parse).ToArray();
}

public sealed class GameMap
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");
    public string OwnerId { get; set; } = "";
    public string OwnerName { get; set; } = "";
    public string Name { get; set; } = "";
    public int Size { get; set; }
    /// <summary>Terrain names, comma separated, row by row from the south-west corner.</summary>
    public string Tiles { get; set; } = "";
    public bool IsPublic { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

// --- wire shapes ---------------------------------------------------------

public sealed record DeckDto(
    string Id, string Name, int LeaderNum, int[] Cards, bool IsPublic, int DeckCost,
    string OwnerId, string OwnerName, DateTimeOffset UpdatedAt, string? Description = null, bool Starter = false);

public sealed record DeckInput(string? Name, int LeaderNum, int[]? Cards, bool IsPublic);

public sealed record MapDto(
    string Id, string Name, int Size, string[] Tiles, bool IsPublic,
    string OwnerId, string OwnerName, DateTimeOffset UpdatedAt);

public sealed record MapInput(string? Name, int Size, string[]? Tiles, bool IsPublic);
