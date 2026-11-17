package game

import (
	"math/rand"

	"duelistRoses/game/engine"
)

// Terrain mix for generated maps: mostly open ground, a spread of the terrains
// that favour monster types, and a little that blocks or destroys.
var terrainWeights = []struct {
	terrain string
	weight  int
}{
	{engine.TerrainNormal, 34},
	{engine.TerrainSogen, 9}, {engine.TerrainForest, 9}, {engine.TerrainWasteland, 9},
	{engine.TerrainMountain, 9}, {engine.TerrainUmi, 9}, {engine.TerrainYami, 9},
	{engine.TerrainToon, 3}, {engine.TerrainCrush, 4}, {engine.TerrainLabyrinth, 5},
}

func pickTerrain(rng *rand.Rand) string {
	total := 0
	for _, w := range terrainWeights {
		total += w.weight
	}
	n := rng.Intn(total)
	for _, w := range terrainWeights {
		if n < w.weight {
			return w.terrain
		}
		n -= w.weight
	}
	return engine.TerrainNormal
}

// GenerateTiles makes a random map that is fair: it looks the same from every
// seat (mirrored through the centre for two players, turned a quarter for
// four), and the squares around each leader's start are open ground so nobody
// begins boxed in.
func GenerateTiles(size, seats int, seed int64) map[engine.Pos]string {
	rng := rand.New(rand.NewSource(seed))
	half := size / 2
	tiles := map[engine.Pos]string{}

	for x := -half; x <= half; x++ {
		for y := -half; y <= half; y++ {
			p := engine.Pos{X: x, Y: y}
			if _, done := tiles[p]; done {
				continue
			}
			t := pickTerrain(rng)
			tiles[p] = t
			tiles[engine.Pos{X: -x, Y: -y}] = t
			if seats > 2 {
				tiles[engine.Pos{X: -y, Y: x}] = t
				tiles[engine.Pos{X: y, Y: -x}] = t
			}
		}
	}

	starts := []engine.Pos{{X: 0, Y: -half}, {X: 0, Y: half}}
	if seats > 2 {
		starts = append(starts, engine.Pos{X: half, Y: 0}, engine.Pos{X: -half, Y: 0})
	}
	for _, start := range starts {
		for p, t := range tiles {
			if p.Ring(start) <= 1 && (t == engine.TerrainLabyrinth || t == engine.TerrainCrush) {
				tiles[p] = engine.TerrainNormal
			}
		}
	}
	return tiles
}
