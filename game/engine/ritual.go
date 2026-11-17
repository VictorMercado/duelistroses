package engine

import (
	"fmt"
	"strings"
)

// A ritual card is set on the field like a spell and flipped to perform it.
// It sacrifices monsters its owner controls on the field, one for each of
// its requirements, and summons the ritual monster on the ritual card's
// square. Which monsters go is decided by the engine: the weakest set that
// meets every requirement, so the strongest monsters stay in play.

// Tribute is one monster a ritual needs. Every field that is set must hold:
// an exact card name, a monster type, or a limit on printed ATK or DEF.
type Tribute struct {
	Name   string `json:"name,omitempty"`
	Type   string `json:"type,omitempty"`
	MaxAtk int    `json:"maxAtk,omitempty"`
	MinDef int    `json:"minDef,omitempty"`
}

func (t Tribute) accepts(def *CardDef) bool {
	return def.IsMonster() &&
		(t.Name == "" || strings.EqualFold(def.Name, t.Name)) &&
		(t.Type == "" || def.Type == t.Type) &&
		(t.MaxAtk == 0 || def.Atk <= t.MaxAtk) &&
		(t.MinDef == 0 || def.Def >= t.MinDef)
}

func (t Tribute) String() string {
	if t.Name != "" {
		return t.Name
	}
	var what []string
	if t.Type != "" {
		what = append(what, strings.ToUpper(t.Type))
	}
	what = append(what, "monster")
	switch {
	case t.MaxAtk > 0:
		what = append(what, fmt.Sprintf("with ATK %d or less", t.MaxAtk))
	case t.MinDef > 0:
		what = append(what, fmt.Sprintf("with DEF %d or more", t.MinDef))
	}
	return "a " + strings.Join(what, " ")
}

// ritualTributes picks the monsters a ritual would sacrifice: one distinct
// monster its owner controls for each requirement, choosing the set with the
// lowest total ATK. It returns nil when the requirements cannot be met.
func (g *Game) ritualTributes(ritual *Card) []*Card {
	e := ritual.Def.Effect
	if e == nil || len(e.Tributes) == 0 {
		return nil
	}
	pool := g.monsters(func(m *Card) bool { return m.Owner == ritual.Owner })
	var best []*Card
	bestCost := -1
	pick := make([]*Card, len(e.Tributes))
	used := map[*Card]bool{}
	var try func(i, cost int)
	try = func(i, cost int) {
		if bestCost >= 0 && cost >= bestCost {
			return
		}
		if i == len(e.Tributes) {
			best, bestCost = append([]*Card(nil), pick...), cost
			return
		}
		for _, m := range pool {
			if !used[m] && e.Tributes[i].accepts(m.Def) {
				used[m], pick[i] = true, m
				try(i+1, cost+m.Def.Atk)
				used[m] = false
			}
		}
	}
	try(0, 0)
	return best
}

// ritualNeeds describes what a ritual sacrifices, for the player.
func ritualNeeds(e *Effect) string {
	parts := make([]string, len(e.Tributes))
	for i, t := range e.Tributes {
		parts[i] = t.String()
	}
	return strings.Join(parts, ", ")
}

// canRitual explains why a ritual cannot be performed now, or returns nil.
func (g *Game) canRitual(c *Card) error {
	e := c.Def.Effect
	if e.Summon == nil || g.Cat.Card(*e.Summon) == nil || !g.Cat.Card(*e.Summon).IsMonster() {
		return RuleError("This ritual summons nothing yet")
	}
	if g.ritualTributes(c) == nil {
		return RuleError(fmt.Sprintf("To summon %s, sacrifice from your monsters on the field: %s", g.Cat.Card(*e.Summon).Name, ritualNeeds(e)))
	}
	return nil
}

// performRitual sacrifices the tributes and summons the ritual monster where
// the ritual card stood.
func (g *Game) performRitual(c *Card) {
	tributes := g.ritualTributes(c)
	if tributes == nil {
		return // the field changed since it was checked: the ritual fizzles
	}
	owner := g.Seats[c.Owner]
	at := c.Pos
	for _, m := range tributes {
		g.reveal(m)
		g.bury(m, "sacrificed", noOne)
	}
	g.bury(c, "used", noOne)
	m := g.newCard(*c.Def.Effect.Summon, owner.Index)
	if m == nil {
		return
	}
	m.FaceDown = false
	g.place(m, at)
	owner.Stats.Summons++
	owner.Stats.Rituals++
	g.emit(Event{Type: "summon", Seat: owner.Index, CardID: m.ID, Num: cardNum(m.Def.Num), X: at.X, Y: at.Y, Text: "ritual"})
	g.enterTile(m)
}
