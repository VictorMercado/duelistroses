package engine

import (
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
)

// Absorb (Relinquished): once per turn its controller may take an enemy
// monster from one of the eight squares around it. The monster leaves the
// field and Relinquished fights with its ATK and DEF. If Relinquished would
// be destroyed in battle, the absorbed monster is destroyed instead and
// Relinquished goes back to its own stats, free to absorb again.
//
// The offer is made between actions (settle), so it comes up whenever it
// applies: when Relinquished is summoned or flipped, after it moves, at the
// start of its controller's turn, or when an enemy walks up to it.

// baseStats are the ATK and DEF a monster fights with before anything is
// added: its printed ones, or those of the monster it absorbed.
func (c *Card) baseStats() (atk, def int) {
	if c.Absorbed != nil {
		return c.AbsorbAtk, c.AbsorbDef
	}
	return c.Def.Atk, c.Def.Def
}

// absorbable lists the enemy monsters around c it may absorb, strongest first.
func (g *Game) absorbable(c *Card) []*Card {
	out := g.monsters(func(m *Card) bool {
		return m != c && m.Pos.Ring(c.Pos) == 1 && !g.sameTeam(m.Owner, c.Owner) &&
			!m.Def.IsGod() && !g.warded(m, c.Owner)
	})
	sort.SliceStable(out, func(i, j int) bool {
		if a, b := g.here(out[i]), g.here(out[j]); a != b {
			return a > b
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// offerAbsorb asks the player whose turn it is whether a monster of theirs
// with "absorb" takes one of the enemies around it. A player who declines is
// not asked again this turn unless different enemies come within reach.
func (g *Game) offerAbsorb() {
	if g.Phase != PhasePlaying || g.Pending != nil {
		return
	}
	for _, c := range g.boardCards() {
		if c.Owner != g.Turn || c.FaceDown || c.Absorbed != nil || c.AbsorbTurn == g.TurnCount ||
			g.ability(c, "absorb") == nil || g.bound(c) {
			continue
		}
		targets := g.absorbable(c)
		if len(targets) == 0 {
			continue
		}
		ids := make([]string, len(targets))
		for i, m := range targets {
			ids[i] = strconv.Itoa(m.ID)
		}
		offer := fmt.Sprintf("%d:%s", g.TurnCount, strings.Join(ids, ","))
		if c.AbsorbDeclined == offer {
			continue
		}
		c.AbsorbDeclined = offer
		options := make([]Choice, 0, len(targets)+1)
		for _, m := range targets {
			label, num := "Face-down monster", (*int)(nil)
			if !m.FaceDown {
				label, num = fmt.Sprintf("%s (ATK %d)", m.Def.Name, g.here(m)), cardNum(m.Def.Num)
			}
			options = append(options, Choice{Label: fmt.Sprintf("%s at (%d, %d)", label, m.Pos.X, m.Pos.Y), Num: num, cardID: m.ID})
		}
		options = append(options, Choice{Label: "Don't absorb", index: -1})
		g.Pending = &Pending{Seat: c.Owner, Kind: "absorb", Prompt: c.Def.Name + ": choose an enemy monster to absorb", Options: options, source: c}
		return
	}
}

// absorb takes target into c: it leaves the field and c takes its strength.
func (g *Game) absorb(c, target *Card) {
	if !c.OnBoard || !target.OnBoard || target.Pos.Ring(c.Pos) != 1 || g.sameTeam(target.Owner, c.Owner) ||
		!slices.Contains(g.absorbable(c), target) {
		return // the field changed while the player was choosing
	}
	c.AbsorbTurn = g.TurnCount
	target.FaceDown = false
	c.AbsorbAtk, c.AbsorbDef = floor0(target.Def.Atk+target.AtkMod), floor0(target.Def.Def+target.DefMod)
	delete(g.Board, target.Pos)
	delete(g.Cards, target.ID)
	target.OnBoard = false
	c.Absorbed = target
	g.emit(Event{Type: "destroyed", Seat: target.Owner, CardID: target.ID, Num: cardNum(target.Def.Num), X: target.Pos.X, Y: target.Pos.Y, Text: "absorbed"})
	g.announce(c, c.AbsorbAtk)
}

// shieldWith destroys the monster c absorbed in its place, when c loses a
// battle to winner. It reports whether c was saved.
func (g *Game) shieldWith(c, winner *Card) bool {
	held := c.Absorbed
	if held == nil {
		return false
	}
	g.dropAbsorbed(c, winner.Owner)
	// "shield": the absorbed monster, off the field, fell in c's place.
	g.emit(Event{Type: "destroyed", Seat: held.Home, CardID: held.ID, Num: cardNum(held.Def.Num), X: c.Pos.X, Y: c.Pos.Y, Text: "shield"})
	return true
}

// dropAbsorbed sends the monster c absorbed to its owner's graveyard, when it
// is destroyed in c's place or c leaves the field; by is who destroyed it.
func (g *Game) dropAbsorbed(c *Card, by int) {
	held := c.Absorbed
	if held == nil {
		return
	}
	c.Absorbed, c.AbsorbAtk, c.AbsorbDef = nil, 0, 0
	g.creditDestroy(held, by)
	if home := g.seat(held.Home); home != nil {
		home.Graveyard = append(home.Graveyard, held.Def.Num)
	}
}
