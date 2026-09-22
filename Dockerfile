# Stage 1: Build React Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml ./
# Pin pnpm to the major that wrote this lockfile (lockfileVersion 6.0 = pnpm 8).
# Unpinned `npm install -g pnpm` picks up pnpm 10+, which both rejects this
# lockfile format and fails the install outright with ERR_PNPM_IGNORED_BUILDS
# because esbuild's postinstall script is blocked by default.
RUN npm install -g pnpm@8 && pnpm install --frozen-lockfile
COPY web/ .
RUN pnpm run build

# Stage 2: Build Go Backend
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
# main.go imports duelistRoses/api and duelistRoses/game, so the packages have
# to be in the build context too - copying main.go alone does not compile.
COPY main.go ./
COPY api/ ./api/
COPY game/ ./game/
# Build the binary, statically linked
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

# Stage 3: Final Image
FROM alpine:latest
WORKDIR /root/
# Copy the compiled binary from backend builder
COPY --from=backend-builder /app/server .
# Copy the built frontend assets from frontend builder
# Note: The server expects assets in ./web/dist relative to execution directory
COPY --from=frontend-builder /app/web/dist ./web/dist

# Expose the application port. The server honours $PORT and falls back to 8080.
ENV PORT=8080
EXPOSE 8080

# Run the server
CMD ["./server"]
