package cardscout

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // the card database's art is JPEG
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/image/draw"

	"duelistRoses/db"
)

// artSize is the side of the square card art, as the rest of the catalog has.
const artSize = 512

// Accept saves option (0-based) of a pending suggestion as a new card, with
// its art at cards/NNN.png, and starts building the art's WebP copies and
// holo mask in the background. It returns the new card's number.
func (s *Scout) Accept(ctx context.Context, id int64, option int, by string) (int, error) {
	s.acceptMu.Lock()
	defer s.acceptMu.Unlock()
	g, err := s.get(id)
	if err != nil {
		return 0, err
	}
	if g.Status != StatusPending {
		return 0, fmt.Errorf("that suggestion is %s, not pending", g.Status)
	}
	if option < 0 || option >= len(g.Options) {
		return 0, errors.New("no such option")
	}
	if s.catalogNames()[strings.ToLower(g.Name)] {
		return 0, fmt.Errorf("%s is already in the catalog", g.Name)
	}

	num := s.Content.NextFreeNum()
	rel := fmt.Sprintf("cards/%03d.png", num)
	artPath := filepath.Join(s.Config.AssetDir, filepath.FromSlash(rel))
	var art image.Image
	if g.Summon == SummonUpload {
		art, err = s.uploadedArt(g)
	} else {
		art, err = s.downloadArt(ctx, g.Source)
	}
	if err == nil {
		err = writePNG(artPath, squareArt(art, artSize))
	}
	if err != nil {
		return 0, fmt.Errorf("the art: %w", err)
	}
	var head struct{ Kind string }
	_ = json.Unmarshal(g.Options[option].Card, &head)

	var card map[string]json.RawMessage
	if err := json.Unmarshal(g.Options[option].Card, &card); err != nil {
		os.Remove(artPath)
		return 0, errors.New("the stored option is unreadable")
	}
	if checked := g.Options[option].CheckedNum; checked != 0 && checked != num {
		for _, field := range []string{"effect", "abilities", "leader"} {
			if v, ok := card[field]; ok {
				card[field] = renumber(v, checked, num)
			}
		}
	}
	card["image"], _ = json.Marshal(rel)
	raw, _ := json.Marshal(card)
	note := fmt.Sprintf("card scout: %s (%s, option %d: %s)", g.Name, g.Summon, option+1, g.Options[option].Title)
	if _, err := s.Content.SaveCard(num, raw, by, note); err != nil {
		os.Remove(artPath)
		return 0, err
	}
	_, err = s.DB.Exec(`UPDATE card_suggestions SET status = 'accepted', chosen = ?, card_num = ?, decided_at = ?, decided_by = ?, assets = 'working', assets_log = '' WHERE id = ?`,
		option, num, db.Time(time.Now()), by, id)
	if err != nil {
		return num, err
	}
	log.Printf("card scout: %s accepted %s as card %d", by, g.Name, num)
	go s.buildAssets(id, num, head.Kind)
	return num, nil
}

// RetryAssets builds an accepted card's WebP copies and mask again.
func (s *Scout) RetryAssets(id int64) error {
	g, err := s.get(id)
	if err != nil {
		return err
	}
	if g.Status != StatusAccepted || g.CardNum == nil {
		return errors.New("only an accepted card has assets")
	}
	if g.Assets == "working" {
		return errors.New("its assets are being built")
	}
	if _, err := s.DB.Exec(`UPDATE card_suggestions SET assets = 'working', assets_log = '' WHERE id = ?`, id); err != nil {
		return err
	}
	kind := "monster"
	if d := s.Content.Catalog().Card(*g.CardNum); d != nil {
		kind = d.Kind
	}
	go s.buildAssets(id, *g.CardNum, kind)
	return nil
}

// downloadArt downloads the card's art from the card database (the cropped
// picture, without the card frame).
func (s *Scout) downloadArt(ctx context.Context, c SourceCard) (image.Image, error) {
	link := c.Cropped
	if link == "" {
		return nil, errors.New("the card database has no art for this card")
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download answered %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return nil, err
	}
	return decodeImage(data)
}

// squareArt crops the centre square of src and scales it to size.
func squareArt(src image.Image, size int) image.Image {
	b := src.Bounds()
	side := min(b.Dx(), b.Dy())
	x0 := b.Min.X + (b.Dx()-side)/2
	y0 := b.Min.Y + (b.Dy()-side)/2
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, image.Rect(x0, y0, x0+side, y0+side), draw.Src, nil)
	return dst
}

// buildAssets runs the asset scripts on a new card's art: the WebP copies
// (build_webp.sh) and the holo mask (build_masks.py; a spell, trap or ritual
// gets an all-black mask, foil everywhere, as build_masks.py gives the
// catalog's, which it finds by kind in cards.json). Once the mask exists
// the card is saved with it; the catalog is reloaded either way so the WebP
// copies are offered.
func (s *Scout) buildAssets(id int64, num int, kind string) {
	s.assetsMu.Lock()
	defer s.assetsMu.Unlock()
	var logs []string
	ok := true
	run := func(timeout time.Duration, name string, args ...string) {
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		cmd := exec.CommandContext(ctx, name, args...)
		out, err := cmd.CombinedOutput()
		line := "$ " + name + " " + strings.Join(args, " ")
		logs = append(logs, line, tail(string(out), 1500))
		if err != nil {
			ok = false
			logs = append(logs, "failed: "+err.Error())
		}
	}

	cardsDir := filepath.Join(s.Config.AssetDir, "cards")
	webp := filepath.Join(s.Config.Scripts, "build_webp.sh")
	masks := filepath.Join(s.Config.Scripts, "build_masks.py")
	art := filepath.Join(cardsDir, fmt.Sprintf("%03d.png", num))

	if _, err := exec.LookPath("cwebp"); err != nil {
		ok = false
		logs = append(logs, "cwebp not found on the server (brew install webp / apt install webp)")
	} else {
		run(5*time.Minute, "sh", webp, s.Config.AssetDir)
	}

	if kind != "monster" {
		black := image.NewGray(image.Rect(0, 0, artSize, artSize))
		maskPath := filepath.Join(cardsDir, fmt.Sprintf("%03d_Mask.png", num))
		if err := writePNG(maskPath, black); err != nil {
			ok = false
			logs = append(logs, "writing the all-black mask: "+err.Error())
		} else {
			logs = append(logs, "a "+kind+": all-black mask (foil everywhere)")
		}
	} else if _, err := exec.LookPath("uv"); err != nil {
		ok = false
		logs = append(logs, "uv not found on the server: the holo mask needs it (https://docs.astral.sh/uv/)")
	} else {
		// --force: the art is new, so any mask already at this number is stale.
		args := []string{"run", masks, "--force", "--only", fmt.Sprint(num)}
		if s.Config.MaskModel != "" {
			args = append(args, "--model", s.Config.MaskModel)
		}
		// The first run downloads the segmentation model.
		run(45*time.Minute, "uv", append(args, art)...)
	}

	maskRel := fmt.Sprintf("cards/%03d_Mask.png", num)
	if _, err := os.Stat(filepath.Join(s.Config.AssetDir, filepath.FromSlash(maskRel))); err == nil {
		if err := s.saveMask(num, maskRel); err != nil {
			ok = false
			logs = append(logs, "saving the card with its mask: "+err.Error())
		}
	} else {
		ok = false
		logs = append(logs, "no mask was made")
		if err := s.Content.Reload(); err != nil {
			logs = append(logs, "reloading the catalog: "+err.Error())
		}
	}

	status := "done"
	if !ok {
		status = "failed"
	}
	log.Printf("card scout: assets for card %d: %s", num, status)
	if _, err := s.DB.Exec(`UPDATE card_suggestions SET assets = ?, assets_log = ? WHERE id = ?`, status, tail(strings.Join(logs, "\n"), 8000), id); err != nil {
		log.Printf("card scout: recording assets of card %d: %v", num, err)
	}
}

// saveMask adds the mask to the stored card (which also reloads the catalog).
func (s *Scout) saveMask(num int, mask string) error {
	stored, err := s.Content.StoredCard(num)
	if err != nil {
		return err
	}
	var card map[string]json.RawMessage
	if err := json.Unmarshal(stored, &card); err != nil {
		return err
	}
	card["mask"], _ = json.Marshal(mask)
	raw, _ := json.Marshal(card)
	_, err = s.Content.SaveCard(num, raw, "card scout", "holo mask built")
	return err
}

func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return "…" + s[len(s)-n:]
}

// renumber replaces from with to in every "nums" list inside raw: a card
// that names itself was checked under a number it may not get.
func renumber(raw json.RawMessage, from, to int) json.RawMessage {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return raw
	}
	var walk func(any)
	walk = func(x any) {
		switch t := x.(type) {
		case map[string]any:
			for k, val := range t {
				if list, ok := val.([]any); ok && k == "nums" {
					for i, n := range list {
						if f, ok := n.(float64); ok && int(f) == from {
							list[i] = float64(to)
						}
					}
					continue
				}
				walk(val)
			}
		case []any:
			for _, val := range t {
				walk(val)
			}
		}
	}
	walk(v)
	out, err := json.Marshal(v)
	if err != nil {
		return raw
	}
	return out
}
