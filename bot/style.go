package bot

// Style is a rule-based bot's temperament: the same reading of the board,
// weighed differently.
type Style string

const (
	// Balanced plays whatever looks best: what stands in for a disconnected
	// human, and what a plain "bot" seat gets.
	Balanced Style = ""
	// Aggressive marches its deck leader forward so its summons land close
	// to the enemy, and throws every monster at the enemy leader.
	Aggressive Style = "aggressive"
	// Builder gathers a field of monsters around its leader, fusing and
	// equipping them, and only marches once the field is big enough.
	Builder Style = "builder"
	// Defensive keeps a wall of monsters around its leader, braces in
	// defense, punishes whatever comes close and wins on LP or by attrition.
	Defensive Style = "defensive"
)

// Styles are the personalities a host can pick, in the order they are offered.
var Styles = []Style{Aggressive, Builder, Defensive}

// ParseStyle reads a seat's bot kind ("aggressive", "builder"...). Anything
// else is the balanced bot.
func ParseStyle(kind string) Style {
	for _, s := range Styles {
		if string(s) == kind {
			return s
		}
	}
	return Balanced
}

// temperament holds the knobs a style turns.
type temperament struct {
	name string
	// advance is worth per square a monster gains toward the enemy leader
	// while the side is marching.
	advance float64
	// leaderPush is what stepping the deck leader toward the enemy is worth
	// (0: the leader only ever steps out of danger). leaderNerve is the share
	// of its LP the leader will stand in reach of to do it.
	leaderPush  float64
	leaderNerve float64
	// trade is what a battle where both monsters fall is worth.
	trade float64
	// lpDamage weighs the LP a won battle takes off the enemy.
	lpDamage float64
	// counter is the penalty for winning a battle onto a square a stronger
	// enemy can then hit: how much the style fears the counterattack.
	counter float64
	// home keeps monsters within this distance of their leader while the side
	// is holding (not marching).
	home int
	// muster is how many monsters the side gathers before it marches; 0
	// means it always marches. ratio is the field strength over the enemy's
	// that also starts the march.
	muster int
	ratio  float64
	// guard is the bonus for striking a monster that can reach our leader.
	guard float64
	// brace turns threatened monsters to defense even when they could step away.
	brace bool
	// boldness is the ATK at which a monster attacks a face-down card.
	boldness int
	// merge is the bonus for fusing and equipping.
	merge float64
	// setCard is the bonus for laying traps and spells.
	setCard float64
}

func temperamentOf(s Style) temperament {
	switch s {
	case Aggressive:
		return temperament{
			name: "Briar Rush", advance: 14, leaderPush: 95, leaderNerve: 0.4,
			trade: 110, lpDamage: 0.2, counter: 15, muster: 0,
			guard: 40, boldness: 1000, merge: 0, setCard: -10,
		}
	case Builder:
		return temperament{
			name: "Rose Gardener", advance: 12, leaderPush: 35, leaderNerve: 0.2,
			trade: 0, lpDamage: 0.1, counter: 70, home: 2, muster: 3, ratio: 1.5,
			guard: 80, boldness: 1700, merge: 25, setCard: 5,
		}
	case Defensive:
		return temperament{
			name: "Thorn Wall", advance: 8, leaderPush: 0, leaderNerve: 0,
			trade: 0, lpDamage: 0.1, counter: 90, home: 2, muster: 4, ratio: 1.8,
			guard: 160, brace: true, boldness: 1900, merge: 15, setCard: 25,
		}
	}
	return temperament{
		name: "Rose Bot", advance: 10, leaderPush: 60, leaderNerve: 0.25,
		trade: 25, lpDamage: 0.1, counter: 50, home: 2, muster: 2, ratio: 1.2,
		guard: 60, boldness: 1200, merge: 0, setCard: 0,
	}
}

// StyleKind is a rule-based seat's kind as the room hands it to the bot
// factory. Only an administrator picks the personality ("aggressive",
// "builder", "defensive" or "balanced"); everyone else, and an administrator
// asking for "random" or nothing, gets one of Styles at random. pick returns
// a number in [0, n).
func StyleKind(requested string, admin bool, pick func(n int) int) string {
	if admin {
		if requested == "balanced" {
			return requested
		}
		if s := ParseStyle(requested); s != Balanced {
			return string(s)
		}
	}
	return string(Styles[pick(len(Styles))])
}
