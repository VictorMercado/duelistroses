// Package cardlab is the administrators' card designer: a conversation with
// Claude that can search the catalog, check a card against the same rules a
// save goes through, and propose cards. It never saves anything itself: an
// administrator opens a proposal in the card editor and saves it from there.
package cardlab

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"

	"duelistRoses/bot"
	"duelistRoses/content"
	"duelistRoses/game/engine"
)

const (
	// Tool rounds one message may take before Claude has to answer.
	maxRounds   = 12
	maxSessions = 50
	sessionIdle = 12 * time.Hour
)

// ErrNoSession is a conversation the server no longer has (it restarted, or
// the conversation sat idle too long).
var ErrNoSession = errors.New("that conversation is gone: start a new one")

// Lab holds the conversations.
type Lab struct {
	Content *content.Service
	// Available is whether Anthropic credentials were found.
	Available bool
	// DefaultModel answers when a conversation names none.
	DefaultModel string

	client anthropic.Client
	mu     sync.Mutex
	chats  map[string]*chat
	// The reference sent as the system prompt, rebuilt when the catalog changes.
	refVersion string
	ref        string
}

func New(c *content.Service, available bool, defaultModel string) *Lab {
	return &Lab{Content: c, Available: available, DefaultModel: defaultModel, client: anthropic.NewClient(), chats: map[string]*chat{}}
}

type chat struct {
	mu       sync.Mutex
	id       string
	model    bot.Model
	messages []anthropic.MessageParam
	usage    bot.Usage
	updated  time.Time
}

// Proposal is a card Claude suggests, already checked.
type Proposal struct {
	Card    json.RawMessage `json:"card"`
	Summary string          `json:"summary"`
	// NewBehaviour describes engine work an op the engine does not carry out
	// yet would need, for whoever implements it.
	NewBehaviour string   `json:"newBehaviour,omitempty"`
	Warnings     []string `json:"warnings"`
	// Replaces names the existing card this one would overwrite.
	Replaces string `json:"replaces,omitempty"`
}

// Reply is one answer in a conversation.
type Reply struct {
	Session   string     `json:"session"`
	Model     string     `json:"model"`
	Text      string     `json:"text"`
	Proposals []Proposal `json:"proposals"`
	// Steps are the tools Claude used, for the transcript.
	Steps     []string  `json:"steps"`
	TurnCost  float64   `json:"turnCostUsd"`
	TotalCost float64   `json:"totalCostUsd"`
	Usage     bot.Usage `json:"usage"`
}

// Send adds the administrator's message to a conversation (a new one when
// session is empty) and returns Claude's answer once it has finished using
// its tools.
func (l *Lab) Send(ctx context.Context, session, model, text string) (Reply, error) {
	if !l.Available {
		return Reply{}, errors.New("no Anthropic credentials on the server")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return Reply{}, errors.New("say something first")
	}
	c, err := l.chat(session, model)
	if err != nil {
		return Reply{}, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	catalog := l.Content.Catalog()
	system := l.reference(catalog)
	thinking := anthropic.ThinkingConfigAdaptiveParam{}
	tools := toolDefs()

	// On failure the conversation goes back to how it was, so it can be retried.
	before := len(c.messages)
	c.messages = append(c.messages, anthropic.NewUserMessage(anthropic.NewTextBlock(text)))
	reply := Reply{Session: c.id, Model: c.model.ID, Proposals: []Proposal{}, Steps: []string{}}
	var spent bot.Usage
	var said []string

	for round := 0; ; round++ {
		params := anthropic.MessageNewParams{
			Model:     anthropic.Model(c.model.ID),
			MaxTokens: 16000,
			Thinking:  anthropic.ThinkingConfigParamUnion{OfAdaptive: &thinking},
			OutputConfig: anthropic.OutputConfigParam{
				Effort: anthropic.OutputConfigEffortMedium,
			},
			System: []anthropic.TextBlockParam{{Text: system, CacheControl: anthropic.NewCacheControlEphemeralParam()}},
			// The conversation so far is cached too, so each round pays for
			// what is new.
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
			Tools:        tools,
			Messages:     c.messages,
		}
		if round == maxRounds {
			// The last round: an answer, not more tool calls.
			params.ToolChoice = anthropic.ToolChoiceUnionParam{OfNone: &anthropic.ToolChoiceNoneParam{}}
		}
		resp, err := l.client.Messages.New(ctx, params)
		if err != nil {
			c.messages = c.messages[:before]
			log.Printf("card lab: %v", err)
			return Reply{}, fmt.Errorf("Claude could not answer: %w", err)
		}
		u := resp.Usage
		spent.Calls++
		spent.Input += u.InputTokens
		spent.Output += u.OutputTokens
		spent.CacheRead += u.CacheReadInputTokens
		spent.CacheWrite += u.CacheCreationInputTokens
		c.messages = append(c.messages, resp.ToParam())

		var results []anthropic.ContentBlockParamUnion
		for _, block := range resp.Content {
			switch b := block.AsAny().(type) {
			case anthropic.TextBlock:
				if t := strings.TrimSpace(b.Text); t != "" {
					said = append(said, t)
				}
			case anthropic.ToolUseBlock:
				out, isErr, step, proposal := l.runTool(catalog, b.Name, []byte(b.JSON.Input.Raw()))
				reply.Steps = append(reply.Steps, step)
				if proposal != nil {
					reply.Proposals = append(reply.Proposals, *proposal)
				}
				results = append(results, anthropic.NewToolResultBlock(b.ID, out, isErr))
			}
		}

		if resp.StopReason == anthropic.StopReasonRefusal {
			said = append(said, "(Claude declined to continue with that request.)")
			break
		}
		if resp.StopReason == anthropic.StopReasonMaxTokens {
			said = append(said, "(The answer was cut off: it ran out of room. Ask it to continue.)")
		}
		if resp.StopReason != anthropic.StopReasonToolUse || len(results) == 0 {
			break
		}
		if round+1 == maxRounds {
			results = append(results, anthropic.NewTextBlock("You have used your tools enough for this message: answer now with what you have."))
		}
		c.messages = append(c.messages, anthropic.NewUserMessage(results...))
	}

	c.usage.Calls += spent.Calls
	c.usage.Input += spent.Input
	c.usage.Output += spent.Output
	c.usage.CacheRead += spent.CacheRead
	c.usage.CacheWrite += spent.CacheWrite
	c.updated = time.Now()
	reply.Text = strings.Join(said, "\n\n")
	reply.Usage = c.usage
	reply.TurnCost, _ = spent.Cost(c.model)
	reply.TotalCost, _ = c.usage.Cost(c.model)
	return reply, nil
}

// chat finds a conversation, or starts one.
func (l *Lab) chat(id, model string) (*chat, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for key, c := range l.chats {
		if now.Sub(c.updated) > sessionIdle {
			delete(l.chats, key)
		}
	}
	if id != "" {
		c := l.chats[id]
		if c == nil {
			return nil, ErrNoSession
		}
		return c, nil
	}
	if model == "" {
		model = l.DefaultModel
	}
	m, ok := bot.FindModel(model)
	if !ok {
		return nil, fmt.Errorf("unknown model %q", model)
	}
	if len(l.chats) >= maxSessions {
		// Make room: forget the conversation idle longest.
		var oldest *chat
		for _, c := range l.chats {
			if oldest == nil || c.updated.Before(oldest.updated) {
				oldest = c
			}
		}
		delete(l.chats, oldest.id)
	}
	b := make([]byte, 8)
	rand.Read(b)
	c := &chat{id: hex.EncodeToString(b), model: m, updated: now}
	l.chats[c.id] = c
	return c, nil
}

// --- tools -------------------------------------------------------------------

func toolDefs() []anthropic.ToolUnionParam {
	cardSchema := map[string]any{"type": "object", "description": "The whole card as JSON, in the catalog's format."}
	defs := []anthropic.ToolParam{
		{
			Name:        "search_cards",
			Description: anthropic.String("Find cards in the catalog whose name or text contains the query (case-insensitive), optionally only of one kind or using one effect or ability op. Returns up to 20 cards with their stats, text and effect JSON. Use it to see how existing cards express an effect and what similar cards cost."),
			InputSchema: anthropic.ToolInputSchemaParam{Properties: map[string]any{
				"query": map[string]any{"type": "string", "description": "Text to look for in names and card text; empty matches everything."},
				"kind":  map[string]any{"type": "string", "enum": []string{"monster", "spell", "trap", "ritual"}},
				"op":    map[string]any{"type": "string", "description": "Only cards whose effect or abilities use this op."},
			}},
		},
		{
			Name:        "get_card",
			Description: anthropic.String("The stored JSON of one card, by number."),
			InputSchema: anthropic.ToolInputSchemaParam{Properties: map[string]any{"num": map[string]any{"type": "integer"}}, Required: []string{"num"}},
		},
		{
			Name:        "check_card",
			Description: anthropic.String("Run every check a save runs on a card (its fields, its effect against the engine, and the whole catalog with it in place) without saving. Returns OK with warnings, or the problems that would refuse it. Omit num for a new card."),
			InputSchema: anthropic.ToolInputSchemaParam{Properties: map[string]any{"card": cardSchema}, Required: []string{"card"}},
		},
		{
			Name: "propose_card",
			Description: anthropic.String("Show the administrator a finished card, which they can open in the card editor and save. It is checked first: a card with problems is refused and not shown, so fix it and propose again. " +
				"Omit num for a new card (it gets the next free number); give an existing num only when the administrator asked to change that card."),
			InputSchema: anthropic.ToolInputSchemaParam{Properties: map[string]any{
				"card":          cardSchema,
				"summary":       map[string]any{"type": "string", "description": "One or two sentences: what the card does in play and why it is balanced."},
				"new_behaviour": map[string]any{"type": "string", "description": "Only when the card uses an op the engine does not carry out yet: a precise specification of the new op for the developer who will add it to game/engine (when it triggers, what it targets, every field it reads, edge cases)."},
			}, Required: []string{"card", "summary"}},
		},
	}
	out := make([]anthropic.ToolUnionParam, len(defs))
	for i := range defs {
		out[i] = anthropic.ToolUnionParam{OfTool: &defs[i]}
	}
	return out
}

// runTool carries out one tool call: what to tell Claude, whether it is an
// error, a line for the transcript, and the proposal it made, if any.
func (l *Lab) runTool(catalog *content.Catalog, name string, raw []byte) (out string, isErr bool, step string, proposal *Proposal) {
	switch name {
	case "search_cards":
		var in struct{ Query, Kind, Op string }
		json.Unmarshal(raw, &in)
		lines := search(catalog, in.Query, in.Kind, in.Op, 20)
		step = fmt.Sprintf("searched cards for %q", in.Query)
		if in.Op != "" {
			step += " using " + in.Op
		}
		if len(lines) == 0 {
			return "No card matches.", false, step, nil
		}
		return strings.Join(lines, "\n"), false, step, nil

	case "get_card":
		var in struct{ Num int }
		json.Unmarshal(raw, &in)
		card, err := l.Content.StoredCard(in.Num)
		if err != nil {
			return fmt.Sprintf("There is no card %d.", in.Num), true, fmt.Sprintf("looked up card %d (none)", in.Num), nil
		}
		step = fmt.Sprintf("read card %d", in.Num)
		if d := catalog.Card(in.Num); d != nil {
			step = fmt.Sprintf("read %s (#%d)", d.Name, in.Num)
		}
		return string(card), false, step, nil

	case "check_card", "propose_card":
		var in struct {
			Card         json.RawMessage `json:"card"`
			Summary      string          `json:"summary"`
			NewBehaviour string          `json:"new_behaviour"`
		}
		if err := json.Unmarshal(raw, &in); err != nil || len(in.Card) == 0 {
			return "card is missing or is not a JSON object", true, name + " (no card)", nil
		}
		num, replaces := l.numberFor(catalog, in.Card)
		clean, warnings, err := l.Content.CheckCard(num, in.Card)
		cardName := nameOf(in.Card)
		var problem *content.CardProblem
		if errors.As(err, &problem) {
			msg := "Refused: " + strings.Join(problem.Problems, "; ")
			if len(problem.Warnings) > 0 {
				msg += "\nWarnings: " + strings.Join(problem.Warnings, "; ")
			}
			return msg, true, fmt.Sprintf("checked %s: refused (%s)", cardName, strings.Join(problem.Problems, "; ")), nil
		}
		if err != nil {
			return "The check failed on the server: " + err.Error(), true, "checked " + cardName + ": server error", nil
		}
		msg := fmt.Sprintf("OK as card %d.", num)
		if replaces != "" {
			msg += fmt.Sprintf(" This replaces the existing card %q.", replaces)
		}
		if len(warnings) > 0 {
			msg += "\nWarnings: " + strings.Join(warnings, "; ")
		}
		if name == "check_card" {
			return msg, false, "checked " + cardName + ": ok", nil
		}
		return msg + "\nShown to the administrator.", false, "proposed " + cardName, &Proposal{
			Card: clean, Summary: strings.TrimSpace(in.Summary), NewBehaviour: strings.TrimSpace(in.NewBehaviour),
			Warnings: warnings, Replaces: replaces,
		}
	}
	return "unknown tool " + name, true, "unknown tool " + name, nil
}

// numberFor is the number a proposed card is checked as: the num it gives,
// or the next free one. replaces names the card at that number, if any.
func (l *Lab) numberFor(catalog *content.Catalog, card json.RawMessage) (num int, replaces string) {
	var head struct {
		Num *int `json:"num"`
	}
	json.Unmarshal(card, &head)
	if head.Num != nil && *head.Num >= 0 {
		if d := catalog.Card(*head.Num); d != nil {
			return *head.Num, d.Name
		}
		return *head.Num, ""
	}
	next := 0
	for _, d := range catalog.Defs() {
		next = max(next, d.Num+1)
	}
	return next, ""
}

func nameOf(card json.RawMessage) string {
	var head struct{ Name string }
	json.Unmarshal(card, &head)
	if head.Name == "" {
		return "a card"
	}
	return head.Name
}

func usesOp(d *engine.CardDef, op string) bool {
	if d.Effect != nil && d.Effect.Op == op {
		return true
	}
	for _, a := range d.Abilities {
		if a.Op == op {
			return true
		}
	}
	return false
}

func search(catalog *content.Catalog, query, kind, op string, limit int) []string {
	query = strings.ToLower(strings.TrimSpace(query))
	var out []string
	for _, d := range catalog.Defs() {
		if kind != "" && d.Kind != kind {
			continue
		}
		if op != "" && !usesOp(d, op) {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(d.Name), query) && !strings.Contains(strings.ToLower(d.Text), query) {
			continue
		}
		out = append(out, describe(d))
		if len(out) == limit {
			break
		}
	}
	return out
}

// describe is one line about a card, with its effect as JSON.
func describe(d *engine.CardDef) string {
	var b strings.Builder
	fmt.Fprintf(&b, "#%d %s (%s", d.Num, d.Name, d.Kind)
	if d.IsMonster() {
		fmt.Fprintf(&b, ", %s/%s, level %d, ATK %d DEF %d", d.Type, d.Attribute, d.Level, d.Atk, d.Def)
	}
	fmt.Fprintf(&b, ", deckCost %d)", d.DeckCost)
	if d.Text != "" {
		fmt.Fprintf(&b, ": %s", d.Text)
	}
	if d.Effect != nil {
		e, _ := json.Marshal(d.Effect)
		fmt.Fprintf(&b, " | effect %s", e)
	}
	if len(d.Abilities) > 0 {
		a, _ := json.Marshal(d.Abilities)
		fmt.Fprintf(&b, " | abilities %s", a)
	}
	if d.Leader != nil {
		a, _ := json.Marshal(d.Leader)
		fmt.Fprintf(&b, " | leader %s", a)
	}
	return b.String()
}

// --- the reference -------------------------------------------------------------

// reference is the system prompt: how cards are written, and every op the
// engine carries out with an example card. It only changes with the catalog,
// so it stays cached between messages.
func (l *Lab) reference(catalog *content.Catalog) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.refVersion == catalog.Version && l.ref != "" {
		return l.ref
	}
	defs := catalog.Defs()
	types, attrs := map[string]bool{}, map[string]bool{}
	next := 0
	for _, d := range defs {
		if d.Type != "" && d.IsMonster() {
			types[d.Type] = true
		}
		if d.Attribute != "" {
			attrs[d.Attribute] = true
		}
		next = max(next, d.Num+1)
	}
	examples := func(op string, n int) []string {
		var out []string
		for _, d := range defs {
			if usesOp(d, op) {
				out = append(out, "    "+describe(d))
				if len(out) == n {
					break
				}
			}
		}
		return out
	}

	var b strings.Builder
	b.WriteString(designerPrompt)
	fmt.Fprintf(&b, "\n\nTHE CATALOG\n%d cards; the next free card number is %d.\nMonster types: %s\nAttributes: %s\nTerrains: %s\n",
		len(defs), next, joinKeys(types), joinKeys(attrs), strings.Join(engine.AllTerrains, ", "))

	b.WriteString("\nEFFECT OPS (card.effect.op), with the kind of card that uses each and example cards:\n")
	ops := make([]string, 0, len(engine.EffectOps))
	for op := range engine.EffectOps {
		ops = append(ops, op)
	}
	sort.Strings(ops)
	for _, op := range ops {
		fmt.Fprintf(&b, "- %s (%s)\n", op, engine.EffectOps[op])
		for _, e := range examples(op, 2) {
			b.WriteString(e + "\n")
		}
	}

	b.WriteString("\nMONSTER ABILITY OPS (card.abilities[].op), with the moments (abilities[].on) each may use (\"\" = passive while face up) and example cards:\n")
	ops = ops[:0]
	for op := range engine.AbilityOps {
		ops = append(ops, op)
	}
	sort.Strings(ops)
	for _, op := range ops {
		moments := make([]string, len(engine.AbilityOps[op]))
		for i, m := range engine.AbilityOps[op] {
			moments[i] = fmt.Sprintf("%q", m)
		}
		fmt.Fprintf(&b, "- %s (on: %s)\n", op, strings.Join(moments, ", "))
		for _, e := range examples(op, 2) {
			b.WriteString(e + "\n")
		}
	}
	fmt.Fprintf(&b, "\nLEADER OPS (card.leader.op): %s\n", strings.Join(engine.LeaderOps, ", "))

	l.refVersion, l.ref = catalog.Version, b.String()
	return l.ref
}

func joinKeys(m map[string]bool) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.Join(keys, ", ")
}

const designerPrompt = `You help the administrator of Duelist Roses design cards. Duelist Roses is a tactical card duel on a square grid: each duelist has a deck leader on the board and life points (LP); cards are played face down next to your leader, monsters move one square at a time and battle by moving onto each other, and a monster that reaches the enemy leader deals its ATK as damage. Monsters cost their level in summoning stars (3 stars a turn, up to 12); spells and traps are free. Spells are activated by flipping them face up; traps spring by themselves when their trigger happens near them.

WHAT YOU CAN DO
- Design new cards and change existing ones, written as card JSON in the catalog's format.
- Look things up with search_cards and get_card, and run check_card while you work.
- When a design is finished, call propose_card. The administrator reviews it and saves it from the card editor; you never save anything yourself.

HOW EFFECTS WORK
A card's behaviour is data that the game engine carries out. Every op listed below already works in play. Prefer to build what the administrator asks for out of these ops and their fields: such a card is playable the moment it is saved.
If an idea truly cannot be expressed with the existing ops, you may invent a new op name. The card still saves, with a warning, but it does nothing in play until a developer implements the op in the engine (game/engine/effects.go or abilities.go). When you do this, say so plainly and fill new_behaviour with a precise specification for that developer. Never pretend a new op already works.

CARD JSON
- num (number; omit for a new card), name (1-60 characters), kind ("monster", "spell", "trap" or "ritual"), text (the rules text players read; keep it accurate to what the effect does).
- Monsters: type, attribute, level (1-12), atk, def. Optional: abilities (list of effects, each with "on"), favors (extra terrains it is strong on), leader (deck leader ability), fusion (true for a fusion monster).
- Spells, traps and rituals: effect (one effect object).
- deckCost: what the card costs to put in a deck. Match it to similar cards (search for them); stronger cards cost more.
- image: the art path under the asset folder (e.g. "cards/005.png"). Leave it out for a new card: the administrator adds art separately.
- Never set frame, template or attributeIcon: the server works those out.
Effect fields (use only what an op reads; the examples show which):
  op; amount (ATK/DEF change, LP, cards, stars...); turns (spellbind length, -1 = permanent); types / attrs (monster types / attributes affected); name (a substring a card's name must contain); terrain; radius; maxAtk / minAtk (limits on affected monsters); count;
  side ("own", "enemy" or "" for everyone, from the card's point of view); nums (only these card numbers); kinds (only these card kinds); shape ("diamond", "ring", "row" or "here") for terrain areas; toType / toAttr (what a monster is turned into); stat ("def" makes a boost DEF only); position ("attack" or "defense"); faceDown (a summoned card arrives face down); permanent (a trap stays after it goes off); minLP / cost (LP that must remain / LP paid); counters (the spell ops a counter trap answers); grant (effects a power-up gives the monster it is used on);
  traps only: trigger (one of move, attack, spell, heal, powerUp, defense, trap) and range ("limited" = the eight surrounding squares, "full" = anywhere);
  rituals only: summon (the number of the monster summoned) and tributes (1-5 requirements, each with name, type, maxAtk or minDef);
  abilities only: on (the moment: "flip", "battleFlip", "battle", "destroyed" (destroyed in battle), "anyDestroy" (destroyed by anything: battle, spell, trap, ability), "aura", "turn", "move", or "" for passive).

WORKING STYLE
- Look at existing cards that use an op before using it, so you set the fields the way the engine reads them.
- Keep cards balanced against the catalog: compare stats, level and deckCost with similar cards.
- Run check_card on a design before proposing it, and fix every problem it reports.
- Be brief in conversation: what you made, how it plays, and anything the administrator must do (art, a new op to implement).`
