# Stage 1: Build React Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package.json web/pnpm-lock.yaml ./
# Install dependencies (using npm since pnpm might not be pre-installed, or install pnpm)
RUN npm install -g pnpm && pnpm install
COPY web/ .
RUN pnpm run build

# Stage 2: Build Go Backend
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app
COPY go.mod ./
# COPY go.sum ./ # Uncomment if/when you have a go.sum
RUN go mod download
COPY main.go .
# Build the binary, statically linked
RUN CGO_ENABLED=0 GOOS=linux go build -o server main.go

# Stage 3: Final Image
FROM alpine:latest
WORKDIR /root/
# Copy the compiled binary from backend builder
COPY --from=backend-builder /app/server .
# Copy the built frontend assets from frontend builder
# Note: The server expects assets in ./web/dist relative to execution directory
COPY --from=frontend-builder /app/web/dist ./web/dist

# Expose the application port
EXPOSE 8080

# Run the server
CMD ["./server"]
