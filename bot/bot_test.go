package bot

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"duelistRoses/game/engine"
)

// realCatalog loads the card data in content/data, when this
// checkout has it.
type realCatalog struct {
	cards map[int]*engine.CardDef
}

func (c realCatalog) Card(num int) *engine.CardDef              { return c.cards[num] }
func (c realCatalog) Fuse(a, b *engine.CardDef) *engine.CardDef { return nil }

func loadReal(t *testing.T) (realCatalog, [][]int) {
	t.Helper()
	read := func(name string, out any) {
		data, err := os.ReadFile("../content/data/" + name)
		if err != nil {
			t.Skipf("content data not present: %v", err)
		}
		if err := json.Unmarshal(data, out); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	var cards []*engine.CardDef
	var decks []struct{ Cards []int }
	read("cards.json", &cards)
	read("starter-decks.json", &decks)

	catalog := realCatalog{cards: map[int]*engine.CardDef{}}
	for _, card := range cards {
		catalog.cards[card.Num] = card
	}
	var lists [][]int
	for _, deck := range decks {
		lists = append(lists, deck.Cards)
	}
	return catalog, lists
}

// TestBotsFinishGamesWithRealCards plays the rule-based bot against itself
// with every starter deck. Each game must end, every action the bot picks must
// be accepted, and somebody should usually win rather than time out.
func TestBotsFinishGamesWithRealCards(t *testing.T) {
	catalog, decks := loadReal(t)
	decided := 0
	styles := append([]Style{Balanced}, Styles...)

	for i := range decks {
		player := Heuristic{Style: styles[i%len(styles)]}
		for _, seats := range []int{2, 4} {
			var setups []engine.SeatSetup
			for s := 0; s < seats; s++ {
				setups = append(setups, engine.SeatSetup{Team: s % 2, Deck: decks[(i+s)%len(decks)]})
			}
			size := 7 + (seats - 2)
			g := engine.New(engine.DefaultConfig(size), catalog, nil, setups, int64(i*10+seats))

			for step := 0; g.Phase == engine.PhasePlaying; step++ {
				if step > 50000 {
					t.Fatalf("deck %d, %d seats: the game did not finish", i, seats)
				}
				actor := g.Turn
				if g.Pending != nil {
					actor = g.Pending.Seat
				}
				legal := g.LegalActions(actor)
				obs := Observation{Seat: actor, View: g.ViewFor(actor), Legal: legal, Card: catalog.Card}
				choice := player.Choose(context.Background(), obs)
				if choice.Index < 0 || choice.Index >= len(legal) {
					t.Fatalf("bot chose %d of %d actions", choice.Index, len(legal))
				}
				if err := g.Apply(actor, legal[choice.Index]); err != nil {
					t.Fatalf("deck %d: bot action %+v rejected: %v", i, legal[choice.Index], err)
				}
				// What the LLM would be shown must always render.
				if step%50 == 0 && Describe(obs) == "" {
					t.Fatal("empty description")
				}
			}
			if g.WinnerTeam >= 0 {
				decided++
			}
			t.Logf("deck %d, %d seats: team %d won after %d turns", i, seats, g.WinnerTeam, g.TurnCount)
		}
	}
	if decided < len(decks) {
		t.Fatalf("only %d of %d games had a winner: the bot is not finishing games", decided, 2*len(decks))
	}
}

// TestBotsBreakStandoffs plays every pairing of bot styles across the starter
// decks, one on one. Left alone, cautious bots can stall, ending their turns
// until the round limit decides the duel on points; once nothing has been
// fought for a few rounds they must take risks, so no duel runs the clock out.
func TestBotsBreakStandoffs(t *testing.T) {
	catalog, decks := loadReal(t)
	styles := append([]Style{Balanced}, Styles...)
	for seed := 0; seed < 2; seed++ {
		for i := range decks {
			for a := range styles {
				for c := range styles {
					setups := []engine.SeatSetup{{Team: 0, Deck: decks[i]}, {Team: 1, Deck: decks[(i+1+seed)%len(decks)]}}
					g := engine.New(engine.DefaultConfig(7), catalog, nil, setups, int64(seed*1000+i*10+a*3+c))
					players := []Heuristic{{Style: styles[a]}, {Style: styles[c]}}
					for step := 0; g.Phase == engine.PhasePlaying; step++ {
						if step > 50000 {
							t.Fatal("the game did not finish")
						}
						actor := g.Turn
						if g.Pending != nil {
							actor = g.Pending.Seat
						}
						legal := g.LegalActions(actor)
						choice := players[actor].Choose(context.Background(), Observation{Seat: actor, View: g.ViewFor(actor), Legal: legal, Card: catalog.Card})
						if err := g.Apply(actor, legal[choice.Index]); err != nil {
							t.Fatalf("bot action %+v rejected: %v", legal[choice.Index], err)
						}
					}
					if g.Round > g.Cfg.MaxRounds {
						t.Errorf("deck %d, %s vs %s (seed %d): stalled until the round limit", i, players[0].Name(), players[1].Name(), seed)
					}
				}
			}
		}
	}
}
