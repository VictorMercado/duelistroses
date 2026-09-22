package game

// Card definitions live here so the server owns what a deck contains. The
// client still resolves artwork locally, but every id, stat and asset path a
// client renders now originates from this catalog.

var (
	AttrLight = Attribute{Type: "light", AttributeUrl: "/assets/attributes/light_attribute.svg"}
	AttrDark  = Attribute{Type: "dark", AttributeUrl: "/assets/attributes/dark_attribute.svg"}
	AttrEarth = Attribute{Type: "earth", AttributeUrl: "/assets/attributes/earth_attribute.svg"}
	AttrSpell = Attribute{Type: "spell", AttributeUrl: "/assets/attributes/spell_attribute.svg"}
)

var (
	KindSpellcaster = &MonsterKind{Monster: "spellcaster", StrongIn: []TerrainType{TerrainYami}, WeakIn: []TerrainType{TerrainToon, TerrainSogen}}
	KindDragon      = &MonsterKind{Monster: "dragon", StrongIn: []TerrainType{TerrainMountain}, WeakIn: []TerrainType{TerrainToon}}
	KindWarrior     = &MonsterKind{Monster: "warrior", StrongIn: []TerrainType{TerrainSogen}, WeakIn: []TerrainType{TerrainToon}}
	KindFiend       = &MonsterKind{Monster: "fiend", StrongIn: []TerrainType{TerrainYami}, WeakIn: []TerrainType{TerrainToon}}
)

// CardTemplate is a card without any per-game state (no id, owner or position).
type CardTemplate struct {
	Name        string
	Description string
	Attack      int
	Defense     int
	Level       int
	Type        string
	Rarity      Rarity
	Attribute   Attribute
	Monster     *MonsterKind
	TemplateUrl string
	TextureUrl  string
	MaskUrl     string
}

// CardCatalog is every card the server can deal.
var CardCatalog = []CardTemplate{
	{
		Name: "Dark Magician", Description: "The ultimate wizard in terms of attack and defense.",
		Attack: 2500, Defense: 2100, Level: 8, Type: "normal", Rarity: "ultra",
		Attribute: AttrDark, Monster: KindSpellcaster,
		TemplateUrl: "/assets/textures/normalTemplate.png",
		TextureUrl:  "/assets/cards/Dark_Magician.png",
		MaskUrl:     "/assets/cards/Dark_Magician_Mask.png",
	},
	{
		Name: "Blue-Eyes White Dragon", Description: "This legendary dragon is a powerful engine of destruction.",
		Attack: 3000, Defense: 2500, Level: 8, Type: "normal", Rarity: "ultra",
		Attribute: AttrLight, Monster: KindDragon,
		TemplateUrl: "/assets/textures/normalTemplate.png",
		TextureUrl:  "/assets/cards/Blue_Eyes_White_Dragon.png",
		MaskUrl:     "/assets/cards/Blue_Eyes_White_Dragon_Mask.png",
	},
	{
		Name: "Dark Magician Girl", Description: "The Dark Magician's younger sister. She wields the power of the Dark Magician.",
		Attack: 2000, Defense: 1600, Level: 6, Type: "effect", Rarity: "ultra",
		Attribute: AttrDark, Monster: KindSpellcaster,
		TemplateUrl: "/assets/textures/effectTemplate.png",
		TextureUrl:  "/assets/cards/Dark_Magician_Girl.png",
		MaskUrl:     "/assets/cards/Dark_Magician_Girl_Mask.png",
	},
	{
		Name: "Red-Eyes Black Dragon", Description: "A ferocious dragon with a deadly attack.",
		Attack: 2400, Defense: 2000, Level: 7, Type: "normal", Rarity: "common",
		Attribute: AttrDark, Monster: KindDragon,
		TemplateUrl: "/assets/textures/normalTemplate.png",
		TextureUrl:  "/assets/cards/Red_Eyes_Black_Dragon.png",
	},
	{
		Name: "Blue-Eyes Ultimate Dragon", Description: "This legendary dragon is a powerful engine of destruction.",
		Attack: 4500, Defense: 3800, Level: 12, Type: "fusion", Rarity: "ultra",
		Attribute: AttrLight, Monster: KindDragon,
		TemplateUrl: "/assets/textures/fusionTemplate.png",
		TextureUrl:  "/assets/cards/Blue_Eyes_Ultimate_Dragon.png",
		MaskUrl:     "/assets/cards/Blue_Eyes_Ultimate_Dragon_Mask.png",
	},
	{
		Name: "Black Luster Soldier", Description: "This monster can only be Ritual Summoned with the Ritual Spell Card, Black Luster Ritual.",
		Attack: 3000, Defense: 2500, Level: 8, Type: "ritual", Rarity: "common",
		Attribute: AttrEarth, Monster: KindWarrior,
		TemplateUrl: "/assets/textures/ritualTemplate.png",
		TextureUrl:  "/assets/cards/Black_Luster_Soldier.png",
	},
	{
		Name: "Change of Heart", Description: "Target 1 monster your opponent controls; change its ATK and DEF to 0.",
		Attack: -1, Defense: -1, Level: 0, Type: "normal", Rarity: "common",
		Attribute: AttrSpell, Monster: nil,
		TemplateUrl: "/assets/textures/spellTemplate.png",
		TextureUrl:  "/assets/cards/Change_of_Heart.png",
	},
	{
		Name: "Summoned Skull", Description: "A fiend with dark powers for confusing the enemy. Among the Fiend-Type monsters, the monster boasts considerable force.",
		Attack: 2500, Defense: 1200, Level: 6, Type: "normal", Rarity: "ultra",
		Attribute: AttrDark, Monster: KindFiend,
		TemplateUrl: "/assets/textures/normalTemplate.png",
		TextureUrl:  "/assets/cards/Summoned_Skull.png",
		MaskUrl:     "/assets/cards/Summoned_Skull_Mask.png",
	},
}

// NewCard instantiates a template for a seat. Cards start face down in attack
// position; the caller places it on the board or into a deck.
func (t CardTemplate) NewCard(id int, owner Owner, position Vector3) *Card {
	return &Card{
		ID:            id,
		Name:          t.Name,
		Description:   t.Description,
		Attack:        t.Attack,
		Defense:       t.Defense,
		Level:         t.Level,
		Type:          t.Type,
		Rarity:        t.Rarity,
		Attribute:     t.Attribute,
		Monster:       t.Monster,
		TemplateUrl:   t.TemplateUrl,
		TextureUrl:    t.TextureUrl,
		MaskUrl:       t.MaskUrl,
		Owner:         owner,
		Position:      position,
		IsFaceDown:    true,
		IsDefenseMode: false,
		HasMoved:      false,
	}
}

// Deck sizes are identical for every seat so both players always hold the same
// number of cards.
const (
	DeckSize        = 40
	OpeningHandSize = 5
	StartingUnits   = 2
)

// BuildDeck deals DeckSize cards by cycling the catalog, so both seats get the
// same composition, only with different ids and owners.
func BuildDeck(owner Owner, startID int) []*Card {
	deck := make([]*Card, 0, DeckSize)
	for i := 0; i < DeckSize; i++ {
		template := CardCatalog[i%len(CardCatalog)]
		// Off-board cards sit below the table until they are played.
		deck = append(deck, template.NewCard(startID+i, owner, Vector3{X: 0, Y: 0, Z: -10}))
	}
	return deck
}
