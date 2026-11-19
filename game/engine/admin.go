package engine

// Test tools for administrators. They break the rules on purpose, so a card's
// effect can be tried without waiting to draw it. Nothing here is reachable
// by an ordinary player: the room only calls these for an administrator, and
// they are not actions, so a bot never sees them among its legal moves.

// AdminGive puts a new copy of a card in a seat's hand, or onto the field at
// p. A card on the field arrives ready to act, as if it had been summoned
// there: face down, so flipping it is how a spell or trap is set off, unless
// faceUp asks for it already revealed (its flip effect is then skipped).
func (g *Game) AdminGive(seat, num int, onField, faceUp bool, p Pos) error {
	if g.Phase != PhasePlaying {
		return RuleError("The duel is over")
	}
	s := g.seat(seat)
	if s == nil || !s.Alive {
		return RuleError("You are not in this duel")
	}
	def := g.Cat.Card(num)
	if def == nil {
		return RuleError("There is no such card")
	}
	if onField {
		switch {
		case !g.InBounds(p):
			return RuleError("That square is off the board")
		case g.Board[p] != nil:
			return RuleError("That square is taken")
		case g.leaderAt(p) != nil:
			return RuleError("A deck leader stands there")
		}
	}

	c := g.newCard(num, seat)
	g.emit(Event{Type: "adminTool", Seat: seat, Text: "used the test tools to get a card"})
	if !onField {
		s.Hand = append(s.Hand, c)
		g.emit(Event{Type: "draw", Seat: seat, CardID: c.ID, X: s.Leader.X, Y: s.Leader.Y})
		return nil
	}
	c.FaceDown = !faceUp
	g.place(c, p)
	e := Event{Type: "summon", Seat: seat, CardID: c.ID, X: p.X, Y: p.Y}
	if faceUp {
		e.Num = cardNum(num)
	}
	g.emit(e)
	return nil
}

// AdminSetLP sets a seat's life points. Zero or less knocks it out, as a
// battle would.
func (g *Game) AdminSetLP(seat, lp int) error {
	if g.Phase != PhasePlaying {
		return RuleError("The duel is over")
	}
	s := g.seat(seat)
	if s == nil || !s.Alive {
		return RuleError("That duelist is not in this duel")
	}
	if lp > 999999 {
		return RuleError("That is too many life points")
	}
	s.LP = lp
	g.emit(Event{Type: "adminTool", Seat: seat, Text: "used the test tools to set their life points"})
	g.settle()
	return nil
}

// AdminRemove takes a card off the field and puts it in its owner's
// graveyard, destroyed by nobody: no destroy credit, no battle.
func (g *Game) AdminRemove(seat, id int) error {
	if g.Phase != PhasePlaying {
		return RuleError("The duel is over")
	}
	c := g.Cards[id]
	if c == nil || !c.OnBoard {
		return RuleError("That card is not on the field")
	}
	g.emit(Event{Type: "adminTool", Seat: seat, Text: "used the test tools to remove a card"})
	g.bury(c, "removed", noOne)
	g.settle()
	return nil
}

// ViewSandbox is the administrators' sandbox view: the seat they are playing
// with nothing hidden, every hand and deck included. Like ViewAll, it must
// never reach anyone but the administrator who owns the sandbox.
func (g *Game) ViewSandbox(seat int) View {
	v := g.view(seat, true)
	v.Reveal = g.ViewAll().Reveal
	if s := g.seat(seat); s != nil {
		v.FusionHints = g.fusionHints(s)
	}
	return v
}

// AdminRefresh gives a seat everything back for its turn: full summoning
// power, a card to play, and every card of its ready to act again.
func (g *Game) AdminRefresh(seat int) error {
	if g.Phase != PhasePlaying {
		return RuleError("The duel is over")
	}
	s := g.seat(seat)
	if s == nil || !s.Alive {
		return RuleError("You are not in this duel")
	}
	g.emit(Event{Type: "adminTool", Seat: seat, Text: "used the test tools to refresh their turn"})
	s.Stars = g.Cfg.MaxStars
	s.PlaysLeft = 1
	s.LeaderActed = false
	for _, c := range g.Board {
		if c.Owner == seat {
			c.Acted = false
		}
	}
	return nil
}

// AdminSetDeck reorders what is left of a seat's deck, top card first. The
// new order must hold exactly the cards the deck holds now.
func (g *Game) AdminSetDeck(seat int, deck []int) error {
	if g.Phase != PhasePlaying {
		return RuleError("The duel is over")
	}
	s := g.seat(seat)
	if s == nil || !s.Alive {
		return RuleError("You are not in this duel")
	}
	if len(deck) != len(s.Deck) {
		return RuleError("The deck has changed: try again")
	}
	count := map[int]int{}
	for _, num := range s.Deck {
		count[num]++
	}
	for _, num := range deck {
		if count[num]--; count[num] < 0 {
			return RuleError("The deck has changed: try again")
		}
	}
	s.Deck = append([]int{}, deck...)
	g.emit(Event{Type: "adminTool", Seat: seat, Text: "used the test tools to rearrange their deck"})
	return nil
}

// SetUnlimited turns the sandbox's free play on or off (see Game.Unlimited).
func (g *Game) SetUnlimited(on bool) {
	g.Unlimited = on
	g.topUp()
}

// DeckOf is what is left of a seat's deck, top card first.
func (g *Game) DeckOf(seat int) []int {
	if s := g.seat(seat); s != nil {
		return append([]int{}, s.Deck...)
	}
	return nil
}

// AdminSetTerrain lays a new map's terrain under the duel as it stands. The
// map must cover this board exactly; the cards and leaders stay where they are.
func (g *Game) AdminSetTerrain(seat int, tiles map[Pos]string) error {
	if g.Phase != PhasePlaying {
		return RuleError("The duel is over")
	}
	if len(tiles) != g.Cfg.Size*g.Cfg.Size {
		return RuleError("That map does not fit this board")
	}
	for p := range tiles {
		if !g.InBounds(p) {
			return RuleError("That map does not fit this board")
		}
	}
	g.Tiles = make(map[Pos]string, len(tiles))
	for p, t := range tiles {
		g.Tiles[p] = t
	}
	g.emit(Event{Type: "adminTool", Seat: seat, Text: "used the test tools to change the map"})
	return nil
}

// FusionHint is a fusion recipe within reach of a seat's hand, for the
// sandbox: hand card A with hand card B, or A played onto the seat's monster
// on the field at (X, Y) when OnField.
type FusionHint struct {
	A       int  `json:"a"`
	B       int  `json:"b"`
	OnField bool `json:"onField,omitempty"`
	X       int  `json:"x"`
	Y       int  `json:"y"`
	Result  int  `json:"result"`
}

// fusionHints lists the real fusions (a recipe, not one monster knocking out
// another) a seat's hand can make, among its own cards or onto its monsters.
func (g *Game) fusionHints(s *Seat) []FusionHint {
	out := []FusionHint{}
	for i, a := range s.Hand {
		for _, b := range s.Hand[i+1:] {
			if f := g.Cat.Fuse(a.Def, b.Def); f != nil {
				out = append(out, FusionHint{A: a.ID, B: b.ID, Result: f.Num})
			}
		}
	}
	for _, c := range g.boardCards() {
		if c.Owner != s.Index || c.Borrowed || !c.Def.IsMonster() {
			continue
		}
		for _, a := range s.Hand {
			if f := g.Cat.Fuse(c.Def, a.Def); f != nil {
				out = append(out, FusionHint{A: a.ID, OnField: true, X: c.Pos.X, Y: c.Pos.Y, Result: f.Num})
			}
		}
	}
	return out
}
