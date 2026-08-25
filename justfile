set shell := ["bash", "-cu"]

default:
    @just --list

# Run vite dev (SPA on :3000, proxying /ws + /health to :8787)
# and wrangler dev (worker on :8787) in parallel.
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT
    pnpm --filter web dev &
    pnpm --filter robot-sim-worker exec wrangler dev --port 8787 &
    wait

dev-web:
    pnpm --filter web dev

dev-worker:
    pnpm --filter robot-sim-worker dev

# Install workspace deps.
install:
    pnpm install

# Build the SPA into web/dist/client (consumed by the worker's assets binding).
build:
    pnpm --filter web build

# Build the SPA and deploy the worker (assets + DO) to Cloudflare.
deploy:
    pnpm --filter web build
    pnpm --filter robot-sim-worker exec wrangler deploy

# Run the Server standalone — starts the WS on :8081 and prints
# one line per protocol event. Not a physics sim; the worker is.
server:
    ./gradlew :Server:run --console=plain

# Compile the standalone Server jar.
server-build:
    ./gradlew :Server:build

# Build web + worker + Server.
build-all:
    just build
    just server-build
