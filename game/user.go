package game

import (
	"crypto/rand"
	"encoding/hex"
)

// Role is what a user is doing in a room.
type Role string

const (
	RolePlayer    Role = "player"
	RoleSpectator Role = "spectator"
)

// User is who is connected, one level above the game itself: every connection
// is a user, and a user is either a player holding a seat or a spectator
// watching.
//
// The user carries identity - name, clan and the emblem drawn for it - while
// the seat it occupies carries only position (see Seat). A player's seat in
// GameState is keyed by this user's ID, so there is one identity, not two.
type User struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role Role   `json:"role"`

	// Set when the user sits down; empty for spectators.
	Clan       Clan   `json:"clan,omitempty"`
	Owner      Owner  `json:"owner,omitempty"`
	TextureUrl string `json:"textureUrl,omitempty"`
}

func NewUser(name string, role Role) *User {
	if name == "" {
		name = "Anonymous"
	}
	return &User{
		ID:   newUserID(),
		Name: name,
		Role: role,
	}
}

func (u *User) IsPlayer() bool {
	return u.Role == RolePlayer
}

// takeClan gives the user the identity of the side it just sat down on. A user
// who never chose a name is known by its clan's banner instead.
func (u *User) takeClan(profile ClanProfile) {
	u.Clan = profile.Clan
	u.Owner = profile.Owner
	u.TextureUrl = profile.TextureUrl
	if u.Name == "" || u.Name == "Anonymous" {
		u.Name = profile.BannerName
	}
}

// Snapshot copies the user for sending, so a live connection's fields are never
// marshalled while another goroutine could be reading them.
func (u *User) Snapshot() User {
	return *u
}

func newUserID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// A collision here only affects roster display, never game rules.
		return "user"
	}
	return hex.EncodeToString(b)
}
