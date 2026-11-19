package content

import (
	"os"
	"path/filepath"
	"testing"
)

// A single-file track picks up its loop points from X.loop.json; a broken
// sidecar is ignored rather than breaking the list.
func TestMusicLoopPoints(t *testing.T) {
	assets := t.TempDir()
	audio := filepath.Join(assets, "audio")
	if err := os.MkdirAll(audio, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"VS_One.mp3":          "",
		"VS_One.loop.json":    `{"loopStart": 15.309, "loopEnd": 74.069}`,
		"VS_Two.mp3":          "",
		"VS_Two.loop.json":    `{"loopStart": 9, "loopEnd": 3}`,
		"VS_Pair_Starter.mp3": "",
		"VS_Pair_Loop.mp3":    "",
	} {
		if err := os.WriteFile(filepath.Join(audio, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	s := &Service{assetDir: assets}
	got := map[string]Track{}
	for _, track := range s.Music() {
		got[track.Name] = track
	}
	if len(got) != 3 {
		t.Fatalf("tracks %+v", got)
	}
	if one := got["VS_One"]; one.LoopStart != 15.309 || one.LoopEnd != 74.069 || one.Loop != "audio/VS_One.mp3" {
		t.Errorf("VS_One: %+v", one)
	}
	if two := got["VS_Two"]; two.LoopStart != 0 || two.LoopEnd != 0 {
		t.Errorf("a backwards loop was kept: %+v", two)
	}
	if pair := got["VS_Pair"]; pair.Intro != "audio/VS_Pair_Starter.mp3" || pair.Loop != "audio/VS_Pair_Loop.mp3" {
		t.Errorf("the starter/loop pair: %+v", pair)
	}
}
