package engine

import (
	"strings"
	"testing"
)

func init() {
	cat[40] = &CardDef{Num: 40, Name: "Overlord", Kind: KindMonster, Type: "dragon", Attribute: "dark", Level: 9, Atk: 3500, Def: 3000}
	cat[41] = &CardDef{Num: 41, Name: "Overlord Rite", Kind: KindRitual, Effect: &Effect{
		Op: "ritual", Summon: cardNum(40),
		Tributes: []Tribute{{Name: "Drake"}, {Type: "warrior"}, {MaxAtk: 1500}},
	}}
	cat[42] = &CardDef{Num: 42, Name: "Champion", Kind: KindMonster, Type: "warrior", Attribute: "light", Level: 6, Atk: 2500, Def: 2000}
}

func TestRitualSacrificesTheWeakestMatchingMonsters(t *testing.T) {
	g := duel(t)
	drake := put(g, 2, 0, -1, -1, false)
	gruntA := put(g, 1, 0, 0, -1, true) // face down: still the owner's to sacrifice
	gruntB := put(g, 1, 0, 1, -1, false)
	champion := put(g, 42, 0, 2, -1, false) // a warrior too, but the costlier one
	titan := put(g, 3, 0, -2, -1, false)    // matches nothing
	enemy := put(g, 1, 1, 0, 2, false)      // the opponent's: never sacrificed
	rite := put(g, 41, 0, 1, -2, true)

	must(t, g, 0, Action{Type: ActFlip, CardID: rite.ID})

	summoned := g.Board[Pos{1, -2}]
	if summoned == nil || summoned.Def.Num != 40 || summoned.FaceDown || summoned.Owner != 0 {
		t.Fatalf("the ritual monster should stand where the ritual was: %+v", summoned)
	}
	for _, c := range []*Card{drake, gruntA, gruntB} {
		if c.OnBoard {
			t.Errorf("%s was not sacrificed", c.Def.Name)
		}
	}
	for _, c := range []*Card{champion, titan, enemy} {
		if !c.OnBoard {
			t.Errorf("%s should not have been sacrificed", c.Def.Name)
		}
	}
	if rite.OnBoard {
		t.Error("the ritual card stays on the field")
	}
	// Three sacrifices and the ritual card itself go to the graveyard.
	if n := len(g.Seats[0].Graveyard); n != 4 {
		t.Errorf("graveyard has %d cards, want 4", n)
	}
	s := g.Seats[0].Stats
	if s.Rituals != 1 || s.Summons != 1 || s.SpellsCast != 1 || s.CardsLost != 0 {
		t.Errorf("stats %+v: sacrifices are not losses", s)
	}
}

func TestRitualRefusedWithoutItsSacrifices(t *testing.T) {
	g := duel(t)
	put(g, 2, 0, -1, -1, false) // Drake
	put(g, 1, 0, 0, -1, false)  // one Grunt: the third requirement is missing
	put(g, 1, 1, 0, 2, false)   // the opponent's monster does not count
	rite := put(g, 41, 0, 1, -2, true)

	err := g.Apply(0, Action{Type: ActFlip, CardID: rite.ID})
	if err == nil || !strings.Contains(err.Error(), "Overlord") || !strings.Contains(err.Error(), "Drake") {
		t.Fatalf("refusal should say what the ritual needs: %v", err)
	}
	if !rite.OnBoard || !rite.FaceDown || len(g.Seats[0].Graveyard) != 0 {
		t.Fatal("a refused ritual changes nothing")
	}
	for _, a := range g.LegalActions(0) {
		if a.Type == ActFlip && a.CardID == rite.ID {
			t.Fatal("a ritual that cannot be performed is not offered to bots")
		}
	}
}

func TestCheckCardValidatesRituals(t *testing.T) {
	bad := &CardDef{Num: 99, Name: "Broken Rite", Kind: KindRitual, Effect: &Effect{Op: "ritual", Tributes: []Tribute{{}}}}
	problems, _ := CheckCard(bad)
	if len(problems) < 2 {
		t.Fatalf("missing summon and an empty requirement should both be problems: %v", problems)
	}
	if problems, warnings := CheckCard(cat[41]); len(problems)+len(warnings) != 0 {
		t.Fatalf("a valid ritual: %v %v", problems, warnings)
	}
}
