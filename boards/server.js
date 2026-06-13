// Boards dashboard API + static UI. Zero dependencies: board/group metadata
// is a JSON file on a volume; board content itself lives in the regular
// Excalidraw room/storage pipeline (encrypted in Redis).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const DATA_FILE = process.env.DATA_FILE || "/data/boards.json";

function load() {
  try {
    const state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return { groups: state.groups || [], boards: state.boards || [] };
  } catch {
    return { groups: [], boards: [] };
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// Matches what the Excalidraw app generates for collab links: a 20-char hex
// room id and a 22-char base64url AES-128-GCM key (the key never leaves the
// URL fragment in requests to the app, but we persist it here so the board
// is reopenable from any device).
function newRoomFragment() {
  const roomId = crypto.randomBytes(10).toString("hex");
  const key = crypto.randomBytes(16).toString("base64url");
  return `#room=${roomId},${key}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
  });
}

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const INDEX_HTML = fs.readFileSync(path.join(__dirname, "index.html"));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const route = `${req.method} ${url.pathname}`;

  try {
    if (route === "GET /boards" || route === "GET /boards/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(INDEX_HTML);
    }

    if (route === "GET /boards/api/state") {
      return json(res, 200, load());
    }

    if (route === "POST /boards/api/groups") {
      const { name } = await readBody(req);
      if (!name || !name.trim()) return json(res, 400, { error: "name required" });
      const state = load();
      const group = { id: crypto.randomUUID(), name: name.trim() };
      state.groups.push(group);
      save(state);
      return json(res, 201, group);
    }

    if (route === "POST /boards/api/boards") {
      const { name, groupId } = await readBody(req);
      if (!name || !name.trim()) return json(res, 400, { error: "name required" });
      const state = load();
      if (groupId && !state.groups.some((g) => g.id === groupId)) {
        return json(res, 400, { error: "unknown group" });
      }
      const board = {
        id: crypto.randomUUID(),
        name: name.trim(),
        groupId: groupId || null,
        room: newRoomFragment(),
        createdAt: new Date().toISOString(),
      };
      state.boards.push(board);
      save(state);
      return json(res, 201, board);
    }

    const groupMatch = url.pathname.match(/^\/boards\/api\/groups\/([0-9a-f-]+)$/);
    if (groupMatch) {
      const state = load();
      const group = state.groups.find((g) => g.id === groupMatch[1]);
      if (!group) return json(res, 404, { error: "not found" });
      if (req.method === "PATCH") {
        const { name } = await readBody(req);
        if (name && name.trim()) group.name = name.trim();
        save(state);
        return json(res, 200, group);
      }
      if (req.method === "DELETE") {
        // Boards in the group survive; they fall back to ungrouped.
        state.groups = state.groups.filter((g) => g.id !== group.id);
        for (const b of state.boards) if (b.groupId === group.id) b.groupId = null;
        save(state);
        return json(res, 204, {});
      }
    }

    const boardMatch = url.pathname.match(/^\/boards\/api\/boards\/([0-9a-f-]+)$/);
    if (boardMatch) {
      const state = load();
      const board = state.boards.find((b) => b.id === boardMatch[1]);
      if (!board) return json(res, 404, { error: "not found" });
      if (req.method === "PATCH") {
        const { name, groupId } = await readBody(req);
        if (name && name.trim()) board.name = name.trim();
        if (groupId !== undefined) {
          if (groupId && !state.groups.some((g) => g.id === groupId)) {
            return json(res, 400, { error: "unknown group" });
          }
          board.groupId = groupId || null;
        }
        save(state);
        return json(res, 200, board);
      }
      if (req.method === "DELETE") {
        // Removes the dashboard entry only; room data in Redis is untouched,
        // so anyone still holding the link keeps access to the content.
        state.boards = state.boards.filter((b) => b.id !== board.id);
        save(state);
        return json(res, 204, {});
      }
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`boards listening on :${PORT}, data at ${DATA_FILE}`));
