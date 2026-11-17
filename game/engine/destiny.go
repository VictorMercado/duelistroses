package engine

import "math/rand"

// Destiny Draw: a duelist in trouble may draw a powerful card that is not in
// their deck. How likely it is grows with how badly the duel is going and
// with the deck leader's rank; which card it is depends on what would help
// most right now (Dian Keto on low LP, Raigeki against a crowded field,
// Arsenal Bug under an Insect leader...).
//
// Only a duelist down to half their starting LP or less can get one, and at
// most destinyMaxPerDuel in a duel: being outnumbered or ranked up raises the
// odds then, but never gives a healthy duelist a Destiny Draw.
//
// Rank is earned during the duel: every RankEvery enemy monsters a seat
// destroys moves its leader up one rank, to MaxRank. A higher rank makes a
// Destiny Draw more likely once the duelist is low on LP.

const (
	MaxRank   = 10
	RankEvery = 2 // enemy monsters destroyed per rank

	// A seat gets at most one Destiny Draw in this many of its own turns.
	destinyCooldown = 3
	// And at most this many in a whole duel.
	destinyMaxPerDuel = 2
	// destinyScale tunes how often Destiny Draw happens overall: every chance
	// below is multiplied by it (0.5 halved them when it came up too often).
	destinyScale   = 0.5
	destinyMaxOdds = 0.6 * destinyScale
)

// rankUp moves a seat's leader up a rank when its kills have earned one.
func (g *Game) rankUp(s *Seat) {
	rank := min(1+s.Stats.MonstersDestroyed/RankEvery, MaxRank)
	if rank <= s.Rank {
		return
	}
	s.Rank = rank
	g.emit(Event{Type: "rankUp", Seat: s.Index, Amount: rank, X: s.Leader.X, Y: s.Leader.Y})
}

// trouble is how badly the duel is going for a seat, from 0 (fine) upward.
func (g *Game) trouble(s *Seat) float64 {
	t := 0.0
	start := max(g.Cfg.StartLP, 1)
	switch {
	case s.LP <= 1000 || s.LP*4 <= start:
		t += 0.35
	case s.LP*2 <= start:
		t += 0.15
	}

	// Outnumbered on the field.
	ours, theirs := 0, 0
	for _, c := range g.boardCards() {
		if !c.Def.IsMonster() {
			continue
		}
		if g.sameTeam(c.Owner, s.Index) {
			ours++
		} else {
			theirs++
		}
	}
	switch deficit := theirs - ours; {
	case deficit >= 3:
		t += 0.2
	case deficit >= 1:
		t += 0.08
	}

	// Well behind the healthiest enemy.
	best := 0
	for _, e := range g.enemies(s.Index) {
		best = max(best, e.LP)
	}
	if best-s.LP >= start/2 {
		t += 0.1
	}
	return t
}

// destinyOdds is the chance of a Destiny Draw this turn: none above half
// the starting LP.
func (g *Game) destinyOdds(s *Seat) float64 {
	if s.LP*2 > max(g.Cfg.StartLP, 1) {
		return 0
	}
	rank := float64(max(s.Rank, 1) - 1)
	odds := (g.trouble(s)*(1+0.1*rank) + 0.015*rank) * destinyScale
	return min(odds, destinyMaxOdds)
}

// destinyScore is how much a card would help the seat right now; 0 or less
// means it would not help at all.
func (g *Game) destinyScore(s *Seat, def *CardDef) float64 {
	score := 0.0
	if def.IsMonster() {
		score = float64(def.Atk) / 2000
	}
	if e := def.Effect; e != nil {
		switch e.Op {
		case "healTo":
			if s.LP < e.Amount {
				score += float64(e.Amount-s.LP) / 1000
				if s.LP <= 1000 {
					score += 3 // critically low: the cure comes first
				}
			}
		case "heal":
			score += float64(min(e.Amount, g.Cfg.StartLP-s.LP)) / 1000
		case "destroyCross":
			score += float64(g.bestCross(s))
		case "destroyAll":
			score += float64(g.enemyMonsters(s, nil)-g.teamMonsters(s)) * 0.8
		case "trapMirrorForce":
			score += float64(g.enemyMonsters(s, func(c *Card) bool { return !c.Defense })) * 0.9
		case "swords":
			score += float64(g.enemyMonsters(s, nil)) * 0.6
		case "revive":
			bestAtk := 0
			for _, seat := range g.Seats {
				for _, num := range seat.Graveyard {
					if d := g.Cat.Card(num); d != nil && d.IsMonster() {
						bestAtk = max(bestAtk, d.Atk)
					}
				}
			}
			if !g.monstersFull(s.Index) {
				score += float64(bestAtk) / 1000
			}
		}
	}
	for _, a := range def.Abilities {
		switch a.Op {
		case "boostIfLeader":
			// Arsenal Bug under an Insect leader.
			if s.LeaderDef != nil && contains(a.Types, s.LeaderDef.Type) {
				score += 4
			}
		case "battleBonus":
			// Woodland Sprite against Fiends.
			score += 1.5 * float64(g.enemyMonsters(s, func(c *Card) bool { return contains(a.Types, c.Def.Type) }))
		}
	}
	return score
}

func (g *Game) enemyMonsters(s *Seat, keep func(*Card) bool) int {
	n := 0
	for _, c := range g.boardCards() {
		if c.Def.IsMonster() && !g.sameTeam(c.Owner, s.Index) && (keep == nil || keep(c)) {
			n++
		}
	}
	return n
}

func (g *Game) teamMonsters(s *Seat) int {
	n := 0
	for _, c := range g.boardCards() {
		if c.Def.IsMonster() && g.sameTeam(c.Owner, s.Index) {
			n++
		}
	}
	return n
}

// bestCross is the most enemy monsters, less our own, that one row and
// column through a square would catch (Raigeki).
func (g *Game) bestCross(s *Seat) int {
	best := 0
	for p := range g.Tiles {
		n := 0
		for _, c := range g.boardCards() {
			if !c.Def.IsMonster() || (c.Pos.X != p.X && c.Pos.Y != p.Y) {
				continue
			}
			if g.sameTeam(c.Owner, s.Index) {
				n--
			} else {
				n++
			}
		}
		best = max(best, n)
	}
	return best
}

// pickDestiny chooses the card: most likely the one that helps most, weighted
// by the square of each card's score. 0 when nothing in the pool would help.
func (g *Game) pickDestiny(s *Seat, rng *rand.Rand) int {
	type option struct {
		num    int
		weight float64
	}
	var options []option
	total := 0.0
	for _, num := range g.Cfg.DestinyPool {
		def := g.Cat.Card(num)
		if def == nil || def.Locked {
			continue
		}
		if score := g.destinyScore(s, def); score > 0 {
			options = append(options, option{num, score * score})
			total += score * score
		}
	}
	if len(options) == 0 {
		return 0
	}
	r := rng.Float64() * total
	for _, o := range options {
		if r < o.weight {
			return o.num
		}
		r -= o.weight
	}
	return options[len(options)-1].num
}

// destinyDraw may hand the seat a card from outside its deck. It returns the
// card, or nil when destiny passes the seat by this turn.
func (g *Game) destinyDraw(s *Seat) *Card {
	if len(g.Cfg.DestinyPool) == 0 || s.TurnsTaken < 2 {
		return nil
	}
	if s.LastDestiny > 0 && s.TurnsTaken-s.LastDestiny < destinyCooldown {
		return nil
	}
	if s.Destinies >= destinyMaxPerDuel {
		return nil
	}
	if g.destinyRng.Float64() >= g.destinyOdds(s) {
		return nil
	}
	num := g.pickDestiny(s, g.destinyRng)
	if num == 0 {
		return nil
	}
	c := g.newCard(num, s.Index)
	if c == nil {
		return nil
	}
	s.Hand = append(s.Hand, c)
	s.LastDestiny = s.TurnsTaken
	s.Destinies++
	s.Stats.CardsDrawn++
	// No card number: only the seat's own hand view says what it is.
	g.emit(Event{Type: "destinyDraw", Seat: s.Index, CardID: c.ID, X: s.Leader.X, Y: s.Leader.Y})
	return c
}
