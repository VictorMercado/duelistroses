// Package metrics is what the server reports to Prometheus. It answers two
// questions: is the server keeping up (room queues, CPU, memory, slow
// websocket clients), and how much of its work and bandwidth goes to serving
// asset files rather than running duels.
//
// Metrics are served on their own address (METRICS_ADDR, ":9091" by
// default), never on the public port.
package metrics

import (
	"bufio"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Latency buckets from 1 ms to 10 s: room work should sit in the first few.
var buckets = []float64{.001, .0025, .005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10}

var (
	httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "duelist_http_requests_total",
		Help: "HTTP requests by route (assets/<folder>, api, client, ws, auth) and status code.",
	}, []string{"route", "code"})
	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "duelist_http_request_duration_seconds",
		Help:    "Time to answer an HTTP request, including sending the body. Websocket upgrades are left out.",
		Buckets: buckets,
	}, []string{"route"})
	httpBytes = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "duelist_http_response_bytes_total",
		Help: "Response body bytes sent, by route (before TLS and any proxy compression).",
	}, []string{"route"})
	httpInFlight = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "duelist_http_requests_in_flight",
		Help: "HTTP requests being answered right now, by route. Websockets are counted in duelist_ws_connections.",
	}, []string{"route"})

	// WSConnections is the number of open game websockets.
	WSConnections = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "duelist_ws_connections",
		Help: "Open game websocket connections.",
	})
	wsMessages = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "duelist_ws_messages_total",
		Help: "Websocket messages, by direction (in, out).",
	}, []string{"dir"})
	wsBytes = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "duelist_ws_bytes_total",
		Help: "Websocket payload bytes, by direction (in, out).",
	}, []string{"dir"})
	// WSSlowDrops counts connections dropped because their send queue filled:
	// the client (or the server's writes) could not keep up.
	WSSlowDrops = promauto.NewCounter(prometheus.CounterOpts{
		Name: "duelist_ws_slow_client_drops_total",
		Help: "Websocket connections dropped because their outgoing queue was full.",
	})

	// RoomQueueWait is how long work waited in a room's queue before the
	// room got to it. It climbs when the server is choking.
	RoomQueueWait = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "duelist_room_queue_wait_seconds",
		Help:    "Time a message or timer waited in a room's queue before the room ran it.",
		Buckets: buckets,
	})
	// RoomTask is how long the room took to run one piece of work (an
	// action, a bot move, a broadcast).
	RoomTask = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "duelist_room_task_seconds",
		Help:    "Time a room spent running one queued message or timer.",
		Buckets: buckets,
	})

	clientErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "duelist_client_errors_total",
		Help: "Error reports received from game clients, by kind.",
	}, []string{"kind"})
)

// WSIn and WSOut count one websocket message of n bytes.
func WSIn(n int) {
	wsMessages.WithLabelValues("in").Inc()
	wsBytes.WithLabelValues("in").Add(float64(n))
}

func WSOut(n int) {
	wsMessages.WithLabelValues("out").Inc()
	wsBytes.WithLabelValues("out").Add(float64(n))
}

// ClientError counts a client's error report. kind must be one of the
// bounded set the reports package accepts.
func ClientError(kind string) { clientErrors.WithLabelValues(kind).Inc() }

// GaugeFunc registers a gauge read when Prometheus scrapes.
func GaugeFunc(name, help string, f func() float64) {
	promauto.NewGaugeFunc(prometheus.GaugeOpts{Name: name, Help: help}, f)
}

// assetDirs are the top-level folders of the asset directory: the only
// values the assets route label may take, so a request for a made-up path
// cannot create a new time series.
var assetDirs atomic.Pointer[map[string]bool]

// WatchAssets names the asset folders (cards, textures, audio...) so asset
// traffic is reported per folder.
func WatchAssets(dir string) {
	dirs := map[string]bool{}
	if entries, err := os.ReadDir(dir); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				dirs[e.Name()] = true
			}
		}
	}
	assetDirs.Store(&dirs)
}

func route(path string) string {
	switch {
	case strings.HasPrefix(path, "/assets/"):
		folder, _, _ := strings.Cut(strings.TrimPrefix(path, "/assets/"), "/")
		if dirs := assetDirs.Load(); dirs != nil && (*dirs)[folder] {
			return "assets/" + folder
		}
		return "assets/other"
	case strings.HasPrefix(path, "/ws/"):
		return "ws"
	case strings.HasPrefix(path, "/api/"):
		return "api"
	case strings.HasPrefix(path, "/.well-known/"):
		return "auth"
	default:
		return "client"
	}
}

// Instrument counts and times every request the handler answers.
func Instrument(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := route(r.URL.Path)
		rec := &recorder{ResponseWriter: w}
		if name == "ws" {
			// A websocket lives as long as the duel: its duration says nothing.
			next.ServeHTTP(rec, r)
			httpRequests.WithLabelValues(name, strconv.Itoa(rec.status())).Inc()
			return
		}
		inFlight := httpInFlight.WithLabelValues(name)
		inFlight.Inc()
		start := time.Now()
		defer func() {
			inFlight.Dec()
			httpDuration.WithLabelValues(name).Observe(time.Since(start).Seconds())
			httpRequests.WithLabelValues(name, strconv.Itoa(rec.status())).Inc()
			httpBytes.WithLabelValues(name).Add(float64(rec.bytes))
		}()
		next.ServeHTTP(rec, r)
	})
}

// recorder notes the status and body size of a response. It keeps the
// writer's optional interfaces: Hijack for websocket upgrades, and ReadFrom
// so file responses still go out by sendfile.
type recorder struct {
	http.ResponseWriter
	code  int
	bytes int64
}

func (r *recorder) status() int {
	if r.code == 0 {
		return http.StatusOK
	}
	return r.code
}

func (r *recorder) WriteHeader(code int) {
	if r.code == 0 {
		r.code = code
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *recorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}

func (r *recorder) ReadFrom(src io.Reader) (int64, error) {
	var n int64
	var err error
	if rf, ok := r.ResponseWriter.(io.ReaderFrom); ok {
		n, err = rf.ReadFrom(src)
	} else {
		n, err = io.Copy(r.ResponseWriter, src)
	}
	r.bytes += n
	return n, err
}

func (r *recorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (r *recorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijacking is not supported")
	}
	if r.code == 0 {
		r.code = http.StatusSwitchingProtocols
	}
	return h.Hijack()
}

func (r *recorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// Serve answers Prometheus on addr ("off" or empty turns it off). It runs in
// the background; a failure to listen is logged, not fatal.
func Serve(addr string) {
	if addr == "" || addr == "off" {
		return
	}
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", promhttp.Handler())
	go func() {
		log.Printf("metrics on %s/metrics", addr)
		if err := http.ListenAndServe(addr, mux); err != nil {
			log.Printf("metrics: %v", err)
		}
	}()
}
