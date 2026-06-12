# Excalidraw, self-hosted

Private Excalidraw with **live collaboration** and **persistent shared links**,
served over **Tailscale** — no domain, no public exposure, $0/month.

## Architecture

One `docker compose` stack, one exposed port:

```
browser ──HTTPS──> tailscale serve ──> nginx gateway (:8080)
                                          ├── /            → frontend   (alswl/excalidraw — Excalidraw with HTTP-storage patch)
                                          ├── /socket.io/  → room       (excalidraw/excalidraw-room — collab websocket relay)
                                          └── /api/v2/     → storage    (excalidraw-storage-backend) ──> redis (volume: redis-data)
```

- **frontend** — prebuilt image of Excalidraw with the small patch that swaps
  Firebase for an HTTP storage backend. Later (Phase 3+) this can be replaced
  with a build from your own fork to carry custom patches.
- **room** — official websocket relay; powers live cursors and real-time sync.
  Collab content is end-to-end encrypted (the key lives in the URL fragment
  after `#`, which never reaches the server).
- **storage** — persists shared scenes, shareable links, and pasted images
  into Redis (`redis-data` volume — this is the only state worth backing up).

## Phase 1 — validate on the OMEN PC (~30 min)

```bash
git clone https://github.com/astromarb/excalidraw-selfhosted.git
cd excalidraw-selfhosted
cp .env.example .env        # defaults are fine for localhost validation
docker compose up -d
```

Open http://localhost:8080 — draw something.

To test from a second device on your LAN, set `PUBLIC_ORIGIN` in `.env` to
`http://<OMEN-LAN-IP>:8080`, then `docker compose up -d` again (the origin is
baked into the frontend at container start, so a restart is required).

## Phase 2 — Tailscale

1. Install Tailscale on the OMEN PC and log in: https://tailscale.com/download
2. Serve the stack over HTTPS (Tailscale issues a valid `*.ts.net` cert
   automatically; enable HTTPS + MagicDNS in the admin console if prompted):

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:8080
   tailscale serve status   # shows your https://<machine>.<tailnet>.ts.net URL
   ```

3. Point the frontend at that URL — in `.env`:

   ```
   PUBLIC_ORIGIN=https://<machine>.<tailnet>.ts.net
   ```

   then `docker compose up -d`.

4. Verify https://… works from another of your own Tailscale devices.

## Phase 3 — share with friends

1. Each friend creates a free Tailscale account and installs the client.
2. In the [Tailscale admin console](https://login.tailscale.com/admin/machines),
   open the OMEN machine → **Share** → send each friend the invite link.
3. They accept; the machine appears in their tailnet and the same
   `https://….ts.net` URL works for them.

To collaborate: open the app → **Share** → **Start session** → send the link
(keep the part after `#` intact — that's the encryption key).

## Phase 4 — migrate to the Mac mini

All state lives in the `redis-data` volume; everything else is this repo.

```bash
# on the OMEN PC
docker compose down
docker run --rm -v excalidraw-selfhosted_redis-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/redis-data.tgz -C /data .

# on the Mac mini
git clone https://github.com/astromarb/excalidraw-selfhosted.git && cd excalidraw-selfhosted
docker volume create excalidraw-selfhosted_redis-data
docker run --rm -v excalidraw-selfhosted_redis-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/redis-data.tgz -C /data
cp .env.example .env   # set PUBLIC_ORIGIN to the Mac mini's ts.net URL
docker compose up -d
tailscale serve --bg --https=443 http://127.0.0.1:8080
```

If you keep the same Tailscale machine name, shared links keep working;
node shares need to be re-issued for the new machine.

## Verification checklist

- [ ] App loads at `PUBLIC_ORIGIN`; drawing works.
- [ ] **Live collab**: Share → Start session in browser A; open the link in
      browser B (or a friend's machine) — cursors and edits sync both ways.
- [ ] **Shareable link**: Share → Export as link; open it in a private window
      — the scene loads (round-trips through storage + Redis).
- [ ] **Images**: paste an image into a scene, export as link, reopen — image
      still there.
- [ ] **Persistence**: `docker compose restart` — previously exported links
      still resolve.
- [ ] **Obsidian round-trip**: export a drawing as `.excalidraw`, open it in
      Obsidian's Excalidraw plugin, edit, save, and drag the file back into
      the self-hosted app — it opens cleanly.
- [ ] **Privacy**: the `ts.net` URL is unreachable without Tailscale
      (e.g. from a phone on cellular with Tailscale off).

## Operations

```bash
docker compose logs -f            # tail all services
docker compose pull && docker compose up -d   # update images
docker run --rm -v excalidraw-selfhosted_redis-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/redis-data-$(date +%F).tgz -C /data .   # backup
```

Pinned versions: `alswl/excalidraw:v0.18.1-fork-b2` (Excalidraw 0.18.1),
`alswl/excalidraw-storage-backend:v2023.11.11`, `excalidraw/excalidraw-room:latest`.
