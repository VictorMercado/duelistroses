package engine

// Rarity: a player's copy of a card grows rarer the more it is used to kill.
// Rarity belongs to a player and a card number (every copy in their decks
// shares it), and is earned only by monsters, with points:
//
//   - MonsterKillPoints for each enemy monster it destroys, in battle or by
//     its own ability;
//   - LeaderKillPoints for the final blow to an enemy deck leader (the hit
//     that takes its last LP).
//
// The engine counts what each seat earns over the duel (Seat.CardPoints) on
// top of what the player had earned before (Seat.RarityBase, from the
// database). A card that crosses a threshold mid-duel shows its new rarity
// at once, and a "rarity" event says so. The room saves the points when the
// duel is recorded (see Room.record).

const (
	RarityCommon   = "common"
	RarityRare     = "rare"
	RaritySecret   = "secret"
	RarityUltra    = "ultra"
	RarityUltimate = "ultimate"
	// RarityCosmic is never earned with points: a player unlocks it for a
	// card some other way (Seat.Unlocked).
	RarityCosmic = "cosmic"
)

const (
	MonsterKillPoints = 1
	LeaderKillPoints  = 10
)

// rarityTiers are the points each rarity needs, rarest first.
var rarityTiers = []struct {
	name   string
	points int
}{
	{RarityUltimate, 100},
	{RarityUltra, 50},
	{RaritySecret, 30},
	{RarityRare, 10},
}

// RarityFor is the rarity a card has with this many points.
func RarityFor(points int) string {
	for _, t := range rarityTiers {
		if points >= t.points {
			return t.name
		}
	}
	return RarityCommon
}

// RarityPoints is the points a rarity needs; false for an unknown name.
func RarityPoints(name string) (int, bool) {
	if name == RarityCommon {
		return 0, true
	}
	for _, t := range rarityTiers {
		if t.name == name {
			return t.points, true
		}
	}
	return 0, false
}

// crediting makes c the card credited with whatever is destroyed, or the LP
// lost, until the returned function runs (deferred, or called once the blow
// is dealt). Nested blows restore the card credited before them.
func (g *Game) crediting(c *Card) func() {
	previous := g.credited
	g.credited = c
	return func() { g.credited = previous }
}

// collects reports whether a seat keeps rarity points (a player with an
// account; bots and guests do not).
func (s *Seat) collects() bool { return s != nil && s.RarityBase != nil }

// earn gives the credited card points for a blow by seat `by` against seat
// `victim`. Only a monster earns, fighting for the deck it came from, against
// the other team.
func (g *Game) earn(points, by, victim int) {
	c := g.credited
	if c == nil || !c.Def.IsMonster() || c.Borrowed || c.Owner != by || c.Home != by || g.sameTeam(by, victim) {
		return
	}
	s := g.seat(c.Home)
	if !s.collects() {
		return
	}
	num := c.Def.Num
	before := g.rarityAt(s, num)
	if s.CardPoints == nil {
		s.CardPoints = map[int]int{}
	}
	s.CardPoints[num] += points
	if after := g.rarityAt(s, num); after != before {
		g.emit(Event{Type: "rarity", Seat: s.Index, CardID: c.ID, Num: cardNum(num), X: c.Pos.X, Y: c.Pos.Y, Text: after})
	}
}

// rarityAt is the rarity of a card number for a seat, counting this duel.
func (g *Game) rarityAt(s *Seat, num int) string {
	if s == nil {
		return RarityCommon
	}
	if r, ok := s.Unlocked[num]; ok {
		return r
	}
	if !s.collects() {
		return RarityCommon
	}
	return RarityFor(s.RarityBase[num] + s.CardPoints[num])
}

// rarityOf is a card's rarity as views carry it: empty for common.
func (g *Game) rarityOf(c *Card) string {
	return shownRarity(g.rarityAt(g.seat(c.Home), c.Def.Num))
}

func shownRarity(r string) string {
	if r == RarityCommon {
		return ""
	}
	return r
}

// AdminSetRarity sets the rarity of a card number for the seat that owns
// card id (one on the field or in a hand), for the test tools. It lasts for
// this duel only: a tested duel is never recorded.
func (g *Game) AdminSetRarity(seat, id int, rarity string) error {
	points, ok := RarityPoints(rarity)
	if !ok && rarity != RarityCosmic {
		return RuleError("Unknown rarity")
	}
	c := g.Cards[id]
	if c == nil {
		return RuleError("No such card")
	}
	s := g.seat(c.Home)
	if s == nil {
		return RuleError("No such seat")
	}
	if s.RarityBase == nil {
		s.RarityBase = map[int]int{}
	}
	if rarity == RarityCosmic {
		if s.Unlocked == nil {
			s.Unlocked = map[int]string{}
		}
		s.Unlocked[c.Def.Num] = RarityCosmic
	} else {
		delete(s.Unlocked, c.Def.Num)
		s.RarityBase[c.Def.Num] = points - s.CardPoints[c.Def.Num]
	}
	g.emit(Event{Type: "adminTool", Seat: seat, Text: "used the test tools to make " + c.Def.Name + " " + rarity})
	return nil
}
