package bot

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"

	"duelistRoses/game/engine"
)

// LLM is a player driven by Claude. Each decision is one request: the model is
// shown the board as text and the numbered legal actions, and answers with the
// number it picks. Because it can only pick from that list it cannot make an
// illegal move, and if the request fails, times out or is refused, the
// heuristic bot's choice is used instead, so the game never waits on it.
type LLM struct {
	client   anthropic.Client
	model    string
	name     string
	fallback Heuristic
	// Timeout bounds one decision.
	Timeout time.Duration
	usage   usageCounters
}

// Model is a Claude model players can pick for an LLM opponent.
type Model struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Note  string `json:"note"`
	// Prices in US dollars per million tokens (zero: not known).
	InputPerM     float64 `json:"inputPerM,omitempty"`
	OutputPerM    float64 `json:"outputPerM,omitempty"`
	CacheReadPerM float64 `json:"cacheReadPerM,omitempty"`
}

// DefaultModel plays when nothing else is chosen.
const DefaultModel = "claude-opus-5-5"

// Models are the choices offered in the lobby, strongest first.
var Models = []Model{
	{ID: "claude-opus-5-5", Label: "Opus", Note: "strongest, slowest", InputPerM: 4, OutputPerM: 20, CacheReadPerM: 0.20},
	{ID: "claude-sonnet-5-5", Label: "Sonnet", Note: "balanced", InputPerM: 2, OutputPerM: 10, CacheReadPerM: 0.20},
	{ID: "claude-haiku-5-5", Label: "Haiku", Note: "fastest, cheapest", InputPerM: 0.10, OutputPerM: 0.50, CacheReadPerM: 0.01},
}

// FindModel returns the offered model with this ID.
func FindModel(id string) (Model, bool) {
	for _, m := range Models {
		if m.ID == id {
			return m, true
		}
	}
	return Model{}, false
}

// NewLLM uses the SDK's default credentials (ANTHROPIC_API_KEY, or a profile
// from `ant auth login`).
func NewLLM(model string) *LLM {
	if model == "" {
		model = DefaultModel
	}
	name := "Claude"
	if m, ok := FindModel(model); ok {
		name = "Claude " + m.Label
	}
	return &LLM{client: anthropic.NewClient(), model: model, name: name, Timeout: 45 * time.Second}
}

func (l *LLM) Name() string { return l.name }

// Model is the model ID this player asks.
func (l *LLM) Model() string { return l.model }

// Usage is what an LLM player has spent so far.
type Usage struct {
	Calls int64 `json:"calls"`
	// Fallbacks are decisions where the rule-based move was played because
	// the request failed or the answer was unusable.
	Fallbacks  int64 `json:"fallbacks"`
	Input      int64 `json:"input"`
	Output     int64 `json:"output"` // thinking included
	CacheRead  int64 `json:"cacheRead"`
	CacheWrite int64 `json:"cacheWrite"`
}

// Cost prices the usage at the model's rates; ok is false when the rates are
// not known. Cache writes cost 1.25 times input (the 5 minute cache).
func (u Usage) Cost(m Model) (dollars float64, ok bool) {
	if m.InputPerM == 0 || m.OutputPerM == 0 {
		return 0, false
	}
	cacheRead := m.CacheReadPerM
	if cacheRead == 0 {
		cacheRead = m.InputPerM / 10
	}
	return (float64(u.Input)*m.InputPerM + float64(u.CacheWrite)*m.InputPerM*1.25 +
		float64(u.CacheRead)*cacheRead + float64(u.Output)*m.OutputPerM) / 1e6, true
}

type usageCounters struct{ calls, fallbacks, input, output, cacheRead, cacheWrite atomic.Int64 }

// Usage totals every request this player has made.
func (l *LLM) Usage() Usage {
	u := &l.usage
	return Usage{
		Calls: u.calls.Load(), Fallbacks: u.fallbacks.Load(), Input: u.input.Load(), Output: u.output.Load(),
		CacheRead: u.cacheRead.Load(), CacheWrite: u.cacheWrite.Load(),
	}
}

// The rules never change between requests, so they go in the system prompt
// where they are cached.
const systemPrompt = `You are playing a tactical card duel on a square grid, as one of the duelists. You are a strong, decisive player. Each request shows you the current position and a numbered list of every legal action. Choose exactly one.

RULES
- Each duelist has a deck leader on the board and life points (LP). A duelist at 0 LP is out; the last team standing wins. An empty deck is not a loss: a duelist with no cards left to draw plays on with its hand and field.
- Coordinates are (x, y): x grows to the east, y grows to the north.
- On your turn you may play ONE card from your hand onto a square next to your own leader (all 8 surrounding squares). Monsters cost their level in summoning stars; you gain 3 stars each turn, up to 12. Spells and traps are free. Cards arrive face down.
- Every card you control may be given ONE order per turn: move, or switch to defense position, or (for a spell) flip face up to activate it. Turning a monster face up, or switching its position, is that card's order too (a move can turn it face up on the way, in the same order). Your leader may step one square. You end your turn explicitly.
- A card moves 1 square orthogonally, or up to 2 if it is a face-up monster standing on terrain that favours its type.
- Moving a monster onto an enemy monster is a battle. Attack vs attack position: the lower ATK is destroyed and its owner loses the difference in LP; a tie destroys both. Attack vs defense position: if your ATK is higher the defender is destroyed with no LP damage; if lower, you lose the difference and nothing is destroyed. Face-down cards are revealed by battle, so attacking one is a gamble.
- Moving a monster onto the enemy LEADER deals its full ATK as LP damage. This is how games are won: get monsters next to the enemy leader.
- Terrain gives a monster +500 or -500 ATK/DEF depending on its type. Crush terrain destroys any non-immortal monster with 1500+ ATK that enters. Labyrinth cannot be entered.
- Your leader may step onto one of your own cards: that card is destroyed (eaten). Only worth it to escape danger or clear a useless card.
- Moving one of your monsters onto another of yours fuses them if a recipe exists. Moving a power-up spell onto your monster equips it.
- A spell is used by flipping it face up on your turn. Traps stay face down and spring by themselves when an enemy monster moves next to them or attacks.
- A card the enemy revealed (turned face up) is not used up: a face-up spell is activated by moving it, where it lands. A face-up trap is disarmed and cannot move, unless it is a permanent trap that already went off (such as Mirror Wall), which keeps working. A monster that moves onto a face-up spell or trap destroys it.
- At most 5 monsters per duelist on the field, counted per team (a 2v2 team shares 10, however it splits them), and 5 spell/trap cards per duelist.

HOW TO PLAY WELL
- Take a winning direct attack on the enemy leader whenever one is listed.
- Win battles you are sure of; avoid attacking visible monsters stronger than yours.
- Spend stars: get monsters onto the board and advance them toward the enemy leader, preferring terrain that favours them.
- Keep your own leader away from enemy monsters.
- End the turn only when no remaining action helps.

Answer with the number of the action you choose and one short sentence, in character as a confident duelist, about why.`

var decisionSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"action":  map[string]any{"type": "integer", "description": "The number of the chosen action."},
		"comment": map[string]any{"type": "string", "description": "One short sentence said aloud to the table."},
	},
	"required":             []string{"action", "comment"},
	"additionalProperties": false,
}

func (l *LLM) Choose(ctx context.Context, o Observation) Decision {
	fallback := l.fallback.Choose(ctx, o)
	if len(o.Legal) <= 1 {
		return fallback
	}
	// The rule-based move, with why it was played instead, for administrators.
	fallBack := func(why string) Decision {
		l.usage.fallbacks.Add(1)
		d := fallback
		d.Thought = why + " Played the rule-based move instead."
		return d
	}

	ctx, cancel := context.WithTimeout(ctx, l.Timeout)
	defer cancel()

	// Summaries of the model's reasoning are shown to administrators.
	thinking := anthropic.ThinkingConfigAdaptiveParam{Display: anthropic.ThinkingConfigAdaptiveDisplaySummarized}
	resp, err := l.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.Model(l.model),
		MaxTokens: 4000,
		Thinking:  anthropic.ThinkingConfigParamUnion{OfAdaptive: &thinking},
		System: []anthropic.TextBlockParam{{
			Text:         systemPrompt,
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
		}},
		// One move in a game: answer quickly rather than deliberate at length.
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{Schema: decisionSchema},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(Describe(o))),
		},
	})
	l.usage.calls.Add(1)
	if err == nil {
		u := resp.Usage
		l.usage.input.Add(u.InputTokens)
		l.usage.output.Add(u.OutputTokens)
		l.usage.cacheRead.Add(u.CacheReadInputTokens)
		l.usage.cacheWrite.Add(u.CacheCreationInputTokens)
	}
	if err != nil {
		log.Printf("llm bot: %v (playing the fallback move)", err)
		return fallBack(fmt.Sprintf("The request failed: %v.", err))
	}
	if resp.StopReason != anthropic.StopReasonEndTurn {
		log.Printf("llm bot: stopped with %q (playing the fallback move)", resp.StopReason)
		return fallBack(fmt.Sprintf("The model stopped with %q.", resp.StopReason))
	}

	var thought []string
	for _, block := range resp.Content {
		if t, ok := block.AsAny().(anthropic.ThinkingBlock); ok && strings.TrimSpace(t.Thinking) != "" {
			thought = append(thought, strings.TrimSpace(t.Thinking))
		}
	}
	for _, block := range resp.Content {
		text, ok := block.AsAny().(anthropic.TextBlock)
		if !ok {
			continue
		}
		var answer struct {
			Action  *int   `json:"action"`
			Comment string `json:"comment"`
		}
		if err := json.Unmarshal([]byte(text.Text), &answer); err != nil || answer.Action == nil {
			continue
		}
		if *answer.Action < 0 || *answer.Action >= len(o.Legal) {
			log.Printf("llm bot: chose action %d of %d (playing the fallback move)", *answer.Action, len(o.Legal))
			return fallBack(fmt.Sprintf("It chose action %d, which is not on the list.", *answer.Action))
		}
		// At low effort the model sometimes answers without thinking; say so,
		// so every move still shows up for administrators.
		why := strings.Join(thought, "\n\n")
		if why == "" {
			why = "(answered without thinking)"
		}
		return Decision{Index: *answer.Action, Comment: strings.TrimSpace(answer.Comment), Thought: why}
	}
	return fallBack("Its answer could not be read.")
}

// ActionText describes a legal action the way the model reads it.
func ActionText(o Observation, a engine.Action) string { return read(o).actionText(a) }

// Describe renders an observation as the text a model reads.
func Describe(o Observation) string {
	b := read(o)
	v := o.View
	var w strings.Builder

	fmt.Fprintf(&w, "You are seat %d (team %d). Round %d (every duelist has one turn a round). Your LP %d, summoning stars %d, card plays left this turn %d.\n",
		o.Seat, b.me.Team, v.Round, b.me.LP, b.me.Stars, b.me.PlaysLeft)
	fmt.Fprintf(&w, "Board %dx%d: x and y run from %d to %d.\n\nLeaders:\n", v.Size, v.Size, -b.half, b.half)
	for _, s := range v.Seats {
		if !s.Alive {
			continue
		}
		side := "enemy"
		switch {
		case s.Index == o.Seat:
			side = "you"
		case s.Team == b.me.Team:
			side = "ally"
		}
		fmt.Fprintf(&w, "- seat %d (%s) at (%d, %d): %d LP, %d cards in hand, %d in deck\n",
			s.Index, side, s.LeaderX, s.LeaderY, s.LP, s.HandCount, s.DeckCount)
	}

	w.WriteString("\nCards on the field:\n")
	if len(v.Cards) == 0 {
		w.WriteString("- none\n")
	}
	for _, c := range v.Cards {
		side := "enemy"
		switch {
		case c.Owner == o.Seat:
			side = "yours"
		case !b.enemy(c.Owner):
			side = "ally"
		}
		fmt.Fprintf(&w, "- #%d %s %s at (%d, %d) on %s", c.ID, side, b.cardText(c), c.X, c.Y, b.terrain(engine.Pos{X: c.X, Y: c.Y}))
		if c.Spellbound != 0 {
			w.WriteString(", spellbound")
		}
		if c.Acted && c.Owner == o.Seat {
			w.WriteString(", already acted")
		}
		w.WriteString("\n")
	}

	w.WriteString("\nYour hand:\n")
	if len(v.Hand) == 0 {
		w.WriteString("- empty\n")
	}
	for _, h := range v.Hand {
		fmt.Fprintf(&w, "- #%d %s\n", h.ID, defText(b.def(h.Num)))
	}

	// Only terrain that matters is listed; everything else is normal ground.
	special := map[string][]string{}
	for y := -b.half; y <= b.half; y++ {
		for x := -b.half; x <= b.half; x++ {
			if t := b.terrain(engine.Pos{X: x, Y: y}); t != engine.TerrainNormal {
				special[t] = append(special[t], fmt.Sprintf("(%d,%d)", x, y))
			}
		}
	}
	if len(special) > 0 {
		w.WriteString("\nTerrain (unlisted squares are normal):\n")
		names := make([]string, 0, len(special))
		for name := range special {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			fmt.Fprintf(&w, "- %s: %s\n", name, strings.Join(special[name], " "))
		}
	}

	if p := v.Pending; p != nil {
		fmt.Fprintf(&w, "\nYou must make a selection: %s\n", p.Prompt)
	}
	w.WriteString("\nLegal actions:\n")
	for i, a := range o.Legal {
		fmt.Fprintf(&w, "%d: %s\n", i, b.actionText(a))
	}
	return w.String()
}

func defText(def *engine.CardDef) string {
	if def == nil {
		return "unknown card"
	}
	if def.IsMonster() {
		return fmt.Sprintf("%s (level %d %s/%s monster, ATK %d DEF %d)", def.Name, def.Level, def.Type, def.Attribute, def.Atk, def.Def)
	}
	text := def.Text
	if text == "" {
		text = "no effect"
	}
	return fmt.Sprintf("%s (%s: %s)", def.Name, def.Kind, text)
}

func (b board) cardText(c engine.CardView) string {
	if c.Hidden {
		return "face-down card (unknown)"
	}
	def := b.def(c.Num)
	if def == nil {
		return "unknown card"
	}
	facing := "face-up"
	if c.FaceDown {
		facing = "face-down"
	}
	if !def.IsMonster() {
		return fmt.Sprintf("%s (%s, %s: %s)", def.Name, facing, def.Kind, def.Text)
	}
	position := "attack"
	if c.Defense {
		position = "defense"
	}
	return fmt.Sprintf("%s (%s monster, ATK %d DEF %d here, %s, %s position)", def.Name, def.Type, c.Atk, c.Def, facing, position)
}

func (b board) actionText(a engine.Action) string {
	target := engine.Pos{X: a.X, Y: a.Y}
	name := func(id int) string {
		if def := b.def(b.byID[id].Num); def != nil {
			return fmt.Sprintf("#%d %s", id, def.Name)
		}
		return fmt.Sprintf("#%d", id)
	}
	switch a.Type {
	case engine.ActSummon:
		def := b.def(b.hand[a.CardIDs[0]])
		what := "card"
		if def != nil {
			what = def.Name
		}
		if occupant, ok := b.cards[target]; ok {
			return fmt.Sprintf("play %s from hand onto your %s at (%d, %d) to combine them", what, name(occupant.ID), a.X, a.Y)
		}
		return fmt.Sprintf("play %s from hand at (%d, %d) on %s", what, a.X, a.Y, b.terrain(target))
	case engine.ActMove:
		for _, s := range b.enemyLeaders() {
			if s.LeaderX == a.X && s.LeaderY == a.Y {
				return fmt.Sprintf("%s attacks the enemy leader of seat %d directly (%d LP left) for %d damage", name(a.CardID), s.Index, s.LP, b.byID[a.CardID].Atk)
			}
		}
		if occupant, ok := b.cards[target]; ok {
			if occupant.Owner == b.o.Seat {
				return fmt.Sprintf("move %s onto your %s at (%d, %d) to combine them", name(a.CardID), name(occupant.ID), a.X, a.Y)
			}
			return fmt.Sprintf("%s attacks enemy %s at (%d, %d)", name(a.CardID), b.cardText(occupant), a.X, a.Y)
		}
		if c := b.byID[a.CardID]; c.Owner == b.o.Seat {
			if def := b.def(c.Num); def != nil && castOnMove(def, c) {
				return fmt.Sprintf("move %s to (%d, %d) and activate it there: %s", name(a.CardID), a.X, a.Y, def.Text)
			}
		}
		return fmt.Sprintf("move %s to (%d, %d) on %s", name(a.CardID), a.X, a.Y, b.terrain(target))
	case engine.ActFlip:
		if def := b.def(b.byID[a.CardID].Num); def != nil && !def.IsMonster() {
			return fmt.Sprintf("activate %s: %s", name(a.CardID), def.Text)
		}
		return fmt.Sprintf("flip %s face up", name(a.CardID))
	case engine.ActPosition:
		if a.Defense {
			return fmt.Sprintf("switch %s to defense position", name(a.CardID))
		}
		return fmt.Sprintf("switch %s to attack position", name(a.CardID))
	case engine.ActLeader:
		if c, ok := b.cards[engine.Pos{X: a.X, Y: a.Y}]; ok {
			return fmt.Sprintf("move your leader to (%d, %d), eating (destroying) your own %s there", a.X, a.Y, name(c.ID))
		}
		return fmt.Sprintf("move your leader to (%d, %d)", a.X, a.Y)
	case engine.ActChoose:
		if p := b.o.View.Pending; p != nil && a.Choice < len(p.Options) {
			return "choose " + p.Options[a.Choice].Label
		}
		return "choose"
	case engine.ActEndTurn:
		return "end your turn"
	}
	return a.Type
}
