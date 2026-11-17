package engine

import (
	"fmt"
	"slices"
	"strings"
)

// EffectOps is every effect op the engine carries out, with the kind of card
// that uses it. A card whose op is not here does nothing when played. Adding
// a behaviour means handling it in effects.go and listing it here (a test
// checks the two agree).
var EffectOps = map[string]string{
	// Spells.
	"equip": KindSpell, "revive": KindSpell, "control": KindSpell, "controlStrongest": KindSpell,
	"heal": KindSpell, "healTo": KindSpell, "burn": KindSpell, "burnPerEnemy": KindSpell, "draw": KindSpell,
	"destroyAll": KindSpell, "destroyCross": KindSpell, "destroySpells": KindSpell, "destroySpellsCross": KindSpell,
	"destroyType": KindSpell, "destroyWeakest": KindSpell,
	"spellbindType": KindSpell, "spellbindExcept": KindSpell, "spellbindStrongest": KindSpell,
	"swords": KindSpell, "revealEnemy": KindSpell, "hideAll": KindSpell, "stopDefense": KindSpell,
	"boost": KindSpell, "boostOwnDef": KindSpell, "swapStats": KindSpell, "cleanse": KindSpell, "halveLP": KindSpell,
	"terrain": KindSpell, "terrainHere": KindSpell, "drainStars": KindSpell, "extraPlay": KindSpell,
	"teleportLeader": KindSpell, "shift": KindSpell, "recall": KindSpell,
	"reviveCard": KindSpell, "magicLabyrinth": KindSpell, "peekHand": KindSpell, "spyTypes": KindSpell,
	"meteor": KindSpell, "earthshaker": KindSpell, "creatureSwap": KindSpell, "convert": KindSpell,
	// Power-ups used by merging them into a monster: Insect Imitation, and
	// spells that only work through a fusion recipe (Metalmorph...).
	"imitation": KindSpell, "morph": KindSpell,
	// Rituals.
	"ritual": KindRitual,
	// Traps.
	"trapBind": KindTrap, "trapDestroy": KindTrap, "trapRuin": KindTrap,
	"trapNegate": KindTrap, "trapMirrorForce": KindTrap, "trapWeaken": KindTrap,
	"trapJam": KindTrap, "trapShield": KindTrap, "trapReflect": KindTrap, "trapBackfire": KindTrap,
	"trapReverse": KindTrap, "trapDecree": KindTrap, "trapForceAttack": KindTrap, "trapGorgon": KindTrap,
	// Monsters: passive abilities, working while the monster is face up.
	"halveDamage": KindMonster, "breakLabyrinth": KindMonster, "battleBonus": KindMonster,
	// Monsters: abilities that go off when the monster is turned face up.
	"flipBoostMachines": KindMonster,
	// Monsters: abilities that go off when the monster is destroyed in battle.
	"blastOnDestroy": KindMonster,
}

// LeaderOps is every deck leader ability the engine carries out.
var LeaderOps = []string{"assembleLimbs"}

var (
	cardKinds    = []string{KindMonster, KindSpell, KindTrap, KindRitual}
	trapTriggers = []string{"move", "attack", "spell", "heal", "powerUp", "defense", "trap"}
	trapRanges   = []string{"", "limited", "full"}
)

// CheckCard says what makes a card unplayable (problems) and what is
// suspicious but allowed (warnings), such as an op the engine does not carry
// out yet, so a card can be designed before its behaviour is written.
func CheckCard(d *CardDef) (problems, warnings []string) {
	bad := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	warn := func(format string, args ...any) { warnings = append(warnings, fmt.Sprintf(format, args...)) }

	if d.Num < 0 {
		bad("num must be 0 or more")
	}
	if n := len([]rune(strings.TrimSpace(d.Name))); n == 0 || n > 60 {
		bad("name must be 1 to 60 characters")
	}
	if !slices.Contains(cardKinds, d.Kind) {
		bad("kind must be one of %s", strings.Join(cardKinds, ", "))
	}
	if d.Atk < 0 || d.Def < 0 || d.Level < 0 || d.DeckCost < 0 {
		bad("atk, def, level and deckCost cannot be negative")
	}
	if d.IsMonster() {
		if d.Level < 1 || d.Level > 12 {
			bad("a monster's level is 1 to 12")
		}
		if d.Type == "" || d.Attribute == "" {
			bad("a monster needs a type and an attribute")
		}
	}
	if e := d.Effect; e != nil {
		kind, known := EffectOps[e.Op]
		switch {
		case e.Op == "":
			bad("effect.op is empty")
		case !known:
			warn("effect op %q is not carried out by the engine yet: the card will do nothing until it is added to game/engine/effects.go", e.Op)
		case kind != d.Kind && !(kind == KindSpell && d.Kind == KindRitual):
			bad("effect op %q is for a %s, not a %s", e.Op, kind, d.Kind)
		}
		if e.Op == "ritual" {
			if e.Summon == nil {
				bad("a ritual's effect.summon is the number of the monster it summons")
			}
			if n := len(e.Tributes); n < 1 || n > 5 {
				bad("a ritual sacrifices 1 to 5 monsters (effect.tributes)")
			}
			for i, t := range e.Tributes {
				if t.Name == "" && t.Type == "" && t.MaxAtk == 0 && t.MinDef == 0 {
					bad("effect.tributes[%d] needs a name, type, maxAtk or minDef", i)
				}
			}
		}
		if d.Kind == KindTrap {
			if !slices.Contains(trapTriggers, e.Trigger) {
				bad("a trap's effect.trigger is one of %s", strings.Join(trapTriggers, ", "))
			}
			if !slices.Contains(trapRanges, e.Range) {
				bad("effect.range is \"limited\" or \"full\"")
			}
		}
	} else if d.Kind == KindSpell || d.Kind == KindTrap {
		warn("a %s with no effect cannot be played", d.Kind)
	}
	for i, e := range d.Abilities {
		moments, known := AbilityOps[e.Op]
		switch {
		case !d.IsMonster():
			bad("only a monster has abilities")
		case e.Op == "":
			bad("abilities[%d].op is empty", i)
		case !known:
			warn("ability op %q is not carried out by the engine yet", e.Op)
		// "anyDestroy" is "destroyed" without the battle: the same ops work there.
		case !slices.Contains(moments, e.On) && !(e.On == "anyDestroy" && slices.Contains(moments, "destroyed")):
			bad("ability %q works %s, not on %q", e.Op, strings.Join(moments, " or "), e.On)
		}
	}
	if l := d.Leader; l != nil {
		if !d.IsMonster() {
			bad("only a monster can have a leader ability")
		}
		if !slices.Contains(LeaderOps, l.Op) {
			bad("leader.op must be one of %s", strings.Join(LeaderOps, ", "))
		}
	}
	return problems, warnings
}
