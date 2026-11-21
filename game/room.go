// Package game runs duels: rooms, seats, connections and bots around the
// rules in game/engine.
package game

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"time"

	"duelistRoses/bot"
	"duelistRoses/content"
	"duelistRoses/game/engine"
	"duelistRoses/metrics"
	"duelistRoses/profile"
	"duelistRoses/replay"
)

const (
	KindHuman = "human"
	KindBot   = "bot"
	// KindPuppet is the sandbox's other seat: nobody sits in it, the
	// administrator who owns the sandbox plays it (see Options.Sandbox).
	KindPuppet = "puppet"

	// A turn a bot spends this many actions on is cut short.
	maxBotActionsPerTurn = 40
	// How long a bot waits before each action, so people can follow the game.
	botPace = 700 * time.Millisecond
	// A disconnected player's seat is played for them after this long.
	absentGrace = 15 * time.Second
	// An empty room is torn down after this long.
	emptyRoomLife = 2 * time.Minute
)

// SeatSpec is how a seat is filled: "human", "bot" (rule based, with a random
// personality unless an administrator names one: "bot:aggressive",
// "bot:builder", "bot:defensive", "bot:balanced") or "bot:llm"
// (optionally "bot:llm:<model>").
type SeatSpec struct {
	Kind    string
	BotKind string
}

type Options struct {
	Mode        string // "1v1" or "2v2"
	Size        int
	Seats       []SeatSpec
	TurnSeconds int
	Map         *content.Map // nil for a generated map

	// Lobby rooms wait for their host to press start, so players can pick
	// seats and teams first. Other rooms start as soon as every seat is full.
	Lobby bool
	// Private rooms are not listed; friends get in by invitation or link.
	Private bool
	// HostID is the user who may configure and start a lobby.
	HostID string
	// HostAdmin: the host is an administrator, who may pick the rule-based
	// bots' personalities. Everyone else's bots get one at random.
	HostAdmin bool
	// Sandbox is an administrator's test table: a private 1v1 with no clock,
	// whose second seat (a puppet) the administrator plays as well, switching
	// sides at will. Cards cost nothing and the field limits are off unless
	// they turn that off, they see everything, and nothing is recorded.
	Sandbox bool
}

// slot is a seat at the table and whoever fills it.
type slot struct {
	Index int
	Team  int
	Kind  string

	UserID   string
	Name     string
	guest    bool
	DeckName string
	deck     []int
	leader   int // the deck leader's card number

	bot    bot.Bot
	client *Client
}

type SeatInfo struct {
	Index     int    `json:"index"`
	Team      int    `json:"team"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	UserID    string `json:"userId,omitempty"`
	DeckName  string `json:"deckName,omitempty"`
	Connected bool   `json:"connected"`
	Open      bool   `json:"open"`
}

type RoomInfo struct {
	ID         string     `json:"id"`
	Mode       string     `json:"mode"`
	Size       int        `json:"size"`
	MapName    string     `json:"mapName"`
	Started    bool       `json:"started"`
	Finished   bool       `json:"finished"`
	Spectators int        `json:"spectators"`
	Seats      []SeatInfo `json:"seats"`
	// Lobby is true while players may still change seats; HostID runs it.
	Lobby   bool   `json:"lobby"`
	Private bool   `json:"private"`
	HostID  string `json:"hostId,omitempty"`
	// SpectatorsMuted is set by the players to silence spectator chat.
	SpectatorsMuted bool `json:"spectatorsMuted"`
	// Pausable: nobody else plays this duel (see Room.pausable), so its one
	// player may stop it. Paused: it is stopped, clock and bots alike.
	Pausable bool `json:"pausable"`
	Paused   bool `json:"paused"`
	// Display: an arena display is showing the board, so the players' phones
	// are controllers (hand, graveyard and buttons) rather than boards.
	Display bool `json:"display"`
	// How the display shows the board, for the phones' d-pads: DisplayTurn
	// quarter turns from the spectators' usual view, and SeatControls when
	// each player's "up" is away from their own edge (a display lying flat on
	// a table, with the players around it) rather than up the screen.
	DisplayTurn  int  `json:"displayTurn"`
	SeatControls bool `json:"seatControls"`
}

// Room owns one duel. Everything that touches its state runs on its own
// goroutine, one closure at a time, taken from inbox: connections, bots and
// timers never touch the game directly, they post work. That is what makes
// "one action at a time" true by construction, with no locks to get wrong.
type Room struct {
	ID   string
	hub  *Hub
	opts Options

	inbox chan task
	done  chan struct{}

	slots   []*slot
	clients map[*Client]bool
	catalog *content.Catalog
	// Decks a computer player added in the lobby can be given.
	botDecks []content.Deck
	hostID   string
	muted    bool // spectators may not chat
	game     *engine.Game
	rng      *rand.Rand

	nextClientID int
	seq          int // counts state messages, so a client can spot a gap
	epoch        int // counts applied actions; stale bot answers and timers are dropped
	// What the turn clock is counting down to, for the client to display.
	deadline time.Time
	timer    *time.Timer
	// The turn clock: when the turn numbered turnClockTurn runs out. It is set
	// once, when the turn begins, so actions taken during it never reset it.
	turnClockTurn  int
	turnClockEnds  time.Time
	idle           *time.Timer
	// A paused duel waits on nothing: no clock, no bot thinking, no moves.
	// pausedClock is what was left on the turn clock when it stopped.
	paused         bool
	pausedClock    time.Duration
	botActions     int
	botActionsTurn int

	// When the current duel was dealt, whether it has been recorded in the
	// players' profiles, and whether an administrator's test tools touched it
	// (such a duel proves nothing, so it is never recorded).
	startedAt time.Time
	recorded  bool
	tested    bool

	// The current duel's recording (see package replay), nil when it is not
	// recorded, and whether it has been saved.
	replay      *replay.Recorder
	replayID    string
	replaySaved bool

	// The sandbox's settings (see Options.Sandbox): whether the controls
	// follow the seat the game waits on, and whether cards are free.
	follow    bool
	unlimited bool
	lastActor int

	// How the arena display is turned (see RoomInfo.DisplayTurn).
	displayTurn  int
	seatControls bool

	info RoomInfo // snapshot for the lobby, refreshed on every change
}

func newRoom(id string, hub *Hub, opts Options, catalog *content.Catalog, botDecks []content.Deck) *Room {
	r := &Room{
		ID: id, hub: hub, opts: opts, catalog: catalog, botDecks: botDecks, hostID: opts.HostID,
		inbox: make(chan task, 256), done: make(chan struct{}),
		clients: map[*Client]bool{}, rng: rand.New(rand.NewSource(time.Now().UnixNano())),
		follow: true, unlimited: true, lastActor: -1,
	}
	for i, spec := range opts.Seats {
		s := &slot{Index: i, Team: i % 2, Kind: KindHuman}
		switch spec.Kind {
		case KindBot:
			r.seatBot(s, r.botKind(spec.BotKind, opts.HostAdmin))
		case KindPuppet:
			r.seatPuppet(s)
		}
		r.slots = append(r.slots, s)
	}
	r.refreshInfo()
	return r
}

// botKind is the kind a requested bot seat really gets: an LLM as asked, or
// a rule-based personality, which only an administrator may choose.
func (r *Room) botKind(requested string, admin bool) string {
	if requested == "llm" || strings.HasPrefix(requested, "llm:") {
		return requested
	}
	return bot.StyleKind(requested, admin, r.rng.Intn)
}

// seatBot puts a computer player in a seat, with a starter deck.
func (r *Room) seatBot(s *slot, kind string) {
	s.Kind, s.UserID, s.client = KindBot, "", nil
	s.bot = r.hub.NewBot(kind)
	s.Name = s.bot.Name()
	// Two of the same model at one table need telling apart.
	taken := map[string]bool{}
	for _, other := range r.slots {
		if other != s {
			taken[other.Name] = true
		}
	}
	for n := 2; taken[s.Name]; n++ {
		s.Name = fmt.Sprintf("%s %d", s.bot.Name(), n)
	}
	if len(r.botDecks) > 0 {
		deck := r.botDecks[r.rng.Intn(len(r.botDecks))]
		s.deck, s.DeckName, s.leader = deck.Cards, deck.Name, deck.LeaderNum
	}
}

// seatPuppet makes a seat the sandbox's other side, with a starter deck.
func (r *Room) seatPuppet(s *slot) {
	s.Kind, s.Name, s.UserID, s.client, s.bot = KindPuppet, "Sandbox opponent", "", nil, nil
	if len(r.botDecks) > 0 {
		deck := r.botDecks[r.rng.Intn(len(r.botDecks))]
		s.deck, s.DeckName, s.leader = deck.Cards, deck.Name, deck.LeaderNum
	}
}

// botsOnly reports whether every seat is a computer player: a duel played
// out for spectators, who may see everything (Watch.All) and the bots' thoughts.
func (r *Room) botsOnly() bool {
	for _, s := range r.slots {
		if s.Kind != KindBot {
			return false
		}
	}
	return true
}

// openSeat empties a seat for a human to take.
func (r *Room) openSeat(s *slot) {
	s.Kind, s.bot, s.client = KindHuman, nil, nil
	s.UserID, s.Name, s.deck, s.DeckName, s.guest, s.leader = "", "", nil, "", false, 0
}

// seatClient sits a connection down with the deck it brought.
func (r *Room) seatClient(s *slot, c *Client) {
	s.UserID, s.Name, s.client, s.guest = c.User.ID, c.User.Name, c, c.User.Guest
	s.deck, s.DeckName, s.leader = c.deck.Cards, c.deck.Name, c.deck.LeaderNum
	c.seat = s.Index
}

func (r *Room) run() {
	r.armIdle()
	for {
		select {
		case t := <-r.inbox:
			start := time.Now()
			metrics.RoomQueueWait.Observe(start.Sub(t.at).Seconds())
			t.f()
			metrics.RoomTask.Observe(time.Since(start).Seconds())
		case <-r.done:
			return
		}
	}
}

// post queues work for the room's goroutine. It is safe from anywhere and
// never blocks forever: a closed room simply drops the work.
func (r *Room) post(f func()) {
	select {
	case r.inbox <- task{f, time.Now()}:
	case <-r.done:
	}
}

// task is work queued for the room, with when it was queued: the wait until
// the room runs it is how the metrics see a room falling behind.
type task struct {
	f  func()
	at time.Time
}

func (r *Room) close() {
	select {
	case <-r.done:
		return
	default:
	}
	close(r.done)
	if r.timer != nil {
		r.timer.Stop()
	}
	r.saveReplay() // a duel nobody finished is still worth watching
	for c := range r.clients {
		r.hub.clearPresence(c.User.ID, r.ID)
		c.close()
	}
	r.hub.remove(r.ID)
}

// Shutdown ends the room for everyone in it: any duel stops where it is and
// every connection is closed with the reason, as final, so nobody reconnects
// into a fresh room of the same name. It returns once the room is gone.
func (r *Room) Shutdown(reason string) {
	r.post(func() {
		for c := range r.clients {
			c.kick(4410, reason) // 410 Gone
		}
		r.close()
	})
	select {
	case <-r.done:
	case <-time.After(2 * time.Second):
	}
}

// Info is the lobby's view of the room; safe to call from any goroutine.
func (r *Room) Info() RoomInfo {
	reply := make(chan RoomInfo, 1)
	r.post(func() { reply <- r.info })
	select {
	case info := <-reply:
		return info
	case <-r.done:
		return RoomInfo{ID: r.ID}
	case <-time.After(time.Second):
		return RoomInfo{ID: r.ID}
	}
}

func (r *Room) refreshInfo() {
	info := RoomInfo{
		ID: r.ID, Mode: r.opts.Mode, Size: r.opts.Size, MapName: "Random", Started: r.game != nil,
		Lobby: r.opts.Lobby && r.game == nil, Private: r.opts.Private, HostID: r.hostID, SpectatorsMuted: r.muted,
	}
	if r.opts.Map != nil {
		info.MapName = r.opts.Map.Name
	}
	info.Finished = r.game != nil && r.game.Phase == engine.PhaseFinished
	info.DisplayTurn, info.SeatControls = r.displayTurn, r.seatControls
	info.Pausable = r.pausable()
	info.Paused = r.paused
	for _, s := range r.slots {
		info.Seats = append(info.Seats, SeatInfo{
			Index: s.Index, Team: s.Team, Kind: s.Kind, Name: s.Name, UserID: s.UserID, DeckName: s.DeckName,
			Connected: s.Kind != KindHuman || s.client != nil,
			Open:      s.Kind == KindHuman && s.UserID == "",
		})
	}
	for c := range r.clients {
		switch {
		case c.watch.Display:
			info.Display = true
		case c.seat < 0:
			info.Spectators++
		}
	}
	r.info = info
}

// --- joining and leaving ---------------------------------------------------

// Join seats a connection: back in the seat its user already holds, else in
// the first open seat, else as a spectator.
func (r *Room) Join(c *Client, deck *content.Deck, watch Watch) {
	r.post(func() {
		if r.opts.Sandbox && !c.User.Admin {
			c.kick(4403, "That is an administrator's sandbox")
			return
		}
		spectate := watch.Set
		if watch.Display && !r.mayDisplay(c.User.ID) {
			c.kick(4403, "Only the host or a player in this room can make this screen its arena display")
			return
		}
		c.seat = -1
		c.deck = deck
		r.nextClientID++
		c.id = r.nextClientID
		var mine *slot
		for _, s := range r.slots {
			// The display is a second screen of a player's, never their seat.
			if s.Kind == KindHuman && s.UserID == c.User.ID && !watch.Display {
				mine = s
			}
		}
		if mine == nil && !spectate && r.game == nil && deck != nil {
			for _, s := range r.slots {
				if s.Kind == KindHuman && s.UserID == "" {
					mine = s
					r.seatClient(s, c)
					break
				}
			}
		}
		if mine != nil {
			if old := mine.client; old != nil && old != c {
				// The same user connected again: the newer connection wins. The
				// older one is told why and not to reconnect, or two screens of
				// one player (a phone and the arena display's PC, say) would keep
				// taking the seat back from each other.
				delete(r.clients, old)
				old.kick(4409, "You joined this room from another screen")
			}
			mine.client = c
			mine.Name = c.User.Name
			c.seat = mine.Index
			// Coming back before the duel starts may bring a different deck.
			if r.game == nil && deck != nil {
				mine.deck, mine.DeckName, mine.leader = deck.Cards, deck.Name, deck.LeaderNum
			}
		}
		if mine == nil && spectate {
			// Watching goes through a player: no player, nothing to watch.
			c.watch = watch
			if !watch.Display && !watch.Admin && !(watch.All && r.botsOnly()) && r.watchedSeat(c) < 0 {
				c.send(r.encode(Outgoing{T: "error", Message: "That duelist is not playing in this room"}))
				c.close()
				return
			}
		}
		r.clients[c] = true
		r.hub.setPresence(c.User.ID, r.ID)
		if r.hostID == "" && mine != nil {
			r.hostID = c.User.ID
		}
		if r.idle != nil {
			r.idle.Stop()
		}

		r.refreshInfo()
		r.welcome(c)
		r.broadcastRoom()

		if r.game == nil {
			r.maybeStart()
		} else {
			if r.opts.Sandbox {
				// Back in the seat they hold: hand them the one the game waits on.
				r.lastActor = -1
				r.followActor()
			}
			c.send(r.stateFor(r.viewKey(c), nil, 0))
			r.schedule() // a returning player takes their seat back from the stand-in
		}
	})
}

func (r *Room) leave(c *Client) {
	r.post(func() {
		if !r.clients[c] {
			return
		}
		delete(r.clients, c)
		r.broadcast(Outgoing{T: "cursor", Cid: c.id, Gone: true})
		for _, s := range r.slots {
			// Before the game starts a seat is not a commitment.
			if s.client == c {
				s.client = nil
				if r.game == nil {
					r.openSeat(s)
				}
			}
		}

		stillHere := false
		for other := range r.clients {
			stillHere = stillHere || other.User.ID == c.User.ID
		}
		if !stillHere {
			r.hub.clearPresence(c.User.ID, r.ID)
			// A lobby whose host walked out passes to whoever is still seated.
			if r.game == nil && r.hostID == c.User.ID {
				r.hostID = ""
				for _, s := range r.slots {
					if s.Kind == KindHuman && s.client != nil {
						r.hostID = s.UserID
						break
					}
				}
			}
		}

		r.refreshInfo()
		r.broadcastRoom()
		if r.game != nil {
			r.schedule()
		}
		r.armIdle()
	})
}

// --- spectators and cursors ------------------------------------------------

// watchedSeat is the seat a spectator sees the duel through, or -1.
func (r *Room) watchedSeat(c *Client) int {
	if c.seat >= 0 || !c.watch.Set || c.watch.Admin || c.watch.All {
		return -1
	}
	if c.watch.User == "" {
		if c.watch.Seat >= 0 && c.watch.Seat < len(r.slots) {
			return c.watch.Seat
		}
		return -1
	}
	for _, s := range r.slots {
		if s.Kind == KindHuman && s.UserID == c.watch.User {
			return s.Index
		}
	}
	return -1
}

// rewatch moves a spectator to watching through another seat (its team, for
// one watching a team), as if they had joined that way, without dropping the
// connection. Players watch from their own seat, and a view that already shows
// everything (an administrator's, a duel between bots) has nothing to switch:
// the client turns the board round for those by itself.
func (r *Room) rewatch(c *Client, seat int) {
	if c.seat >= 0 || !c.watch.Set || c.watch.Display || c.watch.Admin || c.watch.All {
		r.refuse(c, "Only spectators can change whose side they watch from")
		return
	}
	if seat < 0 || seat >= len(r.slots) {
		r.refuse(c, "There is no such seat")
		return
	}
	c.watch = Watch{Set: true, Seat: seat, TeamOnly: c.watch.TeamOnly}
	r.welcome(c)
	if r.game != nil {
		c.send(r.stateFor(r.viewKey(c), nil, 0))
	}
	// Spectator chat and voice go by side: they now reach the other one.
	r.sendVoiceRosters()
}

func (r *Room) welcome(c *Client) {
	you := &Identity{UserID: c.User.ID, Name: c.User.Name, Seat: c.seat, Watch: r.watchedSeat(c), Admin: c.seat < 0 && (c.watch.Admin || c.watch.All), Tools: c.seat >= 0 && c.User.Admin, Display: c.watch.Display}
	if r.opts.Sandbox && c.seat >= 0 {
		you.Sandbox = &SandboxInfo{Follow: r.follow, Unlimited: r.unlimited}
	}
	c.send(r.encode(Outgoing{T: "welcome", You: you, Room: &r.info}))
}

// View keys above the seat numbers: watching through a seat (with its hand),
// watching a team (no hand), and the administrator's view of everything.
const (
	spectatorView = 100
	teamView      = 200
	adminView     = 1000
	// An administrator in a seat sees that seat's view plus its deck.
	testerView = 2000
	// The administrator in a sandbox plays a seat and sees everything.
	sandboxView = 3000
)

// viewKey says which projection of the game a connection gets: its own seat,
// the seat it is watching through, or -1 for someone with neither, who sees
// only what is face up.
func (r *Room) viewKey(c *Client) int {
	if c.seat >= 0 {
		if r.opts.Sandbox && c.User.Admin {
			return sandboxView + c.seat
		}
		if c.User.Admin {
			return testerView + c.seat
		}
		return c.seat
	}
	if c.watch.Admin || (c.watch.All && r.botsOnly()) {
		return adminView
	}
	if w := r.watchedSeat(c); w >= 0 {
		if c.watch.TeamOnly {
			return teamView + w
		}
		return spectatorView + w
	}
	return -1
}

// side is the team a connection belongs to or is watching, -1 for neither.
func (r *Room) side(c *Client) int {
	seat := c.seat
	if seat < 0 && c.watch.Admin {
		return -2 // administrators are a side of their own
	}
	if seat < 0 {
		seat = r.watchedSeat(c)
	}
	if seat < 0 || seat >= len(r.slots) {
		return -1
	}
	return r.slots[seat].Team
}

// reaches reports whether something a spectator does (point, speak) is shown
// to another connection. A spectator who sees one team's hidden cards is only
// ever shown to that same side, so they cannot tip off the other team; one
// who sees nothing hidden is shown to everyone.
func (r *Room) reaches(from, to *Client) bool {
	side := r.side(from)
	return side == -1 || side == r.side(to)
}

// chat relays a line of text to the room. Players speak to everyone.
func (r *Room) chat(c *Client, text string) {
	text = strings.TrimSpace(text)
	if !r.clients[c] || text == "" || time.Since(c.lastChat) < 400*time.Millisecond {
		return
	}
	if len(text) > 300 {
		text = text[:300]
	}
	spectator := c.seat < 0
	if spectator && r.muted {
		r.refuse(c, "The players have muted spectators")
		return
	}
	c.lastChat = time.Now()
	b := r.encode(Outgoing{T: "chat", Cid: c.id, Name: c.User.Name, Seat: c.seat, Spectator: spectator, Message: text})
	for other := range r.clients {
		// Administrators hear everything, so they can moderate.
		if !spectator || other == c || r.reaches(c, other) || (other.seat < 0 && other.watch.Admin) {
			other.send(b)
		}
	}
}

// muteSpectators lets any seated player silence (or allow) spectator chat.
func (r *Room) muteSpectators(c *Client, on bool) {
	if c.seat < 0 {
		r.refuse(c, "Only players can mute spectators")
		return
	}
	r.muted = on
	r.refreshInfo()
	r.broadcastRoom()
}

// cursor relays where a connection is pointing. It never touches the game.
// A player's cursor goes to the whole room. A spectator's goes only to their
// own side - the team they watch and its other spectators - so the opposing
// team is never shown, or signalled by, someone who can see hidden cards.
func (r *Room) cursor(c *Client, x, y int) {
	now := time.Now()
	half := r.opts.Size / 2
	if !r.clients[c] || c.watch.Display || now.Sub(c.lastCursor) < 30*time.Millisecond || x < -half || x > half || y < -half || y > half {
		return
	}
	c.lastCursor = now

	spectator := c.seat < 0
	seat := c.seat
	if spectator {
		seat = r.watchedSeat(c)
	}
	b := r.encode(Outgoing{T: "cursor", Cid: c.id, Name: c.User.Name, Seat: seat, X: x, Y: y, Spectator: spectator})
	for other := range r.clients {
		if other != c && (!spectator || r.reaches(c, other)) {
			other.send(b)
		}
	}
}

// --- the arena display -----------------------------------------------------

// mayDisplay reports whether a user may make a screen the room's arena
// display: its host, or someone holding a seat. Anyone else could turn every
// player's phone into a controller for a board they cannot see.
func (r *Room) mayDisplay(userID string) bool {
	if userID == "" {
		return false
	}
	if userID == r.hostID {
		return true
	}
	for _, s := range r.slots {
		if s.Kind == KindHuman && s.UserID == userID {
			return true
		}
	}
	return false
}

// becomeDisplay turns a player's own connection into the room's arena
// display, in place: their seat waits for them to open the room on their
// phone (before the duel it is simply given up, as standing up would). Doing
// it on the open connection, rather than by reconnecting, means the seat that
// entitles them to it is still theirs when it is checked.
func (r *Room) becomeDisplay(c *Client) {
	if !r.clients[c] || c.watch.Display {
		return
	}
	if !r.mayDisplay(c.User.ID) {
		r.refuse(c, "Only the host or a player in this room can make this screen its arena display")
		return
	}
	if c.seat >= 0 {
		s := r.slots[c.seat]
		if s.client == c {
			s.client = nil
			if r.game == nil {
				r.openSeat(s)
			}
		}
		r.broadcast(Outgoing{T: "cursor", Cid: c.id, Gone: true})
	}
	c.seat = -1
	c.deck = nil
	c.watch = Watch{Set: true, Seat: -1, Display: true}
	r.refreshInfo()
	r.welcome(c)
	r.broadcastRoom()
	if r.game != nil {
		c.send(r.stateFor(r.viewKey(c), nil, 0))
		r.schedule() // the seat it left is played for its player if they take too long
	}
}

// orient records how the arena display has turned the board, so the phones'
// d-pads move the cursor the way it looks on the display (see
// RoomInfo.DisplayTurn). Only a display says so.
func (r *Room) orient(c *Client, turn int, seatControls bool) {
	if !r.clients[c] || !c.watch.Display {
		return
	}
	turn = ((turn % 4) + 4) % 4
	if turn == r.displayTurn && seatControls == r.seatControls {
		return
	}
	r.displayTurn, r.seatControls = turn, seatControls
	r.refreshInfo()
	r.broadcastRoom()
}

// maxTargets bounds a selection: no piece reaches more squares than this.
const maxTargets = 64

// selection passes on what a player has picked up, and where it may go, to
// the arena displays, which light it up: the player's phone has no board.
// Only displays get it. It says no more than the board already does, but a
// player has no reason to show the other side their plans as they make them.
func (r *Room) selection(c *Client, kind string, from *engine.Pos, targets []engine.Pos) {
	if !r.clients[c] || c.seat < 0 || r.game == nil || !r.info.Display {
		return
	}
	switch kind {
	case "", "card", "leader", "place", "hand":
	default:
		return
	}
	half := r.opts.Size / 2
	inside := func(p engine.Pos) bool { return p.X >= -half && p.X <= half && p.Y >= -half && p.Y <= half }
	if len(targets) > maxTargets {
		targets = targets[:maxTargets]
	}
	sel := &Selection{Kind: kind, Targets: []engine.Pos{}}
	if from != nil && inside(*from) {
		sel.From = from
	}
	for _, p := range targets {
		if inside(p) {
			sel.Targets = append(sel.Targets, p)
		}
	}
	b := r.encode(Outgoing{T: "sel", Cid: c.id, Seat: c.seat, Name: c.User.Name, Sel: sel})
	for other := range r.clients {
		if other.watch.Display {
			other.send(b)
		}
	}
}

// --- the lobby: seats, teams and starting ----------------------------------

func (r *Room) refuse(c *Client, message string) {
	c.send(r.encode(Outgoing{T: "error", Message: message}))
}

// inLobby reports whether seats can still change, telling c why not.
func (r *Room) inLobby(c *Client, hostOnly bool) bool {
	switch {
	case r.game != nil:
		r.refuse(c, "The duel has already started")
	case hostOnly && c.User.ID != r.hostID:
		r.refuse(c, "Only the host can do that")
	default:
		return true
	}
	return false
}

func (r *Room) changed() {
	r.refreshInfo()
	r.broadcastRoom()
	r.maybeStart()
}

// sit moves a player to an open seat. Seats alternate teams, so this is also
// how a player picks a side: seats 1 and 3 are one team, 2 and 4 the other.
func (r *Room) sit(c *Client, index int) {
	if !r.inLobby(c, false) {
		return
	}
	if index < 0 || index >= len(r.slots) || r.slots[index].Kind != KindHuman || r.slots[index].UserID != "" {
		r.refuse(c, "That seat is taken")
		return
	}
	if c.deck == nil {
		r.refuse(c, "Rejoin with a deck to take a seat")
		return
	}
	if c.seat >= 0 {
		r.openSeat(r.slots[c.seat])
	}
	r.seatClient(r.slots[index], c)
	c.watch = Watch{}
	r.welcome(c)
	r.changed()
}

// stand gives a seat up to watch instead.
func (r *Room) stand(c *Client) {
	if !r.inLobby(c, false) || c.seat < 0 {
		return
	}
	r.openSeat(r.slots[c.seat])
	c.seat = -1
	r.welcome(c)
	r.changed()
}

// setSeat lets the host fill an empty seat with a computer player, or open it
// again. kind is "human", "bot", "bot:<personality>" ("bot:aggressive"...,
// honoured for administrators only), "bot:llm" or "bot:llm:<model>".
func (r *Room) setSeat(c *Client, index int, kind string) {
	if !r.inLobby(c, true) {
		return
	}
	if index < 0 || index >= len(r.slots) {
		return
	}
	s := r.slots[index]
	if s.Kind == KindHuman && s.UserID != "" {
		r.refuse(c, "A player is sitting there")
		return
	}
	switch {
	case kind == "bot" || strings.HasPrefix(kind, "bot:"):
		r.seatBot(s, r.botKind(strings.TrimPrefix(strings.TrimPrefix(kind, "bot"), ":"), c.User.Admin))
	default:
		r.openSeat(s)
	}
	r.changed()
}

// setMode switches the lobby between 1v1 and 2v2.
func (r *Room) setMode(c *Client, mode string) {
	if !r.inLobby(c, true) || mode == r.opts.Mode || (mode != "1v1" && mode != "2v2") {
		return
	}
	if mode == "2v2" {
		for len(r.slots) < 4 {
			r.slots = append(r.slots, &slot{Index: len(r.slots), Team: len(r.slots) % 2, Kind: KindHuman})
		}
	} else {
		for _, s := range r.slots[2:] {
			if s.Kind == KindHuman && s.UserID != "" {
				r.refuse(c, "Seats 3 and 4 must be empty first")
				return
			}
		}
		r.slots = r.slots[:2]
	}
	r.opts.Mode = mode
	if r.opts.Map == nil {
		r.opts.Size = 7
		if mode == "2v2" {
			r.opts.Size = 9
		}
	}
	r.changed()
}

// hostStart begins a lobby's duel.
func (r *Room) hostStart(c *Client) {
	if !r.inLobby(c, true) {
		return
	}
	if !r.start() {
		r.refuse(c, "Every seat needs a player or a computer player first")
	}
}

// armIdle closes the room if nobody is connected for a while.
func (r *Room) armIdle() {
	if len(r.clients) > 0 {
		return
	}
	if r.idle != nil {
		r.idle.Stop()
	}
	r.idle = time.AfterFunc(emptyRoomLife, func() {
		r.post(func() {
			if len(r.clients) == 0 {
				r.close()
			}
		})
	})
}

// maybeStart begins the duel once every seat is filled, unless a host is
// meant to do that.
func (r *Room) maybeStart() {
	if !r.opts.Lobby && r.game == nil {
		r.start()
	}
}

// start deals the duel if every seat is filled, and reports whether it did.
func (r *Room) start() bool {
	if r.game != nil {
		return false
	}
	for _, s := range r.slots {
		if len(s.deck) == 0 {
			return false
		}
	}

	seed := r.rng.Int63()
	tiles := GenerateTiles(r.opts.Size, len(r.slots), seed)
	if r.opts.Map != nil {
		tiles = r.opts.Map.TileMap()
	}
	setups := make([]engine.SeatSetup, len(r.slots))
	for i, s := range r.slots {
		setups[i] = engine.SeatSetup{Team: s.Team, Deck: s.deck, Leader: s.leader, RarityPoints: r.rarityPoints(s)}
	}
	cfg := engine.DefaultConfig(r.opts.Size)
	cfg.DestinyPool = content.DestinyPool
	if r.opts.Sandbox {
		cfg.MaxRounds = 0 // a test runs as long as it needs
	}
	r.game = engine.New(cfg, r.catalog, tiles, setups, seed)
	r.startedAt, r.recorded, r.tested = time.Now(), false, r.opts.Sandbox
	r.turnClockEnds = time.Time{}
	r.paused, r.pausedClock = false, 0
	if r.opts.Sandbox {
		r.game.SetUnlimited(r.unlimited)
		r.lastActor = -1
		r.followActor()
	}
	r.epoch++
	r.refreshInfo()
	r.startReplay()
	r.broadcastRoom()
	r.schedule() // first, so the state carries the new turn's deadline
	r.broadcastState(nil)
	return true
}

// --- actions ---------------------------------------------------------------

// act applies one action. from is the connection to answer, nil for a bot or
// a timer.
func (r *Room) act(seat int, a engine.Action, from *Client, ack int) {
	if r.game == nil {
		if from != nil {
			from.send(r.encode(Outgoing{T: "error", ID: ack, Message: "The duel has not started yet"}))
		}
		return
	}
	if r.paused {
		if from != nil {
			from.send(r.encode(Outgoing{T: "error", ID: ack, Message: "The duel is paused"}))
		}
		return
	}
	if err := r.game.Apply(seat, a); err != nil {
		if from != nil {
			from.send(r.encode(Outgoing{T: "error", ID: ack, Message: err.Error()}))
		}
		return
	}
	r.followActor()
	r.epoch++
	r.schedule() // first, so the state carries the new deadline
	events := r.game.TakeEvents()
	r.recordStep(seat, &a, "", events)
	r.broadcastStateAck(events, from, ack)
	if r.game.Phase == engine.PhaseFinished {
		r.refreshInfo()
		r.broadcastRoom()
		r.saveReplay()
		r.record()
	}
}

// rarityPoints is a player's card rarity points so far, for the engine to
// show their cards' rarity and count what they earn (see engine/rarity.go);
// nil for a seat that keeps none: a bot, a guest. One small indexed query,
// once per seat as the duel starts.
func (r *Room) rarityPoints(s *slot) map[int]int {
	if s.Kind == KindBot || s.guest || s.UserID == "" || r.hub.Profiles == nil {
		return nil
	}
	points, err := r.hub.Profiles.CardPoints(s.UserID)
	if err != nil {
		log.Printf("room %s: card rarity for %s: %v", r.ID, s.UserID, err)
	}
	return points
}

// record files a finished duel in its players' profiles, once.
func (r *Room) record() {
	g := r.game
	if g == nil || g.Phase != engine.PhaseFinished || r.recorded || r.tested || r.hub.Profiles == nil {
		return
	}
	r.recorded = true
	m := profile.Match{
		Room: r.ID, Mode: r.opts.Mode, Map: r.info.MapName, Turns: g.TurnCount,
		Started: r.startedAt, Ended: time.Now().UTC(), WinnerTeam: g.WinnerTeam, StartLP: g.Cfg.StartLP,
	}
	if r.replaySaved {
		m.Replay = r.replayID
	}
	for i, s := range r.slots {
		seat := g.Seats[i]
		m.Seats = append(m.Seats, profile.Seat{
			UserID: s.UserID, Name: s.Name, Guest: s.guest, Bot: s.Kind == KindBot,
			Team: seat.Team, Deck: s.DeckName, LP: seat.LP, Conceded: seat.Conceded, Stats: seat.Stats,
			CardPoints: seat.CardPoints,
		})
	}
	// Off the room's goroutine: the duel never waits on the disk.
	go func() {
		if err := r.hub.Profiles.Record(m); err != nil {
			log.Printf("room %s: recording the duel: %v", r.ID, err)
		}
	}()
}

// adminTool runs one of the administrator's test tools for the seat they
// play: give a card ("give"), reorder their deck ("deck") or refresh their
// turn ("refresh"). Everyone else sees that it happened in the duel's log.
func (r *Room) adminTool(c *Client, m incoming) {
	reply := func(message string) { c.send(r.encode(Outgoing{T: "error", ID: m.ID, Message: message})) }
	if !c.User.Admin || c.seat < 0 {
		reply("The test tools are for administrators playing a duel")
		return
	}
	if r.game == nil {
		reply("The duel has not started yet")
		return
	}
	if r.opts.Sandbox && r.sandboxTool(c, m) {
		return
	}
	var err error
	switch m.Op {
	case "give":
		err = r.game.AdminGive(c.seat, m.Num, m.Field, m.Up, engine.Pos{X: m.X, Y: m.Y})
	case "deck":
		err = r.game.AdminSetDeck(c.seat, m.Deck)
	case "refresh":
		err = r.game.AdminRefresh(c.seat)
	case "lp":
		err = r.game.AdminSetLP(c.seat, m.Num)
	case "remove":
		err = r.game.AdminRemove(c.seat, m.Num)
	case "rarity":
		err = r.game.AdminSetRarity(c.seat, m.Num, m.Text)
	default:
		err = engine.RuleError("Unknown test tool")
	}
	if err != nil {
		reply(err.Error())
		return
	}
	r.tested = true
	r.followActor()
	r.epoch++
	r.schedule()
	events := r.game.TakeEvents()
	r.recordStep(c.seat, nil, m.Op, events)
	r.broadcastStateAck(events, c, m.ID)
}

// sandboxTool runs the sandbox's own controls, reporting whether m was one:
// "control" plays another seat, "follow" turns on or off switching to the
// seat the game waits on, and "unlimited" makes cards free or not.
func (r *Room) sandboxTool(c *Client, m incoming) bool {
	switch m.Op {
	case "control":
		if m.Seat < 0 || m.Seat >= len(r.slots) {
			r.refuse(c, "There is no such seat")
			return true
		}
		c.seat = m.Seat
	case "follow":
		r.follow = m.On
		if r.follow {
			r.lastActor = -1
			r.followActor()
		}
	case "unlimited":
		r.unlimited = m.On
		r.game.SetUnlimited(m.On)
	case "map":
		if !r.sandboxMap(c, m) {
			return true
		}
	default:
		return false
	}
	r.welcome(c)
	r.epoch++
	r.schedule()
	r.broadcastStateAck(r.game.TakeEvents(), c, m.ID)
	return true
}

// sandboxMap changes the sandbox's map: m.Map names a saved map, or is empty
// for a freshly generated one. A map the board's size has its terrain laid
// under the duel as it stands; any other size deals a new duel on it. It
// reports whether it worked, having told the client why not otherwise.
func (r *Room) sandboxMap(c *Client, m incoming) bool {
	var chosen *content.Map
	if m.Map != "" {
		if r.hub == nil || r.hub.Content == nil {
			r.refuse(c, "Maps are not available")
			return false
		}
		found, err := r.hub.Content.Map(m.Map, c.User.ID)
		if err != nil {
			r.refuse(c, "That map does not exist, or is not yours to use")
			return false
		}
		chosen = found
	}
	if chosen != nil && chosen.Size != r.game.Cfg.Size {
		r.opts.Map, r.opts.Size = chosen, chosen.Size
		r.game = nil
		r.start()
		return true
	}
	tiles := GenerateTiles(r.game.Cfg.Size, len(r.slots), r.rng.Int63())
	if chosen != nil {
		tiles = chosen.TileMap()
	}
	if err := r.game.AdminSetTerrain(c.seat, tiles); err != nil {
		r.refuse(c, err.Error())
		return false
	}
	r.opts.Map = chosen
	r.tested = true
	r.recordStep(c.seat, nil, m.Op, nil)
	r.refreshInfo()
	r.broadcastRoom()
	return true
}

// followActor, in a sandbox that follows the game, hands the administrator
// the seat the game now waits on: whoever's turn it is, or whoever has a
// choice to make. It only moves them when that seat changes, so they can
// still switch sides by hand to set something up.
func (r *Room) followActor() {
	if !r.opts.Sandbox || !r.follow || r.game == nil || r.game.Phase != engine.PhasePlaying {
		return
	}
	actor := r.game.Turn
	if r.game.Pending != nil {
		actor = r.game.Pending.Seat
	}
	if actor == r.lastActor {
		return
	}
	r.lastActor = actor
	for c := range r.clients {
		if c.seat >= 0 && c.User.Admin && c.seat != actor {
			c.seat = actor
			r.welcome(c)
		}
	}
}

// endBotsDuel shuts down a duel between computer players only, for whoever
// set it up or an administrator: nobody plays it, so ending it takes nothing
// from anyone, and it stops the bots (and the LLM calls they make). Everyone
// watching goes back to the menu, told who ended it.
func (r *Room) endBotsDuel(c *Client) {
	if !r.botsOnly() {
		r.refuse(c, "Only a duel between computer players can be ended this way")
		return
	}
	if c.User.ID != r.hostID && !c.User.Admin {
		r.refuse(c, "Only whoever started this duel can end it")
		return
	}
	log.Printf("room %s: %s (%s) ended the bots' duel", r.ID, c.User.Name, c.User.ID)
	for other := range r.clients {
		other.kick(4410, c.User.Name+" ended the duel") // 410 Gone: do not reconnect
	}
	r.close()
}

// pausable reports whether the duel may be paused: it is being played (not a
// sandbox, which has no clock anyway), and nobody but computer players sits
// with the one human, if there is one. Pausing never holds up another person.
func (r *Room) pausable() bool {
	if r.game == nil || r.game.Phase != engine.PhasePlaying || r.opts.Sandbox {
		return false
	}
	humans := map[string]bool{}
	for _, s := range r.slots {
		switch s.Kind {
		case KindBot:
		case KindHuman:
			humans[s.UserID] = true
		default:
			return false
		}
	}
	return len(humans) <= 1
}

// pause stops the duel (on) or picks it up again. The player may do it in a
// duel against computer players; in one between computer players only,
// whoever set it up or an administrator may. Stopping drops any move a bot
// is still thinking about (the epoch moves on), and the turn clock keeps
// what it had left.
func (r *Room) pause(c *Client, on bool, ack int) {
	if !r.pausable() {
		r.refuse(c, "Only a duel against computer players can be paused")
		return
	}
	player := c.seat >= 0 && r.slots[c.seat].Kind == KindHuman && r.slots[c.seat].UserID == c.User.ID
	if !player && !(r.botsOnly() && (c.User.ID == r.hostID || c.User.Admin)) {
		r.refuse(c, "Only the player can pause this duel")
		return
	}
	if r.paused == on {
		return
	}
	r.paused = on
	if on {
		r.pausedClock = 0
		if !r.turnClockEnds.IsZero() && r.turnClockTurn == r.game.TurnCount {
			r.pausedClock = max(time.Until(r.turnClockEnds), 0)
		}
	} else if !r.turnClockEnds.IsZero() && r.turnClockTurn == r.game.TurnCount {
		r.turnClockEnds = time.Now().Add(r.pausedClock)
	}
	r.epoch++
	r.schedule() // stops the clock, or starts it and the bots again
	r.refreshInfo()
	r.broadcastRoom()
	r.broadcastStateAck(nil, c, ack)
}

// rematch deals a fresh duel to the same seats once the last one is over.
func (r *Room) rematch(c *Client) {
	if r.game == nil || r.game.Phase != engine.PhaseFinished {
		return
	}
	// A duel between computer players is restarted by whoever set it up.
	if c.seat < 0 && !(r.botsOnly() && (c.User.ID == r.hostID || c.User.Admin)) {
		return
	}
	r.game = nil
	r.start()
}

// schedule works out who the game is waiting on and makes sure something will
// move it forward: a bot's answer, or the clock. It is called after every
// change, so the game can never be left waiting on nothing.
func (r *Room) schedule() {
	if r.timer != nil {
		r.timer.Stop()
		r.timer = nil
	}
	r.deadline = time.Time{}
	if r.game == nil || r.game.Phase != engine.PhasePlaying || r.paused {
		return
	}

	actor := r.game.Turn
	if r.game.Pending != nil {
		actor = r.game.Pending.Seat
	}
	s := r.slots[actor]
	epoch := r.epoch

	if r.opts.Sandbox {
		return // the administrator plays every seat, in their own time
	}
	if s.Kind == KindBot {
		// A duel between computer players waits for someone to watch it,
		// rather than spending model calls on an empty room. Join schedules
		// again.
		if len(r.clients) == 0 && r.botsOnly() {
			return
		}
		r.think(s, s.bot, botPace)
		return
	}
	if s.client == nil {
		// Nobody is there: give them a moment to come back, then stand in.
		r.deadline = time.Now().Add(absentGrace)
		r.timer = time.AfterFunc(absentGrace, func() {
			r.post(func() {
				if r.epoch == epoch && s.client == nil {
					r.think(s, bot.Heuristic{}, 0)
				}
			})
		})
		return
	}
	if r.opts.TurnSeconds <= 0 {
		return
	}
	// One clock per turn, started when the turn begins: acting does not buy
	// more time. A pending choice is answered on the same clock.
	if r.turnClockEnds.IsZero() || r.turnClockTurn != r.game.TurnCount {
		r.turnClockTurn = r.game.TurnCount
		r.turnClockEnds = time.Now().Add(time.Duration(r.opts.TurnSeconds) * time.Second)
	}
	r.deadline = r.turnClockEnds
	r.timer = time.AfterFunc(max(time.Until(r.turnClockEnds), 0), func() {
		r.post(func() {
			if r.epoch != epoch || r.game == nil || r.game.Phase != engine.PhasePlaying {
				return
			}
			// Out of time: take the first option of a pending choice, or end
			// the turn. Answering a choice reschedules, and the spent clock
			// then ends the turn straight away.
			if r.game.Pending != nil {
				r.act(r.game.Pending.Seat, engine.Action{Type: engine.ActChoose, Choice: 0}, nil, 0)
			} else {
				r.act(r.game.Turn, engine.Action{Type: engine.ActEndTurn}, nil, 0)
			}
		})
	})
}

// think asks a bot for the seat's next action, off the room's goroutine, and
// applies the answer if the game has not moved on in the meantime.
func (r *Room) think(s *slot, player bot.Bot, pace time.Duration) {
	if r.botActionsTurn != r.game.TurnCount {
		r.botActionsTurn, r.botActions = r.game.TurnCount, 0
	}
	r.botActions++

	legal := r.game.LegalActions(s.Index)
	if len(legal) == 0 {
		return
	}
	epoch := r.epoch
	if r.botActions > maxBotActionsPerTurn && r.game.Pending == nil {
		r.post(func() {
			if r.epoch == epoch {
				r.act(s.Index, engine.Action{Type: engine.ActEndTurn}, nil, 0)
			}
		})
		return
	}

	obs := bot.Observation{Seat: s.Index, View: r.game.ViewFor(s.Index), Legal: legal, Card: r.catalog.Card}
	go func() {
		started := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		go func() {
			select {
			case <-r.done:
				cancel()
			case <-ctx.Done():
			}
		}()
		decision := player.Choose(ctx, obs)
		if decision.Index < 0 || decision.Index >= len(legal) {
			decision.Index = len(legal) - 1 // ending the turn is always last
		}
		if wait := pace - time.Since(started); wait > 0 {
			select {
			case <-time.After(wait):
			case <-r.done:
				return
			}
		}
		r.post(func() {
			// Dropped if the game moved on, or the player this was standing
			// in for has come back.
			if r.epoch != epoch || (s.Kind == KindHuman && s.client != nil) {
				return
			}
			if decision.Thought != "" && r.botsOnly() {
				// Nobody plays, so nothing is given away: everyone may read it.
				r.broadcast(Outgoing{T: "thought", Seat: s.Index, Name: s.Name, Message: decision.Thought, Action: bot.ActionText(obs, legal[decision.Index])})
			} else if decision.Thought != "" {
				r.toAdmins(Outgoing{T: "thought", Seat: s.Index, Name: s.Name, Message: decision.Thought, Action: bot.ActionText(obs, legal[decision.Index])})
			}
			if decision.Comment != "" {
				r.broadcast(Outgoing{T: "say", Seat: s.Index, Message: decision.Comment})
			}
			r.act(s.Index, legal[decision.Index], nil, 0)
		})
	}()
}

// --- sending ---------------------------------------------------------------

func (r *Room) encode(m Outgoing) []byte {
	b, err := json.Marshal(m)
	if err != nil {
		log.Printf("room %s: cannot encode %q: %v", r.ID, m.T, err)
		return nil
	}
	return b
}

func (r *Room) broadcast(m Outgoing) {
	b := r.encode(m)
	for c := range r.clients {
		c.send(b)
	}
}

// toAdmins sends to administrators only, whether playing or watching: a bot's
// reasoning can give away its hand and its plans.
func (r *Room) toAdmins(m Outgoing) {
	var b []byte
	for c := range r.clients {
		if c.User.Admin {
			if b == nil {
				b = r.encode(m)
			}
			c.send(b)
		}
	}
}

func (r *Room) broadcastRoom() {
	r.broadcast(Outgoing{T: "room", Room: &r.info})
	// Whatever changed the room may change who hears whom.
	r.sendVoiceRosters()
}

// stateFor encodes the game as one view key sees it (see viewKey).
func (r *Room) stateFor(key int, events []engine.Event, ack int) []byte {
	view := r.viewFor(key)
	return r.encodeState(key, &view, events, ack)
}

// viewFor projects the game as one view key sees it.
func (r *Room) viewFor(key int) engine.View {
	var view engine.View
	switch {
	case key == adminView:
		view = r.game.ViewAll()
	case key >= sandboxView:
		view = r.game.ViewSandbox(key - sandboxView)
		view.Deck = r.game.DeckOf(key - sandboxView)
		if view.Deck == nil {
			view.Deck = []int{}
		}
	case key >= testerView:
		view = r.game.ViewFor(key - testerView)
		view.Deck = r.game.DeckOf(key - testerView)
		if view.Deck == nil {
			view.Deck = []int{}
		}
	case key >= spectatorView:
		// A spectator sees what the side they watch sees, and can do nothing:
		// no moves to make and no choices to answer.
		view = r.game.ViewFor((key - spectatorView) % spectatorView)
		view.Legal = nil
		if view.Pending != nil {
			view.Pending.Options = nil
		}
		if key >= teamView {
			view.Hand = []engine.HandCardView{} // watching the team, not a player
		}
	default:
		view = r.game.ViewFor(key)
	}
	return view
}

// encodeState encodes a view as the state message for its key; ack is the
// id of the action it answers for the connection that sent it, else 0.
func (r *Room) encodeState(key int, view *engine.View, events []engine.Event, ack int) []byte {
	m := Outgoing{T: "state", Seq: r.seq, State: view, Events: hideChains(key, events), ID: ack}
	if !r.deadline.IsZero() {
		m.Deadline = r.deadline.UnixMilli()
	}
	return r.encode(m)
}

// handSeat is the seat whose hand a view key sees, -1 for none, or -2 for the
// administrator, who sees every hand.
func handSeat(key int) int {
	switch {
	case key == adminView, key >= sandboxView:
		return -2
	case key >= testerView:
		return key - testerView
	case key >= teamView:
		return -1 // watching a team shows no hand
	case key >= spectatorView:
		return key - spectatorView
	}
	return key
}

// hideChains turns the cards of a fusion chain face down for a view that
// does not see the hand they were played from: the opponents, and those
// watching through them, see mystery cards merging.
func hideChains(key int, events []engine.Event) []engine.Event {
	seat := handSeat(key)
	var out []engine.Event
	for i, e := range events {
		if e.Type != "fusionChain" || seat == -2 || seat == e.Seat {
			continue
		}
		if out == nil {
			out = append([]engine.Event(nil), events...)
		}
		out[i].Steps = engine.HideChain(e.Steps)
	}
	if out == nil {
		return events
	}
	return out
}

func (r *Room) broadcastState(events []engine.Event) { r.broadcastStateAck(events, nil, 0) }

// broadcastStateAck sends everyone the new state. Each seat gets its own
// projection, encoded once per seat rather than once per connection, and the
// connection whose action caused it gets that action's id back.
func (r *Room) broadcastStateAck(events []engine.Event, from *Client, ack int) {
	if r.game == nil {
		return
	}
	r.seq++
	// Each view is worked out once per key. The connection that sent the
	// action shares it and only gets its own encoding, with the ack.
	views := map[int]*engine.View{}
	viewOf := func(key int) *engine.View {
		v, ok := views[key]
		if !ok {
			built := r.viewFor(key)
			v = &built
			views[key] = v
		}
		return v
	}
	cache := map[int][]byte{}
	for c := range r.clients {
		key := r.viewKey(c)
		if c == from && ack != 0 {
			c.send(r.encodeState(key, viewOf(key), events, ack))
			continue
		}
		b, ok := cache[key]
		if !ok {
			b = r.encodeState(key, viewOf(key), events, 0)
			cache[key] = b
		}
		c.send(b)
	}
}
