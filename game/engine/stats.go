package engine

// Stats is what one seat did over a duel. The engine keeps it as the game is
// played, at the point each thing happens, because that is the only place
// that knows who caused it: a trap's kill belongs to the trap's owner, a
// monster that loses an attack is destroyed by the defender, and so on.
// Events cannot answer that, since they are written for the client to animate.
type Stats struct {
	// Life points: what this seat took from enemies, what enemies took from
	// it, and its largest single blow. Only LP actually lost counts, so
	// overkill on a duelist with 300 LP left counts 300.
	DamageDealt int `json:"damageDealt"`
	DamageTaken int `json:"damageTaken"`
	BiggestHit  int `json:"biggestHit"`
	Healed      int `json:"healed"`

	// Enemy cards this seat destroyed (any kind, monsters among them), and its
	// own cards an enemy destroyed. Cards used up, fused or discarded are not
	// destroyed.
	CardsDestroyed    int `json:"cardsDestroyed"`
	MonstersDestroyed int `json:"monstersDestroyed"`
	CardsLost         int `json:"cardsLost"`

	Summons     int `json:"summons"`
	Fusions     int `json:"fusions"`
	Rituals     int `json:"rituals"`
	Revives     int `json:"revives"`
	Equips      int `json:"equips"`
	SpellsCast  int `json:"spellsCast"`
	TrapsSprung int `json:"trapsSprung"`
	Takeovers   int `json:"takeovers"`
	CardsDrawn  int `json:"cardsDrawn"`

	// Attacks counts every attack that went ahead (one a trap stopped does
	// not); DirectAttacks those on a deck leader. A battle is won when the
	// other side's monster falls and this side's does not.
	Attacks       int `json:"attacks"`
	DirectAttacks int `json:"directAttacks"`
	BattlesWon    int `json:"battlesWon"`
}

// Add folds another duel's stats into a running total.
func (s *Stats) Add(o Stats) {
	s.DamageDealt += o.DamageDealt
	s.DamageTaken += o.DamageTaken
	s.BiggestHit = max(s.BiggestHit, o.BiggestHit)
	s.Healed += o.Healed
	s.CardsDestroyed += o.CardsDestroyed
	s.MonstersDestroyed += o.MonstersDestroyed
	s.CardsLost += o.CardsLost
	s.Summons += o.Summons
	s.Fusions += o.Fusions
	s.Rituals += o.Rituals
	s.Revives += o.Revives
	s.Equips += o.Equips
	s.SpellsCast += o.SpellsCast
	s.TrapsSprung += o.TrapsSprung
	s.Takeovers += o.Takeovers
	s.CardsDrawn += o.CardsDrawn
	s.Attacks += o.Attacks
	s.DirectAttacks += o.DirectAttacks
	s.BattlesWon += o.BattlesWon
}

// Best keeps, for every stat, the higher of the two: a record of the best
// single duel.
func (s *Stats) Best(o Stats) {
	for _, pair := range [][2]*int{
		{&s.DamageDealt, &o.DamageDealt}, {&s.DamageTaken, &o.DamageTaken}, {&s.BiggestHit, &o.BiggestHit},
		{&s.Healed, &o.Healed}, {&s.CardsDestroyed, &o.CardsDestroyed}, {&s.MonstersDestroyed, &o.MonstersDestroyed},
		{&s.CardsLost, &o.CardsLost}, {&s.Summons, &o.Summons}, {&s.Fusions, &o.Fusions}, {&s.Rituals, &o.Rituals}, {&s.Revives, &o.Revives},
		{&s.Equips, &o.Equips}, {&s.SpellsCast, &o.SpellsCast}, {&s.TrapsSprung, &o.TrapsSprung},
		{&s.Takeovers, &o.Takeovers}, {&s.CardsDrawn, &o.CardsDrawn}, {&s.Attacks, &o.Attacks},
		{&s.DirectAttacks, &o.DirectAttacks}, {&s.BattlesWon, &o.BattlesWon},
	} {
		*pair[0] = max(*pair[0], *pair[1])
	}
}

// noOne is the "by" of something nobody gets credit for: a card used up,
// replaced, discarded, or a monster walking onto crush terrain by itself.
const noOne = -1

func (g *Game) stats(seat int) *Stats {
	if s := g.seat(seat); s != nil {
		return &s.Stats
	}
	return nil
}

// creditDamage records lost LP: taken by the victim, dealt by an enemy.
func (g *Game) creditDamage(victim, by, lost int) {
	if st := g.stats(victim); st != nil {
		st.DamageTaken += lost
	}
	if by == noOne || g.sameTeam(by, victim) {
		return
	}
	if st := g.stats(by); st != nil {
		st.DamageDealt += lost
		st.BiggestHit = max(st.BiggestHit, lost)
	}
}

// creditDestroy records a card destroyed by an enemy of whoever controlled it.
func (g *Game) creditDestroy(c *Card, by int) {
	if by == noOne || g.sameTeam(by, c.Owner) {
		return
	}
	if st := g.stats(by); st != nil {
		st.CardsDestroyed++
		if c.Def.IsMonster() {
			st.MonstersDestroyed++
			if s := g.seat(by); s != nil {
				g.rankUp(s)
			}
		}
	}
	// The loss is the deck's it came from, even if someone had borrowed it.
	if st := g.stats(c.Home); st != nil {
		st.CardsLost++
	}
}
