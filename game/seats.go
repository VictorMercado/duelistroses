package game

// Seat is a place at the table and nothing more: which edge it holds and which
// way whoever sits there looks. Identity - name, clan, emblem - belongs to the
// User that takes the seat, not to the seat itself.
type Seat struct {
	BoardSide BoardSide
	Facing    BoardSide
}

// Two seats, facing each other across the board.
var Seats = []Seat{
	{BoardSide: "S", Facing: "S"},
	{BoardSide: "N", Facing: "N"},
}

// ClanProfile is the identity handed to a user when it sits down at the seat
// with the matching index.
type ClanProfile struct {
	Clan       Clan
	Owner      Owner
	TextureUrl string
	// BannerName names a player who did not give a name of their own.
	BannerName string
}

var ClanProfiles = []ClanProfile{
	{
		Clan:       "Lancastrians",
		Owner:      PlayerOwner,
		TextureUrl: "/assets/textures/Red_Rose_Emblem.png",
		BannerName: "Red Rose",
	},
	{
		Clan:       "Yorkists",
		Owner:      OpponentOwner,
		TextureUrl: "/assets/textures/White_Rose_Emblem.png",
		BannerName: "White Rose",
	},
}

// cardIDBase keeps each seat's card ids in their own readable block: 1000, 2000.
func cardIDBase(seatIndex int) int {
	return (seatIndex + 1) * 1000
}

// leaderPosition puts the leader in the middle of its own edge.
func (s Seat) leaderPosition(gridSize int) Vector3 {
	edge := float64(gridSize-1) / 2
	if s.BoardSide == "N" {
		return Vector3{X: 0, Y: edge, Z: PlayerBaseZ}
	}
	return Vector3{X: 0, Y: -edge, Z: PlayerBaseZ}
}

// startingUnitPositions flanks the leader with the seat's opening units.
func (s Seat) startingUnitPositions(gridSize int) []Vector3 {
	edge := float64(gridSize-1) / 2
	y := -edge
	if s.BoardSide == "N" {
		y = edge
	}

	positions := make([]Vector3, 0, StartingUnits)
	// -2, +2, -3, +3 ... spreading outwards from the leader.
	for i := 0; i < StartingUnits; i++ {
		offset := float64(2 + i/2)
		if i%2 == 0 {
			offset = -offset
		}
		positions = append(positions, Vector3{X: offset, Y: y, Z: CardBaseZ + float64(i)*0.01})
	}
	return positions
}

const (
	// Matches the client's PLAYER_BASE_Z / card z offsets.
	PlayerBaseZ = 0.1
	CardBaseZ   = 0.11
)

// buildSeatUnsafe deals a seat its cards the first time somebody sits down:
// an identical deck, an identical opening hand and identical starting units for
// every seat. The seat is left empty (no user) for the caller to claim.
// Assumes the state lock is held.
func (s *GameState) buildSeatUnsafe(index int, seat Seat) *Player {
	owner := ClanProfiles[index].Owner
	deck := BuildDeck(owner, cardIDBase(index))

	player := &Player{
		Owner:       owner,
		BoardSide:   seat.BoardSide,
		Facing:      seat.Facing,
		Position:    seat.leaderPosition(s.GridSize),
		Deck:        []int{},
		Hand:        []int{},
		Graveyard:   []int{},
		CardsInPlay: []int{},
		FirstMove:   len(s.Players) == 0,
		Connected:   false,
	}

	for _, card := range deck {
		s.cardsByID[card.ID] = card
	}

	// Deal off the top of the deck: starting units, then the opening hand.
	cursor := 0
	for _, position := range seat.startingUnitPositions(s.GridSize) {
		card := deck[cursor]
		cursor++
		card.Position = position
		card.IsFaceDown = true
		s.Cards = append(s.Cards, card)
		player.CardsInPlay = append(player.CardsInPlay, card.ID)
	}

	for i := 0; i < OpeningHandSize; i++ {
		card := deck[cursor]
		cursor++
		player.Hand = append(player.Hand, card.ID)
	}

	for _, card := range deck[cursor:] {
		player.Deck = append(player.Deck, card.ID)
	}

	s.Players = append(s.Players, player)
	return player
}

// ClaimSeat seats a client at the first seat nobody is connected to, creating
// that seat's cards on first use. The seat adopts the user's id, and the user
// adopts the seat's clan.
func (r *Room) ClaimSeat(client *Client) *Player {
	r.GameState.mu.Lock()
	defer r.GameState.mu.Unlock()

	for index, seat := range Seats {
		var player *Player
		if index < len(r.GameState.Players) {
			player = r.GameState.Players[index]
		} else {
			player = r.GameState.buildSeatUnsafe(index, seat)
		}

		if player.Connected {
			continue
		}

		client.takeClan(ClanProfiles[index])
		player.ID = client.ID
		player.Connected = true
		return player
	}

	return nil
}

// ReleaseSeat marks a seat empty when its client disconnects. The seat keeps its
// cards so a reconnecting player picks the game back up.
func (r *Room) ReleaseSeat(client *Client) {
	r.GameState.mu.Lock()
	defer r.GameState.mu.Unlock()

	player := r.GameState.getPlayerUnsafe(client.ID)
	if player == nil {
		return
	}
	player.Connected = false
	// The seat keeps its cards but no longer belongs to anyone.
	player.ID = ""

	// Do not leave the turn stranded on an empty seat.
	if active := r.GameState.GetActivePlayerUnsafe(); active != nil && active.ID == player.ID {
		r.GameState.advanceTurnUnsafe()
	}
}

// advanceTurnUnsafe hands the turn to the next connected seat, skipping empty
// ones. Assumes the state lock is held.
func (s *GameState) advanceTurnUnsafe() *Player {
	count := len(s.Players)
	if count == 0 {
		return nil
	}

	for step := 1; step <= count; step++ {
		index := (s.PlayerTurnIndex + step) % count
		if s.Players[index].Connected {
			s.PlayerTurnIndex = index
			return s.Players[index]
		}
	}

	// Nobody else is connected, the turn stays put.
	return s.GetActivePlayerUnsafe()
}
