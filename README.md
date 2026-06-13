# Excalidraw, self-hosted

Private Excalidraw with **live collaboration**, **persistent shared links**,
and a split-DNS custom domain. Public visitors see a landing page; authorized
tailnet members reach the application at the same URL.

## Architecture

One `docker compose` stack. A **Tailscale sidecar** joins the tailnet as its
own machine. CoreDNS supplies the private DNS answer and Caddy terminates HTTPS
for both the custom hostname and the legacy `*.ts.net` hostname:

```
tailnet DNS ──> CoreDNS ──> 100.105.138.9
browser ──HTTPS──> Caddy ──> nginx gateway
                              ├── /            → frontend
                              ├── /socket.io/  → room
                              └── /api/v2/     → storage ──> Redis
```

Because the app is its own tailnet machine, collaborators can be granted only
TCP 443 and TCP/UDP 53 on this node. They receive no access to the Docker host,
other containers, other tailnet devices, SSH, or subnet routes.

- **frontend** — prebuilt image of Excalidraw with the small patch that swaps
  Firebase for an HTTP storage backend. Later (Phase 3+) this can be replaced
  with a build from your own fork to carry custom patches.
- **room** — official websocket relay; powers live cursors and real-time sync.
  Collab content is end-to-end encrypted (the key lives in the URL fragment
  after `#`, which never reaches the server).
- **storage** — persists shared scenes, shareable links, and pasted images
  into Redis (`redis-data` volume — this is the only state worth backing up).

## One-time setup

### 1. ACME-DNS delegation

Register a dedicated ACME-DNS account:

```bash
curl -X POST https://auth.acme-dns.io/register
```

Copy the response into `secrets/acmedns.json` using
`secrets/acmedns.example.json` as the shape. In Wix DNS, create:

```text
Type:   CNAME
Host:   _acme-challenge.excalidraw
Value:  <fulldomain returned by ACME-DNS>
```

### 2. Public landing page

Deploy `landing/` as a Vercel project. Add
`excalidraw.marvinlopezacevedo.com` to that project, then create the CNAME
Vercel provides in Wix. This is the public DNS answer.

### 3. Tailscale DNS and policy

Keep MagicDNS and HTTPS certificates enabled. In the DNS admin page, add a
restricted nameserver:

```text
Domain:      excalidraw.marvinlopezacevedo.com
Nameserver:  100.105.138.9
```

Merge `tailscale-policy.fragment.hujson` into the existing policy. Add invited
login identities to `group:excalidraw-users`, narrow any existing broad member
grant that includes them, and authorize `tag:excalidraw`.

After the policy accepts the tag, set:

```dotenv
TS_EXTRA_ARGS=--advertise-tags=tag:excalidraw
```

### 4. Start the stack

```bash
cp .env.example .env
# Preserve the existing TS_AUTHKEY and persisted tailscale-state volume.
# Set ACME_EMAIL and verify all hostname/IP values.
docker compose config
docker compose build caddy
docker compose up -d
```

Initially leave `ACME_CA` on Let's Encrypt staging. After HTTPS and DNS tests
pass, change it to:

```dotenv
ACME_CA=https://acme-v02.api.letsencrypt.org/directory
```

Then recreate Caddy:

```bash
docker compose up -d --force-recreate caddy
```

To collaborate: open the app → **Share** → **Start session** → send the link
(keep the part after `#` intact — that's the encryption key).

## Migrate to the Mac mini

All state lives in three volumes: `redis-data` (scenes/links/images),
`tailscale-state` (the node's tailnet identity), and `boards-data` (the
boards dashboard). Move them and the new host serves the **same URL with the
same shares** — friends notice nothing.

```bash
# on the OMEN PC
docker compose down
for v in redis-data tailscale-state boards-data; do
  docker run --rm -v excalidraw-selfhosted_$v:/data -v "$PWD":/backup alpine \
    tar czf /backup/$v.tgz -C /data .
done

# on the Mac mini (after copying the .tgz files and your .env over)
git clone https://github.com/astromarb/excalidraw-selfhosted.git && cd excalidraw-selfhosted
for v in redis-data tailscale-state boards-data; do
  docker volume create excalidraw-selfhosted_$v
  docker run --rm -v excalidraw-selfhosted_$v:/data -v "$PWD":/backup alpine \
    tar xzf /backup/$v.tgz -C /data
done
docker compose up -d
```

## Boards dashboard

`/boards` is a homepage for **named, grouped, persistent shared whiteboards**.
Creating a board mints a regular Excalidraw collab-room link and remembers it
by name, so any device with access can reopen the same board later — no more
bookkeeping room URLs by hand. Groups organize boards; deleting a group moves
its boards to *Ungrouped*; deleting a board removes only the dashboard entry
(the drawing stays reachable for anyone who kept the link).

Metadata lives in the `boards-data` volume (a small JSON file). Board
*content* rides the normal collab/storage pipeline, encrypted in Redis.

Navigation back from the canvas: the self-host patch adds a **Boards** entry
to the app's hamburger menu and welcome screen. This is frontend source code,
so it only appears when the frontend is built from source (see *Building the
frontend from source* below) — the prebuilt `alswl` image doesn't have it,
though `/boards` itself works either way.

Privacy note: for dashboard boards, the room encryption key is stored in
`boards-data` so boards are reopenable by name. That's the point of a shared
dashboard — but it means these boards are only as private as the dashboard
itself. Ad-hoc sessions started from inside the app keep full end-to-end
secrecy as before.

## Verification checklist

- [ ] With Tailscale off, the custom hostname shows the Vercel landing page.
- [ ] With Tailscale on, DNS returns `100.105.138.9`.
- [ ] The custom hostname has a trusted production certificate.
- [ ] The legacy `*.ts.net` URL redirects to the custom hostname.
- [ ] Collaborators can reach only TCP 443 and TCP/UDP 53 on the app node.
- [ ] Collaborators cannot reach the host, SSH, port 80/8080, or other nodes.
- [ ] App loads at `PUBLIC_ORIGIN`; drawing works.
- [ ] **Live collab**: Share → Start session in browser A; open the link in
      browser B (or a friend's machine) — cursors and edits sync both ways.
- [ ] **Shareable link**: Share → Export as link; open it in a private window
      — the scene loads (round-trips through storage + Redis).
- [ ] **Images**: paste an image into a scene, export as link, reopen — image
      still there.
- [ ] **Persistence**: `docker compose restart` — previously exported links
      still resolve.
- [ ] **Boards dashboard**: create a group and a board at `/boards`, draw in
      it, close the tab, reopen the board from the dashboard on another
      device — same content; `docker compose restart boards` keeps the list.
- [ ] **Obsidian round-trip**: export a drawing as `.excalidraw`, open it in
      Obsidian's Excalidraw plugin, edit, save, and drag the file back into
      the self-hosted app — it opens cleanly.
- [ ] `docker compose restart` preserves DNS, certificates, links, and images.

## Building the frontend from source (customization)

The default `frontend` is a prebuilt image. To own the code instead,
`docker-compose.build.yml` compiles the frontend from upstream
`excalidraw/excalidraw` (pinned tag) with the vendored
`frontend/excalidraw-selfhost.patch` applied. The patch swaps Firebase for
the HTTP storage backend, makes env vars runtime-injected (`window._env_` +
`launcher.py`) instead of build-time baked, and adds the **Boards** menu/
welcome-screen links — the first selfhost-only UI customization.

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

or add `COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml` to `.env`
to make it the default mode.

### Graduating to your own fork

When you want real customizations (custom tools, Discord export, …):

1. Fork `excalidraw/excalidraw` on GitHub.
2. Seed it with the patch:

   ```bash
   git clone https://github.com/astromarb/excalidraw.git
   cd excalidraw
   git checkout -b selfhost v0.18.1
   git apply ../excalidraw-selfhosted/frontend/excalidraw-selfhost.patch
   git add -A && git commit -m "Self-host patch: HTTP storage backend + runtime env"
   git push -u origin selfhost
   ```

3. Point the build at the fork — in `.env`:

   ```
   EXCALIDRAW_REPO=https://github.com/astromarb/excalidraw.git
   EXCALIDRAW_REF=selfhost
   ```

   Customizations are then normal commits on `selfhost`; rebuild with
   `docker compose up -d --build frontend`. Upstream updates:
   `git fetch upstream && git rebase <new-release-tag>`.

## Operations

```bash
docker compose logs -f            # tail all services
docker compose pull && docker compose up -d   # update images
docker run --rm -v excalidraw-selfhosted_redis-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/redis-data-$(date +%F).tgz -C /data .   # backup
```

Pinned versions include `caddy:2.10.0`, `coredns:1.12.1`,
`alswl/excalidraw:v0.18.1-fork-b2`, and
`alswl/excalidraw-storage-backend:v2023.11.11`.
