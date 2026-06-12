# Excalidraw, self-hosted

Private Excalidraw with **live collaboration** and **persistent shared links**,
served over **Tailscale** — no domain, no public exposure, $0/month.

## Architecture

One `docker compose` stack. A **Tailscale sidecar** joins the tailnet as its
own machine (`excalidraw.<tailnet>.ts.net`), terminates HTTPS with an
auto-provisioned `*.ts.net` cert, and hands requests to nginx:

```
browser ──HTTPS──> tailscale sidecar (its own tailnet node) ──> nginx gateway
                                          ├── /            → frontend   (alswl/excalidraw — Excalidraw with HTTP-storage patch)
                                          ├── /socket.io/  → room       (excalidraw/excalidraw-room — collab websocket relay)
                                          └── /api/v2/     → storage    (excalidraw-storage-backend) ──> redis (volume: redis-data)
```

Because the app is its own tailnet machine, you share *the app* with friends —
not the host PC. The node's identity lives in the `tailscale-state` volume, so
restarts and host migrations don't change the URL or require re-sharing. The
host needs no Tailscale configuration at all (it doesn't even need Tailscale
installed for the stack to work — only for *you* to reach it from the host
over the tailnet; `http://localhost:8080` works regardless).

- **frontend** — prebuilt image of Excalidraw with the small patch that swaps
  Firebase for an HTTP storage backend. Later (Phase 3+) this can be replaced
  with a build from your own fork to carry custom patches.
- **room** — official websocket relay; powers live cursors and real-time sync.
  Collab content is end-to-end encrypted (the key lives in the URL fragment
  after `#`, which never reaches the server).
- **storage** — persists shared scenes, shareable links, and pasted images
  into Redis (`redis-data` volume — this is the only state worth backing up).

## Setup (~15 min)

Prereqs (one-time, tailnet-wide, at https://login.tailscale.com/admin/dns):
**MagicDNS** on, **HTTPS Certificates** on.

1. Generate an auth key at
   https://login.tailscale.com/admin/settings/keys → *Generate auth key*
   (defaults are fine; it's only used for the first join).
2. Configure and start:

   ```bash
   git clone https://github.com/astromarb/excalidraw-selfhosted.git
   cd excalidraw-selfhosted
   cp .env.example .env
   # edit .env: paste TS_AUTHKEY, set PUBLIC_ORIGIN to
   # https://excalidraw.<your-tailnet>.ts.net
   docker compose up -d
   docker compose logs tailscale | tail   # should show it joining the tailnet
   ```

3. The `excalidraw` machine appears in the
   [admin console](https://login.tailscale.com/admin/machines) — open it and
   **disable key expiry** so it never drops off the tailnet.
4. Open `https://excalidraw.<tailnet>.ts.net` from any of your Tailscale
   devices (the very first HTTPS request can take ~30 s while the cert is
   provisioned). For a quick host-local sanity check without Tailscale,
   http://localhost:8080 serves the same app.

## Share with friends

1. Each friend creates a free Tailscale account and installs the client.
2. In the [admin console](https://login.tailscale.com/admin/machines), open
   the **excalidraw** machine (not the host PC) → **Share** → send each friend
   the invite link.
3. They accept; the node appears in their tailnet and the same
   `https://excalidraw.<tailnet>.ts.net` URL works for them. They can reach
   the whiteboard and nothing else on your network.

To collaborate: open the app → **Share** → **Start session** → send the link
(keep the part after `#` intact — that's the encryption key).

## Migrate to the Mac mini

All state lives in two volumes: `redis-data` (scenes/links/images) and
`tailscale-state` (the node's tailnet identity). Move both and the new host
serves the **same URL with the same shares** — friends notice nothing.

```bash
# on the OMEN PC
docker compose down
for v in redis-data tailscale-state; do
  docker run --rm -v excalidraw-selfhosted_$v:/data -v "$PWD":/backup alpine \
    tar czf /backup/$v.tgz -C /data .
done

# on the Mac mini (after copying the .tgz files and your .env over)
git clone https://github.com/astromarb/excalidraw-selfhosted.git && cd excalidraw-selfhosted
for v in redis-data tailscale-state; do
  docker volume create excalidraw-selfhosted_$v
  docker run --rm -v excalidraw-selfhosted_$v:/data -v "$PWD":/backup alpine \
    tar xzf /backup/$v.tgz -C /data
done
docker compose up -d
```

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
`alswl/excalidraw-storage-backend:v2023.11.11`, `excalidraw/excalidraw-room:latest`,
`tailscale/tailscale:latest`.

## Alternative: host-level `tailscale serve`

If you'd rather not run the sidecar, the host's own Tailscale can front the
stack instead: remove the `tailscale` service and `network_mode` line, put
`ports: ["8080:80"]` back on `gateway`, and run
`tailscale serve --bg --https=443 http://127.0.0.1:8080` on the host. The app
is then served at the *host's* ts.net name, and sharing it with friends means
sharing your whole machine — the sidecar setup is preferred.
