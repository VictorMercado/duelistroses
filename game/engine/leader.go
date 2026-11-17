package engine

// Deck leader powers. A deck names one monster as its leader; a few leaders
// have a passive power, checked by the engine (never activated by a player).

// limbsAssembled is true when the seat's leader wins by assembling its limbs
// (Exodia) and every one of them is on the field under the seat's control,
// face up and not spellbound. The limbs are drawn and played like any card.
func (g *Game) limbsAssembled(s *Seat) bool {
	if s.LeaderDef == nil || s.LeaderDef.Leader == nil || s.LeaderDef.Leader.Op != "assembleLimbs" || len(s.LeaderDef.Leader.Cards) == 0 {
		return false
	}
	// Moisture Creature: an enemy leader's power does not work.
	for _, a := range g.auras("noLeader") {
		if !g.sameTeam(a.src.Owner, s.Index) {
			return false
		}
	}
	for _, num := range s.LeaderDef.Leader.Cards {
		found := false
		for _, c := range g.Board {
			if c.Def.Num == num && c.Owner == s.Index && !c.FaceDown && !g.bound(c) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
