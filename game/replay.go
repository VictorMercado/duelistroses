package game

import (
	"log"
	"time"

	"duelistRoses/game/engine"
	"duelistRoses/replay"
)

// replayFrame is one recorded step of a duel: the board after it, with
// nothing hidden, and what caused it.
type replayFrame struct {
	// At is when it happened, in milliseconds since the duel was dealt.
	At int64 `json:"at"`
	// Seat is who acted, -1 for the deal.
	Seat   int            `json:"seat"`
	Action *engine.Action `json:"action,omitempty"`
	// Tool is an administrator's test tool ("give", "deck"...), if one was used.
	Tool   string         `json:"tool,omitempty"`
	State  engine.View    `json:"state"`
	Events []engine.Event `json:"events,omitempty"`
}

// replayEnd closes a recording: how the duel ended.
type replayEnd struct {
	Finished   bool      `json:"finished"`
	WinnerTeam int       `json:"winnerTeam"`
	Turns      int       `json:"turns"`
	Ended      time.Time `json:"ended"`
}

// startReplay begins recording the duel just dealt. A sandbox is never
// recorded: it is a workbench, not a duel.
func (r *Room) startReplay() {
	r.replay, r.replayID, r.replaySaved = nil, "", false
	if r.hub.Replays == nil || r.opts.Sandbox || r.game == nil {
		return
	}
	r.replayID = replay.NewID()
	r.replay = replay.NewRecorder(r.info)
	r.recordStep(-1, nil, "", nil)
}

// recordStep adds the board as it stands now to the recording.
func (r *Room) recordStep(seat int, a *engine.Action, tool string, events []engine.Event) {
	if r.replay == nil || r.replaySaved || r.game == nil {
		return
	}
	r.replay.Add(replayFrame{
		At: time.Since(r.startedAt).Milliseconds(), Seat: seat, Action: a, Tool: tool,
		State: r.game.ViewAll(), Events: events,
	})
}

// saveReplay files the recording, once: when the duel ends, or when the room
// closes on a duel nobody finished. A duel closed before anyone moved is not
// worth keeping.
func (r *Room) saveReplay() {
	g := r.game
	if r.replay == nil || r.replaySaved || g == nil {
		return
	}
	finished := g.Phase == engine.PhaseFinished
	if !finished && r.replay.Steps() < 2 {
		return
	}
	r.replaySaved = true
	ended := time.Now().UTC()
	winner := g.WinnerTeam
	if !finished {
		winner = -1
	}
	steps := r.replay.Steps()
	frames, err := r.replay.Finish(replayEnd{Finished: finished, WinnerTeam: winner, Turns: g.TurnCount, Ended: ended})
	r.replay = nil
	if err != nil {
		log.Printf("room %s: recording the replay: %v", r.ID, err)
		return
	}
	m := replay.Meta{
		ID: r.replayID, Room: r.ID, Mode: r.opts.Mode, Map: r.info.MapName,
		Started: r.startedAt, Ended: ended, Finished: finished, WinnerTeam: winner,
		Turns: g.TurnCount, Steps: steps, Players: []replay.Player{},
	}
	for _, s := range r.slots {
		p := replay.Player{Name: s.Name, Team: s.Team, Bot: s.Kind == KindBot, Deck: s.DeckName}
		if !s.guest && s.Kind != KindBot {
			p.UserID = s.UserID
		}
		m.Players = append(m.Players, p)
	}
	store := r.hub.Replays
	// Off the room's goroutine: the duel never waits on the disk.
	go func() {
		if err := store.Save(m, frames); err != nil {
			log.Printf("room %s: saving the replay: %v", r.ID, err)
		}
	}()
}
