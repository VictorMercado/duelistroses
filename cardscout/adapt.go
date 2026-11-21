package cardscout

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2"

	"duelistRoses/bot"
	"duelistRoses/cardlab"
	"duelistRoses/content"
)

// cardRead is what Claude read off an uploaded card image.
type cardRead struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	CardType  string `json:"card_type"`
	Race      string `json:"monster_type"`
	Attribute string `json:"attribute"`
	Level     int    `json:"level"`
	Atk       *int   `json:"atk"`
	Def       *int   `json:"def"`
	Text      string `json:"text"`
}

// adaptResult is what one conversation with Claude produced.
type adaptResult struct {
	Options []Option
	Note    string
	// Read is the card as read from an image (uploads only).
	Read *cardRead
	Cost float64
}

// adapt asks Claude how a card could work in this game. first is the
// opening message (text, and the card image for an upload); upload says the
// card is an image Claude must read, of any kind, rather than a Synchro
// described in text.
func (s *Scout) adapt(ctx context.Context, first []anthropic.ContentBlockParamUnion, upload bool) (res adaptResult, err error) {
	catalog := s.Content.Catalog()
	brief := synchroBrief
	if upload {
		brief = uploadBrief
	}
	system := strings.Replace(scoutPrompt, "{{BRIEF}}", brief, 1) + "\n\n" + s.Lab.Reference(catalog)
	tools := append(cardlab.LookupTools(), suggestTool(upload))
	messages := []anthropic.MessageParam{anthropic.NewUserMessage(first...)}
	var spent bot.Usage
	// Whatever happens, the cost is what was spent.
	defer func() { res.Cost, _ = spent.Cost(s.model) }()

	for round := 0; round <= maxRounds; round++ {
		params := anthropic.MessageNewParams{
			Model:        anthropic.Model(s.model.ID),
			MaxTokens:    16000,
			System:       []anthropic.TextBlockParam{{Text: system, CacheControl: anthropic.NewCacheControlEphemeralParam()}},
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
			Tools:        tools,
			Messages:     messages,
		}
		if round < maxRounds {
			thinking := anthropic.ThinkingConfigAdaptiveParam{}
			params.Thinking = anthropic.ThinkingConfigParamUnion{OfAdaptive: &thinking}
			params.OutputConfig = anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortMedium}
		} else {
			// The last round must suggest: a forced tool cannot be combined with thinking.
			params.ToolChoice = anthropic.ToolChoiceUnionParam{OfTool: &anthropic.ToolChoiceToolParam{Name: "suggest_options"}}
		}
		resp, err := s.client.Messages.New(ctx, params)
		if err != nil {
			return res, fmt.Errorf("Claude could not answer: %w", err)
		}
		u := resp.Usage
		spent.Calls++
		spent.Input += u.InputTokens
		spent.Output += u.OutputTokens
		spent.CacheRead += u.CacheReadInputTokens
		spent.CacheWrite += u.CacheCreationInputTokens
		messages = append(messages, resp.ToParam())

		var results []anthropic.ContentBlockParamUnion
		for _, block := range resp.Content {
			b, ok := block.AsAny().(anthropic.ToolUseBlock)
			if !ok {
				continue
			}
			raw := []byte(b.JSON.Input.Raw())
			if b.Name == "suggest_options" {
				opts, note, read, problem := s.checkOptions(raw, upload)
				if problem == "" {
					res.Options, res.Note, res.Read = opts, note, read
					return res, nil
				}
				results = append(results, anthropic.NewToolResultBlock(b.ID, problem, true))
				continue
			}
			out, isErr, _ := s.Lab.RunLookup(catalog, b.Name, raw)
			results = append(results, anthropic.NewToolResultBlock(b.ID, out, isErr))
		}
		if resp.StopReason == anthropic.StopReasonRefusal {
			return res, errors.New("Claude declined to adapt this card")
		}
		if len(results) == 0 {
			results = append(results, anthropic.NewTextBlock("Call suggest_options with your options now."))
		} else if round+1 == maxRounds {
			results = append(results, anthropic.NewTextBlock("That is enough research: call suggest_options now."))
		}
		messages = append(messages, anthropic.NewUserMessage(results...))
	}
	return res, errors.New("Claude did not finish its options in time: ask again")
}

func suggestTool(upload bool) anthropic.ToolUnionParam {
	option := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"title":         map[string]any{"type": "string", "description": "A few words naming the approach, e.g. \"Faithful\", \"Board aura\", \"Simplified\"."},
			"card":          map[string]any{"type": "object", "description": "The whole card as JSON, in the catalog's format, without num, image or mask."},
			"summary":       map[string]any{"type": "string", "description": "One or two sentences: how the original effect became this, and how it plays."},
			"new_behaviour": map[string]any{"type": "string", "description": "Only when the card uses an op the engine does not carry out yet: a precise specification of it for the developer."},
		},
		"required": []string{"title", "card", "summary"},
	}
	props := map[string]any{
		"options": map[string]any{"type": "array", "items": option, "minItems": 1, "maxItems": maxOptions},
		"note":    map[string]any{"type": "string", "description": "Optional: anything the administrator should know about this card (a stat that was \"?\", a part of the effect dropped, a word you could not read)."},
	}
	required := []string{"options"}
	if upload {
		props["card_read"] = map[string]any{
			"type":        "object",
			"description": "The card exactly as printed on the image, before any adaptation.",
			"properties": map[string]any{
				"name":         map[string]any{"type": "string"},
				"kind":         map[string]any{"type": "string", "enum": []string{"monster", "spell", "trap", "ritual"}, "description": "The kind it becomes here: monsters of every summon type are \"monster\"; a Ritual Spell is \"ritual\"."},
				"card_type":    map[string]any{"type": "string", "description": "As printed, e.g. \"Effect Monster\", \"Synchro Monster\", \"Quick-Play Spell\", \"Counter Trap\"."},
				"monster_type": map[string]any{"type": "string", "description": "Monsters: the printed type, e.g. \"Spellcaster\"."},
				"attribute":    map[string]any{"type": "string", "description": "Monsters: the printed attribute."},
				"level":        map[string]any{"type": "integer", "description": "Monsters: the stars (Rank for Xyz, Link rating for Link)."},
				"atk":          map[string]any{"type": "integer", "description": "Omit for \"?\"."},
				"def":          map[string]any{"type": "integer", "description": "Omit for \"?\" or a Link monster."},
				"text":         map[string]any{"type": "string", "description": "The full card text, word for word."},
			},
			"required": []string{"name", "kind", "card_type", "text"},
		}
		required = append(required, "card_read")
	}
	t := anthropic.ToolParam{
		Name: "suggest_options",
		Description: anthropic.String("Hand the administrator your options for this card. Every card is checked as a save would check it; if any is refused nothing is shown, " +
			"and you get the problems to fix. Two options for a card with an effect, one for a card without."),
		InputSchema: anthropic.ToolInputSchemaParam{Properties: props, Required: required},
	}
	return anthropic.ToolUnionParam{OfTool: &t}
}

// checkOptions checks every option's card. problem is what to tell Claude
// when one is refused ("" when all are fine). For an upload, every option
// must be the kind of card Claude read; a scouted Synchro must be a monster.
func (s *Scout) checkOptions(raw []byte, upload bool) (options []Option, note string, read *cardRead, problem string) {
	var in struct {
		Options []struct {
			Title        string          `json:"title"`
			Card         json.RawMessage `json:"card"`
			Summary      string          `json:"summary"`
			NewBehaviour string          `json:"new_behaviour"`
		} `json:"options"`
		Note string    `json:"note"`
		Read *cardRead `json:"card_read"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, "", nil, "options is not in the expected form: " + err.Error()
	}
	if len(in.Options) < 1 || len(in.Options) > maxOptions {
		return nil, "", nil, fmt.Sprintf("give 1 to %d options", maxOptions)
	}
	kind := "monster"
	if upload {
		if in.Read == nil || strings.TrimSpace(in.Read.Name) == "" || in.Read.Kind == "" {
			return nil, "", nil, "card_read (with name, kind, card_type and text) is required: say what you read on the card"
		}
		kind = in.Read.Kind
	}
	num := s.Content.NextFreeNum()
	var problems []string
	for i, o := range in.Options {
		card, err := stripCard(o.Card)
		if err != nil {
			problems = append(problems, fmt.Sprintf("option %d: %v", i+1, err))
			continue
		}
		var head struct{ Kind string }
		_ = json.Unmarshal(card, &head)
		if head.Kind != kind {
			problems = append(problems, fmt.Sprintf("option %d: this card becomes a %s (kind %q), not a %q", i+1, kind, kind, head.Kind))
			continue
		}
		clean, warnings, err := s.Content.CheckCard(num, card)
		var refused *content.CardProblem
		switch {
		case errors.As(err, &refused):
			problems = append(problems, fmt.Sprintf("option %d refused: %s", i+1, strings.Join(refused.Problems, "; ")))
			continue
		case err != nil:
			problems = append(problems, fmt.Sprintf("option %d: the check failed on the server: %v", i+1, err))
			continue
		}
		options = append(options, Option{
			Title: strings.TrimSpace(o.Title), Card: withoutNum(clean), Summary: strings.TrimSpace(o.Summary),
			NewBehaviour: strings.TrimSpace(o.NewBehaviour), Warnings: warnings, CheckedNum: num,
		})
	}
	if len(problems) > 0 {
		return nil, "", nil, "Nothing was shown. Fix these and call suggest_options again with every option:\n" + strings.Join(problems, "\n")
	}
	return options, strings.TrimSpace(in.Note), in.Read, ""
}

// stripCard drops the fields the scout sets itself on accept.
func stripCard(raw json.RawMessage) (json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, errors.New("card must be a JSON object")
	}
	for _, f := range []string{"num", "image", "mask", "fullArt", "locked"} {
		delete(fields, f)
	}
	return json.Marshal(fields)
}

func withoutNum(raw json.RawMessage) json.RawMessage {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return raw
	}
	delete(fields, "num")
	out, _ := json.Marshal(fields)
	return out
}

// describeSource is a scouted Synchro as Claude is first shown it.
func describeSource(c *SourceCard, feedback string) string {
	stat := func(v *int) string {
		if v == nil {
			return "?"
		}
		return fmt.Sprint(*v)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Adapt this card to Duelist Roses.\n\nName: %s\nCard type: %s\nMonster type: %s\nAttribute: %s\nLevel: %d\nATK %s / DEF %s\nFirst released: %s\nText:\n%s\n",
		c.Name, c.Type, c.Race, c.Attribute, c.Level, stat(c.Atk), stat(c.Def), c.Released, c.Desc)
	writeFeedback(&b, feedback)
	return b.String()
}

func writeFeedback(b *strings.Builder, feedback string) {
	if feedback != "" {
		fmt.Fprintf(b, "\nThe administrator reviewed an earlier suggestion for this card and asks:\n%s\n", feedback)
	}
}

const scoutPrompt = `You are the card scout for Duelist Roses. You bring cards from the original trading card game into this game, one card at a time, and an administrator reviews your suggestions before anything is saved.

{{BRIEF}}

WHAT TO SUGGEST
Call suggest_options once, with:
- Two options when the card has an effect:
  1. A faithful option: as close to the original effect as the engine's existing ops allow.
  2. An alternative: a different reading that plays well on this grid board (an aura or flip ability instead of a once-per-turn activation, a simpler or more local version, a closer translation that needs one new op). It must differ in play from option 1, not just in numbers.
- One option when the card has no effect (a Normal monster): the stats, with short flavour text or none.
Prefer existing ops: a card made of them plays the moment it is accepted. Invent a new op only when the effect truly cannot be expressed, and then write new_behaviour as a precise spec for the developer, and say in summary that it does nothing until implemented.
In this game there is no extra deck, no chains, no Synchro/Xyz/Link/Pendulum summoning and no tributes for high levels: a monster of any summon type is summoned by paying its level in summoning stars. Drop material lines and summon conditions.

EACH CARD'S JSON
- name exactly the original name.
- Monsters: kind "monster"; level the original level (an Xyz's Rank; a Link monster gets twice its Link rating, at most 12, and say so in note).
  type: one of the catalog's monster types; map the original (Winged Beast -> winged-beast, Sea Serpent -> sea-serpent, Beast-Warrior -> beast-warrior). If the original type is not in the catalog (Psychic, Wyrm, Cyberse...), pick the closest one and mention it in note.
  attribute: lowercase, one of the catalog's attributes. atk / def: the originals; if one is "?" (or a Link has no DEF), choose a fitting value and say so in note.
- Spells and traps: one effect object (traps need trigger and range); a Ritual Spell is kind "ritual" with summon and tributes, and its monster must already be in the catalog (search for it).
- A card that affects only itself names itself with "nums": [the next free card number] (the reference gives it); it is renumbered if saved under another number.
- text: the rules text as the card works HERE, accurate to its effect JSON.
- deckCost: compare with similar catalog cards (search_cards); stronger cards cost more.
- Never set num, image, mask, frame, template, fusion or leader: they are set on acceptance or worked out by the server.

WORKING STYLE
Look at existing cards that use an op before using it (search_cards with op), run check_card while you work, then call suggest_options. Keep titles to a few words and summaries to one or two sentences.`

const synchroBrief = `THE CARD YOU GET
A Synchro Monster from the card database, described in text. It becomes an ordinary monster in the deck (kind "monster"), summoned by paying its level in stars, which already makes high-level monsters slow to bring out. Drop the material line ("1 Tuner + 1 or more non-Tuner monsters"). Its effect is what needs translating, if it has one.`

const uploadBrief = `THE CARD YOU GET
An image of a real card that the administrator wants in the game: it can be any monster, spell or trap. First read it carefully: name, card type, monster type, attribute, stars, ATK/DEF and the whole text box, word for word. Report exactly what is printed in card_read (that is shown next to your options), then adapt it. Every option keeps the card's kind (card_read.kind). If something on the image is unreadable, give your best reading and say so in note.`
