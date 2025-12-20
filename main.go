package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
)

func main() {
	// Define the directory to serve (relative to project root)
	staticDir := "./web/dist"

	// Check if dist exists, just a warning if not (user might need to build)
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		log.Printf("Warning: %s does not exist. Make sure to run 'npm run build' inside 'web/' directory.", staticDir)
	}

	// Create a file server handler
	fs := http.FileServer(http.Dir(staticDir))

	// Serve content
	// We wrap it to handle SPA routing (rewriting 404s to index.html) if needed,
	// but for now simple file server.
	// For SPA, we usually serve index.html for unknown routes.
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(staticDir, r.URL.Path)
		_, err := os.Stat(path)

		// If path doesn't exist or is a directory, serve index.html (SPA logic)
		// But strictly for static assets, usually we check if file exists.
		// Standard SPA pattern:
		if os.IsNotExist(err) || (err == nil && isDir(path)) {
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			return
		}

		fs.ServeHTTP(w, r)
	})

	http.HandleFunc("deploy", func(w http.ResponseWriter, r *http.Request) {
		
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
