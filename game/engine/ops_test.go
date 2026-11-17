package engine

import (
	"os"
	"regexp"
	"testing"
)

// EffectOps must list exactly the ops effects.go handles, so card validation
// never refuses a working op nor waves through a missing one.
func TestEffectOpsMatchEffectsGo(t *testing.T) {
	var src []byte
	for _, name := range []string{"effects.go", "abilities.go", "game.go"} {
		b, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		src = append(src, b...)
	}
	listed := func(op string) bool {
		_, spell := EffectOps[op]
		_, ability := AbilityOps[op]
		return spell || ability
	}
	handled := map[string]bool{}
	for _, m := range regexp.MustCompile(`case "([A-Za-z]+)"`).FindAllSubmatch(src, -1) {
		handled[string(m[1])] = true
	}
	// Some ops are recognised by their trigger rather than a case of their own.
	mentioned := map[string]bool{}
	for _, m := range regexp.MustCompile(`"([A-Za-z]+)"`).FindAllSubmatch(src, -1) {
		mentioned[string(m[1])] = true
	}
	for op := range handled {
		if !listed(op) {
			t.Errorf("the engine handles %q but neither EffectOps nor AbilityOps lists it", op)
		}
	}
	for op := range EffectOps {
		if !handled[op] && !mentioned[op] {
			t.Errorf("EffectOps lists %q but the engine never handles it", op)
		}
	}
	for op := range AbilityOps {
		if !handled[op] && !mentioned[op] {
			t.Errorf("AbilityOps lists %q but the engine never handles it", op)
		}
	}
}
