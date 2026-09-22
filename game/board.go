package game

import (
	"math/rand"
)

// Terrain kinds the generator can place. Keep in sync with the client's
// TerrainType union (web/src/types.ts).
const (
	TerrainSogen     TerrainType = "sogen"
	TerrainYami      TerrainType = "yami"
	TerrainLabyrinth TerrainType = "labyrinth"
	TerrainNormal    TerrainType = "normal"
	TerrainUmi       TerrainType = "umi"
	TerrainCrush     TerrainType = "crush"
	TerrainMountain  TerrainType = "mountain"
	TerrainWasteland TerrainType = "wasteland"
	TerrainForest    TerrainType = "forest"
	TerrainToon      TerrainType = "toon"
)

var AllTerrains = []TerrainType{
	TerrainSogen,
	TerrainYami,
	TerrainLabyrinth,
	TerrainNormal,
	TerrainUmi,
	TerrainCrush,
	TerrainMountain,
	TerrainWasteland,
	TerrainForest,
	TerrainToon,
}

// MapTile is one square of the board. The client resolves the texture for the
// terrain locally, so only the coordinates and the kind travel over the wire.
type MapTile struct {
	X       float64     `json:"x"`
	Y       float64     `json:"y"`
	Terrain TerrainType `json:"terrain"`
}

// GameMap is generated once per room and never mutated afterwards, so it can be
// read concurrently without holding the room lock.
type GameMap struct {
	GridSize int       `json:"gridSize"`
	Seed     int64     `json:"seed"`
	Tiles    []MapTile `json:"tiles"`
}

// NewGameMap lays out a gridSize x gridSize board centred on the origin, giving
// each square a random terrain. Coordinates match the card/player grid: for
// gridSize 11 they run from -5 to +5 on both axes.
func NewGameMap(gridSize int) *GameMap {
	seed := rand.Int63()
	rng := rand.New(rand.NewSource(seed))

	tiles := make([]MapTile, 0, gridSize*gridSize)
	half := float64(gridSize) / 2

	for i := 0; i < gridSize; i++ {
		for j := 0; j < gridSize; j++ {
			tiles = append(tiles, MapTile{
				X:       float64(i) - half + 0.5,
				Y:       float64(j) - half + 0.5,
				Terrain: AllTerrains[rng.Intn(len(AllTerrains))],
			})
		}
	}

	return &GameMap{
		GridSize: gridSize,
		Seed:     seed,
		Tiles:    tiles,
	}
}
