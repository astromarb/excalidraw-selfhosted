#!/bin/sh
# Seed astromarb/excalidraw with the self-host patch as a `selfhost` branch.
# Run once from the root of excalidraw-selfhosted:
#   sh scripts/seed-fork.sh        (PowerShell / Windows)
#   bash scripts/seed-fork.sh      (Linux / macOS / WSL with bash)
#
# After this:
# - astromarb/excalidraw@selfhost has upstream v0.18.1 + the self-host patch
#   as two clean commits.
# - docker-compose.build.yml already defaults to that repo+branch.
# - frontend/excalidraw-selfhost.patch is kept as the bootstrap record, but
#   future customizations are commits on selfhost, not patch-file edits.
# - Upstream updates: git fetch upstream && git rebase v<new-tag> on selfhost.

set -eu

FORK="https://github.com/astromarb/excalidraw.git"
UPSTREAM_TAG="v0.18.1"
BRANCH="selfhost"
PATCH="$(cd "$(dirname "$0")/.." && pwd)/frontend/excalidraw-selfhost.patch"
WORK=$(mktemp -d)

echo "==> Cloning upstream at $UPSTREAM_TAG into $WORK ..."
# Force LF checkout so the patch (LF) matches the working tree on Windows.
git clone --depth 1 --branch "$UPSTREAM_TAG" \
    -c core.autocrlf=false \
    https://github.com/excalidraw/excalidraw.git "$WORK"

cd "$WORK"

echo "==> Adding fork remote ..."
git remote add fork "$FORK"

echo "==> Creating $BRANCH branch off $UPSTREAM_TAG ..."
git checkout -b "$BRANCH"

echo "==> Applying self-host patch ..."
git apply --ignore-whitespace "$PATCH"

git add -A
git -c user.name="Marvin Lopez Acevedo" \
    -c user.email="marvinlopezacevedo.personal@gmail.com" \
    commit -m "Self-host patch: HTTP storage backend, runtime env, Boards navigation

Applies the excalidraw-selfhosted patch on top of upstream $UPSTREAM_TAG:
- Swap Firebase persistence for the HTTP storage backend (httpStorage.ts,
  StorageBackend.ts, data/index.ts, Collab.tsx, App.tsx)
- Runtime env injection via window._env_ + launcher.py instead of
  build-time Vite baking (env.ts, global.d.ts, index.html)
- Boards button in the hamburger menu and welcome screen, linking to /boards
- Dynamic-env Dockerfile and updated .dockerignore

Source: https://github.com/astromarb/excalidraw-selfhosted"

echo "==> Pushing $BRANCH to fork ..."
git push fork "$BRANCH"

echo ""
echo "Done. astromarb/excalidraw@selfhost is ready."
echo "Build with: docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build"
cd / && rm -rf "$WORK"
