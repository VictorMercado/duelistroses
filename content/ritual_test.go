package content

import (
	"encoding/json"
	"os"
	"testing"

	"duelistRoses/db"
	"duelistRoses/game/engine"
)

// Every ritual card has a recipe the engine can carry out: a monster to
// summon, and sacrifices that name real monsters.
func TestEveryRitualHasARecipe(t *testing.T) {
	catalog, _, err := embeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	var rituals []*engine.CardDef
	for num := 0; num < 2000; num++ {
		def := catalog.Card(num)
		if def == nil {
			continue
		}
		if def.IsMonster() {
			names[def.Name] = true
		}
		if def.Kind == engine.KindRitual {
			rituals = append(rituals, def)
		}
	}
	if len(rituals) != 25 {
		t.Fatalf("%d ritual cards, want 25", len(rituals))
	}
	for _, def := range rituals {
		if problems, warnings := engine.CheckCard(def); len(problems)+len(warnings) > 0 {
			t.Errorf("%s: %v %v", def.Name, problems, warnings)
			continue
		}
		e := def.Effect
		if summoned := catalog.Card(*e.Summon); summoned == nil || !summoned.IsMonster() {
			t.Errorf("%s summons card %d, which is not a monster", def.Name, *e.Summon)
		}
		if len(e.Tributes) != 3 {
			t.Errorf("%s sacrifices %d monsters, want 3", def.Name, len(e.Tributes))
		}
		for _, tribute := range e.Tributes {
			if tribute.Name != "" && !names[tribute.Name] {
				t.Errorf("%s sacrifices %q, which is no monster", def.Name, tribute.Name)
			}
		}
	}
}

// A database seeded before rituals had recipes gets them from the migration,
// except a ritual someone already gave an effect.
func TestRitualMigrationUpgradesAnOlderCatalog(t *testing.T) {
	database := db.OpenTemp(t)
	if err := seedCatalog(database); err != nil {
		t.Fatal(err)
	}
	// Back to how the catalog was: rituals with no effect, unplayable.
	if _, err := database.Exec(`UPDATE cards SET data = json_set(json_remove(data, '$.effect'), '$.implemented', json('false')) WHERE json_extract(data, '$.kind') = 'ritual'`); err != nil {
		t.Fatal(err)
	}
	// One ritual an administrator had already edited.
	if _, err := database.Exec(`UPDATE cards SET data = json_set(data, '$.effect', json('{"op":"ritual","summon":2,"tributes":[{"type":"dragon"}]}')) WHERE num = 837`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../db/migrations/0004_ritual_recipes.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}

	rows, err := readCatalog(database)
	if err != nil {
		t.Fatal(err)
	}
	snap, err := rows.build()
	if err != nil {
		t.Fatal(err)
	}
	var card struct {
		Implemented bool
		Effect      engine.Effect
	}
	json.Unmarshal([]byte(rows.cards[853]), &card)
	if !card.Implemented || card.Effect.Op != "ritual" || *card.Effect.Summon != 78 || len(card.Effect.Tributes) != 3 {
		t.Fatalf("Dark Magic Ritual after the migration: %s", rows.cards[853])
	}
	if e := snap.catalog.Card(837).Effect; len(e.Tributes) != 1 {
		t.Errorf("the migration overwrote an edited ritual: %+v", e)
	}
}
