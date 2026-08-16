package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"duelistRoses/api"
	"duelistRoses/game"
)

func main() {
	hub := game.NewHub()

	// WebSocket handler
	http.HandleFunc("/ws/", func(w http.ResponseWriter, r *http.Request) {
		api.ServeWs(hub, w, r)
	})

	// Define the directory to serve (relative to project root)
	staticDir := "./web/dist"

	// Check if dist exists, just a warning if not (user might need to build)
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		log.Printf("Warning: %s does not exist. Make sure to run 'npm run build' inside 'web/' directory.", staticDir)
	}

	// Create a file server handler
	fs := http.FileServer(http.Dir(staticDir))

	// Serve content
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ws/" || len(r.URL.Path) > 4 && r.URL.Path[:4] == "/ws/" {
			// handled by ws route
			return
		}

		path := filepath.Join(staticDir, r.URL.Path)
		_, err := os.Stat(path)

		// If path doesn't exist or is a directory, serve index.html (SPA logic)
		if os.IsNotExist(err) || (err == nil && isDir(path)) {
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			return
		}

		fs.ServeHTTP(w, r)
	})

	port := "8080"
	log.Printf("Starting server on http://localhost:%s", port)
	err := http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatal(err)
	}
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}
