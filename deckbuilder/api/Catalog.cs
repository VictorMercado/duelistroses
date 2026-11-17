using System.Text.Json;
using System.Text.Json.Nodes;

namespace DuelistCity.Content;

/// <summary>
/// The card catalog, fusion recipes and starter decks, loaded once from the
/// JSON files in Data/. Cards are kept as raw JSON: this service stores and
/// serves card data, it does not interpret it. The game server's rules engine
/// is the only thing that gives an "effect" meaning, so a new effect field
/// never needs a change here.
/// </summary>
public sealed class Catalog
{
    public string CardsJson { get; }
    public string Version { get; }
    public IReadOnlyDictionary<int, CardInfo> Cards { get; }
    public IReadOnlyList<DeckDto> StarterDecks { get; }

    public Catalog(IWebHostEnvironment env)
    {
        var dir = Path.Combine(env.ContentRootPath, "Data");
        var cards = JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "cards.json")))!.AsArray();
        var fusions = JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "fusions.json")))!;

        Cards = cards.Select(node => new CardInfo(
            (int)node!["num"]!,
            (string)node["name"]!,
            (string)node["kind"]!,
            (int?)node["deckCost"] ?? 0)).ToDictionary(card => card.Num);

        var payload = new JsonObject { ["cards"] = cards.DeepClone(), ["fusions"] = fusions.DeepClone() };
        var body = payload.ToJsonString();
        // The version doubles as an ETag, so clients revalidate for free.
        Version = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(body)))[..16];
        payload["version"] = Version;
        CardsJson = payload.ToJsonString();

        var starters = JsonSerializer.Deserialize<List<StarterDeck>>(
            File.ReadAllText(Path.Combine(dir, "starter-decks.json")), JsonSerializerOptions.Web)!;
        StarterDecks = starters.Select(deck => new DeckDto(
            deck.Id, deck.Name, deck.LeaderNum, deck.Cards, true, deck.DeckCost,
            "", "Duelist City", DateTimeOffset.UnixEpoch, deck.Description, true)).ToList();
    }

    public int DeckCost(IEnumerable<int> cards) => cards.Sum(num => Cards.TryGetValue(num, out var card) ? card.DeckCost : 0);

    private sealed record StarterDeck(string Id, string Name, int LeaderNum, int[] Cards, int DeckCost, string Description);
}

public sealed record CardInfo(int Num, string Name, string Kind, int DeckCost);
