package content

import (
	"math/rand"
	"testing"

	"duelistRoses/game/engine"
)

// TestEveryEffectInRandomDuels plays random duels with decks made of the
// real catalog's cards that do something (spells, traps, rituals and
// monsters with abilities), so every effect runs against real card data
// and the rules stay consistent whatever the effects do to the field.
func TestEveryEffectInRandomDuels(t *testing.T) {
	catalog, _, err := embeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	var effects, plain []int
	for num := 0; num < 1000; num++ {
		def := catalog.Card(num)
		switch {
		case def == nil:
		case def.Effect != nil || len(def.Abilities) > 0:
			effects = append(effects, num)
		case def.IsMonster() && def.Level <= 4:
			plain = append(plain, num)
		}
	}
	if len(effects) < 250 {
		t.Fatalf("only %d cards with effects", len(effects))
	}

	seeds := int64(120)
	if testing.Short() {
		seeds = 20
	}
	for seed := int64(1); seed <= seeds; seed++ {
		rng := rand.New(rand.NewSource(seed))
		players := 2
		if seed%4 == 0 {
			players = 4
		}
		tiles := map[engine.Pos]string{}
		for x := -3; x <= 3; x++ {
			for y := -3; y <= 3; y++ {
				tiles[engine.Pos{X: x, Y: y}] = engine.AllTerrains[rng.Intn(len(engine.AllTerrains))]
			}
		}
		var seats []engine.SeatSetup
		for i := 0; i < players; i++ {
			deck := make([]int, 40)
			for j := range deck {
				if j%3 == 0 {
					deck[j] = plain[rng.Intn(len(plain))]
				} else {
					deck[j] = effects[rng.Intn(len(effects))]
				}
			}
			seats = append(seats, engine.SeatSetup{Team: i % 2, Deck: deck, Leader: effects[rng.Intn(len(effects))]})
		}
		cfg := engine.DefaultConfig(7)
		cfg.DestinyPool = DestinyPool // as live games have it
		g := engine.New(cfg, catalog, tiles, seats, seed)

		for step := 0; g.Phase == engine.PhasePlaying; step++ {
			if step > 30000 {
				t.Fatalf("seed %d: the game did not finish", seed)
			}
			actor := g.Turn
			if g.Pending != nil {
				actor = g.Pending.Seat
			}
			legal := g.LegalActions(actor)
			if len(legal) == 0 {
				t.Fatalf("seed %d step %d: seat %d has nothing it can do", seed, step, actor)
			}
			a := legal[rng.Intn(len(legal))]
			if a.Type == engine.ActEndTurn && len(legal) > 1 && rng.Intn(4) != 0 {
				a = legal[rng.Intn(len(legal)-1)]
			}
			if err := g.Apply(actor, a); err != nil {
				t.Fatalf("seed %d step %d: legal action %+v rejected: %v", seed, step, a, err)
			}
			g.TakeEvents()
			for p, c := range g.Board {
				if c.Pos != p || !c.OnBoard || g.Cards[c.ID] != c {
					t.Fatalf("seed %d step %d: board and card disagree at %v (%s)", seed, step, p, c.Def.Name)
				}
				if g.Phase == engine.PhasePlaying && !g.Seats[c.Owner].Alive {
					t.Fatalf("seed %d step %d: %s belongs to an eliminated seat", seed, step, c.Def.Name)
				}
			}
			for _, s := range g.Seats {
				if s.Alive && g.Phase == engine.PhasePlaying && (s.LP <= 0 || s.Stars < 0 || s.Stars > g.Cfg.MaxStars) {
					t.Fatalf("seed %d step %d: seat %d has %d LP and %d stars", seed, step, s.Index, s.LP, s.Stars)
				}
				if s.Alive && g.Board[s.Leader] != nil {
					t.Fatalf("seed %d step %d: a card stands on leader %d", seed, step, s.Index)
				}
			}
			if p := g.Pending; p != nil && len(p.Options) == 0 {
				t.Fatalf("seed %d step %d: a choice with no options", seed, step)
			}
			for v := -1; v < players; v++ {
				g.ViewFor(v)
			}
		}
	}
}
