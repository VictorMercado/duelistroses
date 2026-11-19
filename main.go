package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"duelistRoses/api"
	"duelistRoses/auth"
	"duelistRoses/bot"
	"duelistRoses/cardlab"
	"duelistRoses/content"
	"duelistRoses/db"
	"duelistRoses/game"
	"duelistRoses/metrics"
	"duelistRoses/profile"
	"duelistRoses/replay"
	"duelistRoses/reports"
)

// testing deploy

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// llmConfigured reports whether the Anthropic SDK will find credentials.
func llmConfigured() bool {
	for _, key := range []string{"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"} {
		if os.Getenv(key) != "" {
			return true
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		if entries, err := os.ReadDir(filepath.Join(home, ".config", "anthropic")); err == nil && len(entries) > 0 {
			return true
		}
	}
	return false
}

func main() {
	port := env("PORT", "8080")
	publicURL := strings.TrimRight(env("PUBLIC_URL", "http://localhost:"+port), "/")
	turnSeconds, _ := strconv.Atoi(env("TURN_SECONDS", "99"))

	// ADMIN_USERS is a comma separated list of account names.
	dataDir := env("DATA_DIR", "./data")
	// Everything that lasts is in one SQLite database in DATA_DIR. On its
	// first run the JSON files older versions kept there are imported (and
	// renamed *.imported).
	dbPath := env("DB_PATH", filepath.Join(dataDir, "duelist.db"))
	database, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer database.Close()
	log.Printf("database: %s", dbPath)
	accounts, err := auth.New(dataDir, database, publicURL, strings.Split(os.Getenv("ADMIN_USERS"), ","))
	if err != nil {
		log.Fatalf("auth: %v", err)
	}
	// There is always an administrator to sign in as. ADMIN_NAME and
	// ADMIN_PASSWORD only matter the first time, when the account is created;
	// after that its password is changed from the admin dashboard.
	adminName, adminPassword := env("ADMIN_NAME", "admin"), env("ADMIN_PASSWORD", "admin")
	if created, err := accounts.EnsureAdmin(adminName, adminPassword); err != nil {
		log.Printf("admin account %q: %v", adminName, err)
	} else if created {
		log.Printf("created the administrator account %q", adminName)
		if os.Getenv("ADMIN_PASSWORD") == "" {
			log.Printf("its password is %q: change it from the admin dashboard before this server is public", adminPassword)
		}
	}

	// Cards (in the database, seeded from the built-in files), the decks and
	// maps players build and
	// every asset file (ASSET_DIR, served at /assets).
	assetDir := env("ASSET_DIR", "./content/assets")
	if _, err := os.Stat(assetDir); err != nil {
		log.Printf("%s not found: card art, textures and sounds will be missing (see scripts/content/import_assets.sh)", assetDir)
	}
	library, err := content.New(dataDir, database, assetDir, accounts)
	if err != nil {
		log.Fatalf("content: %v", err)
	}
	log.Printf("catalog: %d cards (version %s)", library.Catalog().Size(), library.Catalog().Version)

	// Every duelist's record: what they did in the duels they finished.
	profiles, err := profile.Open(database, filepath.Join(dataDir, "profiles.json"))
	if err != nil {
		log.Fatalf("profiles: %v", err)
	}

	llm := llmConfigured()
	// LLM_MODEL picks the model used when a game does not name one. A model
	// outside the usual list is offered too, so any model can be tried.
	defaultModel := os.Getenv("LLM_MODEL")
	if defaultModel == "" {
		defaultModel = bot.DefaultModel
	}
	if _, ok := bot.FindModel(defaultModel); !ok {
		bot.Models = append(bot.Models, bot.Model{ID: defaultModel, Label: defaultModel, Note: "set by LLM_MODEL"})
	}
	if !llm {
		log.Printf("no Anthropic credentials found: LLM opponents are off, rule-based bots still work")
	}
	// One client per model, made the first time a game asks for it.
	var claudesMu sync.Mutex
	claudes := map[string]*bot.LLM{}
	hub := game.NewHub(library, func(kind string) bot.Bot {
		// kind is "llm", or "llm:<model id>" for a chosen model; otherwise it
		// names the rule-based bot's personality ("aggressive", "builder"...).
		name, model, _ := strings.Cut(kind, ":")
		if name != "llm" {
			return bot.Heuristic{Style: bot.ParseStyle(kind)}
		}
		if !llm {
			return bot.Heuristic{}
		}
		if _, ok := bot.FindModel(model); !ok {
			model = defaultModel
		}
		claudesMu.Lock()
		defer claudesMu.Unlock()
		if claudes[model] == nil {
			claudes[model] = bot.NewLLM(model)
		}
		return claudes[model]
	})
	hub.Profiles = profiles
	// Every duel, recorded to be watched again (see package replay).
	replays := replay.NewStore(database)
	hub.Replays = replays

	// Prometheus scrapes METRICS_ADDR (never the public port).
	metrics.WatchAssets(assetDir)
	metrics.GaugeFunc("duelist_rooms", "Rooms open on the server.", func() float64 { return float64(hub.Count()) })
	errorReports := reports.New(database, accounts)
	errorReports.RegisterInternal(metrics.Handle)
	metrics.Serve(env("METRICS_ADDR", ":9091"))

	mux := http.NewServeMux()
	accounts.Register(mux)
	library.Register(mux)
	errorReports.Register(mux)
	(&api.Server{Hub: hub, Auth: accounts, LLMAvailable: llm, LLMDefault: defaultModel, DefaultTurn: turnSeconds, Profiles: profiles, Replays: replays, Arena: game.NewArena(library, llm), CardLab: cardlab.New(library, llm, defaultModel)}).Register(mux)

	// The built game client. Unknown paths are its routes.
	staticDir := env("STATIC_DIR", "./web/dist")
	if _, err := os.Stat(staticDir); err != nil {
		log.Printf("%s not found: run `pnpm build` in web/, or use the vite dev server", staticDir)
	}
	files := http.FileServer(http.Dir(staticDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// An API path nobody handles is a missing endpoint, not a client route:
		// answering it with index.html would hand the client HTML it reads as JSON.
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws/") || strings.HasPrefix(r.URL.Path, "/assets/") {
			http.NotFound(w, r)
			return
		}
		path := filepath.Join(staticDir, filepath.Clean("/"+r.URL.Path))
		if info, err := os.Stat(path); err != nil || info.IsDir() {
			// The page names the current bundle: always ask whether it changed.
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			return
		}
		w.Header().Set("Cache-Control", clientCache(r.URL.Path))
		files.ServeHTTP(w, r)
	})

	log.Printf("game server on %s", publicURL)
	log.Fatal(http.ListenAndServe(":"+port, metrics.Instrument(api.CORS(mux))))
}

// clientCache is the Cache-Control for a file of the built client. Vite puts
// a hash of each bundle file's content in its name under /app/, so those never
// change and are kept for a year. The page, the service worker and its
// manifest must be checked every time, or an update would never be seen;
// anything else (icons) is kept for a day.
func clientCache(path string) string {
	switch {
	case strings.HasPrefix(path, "/app/"):
		return "public, max-age=31536000, immutable"
	case path == "/" || strings.HasSuffix(path, ".html") || path == "/sw.js" || path == "/registerSW.js" || strings.HasPrefix(path, "/workbox-") || strings.HasSuffix(path, ".webmanifest"):
		return "no-cache"
	default:
		return "public, max-age=86400"
	}
}
