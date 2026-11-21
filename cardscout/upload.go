package cardscout

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif" // card images can come in any common format
	"image/jpeg"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"

	"duelistRoses/db"
)

// SummonUpload marks a suggestion made from card images an administrator
// uploaded, rather than one the scout found.
const SummonUpload = "upload"

// MaxUpload is the largest image accepted.
const MaxUpload = 15 << 20

// Claude reads images up to this many pixels on the long side; larger ones
// are scaled down first (the API would do it anyway, after paying to send them).
const claudeImageSide = 1568

// Upload keeps an administrator's card image (and, optionally, the art to
// use for the card in the game) and starts Claude reading and adapting it in
// the background. The suggestion appears as "working", then "pending".
func (s *Scout) Upload(by string, cardData, artData []byte, hint string) (int64, error) {
	if !s.Available {
		return 0, errors.New("no Anthropic credentials on the server")
	}
	if s.Config.UploadDir == "" {
		return 0, errors.New("uploads are off on this server")
	}
	cardImg, err := decodeImage(cardData)
	if err != nil {
		return 0, fmt.Errorf("the card image: %w", err)
	}
	var artImg image.Image
	if len(artData) > 0 {
		if artImg, err = decodeImage(artData); err != nil {
			return 0, fmt.Errorf("the art: %w", err)
		}
	}

	// Uploads get negative ids, so they never meet the card database's.
	s.acceptMu.Lock()
	sourceID := -int(time.Now().UnixMicro())
	s.acceptMu.Unlock()
	dir := s.uploadDir(sourceID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, err
	}
	if err := writeJPEG(filepath.Join(dir, "card.jpg"), fit(cardImg, claudeImageSide)); err != nil {
		return 0, err
	}
	src := SourceCard{ID: sourceID, Uploaded: true, Hint: strings.TrimSpace(hint), Small: thumbnail(cardImg, 240)}
	if artImg != nil {
		if err := writePNG(filepath.Join(dir, "art.png"), artImg); err != nil {
			return 0, err
		}
		src.ArtThumb = thumbnail(artImg, 160)
	}
	raw, _ := json.Marshal(src)
	res, err := s.DB.Exec(`INSERT INTO card_suggestions (source_id, name, summon, source, status, model, created_at, decided_by)
		VALUES (?, 'Reading the card…', ?, ?, 'working', ?, ?, '')`, sourceID, SummonUpload, string(raw), s.model.ID, db.Time(time.Now()))
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	log.Printf("card scout: %s uploaded a card (suggestion %d)", by, id)
	go s.readUpload(id, "")
	return id, nil
}

func (s *Scout) uploadDir(sourceID int) string {
	return filepath.Join(s.Config.UploadDir, fmt.Sprint(-sourceID))
}

// rereadUpload asks Claude again about an uploaded card, with feedback.
func (s *Scout) rereadUpload(g Suggestion, feedback string) error {
	if g.Status == StatusWorking {
		return errors.New("Claude is still reading that card")
	}
	if _, err := s.DB.Exec(`UPDATE card_suggestions SET status = 'working', decided_at = '', decided_by = '' WHERE id = ?`, g.ID); err != nil {
		return err
	}
	go s.readUpload(g.ID, strings.TrimSpace(feedback))
	return nil
}

// readUpload has Claude read an uploaded card and suggest its options.
func (s *Scout) readUpload(id int64, feedback string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	g, err := s.get(id)
	if err != nil {
		log.Printf("card scout: upload %d: %v", id, err)
		return
	}
	finish := func(res adaptResult, err error) {
		status, note := StatusPending, res.Note
		src := g.Source
		name := g.Name
		if err != nil {
			status, note = StatusFailed, err.Error()
		}
		if r := res.Read; r != nil {
			name = strings.TrimSpace(r.Name)
			src.Name, src.Type, src.Race, src.Attribute = name, r.CardType, r.Race, r.Attribute
			src.Level, src.Atk, src.Def, src.Desc = r.Level, r.Atk, r.Def, r.Text
		}
		if res.Options == nil {
			res.Options = []Option{}
		}
		raw, _ := json.Marshal(src)
		opts, _ := json.Marshal(res.Options)
		if _, err := s.DB.Exec(`UPDATE card_suggestions SET status = ?, name = ?, source = ?, options = ?, note = ?, model = ?, cost_usd = cost_usd + ? WHERE id = ?`,
			status, name, string(raw), string(opts), note, s.model.ID, res.Cost, id); err != nil {
			log.Printf("card scout: saving upload %d: %v", id, err)
		}
		log.Printf("card scout: read uploaded card %q: %s ($%.4f)", name, status, res.Cost)
	}

	data, err := os.ReadFile(filepath.Join(s.uploadDir(g.SourceID), "card.jpg"))
	if err != nil {
		finish(adaptResult{}, fmt.Errorf("the uploaded image is gone: %w", err))
		return
	}
	var b strings.Builder
	b.WriteString("Read this card and adapt it to Duelist Roses.\n")
	if g.Source.Hint != "" {
		fmt.Fprintf(&b, "\nThe administrator's notes on it:\n%s\n", g.Source.Hint)
	}
	writeFeedback(&b, feedback)
	first := []anthropic.ContentBlockParamUnion{
		anthropic.NewImageBlockBase64("image/jpeg", base64.StdEncoding.EncodeToString(data)),
		anthropic.NewTextBlock(b.String()),
	}
	finish(s.adapt(ctx, first, true))
}

// uploadedArt is the art an accepted upload is drawn with: the art dropped
// with it, or else the picture cut out of the card image.
func (s *Scout) uploadedArt(g Suggestion) (image.Image, error) {
	dir := s.uploadDir(g.SourceID)
	if f, err := os.Open(filepath.Join(dir, "art.png")); err == nil {
		defer f.Close()
		img, _, err := image.Decode(f)
		return img, err
	}
	f, err := os.Open(filepath.Join(dir, "card.jpg"))
	if err != nil {
		return nil, errors.New("the uploaded card image is gone")
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return nil, err
	}
	return cardArtBox(img), nil
}

// cardArtBox cuts the picture out of an image of a whole card. A standard
// card's art box starts 11.9% in from the left and 18.1% down, and is 76.2%
// of the card's width on each side. An image that is not card-shaped is
// returned as is (it is cropped to its centre square later).
func cardArtBox(img image.Image) image.Image {
	b := img.Bounds()
	w, h := float64(b.Dx()), float64(b.Dy())
	if math.Abs(w/h-59.0/86.0) > 0.06 {
		return img
	}
	side := int(0.762 * w)
	x0 := b.Min.X + int(0.119*w)
	y0 := b.Min.Y + int(0.181*h)
	r := image.Rect(x0, y0, x0+side, y0+side).Intersect(b)
	out := image.NewRGBA(image.Rect(0, 0, r.Dx(), r.Dy()))
	draw.Copy(out, image.Point{}, img, r, draw.Src, nil)
	return out
}

// --- images ------------------------------------------------------------------

func decodeImage(data []byte) (image.Image, error) {
	if len(data) == 0 {
		return nil, errors.New("it is empty")
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("not a PNG, JPEG, WebP or GIF image")
	}
	if cfg.Width < 64 || cfg.Height < 64 || cfg.Width*cfg.Height > 40_000_000 {
		return nil, fmt.Errorf("%dx%d is too small or too large", cfg.Width, cfg.Height)
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("unreadable image: %w", err)
	}
	return img, nil
}

// fit scales img down so its long side is at most side.
func fit(img image.Image, side int) image.Image {
	b := img.Bounds()
	long := max(b.Dx(), b.Dy())
	if long <= side {
		return img
	}
	w, h := b.Dx()*side/long, b.Dy()*side/long
	dst := image.NewRGBA(image.Rect(0, 0, max(w, 1), max(h, 1)))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Src, nil)
	return dst
}

// thumbnail is a small JPEG of img as a data URL, for the review table.
func thumbnail(img image.Image, side int) string {
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, fit(img, side), &jpeg.Options{Quality: 80})
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func writeJPEG(path string, img image.Image) error {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		return err
	}
	return os.WriteFile(path, buf.Bytes(), 0o644)
}

func writePNG(path string, img image.Image) error {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, buf.Bytes(), 0o644)
}
