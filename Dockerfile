# Game server image: the Go server (with the card catalog built in), the built
# game client, and the asset files served at /assets.

FROM node:22-alpine AS client
WORKDIR /app/web
# Pinned: a newer pnpm can drop support for this lockfile format and break the build.
RUN npm install -g pnpm@10.33.0
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ .
# The commit client error reports name (there is no .git in the build context).
ARG BUILD_SHA=""
ENV BUILD_SHA=$BUILD_SHA
RUN pnpm run build

FROM golang:1.26-alpine AS server
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
COPY api ./api
COPY auth ./auth
COPY bot ./bot
COPY cardlab ./cardlab
COPY content/*.go ./content/
COPY content/data ./content/data
COPY db ./db
COPY game ./game
COPY metrics ./metrics
COPY profile ./profile
COPY reports ./reports
RUN CGO_ENABLED=0 go build -o server .

FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /srv
COPY --from=server /app/server .
COPY --from=client /app/web/dist ./web/dist
# Card art, textures, sounds and fonts (see scripts/content/import_assets.sh).
COPY content/assets ./content/assets
# Mount a volume here: it holds the signing key, accounts, decks and maps.
VOLUME /srv/data
EXPOSE 8080
# Prometheus metrics (METRICS_ADDR); keep it off the public internet.
EXPOSE 9091
CMD ["./server"]
