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
