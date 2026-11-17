package bot

import (
	"context"

	"duelistRoses/game/engine"
)

// Heuristic is a rule-of-thumb player: it scores every legal action and plays
// the best one, ending its turn when nothing is worth doing. It needs no
// network, so it is also what an LLM bot falls back to, and what plays for a
// human who has disconnected. Its Style sets its personality; the zero value
// is the balanced bot.
type Heuristic struct {
	Style Style
}

func (h Heuristic) Name() string { return temperamentOf(h.Style).name }

func (h Heuristic) Choose(_ context.Context, o Observation) Decision {
	b := read(o)
	p := h.plan(b)
	best, bestScore := -1, 0.0
	for i, a := range o.Legal {
		score := p.score(b, a)
		if a.Type == engine.ActEndTurn && best == -1 {
			best = i // the fallback when nothing scores above zero
			continue
		}
		if score > bestScore {
			best, bestScore = i, score
		}
	}
	if best == -1 {
		best = 0
	}
	return Decision{Index: best}
}

// plan is the bot's reading of the whole board for this decision: how strong
// each side is, and whether its personality says to march or hold.
type plan struct {
	t      temperament
	leader engine.Pos
	// marching: monsters head for the enemy leader. Otherwise they hold near
	// their own, screening it.
	marching bool
	// Our monsters on the field and their total ATK; the enemy's visible
	// monsters (face-down cards count as a guess).
	mine, theirs        int
	myPower, theirPower int
	// restless grows while the duel is stalled (see restlessness): the bot
	// marches, takes risks it would normally refuse, and stops ending its
	// turn with nothing done. 0 is normal play.
	restless int
}

// Standoffs: after stallRounds rounds in which nothing was attacked, damaged
// or destroyed, the bot grows restless, one level a round. Each level lets a
// monster walk into reach of an enemy up to riskPerLevel ATK stronger than
// it, and attack face-down cards with riskPerLevel less ATK.
const (
	stallRounds  = 3
	riskPerLevel = 400
)

// restlessness is how far past stallRounds the duel has gone without a fight.
func (b board) restlessness() int {
	alive := 0
	for _, s := range b.o.View.Seats {
		if s.Alive {
			alive++
		}
	}
	if alive == 0 {
		return 0
	}
	return max(0, b.o.View.QuietTurns/alive-stallRounds+1)
}

func (h Heuristic) plan(b board) plan {
	p := plan{t: temperamentOf(h.Style), leader: engine.Pos{X: b.me.LeaderX, Y: b.me.LeaderY}}
	for _, c := range b.cards {
		def := b.def(c.Num)
		switch {
		case !b.enemy(c.Owner):
			if c.Owner == b.o.Seat && def != nil && def.IsMonster() {
				p.mine++
				p.myPower += max(c.Atk, def.Atk+c.AtkMod)
			}
		case c.Hidden:
			p.theirs++
			p.theirPower += hiddenGuess
		case def != nil && def.IsMonster():
			p.theirs++
			p.theirPower += c.Atk
		}
	}

	p.restless = b.restlessness()
	switch {
	case p.restless > 0:
		p.marching = true // a standoff: somebody has to go
	case p.t.muster == 0, p.mine >= p.t.muster:
		p.marching = true
	case p.mine >= 2 && float64(p.myPower) >= p.t.ratio*float64(p.theirPower):
		p.marching = true // the enemy's field is thin: no need to wait
	case b.lateAndBehind():
		p.marching = true // holding would lose on points
	}
	return p
}

// hiddenGuess is what a face-down enemy card is assumed to hit for.
const hiddenGuess = 700

// lateAndBehind is true near the round limit when our team does not lead on
// LP, so a duel decided on points would be lost.
func (b board) lateAndBehind() bool {
	if len(b.o.View.Seats) == 0 || b.o.View.Round < 60 {
		return false
	}
	ours, theirs := 0, 0
	for _, s := range b.o.View.Seats {
		if !s.Alive {
			continue
		}
		if s.Team == b.me.Team {
			ours += s.LP
		} else {
			theirs += s.LP
		}
	}
	return ours <= theirs
}

func (p plan) score(b board, a engine.Action) float64 {
	target := engine.Pos{X: a.X, Y: a.Y}
	switch a.Type {
	case engine.ActChoose:
		return p.choose(b, a)
	case engine.ActSummon:
		return p.summon(b, a, target)
	case engine.ActMove:
		return p.move(b, a, target)
	case engine.ActPosition:
		return p.position(b, a)
	case engine.ActFlip:
		c := b.byID[a.CardID]
		def := b.def(c.Num)
		if def == nil || def.IsMonster() || def.Effect == nil {
			return 0
		}
		return p.spell(b, c, def.Effect)
	case engine.ActLeader:
		return p.leaderStep(b, target)
	}
	return 0
}

func (p plan) choose(b board, a engine.Action) float64 {
	pending := b.o.View.Pending
	if pending == nil || a.Choice >= len(pending.Options) {
		return 1
	}
	option := pending.Options[a.Choice]
	// Restoring LP: whoever on the team is lowest.
	if pending.Kind == "heal" && option.Seat != nil {
		for _, s := range b.o.View.Seats {
			if s.Index == *option.Seat {
				return 1 + 100000/float64(1+s.LP)
			}
		}
	}
	// Reviving or taking control: the strongest option, and never nothing.
	if def := b.optionDef(option.Num); def != nil {
		return 1 + float64(def.Atk)
	}
	return 1
}

// --- summoning --------------------------------------------------------------

func (p plan) summon(b board, a engine.Action, target engine.Pos) float64 {
	def := b.def(b.hand[a.CardIDs[0]])
	if def == nil {
		return 0
	}
	if _, occupied := b.cards[target]; occupied {
		return 90 + p.t.merge // the engine only offers merges that do something
	}
	if !def.IsMonster() {
		switch {
		case def.Kind == engine.KindTrap:
			// A trap is best laid where the enemy will walk: toward them.
			return max(1, 25+p.t.setCard-float64(b.toEnemy(target)))
		case def.Effect != nil && def.Effect.Op == "equip":
			return 4 // better played straight onto a monster
		case def.Effect != nil:
			return max(1, 20+p.t.setCard)
		}
		return 0
	}
	terrain := b.terrain(target)
	if terrain == engine.TerrainCrush && def.Type != "immortal" && def.Atk >= 1500 {
		return 0
	}

	atk := strength(def.Atk, 0, def, terrain)
	guard := strength(def.Def, 0, def, terrain)
	worth := float64(atk)
	switch {
	case p.t.brace:
		worth = float64(max(atk, guard))
	case !p.marching:
		worth = float64(atk+guard) / 2
	}
	score := 40 + worth/100

	if p.marching {
		score -= 2 * float64(b.toEnemy(target))
	} else {
		// Holding: stand between the leader and whatever comes for it.
		score -= float64(b.nearestFoe(target))
	}
	if engine.TerrainBonus(terrain, def.Type) > 0 {
		score += 3
	}
	// Don't put a monster where something stronger can kill it straight away,
	// unless it can take the hit in defense.
	if m := b.menace(target); m > atk && !(p.t.brace && guard >= m) {
		score -= 12
	}
	return max(score, 1)
}

// --- moving -----------------------------------------------------------------

func (p plan) move(b board, a engine.Action, target engine.Pos) float64 {
	c := b.byID[a.CardID]
	def := b.def(c.Num)
	if def == nil {
		return 0
	}
	occupant, occupied := b.cards[target]
	if !def.IsMonster() {
		// A face-up spell (revealed by the enemy) is cast where it lands:
		// weigh it as the spell, from there.
		if castOnMove(def, c) && !occupied {
			at := c
			at.X, at.Y = target.X, target.Y
			return p.spell(b, at, def.Effect)
		}
		if occupied && !b.enemy(occupant.Owner) {
			return 85 + p.t.merge // a power-up reaching its monster, or an ally's
		}
		return 0
	}
	terrain := b.terrain(target)
	power := strength(def.Atk, c.AtkMod, def, terrain)

	for _, s := range b.enemyLeaders() {
		if s.LeaderX == target.X && s.LeaderY == target.Y {
			if power >= s.LP {
				return 5000 // the winning blow
			}
			return 1000 + float64(power)
		}
	}

	if occupied {
		if !b.enemy(occupant.Owner) {
			return 80 + p.t.merge // fusion, with one of ours or an ally's
		}
		return p.attack(b, c, def, occupant, power)
	}

	if terrain == engine.TerrainCrush && def.Type != "immortal" && def.Atk >= 1500 {
		return 0
	}
	from := engine.Pos{X: c.X, Y: c.Y}
	if b.menace(target) > power+p.restless*riskPerLevel {
		return 0 // don't walk into the reach of something that beats us
	}
	score := 0.0
	if p.marching {
		if progress := b.toEnemy(from) - b.toEnemy(target); progress > 0 {
			score = p.t.advance * float64(progress)
			// Within reach of the enemy leader: a direct attack next turn.
			if b.toEnemy(target) <= reachOf(def, terrain) {
				score += 6
			}
		}
	} else {
		// Holding: stay on the leash, and close the gap to whatever is
		// approaching so it meets a monster before it meets the leader.
		home := dist(target, p.leader)
		switch {
		case dist(from, p.leader) > p.t.home && home < dist(from, p.leader):
			score = 4 * float64(dist(from, p.leader)-home) // straying: come back
		case home <= p.t.home:
			if closer := b.threat(from) - b.threat(target); closer > 0 {
				score = 5 * float64(closer)
			}
		}
	}
	if score > 0 && engine.TerrainBonus(terrain, def.Type) > 0 {
		score += 3
	}
	// Out of reach of a monster that would beat us. In a standoff, only from
	// a risk too big to take: otherwise the monster would step forward and
	// straight back again, turn after turn.
	if b.menace(from) > strength(def.Atk, c.AtkMod, def, b.terrain(from))+p.restless*riskPerLevel {
		score = max(score, 50)
	}
	return score
}

// attack scores moving onto an enemy card.
func (p plan) attack(b board, c engine.CardView, def *engine.CardDef, occupant engine.CardView, power int) float64 {
	at := engine.Pos{X: occupant.X, Y: occupant.Y}
	// Whatever threatens our leader is worth more to remove, and a holding
	// side only fights what comes near.
	near := dist(at, p.leader)
	threat := 0.0
	if near <= 3 {
		threat = p.t.guard * float64(4-near) / 3
	}
	if !p.marching && near > p.t.home+2 {
		return 0
	}

	if occupant.Hidden {
		boldness := p.t.boldness - p.restless*riskPerLevel
		switch {
		case power >= boldness+600:
			return 60 + threat/2
		case power >= boldness:
			return 15 + threat/2
		}
		return 0
	}
	theirs := b.def(occupant.Num)
	if theirs == nil || !theirs.IsMonster() {
		return 70 // an exposed spell or trap: free to trample
	}
	guard := occupant.Atk
	if occupant.Defense {
		guard = occupant.Def
	}
	switch {
	case power > guard:
		score := 200 + float64(power-guard)/10 + float64(guard)/100 + threat
		if !occupant.Defense {
			score += p.t.lpDamage * float64(power-guard)
		}
		// The winner stands on the square: will something there beat it?
		if b.menaceExcept(at, occupant.ID) > power {
			score -= p.t.counter
		}
		return score
	case power == guard && !occupant.Defense:
		return p.t.trade + threat
	}
	return 0
}

// --- battle position ---------------------------------------------------------

func (p plan) position(b board, a engine.Action) float64 {
	if !a.Defense {
		return 0
	}
	c := b.byID[a.CardID]
	def := b.def(c.Num)
	if def == nil {
		return 0
	}
	here := engine.Pos{X: c.X, Y: c.Y}
	terrain := b.terrain(here)
	atk := strength(def.Atk, c.AtkMod, def, terrain)
	guard := strength(def.Def, c.DefMod, def, terrain)
	threat := b.menace(here)

	if threat > atk {
		// Cornered by a stronger monster: brace rather than take the hit in attack.
		if !p.t.brace && b.canEscape(c, def) {
			return 0
		}
		if guard >= threat {
			return 160 // the wall holds and the attacker pays for trying
		}
		if b.canEscape(c, def) {
			return 0
		}
		return 120 // the monster falls either way, but the leader keeps its LP
	}
	// A wall beside the leader, with enemies about, digs in when it is the
	// sturdier way round.
	if p.t.brace && !p.marching && guard > atk && dist(here, p.leader) <= 1 && b.nearestFoe(here) <= 3 {
		return 25
	}
	return 0
}

// --- the deck leader --------------------------------------------------------

func (p plan) leaderStep(b board, target engine.Pos) float64 {
	here := p.leader
	lp := b.me.LP
	dangerHere, dangerThere := b.leaderDanger(here), b.leaderDanger(target)
	_, eats := b.cards[target]

	if dangerThere >= lp && dangerThere >= dangerHere {
		return 0 // never step into a killing blow
	}
	// Getting out of reach. Eating one of our own cards to get there costs
	// the card: only when staying would be deadly or the danger is next door.
	if dangerThere < dangerHere {
		if eats && dangerHere < lp && b.threat(here) > 1 {
			return 0
		}
		score := 30 + float64(dangerHere-dangerThere)/100
		if dangerHere >= lp {
			score += 300
		}
		if eats {
			score -= 20
		}
		return score
	}
	if eats || dangerThere > dangerHere {
		return 0
	}

	// Taking the summoning ground forward. The leader stops short of the
	// enemy leader's own ring, where its monsters appear.
	if (p.t.leaderPush > 0 || p.restless > 0) && p.marching && b.me.PlaysLeft > 0 && len(b.o.View.Hand) > 0 {
		progress := b.toEnemy(here) - b.toEnemy(target)
		nerve := min(0.8, p.t.leaderNerve+0.1*float64(p.restless))
		push := max(p.t.leaderPush, 20*float64(p.restless))
		if progress > 0 && b.toEnemy(target) >= 3 && float64(dangerThere) <= nerve*float64(lp) {
			return push
		}
	}
	return 0
}

// leaderDanger is how much ATK could hit a leader standing on p next turn:
// every visible enemy monster within its reach, and a guess for face-down
// cards right next to it.
func (b board) leaderDanger(p engine.Pos) int {
	total := 0
	for pos, c := range b.cards {
		if !b.enemy(c.Owner) || c.Spellbound != 0 {
			continue
		}
		if c.Hidden {
			if dist(pos, p) <= 1 {
				total += hiddenGuess
			}
			continue
		}
		def := b.def(c.Num)
		if def == nil || !def.IsMonster() {
			continue
		}
		if dist(pos, p) <= reachOf(def, b.terrain(pos)) {
			total += c.Atk
		}
	}
	return total
}

// --- reading the board -------------------------------------------------------

// reachOf is how far a monster moves: two squares on terrain it favours.
func reachOf(def *engine.CardDef, terrain string) int {
	if def.Bonus(terrain) > 0 {
		return 2
	}
	return 1
}

// threat is the distance from p to the nearest enemy card.
func (b board) threat(p engine.Pos) int {
	best := 99
	for pos, c := range b.cards {
		if b.enemy(c.Owner) {
			if d := dist(p, pos); d < best {
				best = d
			}
		}
	}
	return best
}

// nearestFoe is the distance from p to the nearest enemy card or leader.
func (b board) nearestFoe(p engine.Pos) int {
	return min(b.threat(p), b.toEnemy(p))
}

// strength is a monster stat with its modifier, fighting on a terrain.
func strength(base, mod int, def *engine.CardDef, terrain string) int {
	if v := base + mod + def.Bonus(terrain); v > 0 {
		return v
	}
	return 0
}

// menace is the attack of the strongest visible enemy monster that could hit
// p on its next turn, counted on p's terrain where the battle would happen.
// Face-down enemies are unknown and ignored.
func (b board) menace(p engine.Pos) int { return b.menaceExcept(p, -1) }

// menaceExcept is menace leaving one card out (one about to be destroyed).
func (b board) menaceExcept(p engine.Pos, skip int) int {
	worst := 0
	for pos, c := range b.cards {
		if c.ID == skip || !b.enemy(c.Owner) || c.Hidden || c.Spellbound != 0 {
			continue
		}
		def := b.def(c.Num)
		if def == nil || !def.IsMonster() {
			continue
		}
		if dist(pos, p) > reachOf(def, b.terrain(pos)) {
			continue
		}
		if atk := strength(def.Atk, c.AtkMod, def, b.terrain(p)); atk > worst {
			worst = atk
		}
	}
	return worst
}

// canEscape is true when the card has a legal step to an empty square that
// no stronger enemy can reach.
func (b board) canEscape(c engine.CardView, def *engine.CardDef) bool {
	for _, a := range b.o.Legal {
		if a.Type != engine.ActMove || a.CardID != c.ID {
			continue
		}
		p := engine.Pos{X: a.X, Y: a.Y}
		if _, occupied := b.cards[p]; occupied || b.leaderAt(p) {
			continue
		}
		if b.menace(p) <= strength(def.Atk, c.AtkMod, def, b.terrain(p)) {
			return true
		}
	}
	return false
}

func (b board) leaderAt(p engine.Pos) bool {
	for _, s := range b.o.View.Seats {
		if s.Alive && s.LeaderX == p.X && s.LeaderY == p.Y {
			return true
		}
	}
	return false
}

// --- spells -----------------------------------------------------------------

// spell scores activating one of our own face-down spells.
func (p plan) spell(b board, spell engine.CardView, e *engine.Effect) float64 {
	mine, theirs := 0, 0        // cards
	myLine, theirLine := 0, 0   // cards in the spell's row or column
	myMatch, theirMatch := 0, 0 // visible monsters the effect's filter selects
	myBound := 0
	for pos, c := range b.cards {
		if c.ID == spell.ID {
			continue
		}
		foe := b.enemy(c.Owner)
		inLine := pos.X == spell.X || pos.Y == spell.Y
		def := b.def(c.Num)
		selected := def != nil && def.IsMonster() &&
			(len(e.Types) == 0 || has(e.Types, def.Type)) && (len(e.Attrs) == 0 || has(e.Attrs, def.Attribute))
		switch {
		case foe:
			theirs++
			if inLine {
				theirLine++
			}
			if selected {
				theirMatch++
			}
		default:
			mine++
			if inLine {
				myLine++
			}
			if selected {
				myMatch++
			}
			if c.Spellbound != 0 {
				myBound++
			}
		}
	}

	// A careful player heals earlier.
	healAt := 0
	if p.t.brace {
		healAt = 1000
	}
	switch e.Op {
	case "ritual":
		// Only offered when the sacrifices are there: three monsters for a big one.
		return 120
	case "burn", "halveLP":
		return 150
	case "burnPerEnemy":
		return float64(40 * theirs)
	case "draw":
		return 130
	case "heal":
		if b.me.LP <= 4000-e.Amount/2+healAt {
			return 120
		}
	case "healTo":
		if b.me.LP <= 2500+healAt {
			return 120
		}
	case "destroyAll":
		if theirs >= mine+2 {
			return 140
		}
	case "destroyCross":
		if theirLine > myLine {
			return 100 + float64(20*(theirLine-myLine))
		}
	case "destroyType", "spellbindType":
		if theirMatch > myMatch {
			return 100
		}
	case "destroyWeakest", "spellbindStrongest", "spellbindExcept":
		if theirs > mine {
			return 50
		}
	case "swords":
		if theirs >= 2 || (p.t.brace && theirs >= 1) {
			return 120
		}
	case "revive", "control", "controlStrongest":
		return 135
	case "boost":
		if myMatch > theirMatch {
			return 60
		}
	case "boostOwnDef":
		if mine >= 2 || (p.t.brace && mine >= 1) {
			return 30
		}
	case "cleanse":
		if myBound > 0 {
			return 80
		}
	case "drainStars":
		return 70
	case "extraPlay":
		if len(b.o.View.Hand) > 0 {
			return 45
		}
	}
	return 0
}

func has(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}

// castOnMove is a face-up spell that moving casts (see engine actMove);
// power-ups are used by moving them onto a monster instead.
func castOnMove(def *engine.CardDef, c engine.CardView) bool {
	if c.FaceDown || def.Kind != engine.KindSpell || def.Effect == nil {
		return false
	}
	switch def.Effect.Op {
	case "equip", "imitation", "morph":
		return false
	}
	return true
}
