package bot

import (
	"context"
	"testing"

	"duelistRoses/game/engine"
)

// cornered builds a 5x5 board where our weak monster (id 1) stands at (0,0)
// next to a stronger enemy (id 2) at (1,0). moves are the squares id 1 may
// step to this turn.
func cornered(moves ...engine.Pos) Observation {
	cards := map[int]*engine.CardDef{
		10: {Num: 10, Kind: engine.KindMonster, Atk: 800, Def: 2000},
		20: {Num: 20, Kind: engine.KindMonster, Atk: 1800, Def: 1000},
	}
	tiles := make([]string, 25)
	for i := range tiles {
		tiles[i] = engine.TerrainNormal
	}
	legal := []engine.Action{}
	for _, p := range moves {
		legal = append(legal, engine.Action{Type: engine.ActMove, CardID: 1, X: p.X, Y: p.Y})
	}
	legal = append(legal,
		engine.Action{Type: engine.ActPosition, CardID: 1, Defense: true},
		engine.Action{Type: engine.ActEndTurn},
	)
	return Observation{
		Seat: 0,
		View: engine.View{
			Size:  5,
			Tiles: tiles,
			Seats: []engine.SeatView{
				{Index: 0, Team: 0, Alive: true, LeaderX: 0, LeaderY: -2},
				{Index: 1, Team: 1, Alive: true, LeaderX: 0, LeaderY: 2},
			},
			Cards: []engine.CardView{
				{ID: 1, Num: 10, Owner: 0, X: 0, Y: 0, Atk: 800, Def: 2000},
				{ID: 2, Num: 20, Owner: 1, X: 1, Y: 0, Atk: 1800, Def: 1000},
			},
		},
		Legal: legal,
		Card:  func(n int) *engine.CardDef { return cards[n] },
	}
}

func TestBotDefendsWhenCornered(t *testing.T) {
	// Every square it can reach is still next to the enemy.
	o := cornered(engine.Pos{X: 1, Y: 1}, engine.Pos{X: 1, Y: -1})
	got := o.Legal[Heuristic{}.Choose(context.Background(), o).Index]
	if got.Type != engine.ActPosition || !got.Defense {
		t.Fatalf("cornered monster should switch to defense, chose %+v", got)
	}
}

func TestBotFleesInsteadOfDefending(t *testing.T) {
	// (-1,0) is out of the enemy's reach.
	o := cornered(engine.Pos{X: -1, Y: 0}, engine.Pos{X: 1, Y: 1})
	got := o.Legal[Heuristic{}.Choose(context.Background(), o).Index]
	if got.Type != engine.ActMove || got.X != -1 || got.Y != 0 {
		t.Fatalf("monster with a way out should step out of reach, chose %+v", got)
	}
}
