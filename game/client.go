package game

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"duelistRoses/auth"
	"duelistRoses/content"
	"duelistRoses/game/engine"
	"duelistRoses/metrics"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 16 * 1024
)

type Identity struct {
	UserID string `json:"userId"`
	Name   string `json:"name"`
	Seat   int    `json:"seat"` // -1 for a spectator
	Admin  bool   `json:"admin,omitempty"`
	// Tools is set for an administrator playing a duel: they may use the
	// test tools (see Room.adminTool).
	Tools bool `json:"tools,omitempty"`
	// Watch is the seat a spectator sees the duel through, -1 for none.
	Watch int `json:"watch"`
	// Sandbox is set for the administrator playing a sandbox (see
	// Options.Sandbox): Seat is the side they control right now.
	Sandbox *SandboxInfo `json:"sandbox,omitempty"`
	// Display is set for the arena display: the shared screen that shows the
	// board while the players play from their phones (see Watch.Display).
	Display bool `json:"display,omitempty"`
}

// SandboxInfo is how a sandbox is set up.
type SandboxInfo struct {
	// Follow switches the controls to the seat the game waits on.
	Follow bool `json:"follow"`
	// Unlimited makes cards free to play and lifts the field limits.
	Unlimited bool `json:"unlimited"`
}

// Outgoing is every message the server sends; T says which fields are set.
type Outgoing struct {
	T        string         `json:"t"`
	ID       int            `json:"id,omitempty"` // the client action this answers
	Seq      int            `json:"seq,omitempty"`
	You      *Identity      `json:"you,omitempty"`
	Room     *RoomInfo      `json:"room,omitempty"`
	State    *engine.View   `json:"state,omitempty"`
	Events   []engine.Event `json:"events,omitempty"`
	Deadline int64          `json:"deadline,omitempty"` // unix ms the turn clock runs out
	Message  string         `json:"message,omitempty"`
	// Action is the move a bot's thought led to ("thought" messages).
	Action string  `json:"action,omitempty"`
	Seat   int     `json:"seat"`
	TS     float64 `json:"ts,omitempty"`

	// Cursor messages: whose it is, where it is, and whether it has gone.
	Cid       int    `json:"cid,omitempty"`
	Name      string `json:"name,omitempty"`
	X         int    `json:"x"`
	Y         int    `json:"y"`
	Spectator bool   `json:"spectator,omitempty"`
	Gone      bool   `json:"gone,omitempty"`

	// Sel is what a player is doing on the board, for the arena display to
	// light up ("sel" messages; see Room.selection).
	Sel *Selection `json:"sel,omitempty"`
}

// Selection is what a player has picked up and where it may go: the display
// lights those squares in the player's colour, since the player's phone shows
// no board. Kind is "card", "leader", "place", "hand" or "" for nothing.
type Selection struct {
	Kind    string       `json:"kind"`
	From    *engine.Pos  `json:"from,omitempty"`
	Targets []engine.Pos `json:"targets"`
}

// Watch is how a spectator asked to see the duel. Watching always goes
// through one side of the table (or, for an administrator, all of it).
type Watch struct {
	// User watches through that player, wherever they sit.
	User string
	// Seat watches through whoever holds that seat; with TeamOnly it is just
	// a way of naming the team, and the seat's hand is not shown.
	Seat     int
	TeamOnly bool
	// Admin sees every card, hand and deck.
	Admin bool
	// All is the same view with nothing hidden, for anyone watching a duel
	// between computer players only: there is nobody to tip off.
	All bool
	// Display is the arena display: a big shared screen that shows the board
	// face up only, while the players hold their hands on their phones. Only
	// the host or a seated player may open one, and it never takes a seat.
	Display bool
	// Set is false for someone not watching through anybody.
	Set bool
}

type incoming struct {
	T  string        `json:"t"`
	ID int           `json:"id"`
	A  engine.Action `json:"a"`
	TS float64       `json:"ts"`
	// Lobby messages.
	Seat int    `json:"seat"`
	Kind string `json:"kind"`
	Mode string `json:"mode"`
	// Cursor position.
	X int `json:"x"`
	Y int `json:"y"`
	// Chat.
	Text string `json:"text"`
	On   bool   `json:"on"`
	// Administrator test tools: what to do, and with which card or deck.
	Op    string `json:"op"`
	Num   int    `json:"num"`
	Field bool   `json:"field"`
	Up    bool   `json:"up"` // put on the field face up
	Deck  []int  `json:"deck"`
	// A player's selection, for the arena display ("sel").
	From    *engine.Pos  `json:"from"`
	Targets []engine.Pos `json:"targets"`
}

// Client is one websocket connection. Its seat is only read and written on
// the room's goroutine.
type Client struct {
	User auth.User
	room *Room
	conn *websocket.Conn
	out  chan []byte
	seat int
	// The deck this connection brought; nil for a pure spectator.
	deck *content.Deck
	// watch is how a spectator sees the duel.
	watch    Watch
	lastChat time.Time
	// id names this connection's cursor to the rest of the room.
	id         int
	lastCursor time.Time

	closeOnce sync.Once
	closed    chan struct{}
	// Set by kick before closed is: how the socket is closed, so the client
	// knows not to reconnect. Zero for a normal close.
	closeCode   int
	closeReason string
}

func NewClient(user auth.User, room *Room, conn *websocket.Conn) *Client {
	return &Client{User: user, room: room, conn: conn, out: make(chan []byte, 64), closed: make(chan struct{}), seat: -1}
}

// send queues a message without ever blocking the room. A connection that
// cannot keep up is dropped; it reconnects and gets the full state again.
func (c *Client) send(b []byte) {
	if b == nil {
		return
	}
	select {
	case <-c.closed:
	case c.out <- b:
	default:
		metrics.WSSlowDrops.Inc()
		c.close()
	}
}

func (c *Client) close() {
	c.closeOnce.Do(func() { close(c.closed) })
}

// kick closes the connection for good: code is 4000 plus an HTTP status,
// which the client takes as final (see refuseWS in api/api.go), and reason is
// shown to the player.
func (c *Client) kick(code int, reason string) {
	c.closeOnce.Do(func() {
		c.closeCode, c.closeReason = code, reason
		close(c.closed)
	})
}

// Serve runs the connection until it ends.
func (c *Client) Serve() {
	metrics.WSConnections.Inc()
	defer metrics.WSConnections.Dec()
	go c.writePump()
	c.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.room.leave(c)
		c.close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { return c.conn.SetReadDeadline(time.Now().Add(pongWait)) })

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		metrics.WSIn(len(data))
		var m incoming
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.T {
		case "ping":
			// Answered here, not by the room, so it measures the wire alone.
			if b, err := json.Marshal(Outgoing{T: "pong", TS: m.TS}); err == nil {
				c.send(b)
			}
		case "action":
			c.room.post(func() { c.room.act(c.seat, m.A, c, m.ID) })
		case "rematch":
			c.room.post(func() { c.room.rematch(c) })
		case "sit":
			c.room.post(func() { c.room.sit(c, m.Seat) })
		case "stand":
			c.room.post(func() { c.room.stand(c) })
		case "seat":
			c.room.post(func() { c.room.setSeat(c, m.Seat, m.Kind) })
		case "mode":
			c.room.post(func() { c.room.setMode(c, m.Mode) })
		case "chat":
			c.room.post(func() { c.room.chat(c, m.Text) })
		case "mute":
			c.room.post(func() { c.room.muteSpectators(c, m.On) })
		case "cursor":
			c.room.post(func() { c.room.cursor(c, m.X, m.Y) })
		case "orient":
			c.room.post(func() { c.room.orient(c, m.Num, m.On) })
		case "display":
			c.room.post(func() { c.room.becomeDisplay(c) })
		case "sel":
			c.room.post(func() { c.room.selection(c, m.Kind, m.From, m.Targets) })
		case "start":
			c.room.post(func() { c.room.hostStart(c) })
		case "admin":
			c.room.post(func() { c.room.adminTool(c, m) })
		case "end":
			c.room.post(func() { c.room.endBotsDuel(c) })
		case "pause":
			c.room.post(func() { c.room.pause(c, m.On, m.ID) })
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case b := <-c.out:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
			metrics.WSOut(len(b))
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-c.closed:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			code, reason := websocket.CloseNormalClosure, ""
			if c.closeCode != 0 {
				code, reason = c.closeCode, c.closeReason
			}
			c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason))
			return
		}
	}
}
