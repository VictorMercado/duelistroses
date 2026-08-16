package game

import "math"

type Vector3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// Distance returns the Euclidean distance to another Vector3
func (v *Vector3) Distance(other Vector3) float64 {
	dx := v.X - other.X
	dy := v.Y - other.Y
	dz := v.Z - other.Z
	return math.Sqrt(dx*dx + dy*dy + dz*dz)
}

// IsAdjacent checks if another vector is exactly 1 unit away on the X or Y axis,
// and 0 units away on the other axis (ignoring Z for 2D adjacency).
func (v *Vector3) IsAdjacent(other Vector3) bool {
	dx := math.Abs(v.X - other.X)
	dy := math.Abs(v.Y - other.Y)

	// Has to be exactly 1 move horizontally or vertically, not diagonal
	return (dx == 1 && dy == 0) || (dx == 0 && dy == 1)
}
