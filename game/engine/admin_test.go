package engine

import (
	"slices"
	"testing"
)

func TestAdminTools(t *testing.T) {
	g := duel(t)
	hand := len(g.Seats[1].Hand)
	if err := g.AdminGive(1, 21, false, false, Pos{}); err != nil {
		t.Fatal(err)
	}
	if got := g.Seats[1].Hand; len(got) != hand+1 || got[len(got)-1].Def.Num != 21 {
		t.Fatalf("card not added to the hand of a seat whose turn it is not")
	}
	if g.AdminGive(1, 999, false, false, Pos{}) == nil {
		t.Error("a card that does not exist was given")
	}

	if err := g.AdminGive(0, 3, true, false, Pos{X: 1, Y: 1}); err != nil {
		t.Fatal(err)
	}
	c := g.Board[Pos{X: 1, Y: 1}]
	if c == nil || c.Def.Num != 3 || c.Owner != 0 || !c.FaceDown {
		t.Fatalf("card not placed: %+v", c)
	}
	if g.AdminGive(0, 3, true, false, Pos{X: 1, Y: 1}) == nil {
		t.Error("a card was placed on a taken square")
	}
	if g.AdminGive(0, 3, true, false, g.Seats[1].Leader) == nil {
		t.Error("a card was placed on a deck leader")
	}
	if g.AdminGive(0, 3, true, false, Pos{X: 9, Y: 0}) == nil {
		t.Error("a card was placed off the board")
	}
	// Hidden from the other team, like any face-down card.
	for _, cv := range g.ViewFor(1).Cards {
		if cv.ID == c.ID && cv.Num != HiddenNum {
			t.Error("the placed card is visible to the other team")
		}
	}

	deck := g.DeckOf(0)
	reversed := slices.Clone(deck)
	slices.Reverse(reversed)
	if err := g.AdminSetDeck(0, reversed); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(g.Seats[0].Deck, reversed) {
		t.Error("deck not reordered")
	}
	swapped := slices.Clone(reversed)
	swapped[0] = 3 // not in the deck
	if g.AdminSetDeck(0, swapped) == nil || g.AdminSetDeck(0, reversed[1:]) == nil {
		t.Error("a deck with different cards was accepted")
	}

	g.Seats[0].Stars, g.Seats[0].PlaysLeft = 0, 0
	if err := g.AdminRefresh(0); err != nil {
		t.Fatal(err)
	}
	if g.Seats[0].Stars != g.Cfg.MaxStars || g.Seats[0].PlaysLeft != 1 {
		t.Error("turn not refreshed")
	}

	if err := g.AdminGive(1, 3, true, true, Pos{X: -1, Y: 1}); err != nil {
		t.Fatal(err)
	}
	up := g.Board[Pos{X: -1, Y: 1}]
	if up == nil || up.FaceDown || up.Owner != 1 {
		t.Fatalf("card not placed face up for the other seat: %+v", up)
	}
	if err := g.AdminRemove(0, up.ID); err != nil {
		t.Fatal(err)
	}
	if g.Board[Pos{X: -1, Y: 1}] != nil || g.Seats[1].Graveyard[len(g.Seats[1].Graveyard)-1] != 3 {
		t.Error("removed card not sent to its owner's graveyard")
	}
	if err := g.AdminSetLP(1, 1234); err != nil || g.Seats[1].LP != 1234 {
		t.Errorf("life points not set: %v", err)
	}
}

func TestUnlimited(t *testing.T) {
	g := duel(t)
	g.Unlimited = true
	s := g.Seats[0]
	// A full field of monsters already, and no summoning power.
	for x := -3; x <= 1; x++ {
		put(g, 1, 0, x, 0, false)
	}
	s.Stars = 0
	for i := 0; i < 2; i++ {
		if err := g.AdminGive(0, 3, false, false, Pos{}); err != nil {
			t.Fatal(err)
		}
	}
	titans := s.Hand[len(s.Hand)-2:]
	tiles := g.SummonTiles(s)
	for i, c := range append([]*Card{}, titans...) {
		if err := g.Apply(0, Action{Type: ActSummon, CardID: c.ID, X: tiles[i].X, Y: tiles[i].Y}); err != nil {
			t.Fatalf("play %d: %v", i+1, err)
		}
	}
	if g.countOnBoard(0, true) != 7 {
		t.Errorf("%d monsters on the field, want 7", g.countOnBoard(0, true))
	}
	if s.Stars != g.Cfg.MaxStars || s.PlaysLeft < 1 {
		t.Errorf("not topped up: %d stars, %d plays", s.Stars, s.PlaysLeft)
	}
	v := g.ViewSandbox(0)
	if v.Reveal == nil || len(v.Reveal.Hands) != 2 {
		t.Error("the sandbox view does not show every hand")
	}
}

func TestSandboxFusionHints(t *testing.T) {
	g := duel(t, 1, 2)
	drake := put(g, 2, 0, 0, -2, false)
	put(g, 2, 1, 0, 2, false) // the opponent's: never a hint
	hints := g.ViewSandbox(0).FusionHints
	pairs, onto := 0, 0
	for _, h := range hints {
		if h.Result != 9 {
			t.Fatalf("hint %+v: want Grunt + Drake = card 9", h)
		}
		if h.OnField {
			onto++
			if h.X != drake.Pos.X || h.Y != drake.Pos.Y {
				t.Fatalf("hint %+v is not onto our Drake", h)
			}
		} else {
			pairs++
		}
	}
	// The hand is Grunt, Drake, Grunt, Drake, Grunt: 3 × 2 pairs, and 3 Grunts onto the Drake.
	if pairs != 6 || onto != 3 {
		t.Fatalf("%d pairs and %d onto the field, want 6 and 3", pairs, onto)
	}
	if g.view(0, false).FusionHints != nil {
		t.Fatal("a player's own view has fusion hints")
	}
}

func TestAdminSetTerrain(t *testing.T) {
	g := duel(t)
	tiles := map[Pos]string{}
	for x := -3; x <= 3; x++ {
		for y := -3; y <= 3; y++ {
			tiles[Pos{x, y}] = TerrainForest
		}
	}
	if err := g.AdminSetTerrain(0, map[Pos]string{{0, 0}: TerrainForest}); err == nil {
		t.Fatal("a map that does not cover the board was laid")
	}
	if err := g.AdminSetTerrain(0, tiles); err != nil {
		t.Fatal(err)
	}
	if g.Tiles[Pos{2, 2}] != TerrainForest {
		t.Fatal("the terrain did not change")
	}
}
