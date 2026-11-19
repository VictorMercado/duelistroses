package game

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

// Voice chat runs browser to browser (WebRTC): the server never carries the
// audio. It decides who may talk to whom, by the same rules as text chat
// (see Room.chat), tells each connection in voice whom to call, and relays
// the calls' setup messages (offers, answers, network candidates) between
// them over the room's websocket.

// VoicePeer is someone a connection in voice is linked to. Speak: we may be
// heard by them. Hear: we may listen to them. The receiving browser plays a
// peer's audio only when Hear is set, so a modified client cannot whisper to
// someone the rules keep it from.
type VoicePeer struct {
	Cid       int    `json:"cid"`
	Name      string `json:"name"`
	Seat      int    `json:"seat"`
	Spectator bool   `json:"spectator,omitempty"`
	Speak     bool   `json:"speak"`
	Hear      bool   `json:"hear"`
}

// ICEServer is a STUN or TURN server for the browsers to reach each other
// through, in the shape RTCPeerConnection takes it.
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// voiceDataLimit bounds one relayed setup message (an offer is a few KB).
const voiceDataLimit = 12 * 1024

// setVoice joins or leaves the room's voice chat.
func (r *Room) setVoice(c *Client, on bool) {
	if !r.clients[c] || c.watch.Display || c.voice == on {
		return
	}
	c.voice = on
	c.voiceRoster = ""
	if on {
		c.ice = iceServers(c.User.ID)
	} else {
		// Leaving: an empty roster, so the browser hangs up on everyone.
		c.send(r.encode(Outgoing{T: "voice", Cid: c.id, Peers: []VoicePeer{}}))
	}
	r.sendVoiceRosters()
}

// speaks reports whether from's voice may be heard by to: players are heard
// by the whole room; spectators only by their own side (and administrators),
// and not at all while the players have muted spectators.
func (r *Room) speaks(from, to *Client) bool {
	if from == to || !from.voice || !to.voice || from.watch.Display || to.watch.Display {
		return false
	}
	if from.seat >= 0 {
		return true
	}
	return !r.muted && (r.reaches(from, to) || (to.seat < 0 && to.watch.Admin))
}

func (r *Room) voiceLinked(a, b *Client) bool { return r.speaks(a, b) || r.speaks(b, a) }

// sendVoiceRosters tells every connection in voice whom it is linked to, when
// that changed. It runs whenever the room does (see broadcastRoom): someone
// joins, leaves, sits, stands, or the players mute spectators.
func (r *Room) sendVoiceRosters() {
	for c := range r.clients {
		if !c.voice {
			continue
		}
		peers := []VoicePeer{}
		for other := range r.clients {
			if !r.voiceLinked(c, other) {
				continue
			}
			peers = append(peers, VoicePeer{
				Cid: other.id, Name: other.User.Name, Seat: other.seat, Spectator: other.seat < 0,
				Speak: r.speaks(c, other), Hear: r.speaks(other, c),
			})
		}
		b := r.encode(Outgoing{T: "voice", Cid: c.id, Peers: peers, ICE: c.ice})
		if string(b) != c.voiceRoster {
			c.voiceRoster = string(b)
			c.send(b)
		}
	}
}

// rtc relays a call setup message to another connection, if the two are linked.
func (r *Room) rtc(c *Client, to int, data json.RawMessage) {
	if !r.clients[c] || len(data) == 0 || len(data) > voiceDataLimit {
		return
	}
	for other := range r.clients {
		if other.id == to {
			if r.voiceLinked(c, other) {
				other.send(r.encode(Outgoing{T: "rtc", Cid: c.id, Data: data}))
			}
			return
		}
	}
}

// iceServers is what a browser is given to find a way through to its peers.
// STUN alone connects most home and mobile networks. Behind stricter ones
// (some carriers, offices) the audio has to be relayed by a TURN server: set
// TURN_URLS (comma separated, e.g. "turn:turn.example.com:3478") and
// TURN_SECRET, coturn's static-auth-secret, to hand out credentials good for
// a day. STUN_URLS replaces the default public STUN server.
func iceServers(userID string) []ICEServer {
	stun := os.Getenv("STUN_URLS")
	if stun == "" {
		stun = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
	}
	servers := []ICEServer{{URLs: splitList(stun)}}
	if urls, secret := splitList(os.Getenv("TURN_URLS")), os.Getenv("TURN_SECRET"); len(urls) > 0 && secret != "" {
		username := fmt.Sprintf("%d:%s", time.Now().Add(24*time.Hour).Unix(), userID)
		mac := hmac.New(sha1.New, []byte(secret))
		mac.Write([]byte(username))
		servers = append(servers, ICEServer{URLs: urls, Username: username, Credential: base64.StdEncoding.EncodeToString(mac.Sum(nil))})
	}
	return servers
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
