// Package deckai is the deck builder's assistant: a conversation with Claude
// that can search the catalog, look up fusions and propose decks checked
// against the same rules a save goes through. It never saves anything: the
// player loads a proposal into the deck builder and saves it from there.
package deckai

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"slices"
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
	maxRounds   = 10
	maxSessions = 200
	sessionIdle = 6 * time.Hour
	// Messages a player (not an administrator) may send in an hour.
	hourlyLimit = 20
)

var (
	// ErrNoSession is a conversation the server no longer has (it restarted,
	// or the conversation sat idle too long), or one that is not the caller's.
	ErrNoSession = errors.New("that conversation is gone: start a new one")
	// ErrBusy is a player who has sent too many messages this hour.
	ErrBusy = errors.New("you've asked the deck assistant a lot this hour: try again a little later")
)

// Assistant holds the conversations.
type Assistant struct {
	Content *content.Service
	// Available is whether Anthropic credentials were found.
	Available bool
	// DefaultModel answers players until an administrator picks another.
	DefaultModel string

	db     *sql.DB
	client anthropic.Client
	mu     sync.Mutex
	chats  map[string]*chat
	// When each player sent their recent messages, for the hourly limit.
	sent map[string][]time.Time
	// The reference sent as the system prompt, rebuilt when the catalog changes.
	refVersion string
	ref        string
}

// New makes the assistant. database keeps the query log and the model
// players get; nil keeps neither (tests).
func New(c *content.Service, database *sql.DB, available bool, defaultModel string) *Assistant {
	if _, ok := bot.FindModel(defaultModel); !ok {
		defaultModel = bot.DefaultModel
	}
	return &Assistant{
		Content: c, Available: available, DefaultModel: defaultModel, db: database,
		client: anthropic.NewClient(), chats: map[string]*chat{}, sent: map[string][]time.Time{},
	}
}

type chat struct {
	mu       sync.Mutex
	id       string
	owner    string
	model    bot.Model
	messages []anthropic.MessageParam
	usage    bot.Usage
	updated  time.Time
}

// Draft is the deck open in the player's builder.
type Draft struct {
	Name      string `json:"name"`
	LeaderNum int    `json:"leaderNum"`
	Cards     []int  `json:"cards"`
}

// Proposal is a deck Claude suggests, already checked.
type Proposal struct {
	Name      string `json:"name"`
	LeaderNum int    `json:"leaderNum"`
	Cards     []int  `json:"cards"`
	Summary   string `json:"summary"`
	DeckCost  int    `json:"deckCost"`
	// Fusions is how many pairs of cards in the deck fuse.
	Fusions int `json:"fusions"`
}

// Reply is one answer in a conversation.
type Reply struct {
	Session   string     `json:"session"`
	Model     string     `json:"model"`
	Text      string     `json:"text"`
	Proposals []Proposal `json:"proposals"`
	// Steps are the tools Claude used, for the transcript.
	Steps []string `json:"steps"`
}

// Sender is who is asking.
type Sender struct {
	ID, Name string
	Admin    bool
}

// Send adds the player's message to their conversation (a new one when
// session is empty) and returns Claude's answer once it has finished using
// its tools. The deck in their builder goes with it, so Claude can work on it.
// model is honoured for administrators starting a conversation; players get
// the model an administrator chose for them.
func (a *Assistant) Send(ctx context.Context, who Sender, session, model, text string, draft *Draft) (Reply, error) {
	if !a.Available {
		return Reply{}, errors.New("the deck assistant is off on this server (no Anthropic credentials)")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return Reply{}, errors.New("say something first")
	}
	if len([]rune(text)) > 2000 {
		return Reply{}, errors.New("that message is too long (2000 characters at most)")
	}
	if !who.Admin && !a.allow(who.ID) {
		return Reply{}, ErrBusy
	}
	if !who.Admin || model == "" {
		model = a.PlayerModel()
	}
	c, err := a.chat(session, who.ID, model)
	if err != nil {
		return Reply{}, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	started := time.Now()
	catalog := a.Content.Catalog()
	system := a.reference(catalog)
	tools := toolDefs()

	// On failure the conversation goes back to how it was, so it can be retried.
	before := len(c.messages)
	c.messages = append(c.messages, anthropic.NewUserMessage(
		anthropic.NewTextBlock(describeDraft(catalog, draft)),
		anthropic.NewTextBlock(text),
	))
	reply := Reply{Session: c.id, Model: c.model.ID, Proposals: []Proposal{}, Steps: []string{}}
	var spent bot.Usage
	var said []string
	refusals := 0
	entry := func(failure string) Entry {
		cost, _ := spent.Cost(c.model)
		return Entry{
			At: started, UserID: who.ID, UserName: who.Name, Session: c.id, Model: c.model.ID,
			Message: text, Reply: reply.Text, Steps: reply.Steps, Proposals: reply.Proposals, Refusals: refusals,
			Usage: spent, CostUSD: cost, DurationMS: time.Since(started).Milliseconds(), Error: failure,
		}
	}

	for round := 0; ; round++ {
		params := anthropic.MessageNewParams{
			Model:     anthropic.Model(c.model.ID),
			MaxTokens: 16000,
			Thinking:  anthropic.ThinkingConfigParamUnion{OfAdaptive: &anthropic.ThinkingConfigAdaptiveParam{}},
			OutputConfig: anthropic.OutputConfigParam{
				Effort: anthropic.OutputConfigEffortMedium,
			},
			System: []anthropic.TextBlockParam{{Text: system, CacheControl: anthropic.NewCacheControlEphemeralParam()}},
			// The conversation so far is cached too, so each round pays for what is new.
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
			Tools:        tools,
			Messages:     c.messages,
		}
		if round == maxRounds {
			// The last round: an answer, not more tool calls.
			params.ToolChoice = anthropic.ToolChoiceUnionParam{OfNone: &anthropic.ToolChoiceNoneParam{}}
		}
		resp, err := a.client.Messages.New(ctx, params)
		if err != nil {
			c.messages = c.messages[:before]
			log.Printf("deck assistant: %v", err)
			a.record(entry(err.Error()))
			return Reply{}, errors.New("Claude could not answer just now: try again")
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
				out, isErr, step, proposal := runTool(catalog, b.Name, []byte(b.JSON.Input.Raw()))
				reply.Steps = append(reply.Steps, step)
				if isErr && (b.Name == "check_deck" || b.Name == "propose_deck") {
					refusals++
				}
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
			said = append(said, "(The answer was cut off. Ask it to continue.)")
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
	a.record(entry(""))
	return reply, nil
}

// allow counts a message against the player's hourly limit.
func (a *Assistant) allow(userID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	cutoff := time.Now().Add(-time.Hour)
	recent := slices.DeleteFunc(a.sent[userID], func(t time.Time) bool { return t.Before(cutoff) })
	if len(recent) >= hourlyLimit {
		a.sent[userID] = recent
		return false
	}
	a.sent[userID] = append(recent, time.Now())
	return true
}

// chat finds the player's conversation, or starts one.
func (a *Assistant) chat(id, owner, model string) (*chat, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	for key, c := range a.chats {
		if now.Sub(c.updated) > sessionIdle {
			delete(a.chats, key)
		}
	}
	if id != "" {
		c := a.chats[id]
		if c == nil || c.owner != owner {
			return nil, ErrNoSession
		}
		return c, nil
	}
	if len(a.chats) >= maxSessions {
		// Make room: forget the conversation idle longest.
		var oldest *chat
		for _, c := range a.chats {
			if oldest == nil || c.updated.Before(oldest.updated) {
				oldest = c
			}
		}
		delete(a.chats, oldest.id)
	}
	b := make([]byte, 8)
	rand.Read(b)
	m, ok := bot.FindModel(model)
	if !ok {
		return nil, fmt.Errorf("unknown model %q", model)
	}
	c := &chat{id: hex.EncodeToString(b), owner: owner, model: m, updated: now}
	a.chats[c.id] = c
	return c, nil
}

// describeDraft is the deck in the player's builder, as Claude reads it.
func describeDraft(catalog *content.Catalog, d *Draft) string {
	if d == nil || (len(d.Cards) == 0 && d.LeaderNum < 0) {
		return "[The deck builder is empty.]"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "[The deck open in the builder right now: %q, %d of %d cards", d.Name, len(d.Cards), content.DeckSize)
	if leader := catalog.Card(d.LeaderNum); leader != nil {
		fmt.Fprintf(&b, ", leader #%d %s", leader.Num, leader.Name)
	} else {
		b.WriteString(", no leader")
	}
	b.WriteString(".")
	if len(d.Cards) > 0 {
		b.WriteString(" Cards: ")
		b.WriteString(countList(catalog, d.Cards))
	}
	b.WriteString("]")
	return b.String()
}

// countList names a list of cards with their counts: "2x #5 Name, ...".
func countList(catalog *content.Catalog, cards []int) string {
	counts := map[int]int{}
	var order []int
	for _, n := range cards {
		if counts[n] == 0 {
			order = append(order, n)
		}
		counts[n]++
	}
	parts := make([]string, 0, len(order))
	for _, n := range order {
		name := "unknown card"
		if d := catalog.Card(n); d != nil {
			name = d.Name
		}
		parts = append(parts, fmt.Sprintf("%dx #%d %s", counts[n], n, name))
	}
	return strings.Join(parts, ", ")
}

// --- tools -------------------------------------------------------------------

func toolDefs() []anthropic.ToolUnionParam {
	deckProps := map[string]any{
		"name":       map[string]any{"type": "string", "description": "The deck's name, 1 to 40 characters."},
		"leader_num": map[string]any{"type": "integer", "description": "The deck leader: any monster's card number. It is not one of the 40 cards."},
		"cards": map[string]any{
			"type": "array", "items": map[string]any{"type": "integer"},
			"description": "Exactly 40 card numbers, a number repeated once per copy (at most 3 copies of a card).",
		},
	}
	proposeProps := map[string]any{"summary": map[string]any{"type": "string", "description": "Two or three sentences for the player: the plan, the key fusions or combos, and the terrain it wants."}}
	for k, v := range deckProps {
		proposeProps[k] = v
	}
	defs := []anthropic.ToolParam{
		{
			Name: "search_cards",
			Description: anthropic.String("Find cards by name or rules text and filters. Returns up to `limit` cards (default 25, at most 60), " +
				"each with its stats, deck cost and rules text. Every filter is optional."),
			InputSchema: anthropic.ToolInputSchemaParam{Properties: map[string]any{
				"query":     map[string]any{"type": "string", "description": "Text to look for in names and rules text (case-insensitive)."},
				"kind":      map[string]any{"type": "string", "enum": []string{"monster", "spell", "trap", "ritual"}},
				"type":      map[string]any{"type": "string", "description": "Monster type, such as dragon or spellcaster."},
				"attribute": map[string]any{"type": "string"},
				"min_atk":   map[string]any{"type": "integer"},
				"max_level": map[string]any{"type": "integer"},
				"limit":     map[string]any{"type": "integer"},
			}},
		},
		{
			Name: "find_fusions",
			Description: anthropic.String("Fusions in play: moving one of your monsters onto another of yours (or playing a card onto one) fuses them when a recipe exists. " +
				"Give `cards` to list, for each, the strongest monsters it fuses into and the partner each needs (up to 12 per card). " +
				"Set `within_only` to list only the fusions possible between the given cards (use it on a whole deck to see its fusions)."),
			InputSchema: anthropic.ToolInputSchemaParam{Properties: map[string]any{
				"cards":       map[string]any{"type": "array", "items": map[string]any{"type": "integer"}},
				"within_only": map[string]any{"type": "boolean"},
			}, Required: []string{"cards"}},
		},
		{
			Name:        "check_deck",
			Description: anthropic.String("Run the checks a save runs on a deck without showing it to the player. Returns OK with the deck cost and its fusions, or what is wrong."),
			InputSchema: anthropic.ToolInputSchemaParam{Properties: deckProps, Required: []string{"name", "leader_num", "cards"}},
		},
		{
			Name: "propose_deck",
			Description: anthropic.String("Show the player a finished deck, which they can load into the deck builder with one tap and save. " +
				"It is checked first: a deck that breaks a rule is refused and not shown, so fix it and propose again."),
			InputSchema: anthropic.ToolInputSchemaParam{Properties: proposeProps, Required: []string{"name", "leader_num", "cards", "summary"}},
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
func runTool(catalog *content.Catalog, name string, raw []byte) (out string, isErr bool, step string, proposal *Proposal) {
	switch name {
	case "search_cards":
		var in struct {
			Query, Kind, Type, Attribute string
			MinAtk                       int `json:"min_atk"`
			MaxLevel                     int `json:"max_level"`
			Limit                        int
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return "malformed input", true, "search (malformed)", nil
		}
		lines := search(catalog, in.Query, in.Kind, in.Type, in.Attribute, in.MinAtk, in.MaxLevel, in.Limit)
		step = "searched cards"
		if in.Query != "" {
			step += fmt.Sprintf(" for %q", in.Query)
		}
		if f := strings.TrimSpace(strings.Join([]string{in.Kind, in.Type, in.Attribute}, " ")); f != "" {
			step += " (" + f + ")"
		}
		if len(lines) == 0 {
			return "No card matches.", false, step, nil
		}
		return strings.Join(lines, "\n"), false, step, nil

	case "find_fusions":
		var in struct {
			Cards      []int `json:"cards"`
			WithinOnly bool  `json:"within_only"`
		}
		if err := json.Unmarshal(raw, &in); err != nil || len(in.Cards) == 0 {
			return "give at least one card number", true, "fusion lookup (no cards)", nil
		}
		if in.WithinOnly {
			lines := fusionsWithin(catalog, in.Cards)
			step = fmt.Sprintf("looked up fusions among %d cards", len(in.Cards))
			if len(lines) == 0 {
				return "None of these cards fuse with each other.", false, step, nil
			}
			return strings.Join(lines, "\n"), false, step, nil
		}
		var b strings.Builder
		var names []string
		for _, n := range uniq(in.Cards) {
			d := catalog.Card(n)
			if d == nil {
				fmt.Fprintf(&b, "#%d: no such card\n", n)
				continue
			}
			names = append(names, d.Name)
			fmt.Fprintf(&b, "%s (#%d) fuses:\n", d.Name, n)
			lines := fusionsOf(catalog, d, 12)
			if len(lines) == 0 {
				b.WriteString("  nothing\n")
			}
			for _, l := range lines {
				b.WriteString("  " + l + "\n")
			}
		}
		return b.String(), false, "looked up fusions for " + strings.Join(names, ", "), nil

	case "check_deck", "propose_deck":
		var in struct {
			Name      string `json:"name"`
			LeaderNum *int   `json:"leader_num"`
			Cards     []int  `json:"cards"`
			Summary   string `json:"summary"`
		}
		if err := json.Unmarshal(raw, &in); err != nil || in.LeaderNum == nil {
			return "name, leader_num and cards are required", true, name + " (malformed)", nil
		}
		verb := "checked"
		if name == "propose_deck" {
			verb = "proposed"
		}
		if problem := content.CheckDeck(catalog, in.Name, *in.LeaderNum, in.Cards); problem != "" {
			return "Refused: " + problem, true, fmt.Sprintf("%s %q: refused (%s)", verb, in.Name, problem), nil
		}
		var notes []string
		for _, n := range uniq(append([]int{*in.LeaderNum}, in.Cards...)) {
			if !catalog.Working(n) {
				notes = append(notes, catalog.Card(n).Name)
			}
		}
		cost := catalog.DeckCost(in.Cards)
		msg := fmt.Sprintf("OK. Deck cost %d.", cost)
		if len(notes) > 0 {
			msg += " Note: the effects of these cards do not work in the game yet: " + strings.Join(notes, ", ") + "."
		}
		if fusions := fusionsWithin(catalog, in.Cards); len(fusions) > 0 {
			msg += fmt.Sprintf("\nFusions within the deck (%d, strongest shown):\n%s", countFusions(catalog, in.Cards), strings.Join(fusions, "\n"))
		} else {
			msg += "\nNo fusions within the deck."
		}
		if name == "check_deck" {
			return msg, false, fmt.Sprintf("checked %q: ok", in.Name), nil
		}
		cards := slices.Clone(in.Cards)
		slices.Sort(cards)
		return msg + "\nShown to the player.", false, fmt.Sprintf("proposed %q", in.Name), &Proposal{
			Name: strings.TrimSpace(in.Name), LeaderNum: *in.LeaderNum, Cards: cards,
			Summary: strings.TrimSpace(in.Summary), DeckCost: cost, Fusions: countFusions(catalog, in.Cards),
		}
	}
	return "unknown tool " + name, true, "unknown tool " + name, nil
}

func copiesOf(cards []int, num int) int {
	n := 0
	for _, c := range cards {
		if c == num {
			n++
		}
	}
	return n
}

func uniq(nums []int) []int {
	seen := map[int]bool{}
	var out []int
	for _, n := range nums {
		if !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	return out
}

func search(catalog *content.Catalog, query, kind, typ, attr string, minAtk, maxLevel, limit int) []string {
	if limit <= 0 {
		limit = 25
	}
	limit = min(limit, 60)
	query = strings.ToLower(strings.TrimSpace(query))
	var out []string
	for _, d := range catalog.Defs() {
		switch {
		case kind != "" && d.Kind != kind,
			typ != "" && !strings.EqualFold(d.Type, typ),
			attr != "" && !strings.EqualFold(d.Attribute, attr),
			minAtk > 0 && d.Atk < minAtk,
			maxLevel > 0 && d.IsMonster() && d.Level > maxLevel,
			query != "" && !strings.Contains(strings.ToLower(d.Name), query) && !strings.Contains(strings.ToLower(d.Text), query):
			continue
		}
		out = append(out, describe(catalog, d, true))
		if len(out) == limit {
			break
		}
	}
	return out
}

// describe is one line about a card; full adds its rules text.
func describe(catalog *content.Catalog, d *engine.CardDef, full bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "#%d %s | ", d.Num, d.Name)
	if d.IsMonster() {
		fmt.Fprintf(&b, "%s/%s L%d %d/%d", d.Type, d.Attribute, d.Level, d.Atk, d.Def)
	} else {
		b.WriteString(d.Kind)
	}
	fmt.Fprintf(&b, " | cost %d", d.DeckCost)
	if d.Locked {
		b.WriteString(" | LOCKED")
	} else if !catalog.Working(d.Num) {
		b.WriteString(" | effect not working yet")
	}
	if d.Leader != nil {
		b.WriteString(" | leader ability " + d.Leader.Op)
	}
	if full && d.Text != "" {
		b.WriteString(" | " + d.Text)
	}
	return b.String()
}

// fusionsOf lists the strongest monsters a card fuses into, with a partner for each.
func fusionsOf(catalog *content.Catalog, a *engine.CardDef, limit int) []string {
	type hit struct {
		result  *engine.CardDef
		partner []string
	}
	byResult := map[int]*hit{}
	for _, b := range catalog.Defs() {
		if b.Locked {
			continue
		}
		r := catalog.Fuse(a, b)
		if r == nil {
			continue
		}
		h := byResult[r.Num]
		if h == nil {
			h = &hit{result: r}
			byResult[r.Num] = h
		}
		h.partner = append(h.partner, fmt.Sprintf("#%d %s", b.Num, b.Name))
	}
	hits := make([]*hit, 0, len(byResult))
	for _, h := range byResult {
		hits = append(hits, h)
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].result.Atk > hits[j].result.Atk })
	var out []string
	for _, h := range hits[:min(limit, len(hits))] {
		partners := h.partner
		more := ""
		if len(partners) > 4 {
			more = fmt.Sprintf(" and %d more", len(partners)-4)
			partners = partners[:4]
		}
		out = append(out, fmt.Sprintf("-> #%d %s (%d/%d) with %s%s", h.result.Num, h.result.Name, h.result.Atk, h.result.Def, strings.Join(partners, ", "), more))
	}
	return out
}

type fusionPair struct{ a, b, r *engine.CardDef }

// fusionPairs is every pair among the cards that fuses, strongest result first.
func fusionPairs(catalog *content.Catalog, cards []int) []fusionPair {
	set := uniq(cards)
	var pairs []fusionPair
	for i, x := range set {
		for _, y := range set[i:] {
			a, b := catalog.Card(x), catalog.Card(y)
			if a == nil || b == nil || (x == y && copiesOf(cards, x) < 2) {
				continue
			}
			if r := catalog.Fuse(a, b); r != nil {
				pairs = append(pairs, fusionPair{a, b, r})
			}
		}
	}
	sort.Slice(pairs, func(i, j int) bool { return pairs[i].r.Atk > pairs[j].r.Atk })
	return pairs
}

func countFusions(catalog *content.Catalog, cards []int) int { return len(fusionPairs(catalog, cards)) }

// fusionsWithin lists the strongest fusions among the cards.
func fusionsWithin(catalog *content.Catalog, cards []int) []string {
	pairs := fusionPairs(catalog, cards)
	out := make([]string, 0, min(40, len(pairs)))
	for _, p := range pairs[:min(40, len(pairs))] {
		out = append(out, fmt.Sprintf("#%d %s + #%d %s -> #%d %s (%d/%d)", p.a.Num, p.a.Name, p.b.Num, p.b.Name, p.r.Num, p.r.Name, p.r.Atk, p.r.Def))
	}
	return out
}

// --- the reference -------------------------------------------------------------

// reference is the system prompt: how the game plays, the deck rules and
// every card in one line each. It only changes with the catalog, so it stays
// cached between messages.
func (a *Assistant) reference(catalog *content.Catalog) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.refVersion == catalog.Version && a.ref != "" {
		return a.ref
	}
	var b strings.Builder
	b.WriteString(builderPrompt)
	fmt.Fprintf(&b, "\n\nDECK RULES\n- Exactly %d cards, plus a deck leader (any monster) that does not take one of the %d slots.\n- At most %d copies of a card; at most 1 God card; LOCKED cards may not be used at all.\n- Deck cost is shown to players as a measure of power; there is no cap, but say what a deck costs.\n",
		content.DeckSize, content.DeckSize, content.MaxCopies)

	b.WriteString("\nTERRAIN (monster type: strong on / weak on; strong means +500 ATK and DEF and moving 2 squares)\n")
	types := map[string]bool{}
	for _, d := range catalog.Defs() {
		if d.IsMonster() && d.Type != "" {
			types[d.Type] = true
		}
	}
	names := make([]string, 0, len(types))
	for t := range types {
		names = append(names, t)
	}
	sort.Strings(names)
	for _, t := range names {
		strong, weak := engine.TypeTerrain(t)
		fmt.Fprintf(&b, "- %s: %s / %s\n", t, orNone(strong), orNone(weak))
	}

	b.WriteString("\nTHE CATALOG (#number name | type/attribute level ATK/DEF, or kind | deck cost | flags). Spells and traps show the start of their text; use search_cards for full rules text.\n")
	for _, d := range catalog.Defs() {
		b.WriteString(describe(catalog, d, false))
		// Spells and traps are chosen by what they do: a short version of it.
		if !d.IsMonster() && d.Text != "" {
			text := []rune(d.Text)
			if len(text) > 90 {
				text = append(text[:90], '…')
			}
			b.WriteString(" | " + string(text))
		}
		b.WriteString("\n")
	}
	a.refVersion, a.ref = catalog.Version, b.String()
	return a.ref
}

func orNone(list []string) string {
	if len(list) == 0 {
		return "none"
	}
	return strings.Join(list, ", ")
}

const builderPrompt = `You are the deck assistant in Duelist Roses' deck builder. You help players build decks, tune the one they have open, and explain card choices.

THE GAME
Duelist Roses is a tactical card duel on a square grid. Each duelist has a deck leader on the board and life points (LP); a duelist at 0 LP loses. Each turn you may play one card from your hand face down onto a square next to your leader. Monsters cost their level in summoning stars (you gain 3 a turn, up to 12); spells and traps are free. Monsters move one square a turn and battle by moving onto enemy monsters (higher ATK wins; the loser's owner loses the difference). A monster that reaches the enemy leader deals its full ATK as damage, which is how games are won. Spells activate when flipped face up; traps spring by themselves when an enemy comes near or attacks. Moving one of your monsters onto another of yours fuses them when a recipe exists, making a stronger monster from the fusion table (fusion results do not need to be in the deck). Power-up spells equip a monster they are moved onto. Terrain on the map makes each monster type stronger or weaker.

WHAT MAKES A GOOD DECK
- A curve of summoning costs: enough low-level monsters to play early, a few strong ones to finish.
- Fusion material: pairs of cheap monsters that fuse into much stronger ones are the heart of most decks. Check them with find_fusions.
- A plan around a terrain or monster type (types share terrain and power-ups), with power-ups for that type.
- Removal and protection: a few spells and traps that answer big enemy monsters.
- Prefer cards whose effects work in the game; mention it if you include one that does not.

HOW TO WORK
- The player's current deck in the builder is sent with each message. When they ask to change it, start from it.
- Look up rules text with search_cards and fusions with find_fusions before relying on them.
- Run check_deck while you work, then call propose_deck with the finished deck: that is the only way the player gets a deck they can load. Never list a full deck only in text.
- Be brief in conversation: the deck's idea, its key combos and anything the player should know. Answer questions about cards and strategy plainly; you do not have to propose a deck when the player only asks a question.`
