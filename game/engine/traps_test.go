package engine

import "testing"

func init() {
	cat[35] = &CardDef{Num: 35, Name: "Force", Kind: KindTrap, Effect: &Effect{Op: "trapMirrorForce", Trigger: "attack", Range: "full"}}
	cat[36] = &CardDef{Num: 36, Name: "Mirror Wall", Kind: KindTrap, Effect: &Effect{Op: "trapWeaken", Trigger: "attack", Range: "full", Permanent: true}}
}

// Walking onto an attack trap is an attack on it: the trap answers it.
func TestSteppingOntoAttackTraps(t *testing.T) {
	// Negate Attack: the walker stays where it was, face up, and the trap is used up.
	g := duel(t)
	trap := put(g, 32, 1, 0, 2, true)
	att := put(g, 3, 0, 0, 1, true)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 2})
	if att.Pos != (Pos{0, 1}) || !att.OnBoard || att.FaceDown || !att.Acted {
		t.Fatalf("the walker should be stopped face up where it was: at %v, face down %v", att.Pos, att.FaceDown)
	}
	if trap.OnBoard {
		t.Fatal("Negate Attack is used up")
	}

	// Mirror Force: the attacking player's face-up attackers go, the rest stay.
	g = duel(t)
	put(g, 35, 1, 0, 2, true)
	att = put(g, 3, 0, 0, 1, true) // face down: flipped up by attacking
	upAttack := put(g, 1, 0, 2, 0, false)
	downAttack := put(g, 1, 0, -2, 0, true)
	defending := put(g, 2, 0, 1, -1, false)
	defending.Defense = true
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 2})
	if att.OnBoard || upAttack.OnBoard {
		t.Fatal("Mirror Force destroys the attacker and its face-up attackers")
	}
	if !downAttack.OnBoard || !defending.OnBoard {
		t.Fatal("Mirror Force spares face-down and defending monsters")
	}

	// Mirror Wall: the walker is halved, then tramples the wall and moves on.
	g = duel(t)
	wall := put(g, 36, 1, 0, 2, true)
	att = put(g, 3, 0, 0, 1, false)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 2})
	if g.here(att) != 1500 || att.Pos != (Pos{0, 2}) || wall.OnBoard {
		t.Fatalf("ATK %d at %v, wall on board %v", g.here(att), att.Pos, wall.OnBoard)
	}
}

// Mirror Wall stays face up and halves every attacker after it went off.
func TestPermanentMirrorWall(t *testing.T) {
	g := duel(t)
	wall := put(g, 36, 1, 3, 3, true)
	first := put(g, 3, 0, 0, 2, false)
	second := put(g, 2, 0, -1, 3, false)
	must(t, g, 0, Action{Type: ActMove, CardID: first.ID, X: 0, Y: 3})
	if !wall.OnBoard || wall.FaceDown || g.Seats[1].LP != 4000-1500 {
		t.Fatalf("wall on board %v face down %v, LP %d", wall.OnBoard, wall.FaceDown, g.Seats[1].LP)
	}
	must(t, g, 0, Action{Type: ActMove, CardID: second.ID, X: 0, Y: 3})
	if !wall.OnBoard || g.Seats[1].LP != 4000-1500-800 {
		t.Fatalf("the wall should halve the second attacker too: LP %d", g.Seats[1].LP)
	}
}

// Attack traps go off in the order they were set until one stops the attack.
func TestAttackTrapsInOrder(t *testing.T) {
	g := duel(t)
	wall := put(g, 36, 1, 3, 3, true)
	negate := put(g, 32, 1, -3, 3, true)
	att := put(g, 3, 0, 0, 2, false)
	must(t, g, 0, Action{Type: ActMove, CardID: att.ID, X: 0, Y: 3})
	if g.Seats[1].LP != 4000 || negate.OnBoard {
		t.Fatalf("Negate Attack should still stop the attack after the wall: LP %d", g.Seats[1].LP)
	}
	if !wall.OnBoard || g.here(att) != 1500 {
		t.Fatalf("the wall went off first: on board %v, ATK %d", wall.OnBoard, g.here(att))
	}
}
