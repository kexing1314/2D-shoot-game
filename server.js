// server.js — 权威服务器：静态托管 + WebSocket 房间 + 游戏循环
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const G = require('./shared.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// —— 静态托管 ——
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  let file;
  if (url === '/shared.js') file = path.join(__dirname, 'shared.js');
  else {
    const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// —— 房间 ——
const rooms = new Map();
let eid = 0;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 I O 0 1
  let c;
  do {
    c = Array.from({ length: G.ROOM.codeLen }, () => A[Math.floor(Math.random() * A.length)]).join('');
  } while (rooms.has(c));
  return c;
}

function send(ws, m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }

function pickKeys(k) {
  k = k || {};
  const out = {};
  for (const key of ['w', 'a', 's', 'd', 'up', 'down', 'left', 'right']) out[key] = !!k[key];
  return out;
}

function enterRoom(ws, room, name) {
  const id = 'p' + (++eid);
  const color = G.COLORS[room.players.size % G.COLORS.length];
  const others = [...room.players.values()].filter(p => !p.deadUntil);
  const s = G.pickFarthestSpawn(G.PLAYER_SPAWNS, others);
  const p = {
    id, ws, name: String(name || '玩家').slice(0, 12), color,
    x: s.x, y: s.y, hp: G.PLAYER.hpMax, weapon: 'pistol',
    kills: 0, deaths: 0, keys: {},
    lastFire: -1e9, lastDamagedAt: -1e9, deadUntil: 0,
  };
  room.players.set(id, p);
  ws.room = room; ws.playerId = id;
  send(ws, { t: 'joined', id, code: room.code, color });
  if (!room.timer) room.timer = setInterval(() => tick(room), G.TICK_MS);
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  room.players.delete(ws.playerId);
  ws.room = null;
  if (room.players.size === 0) {
    clearInterval(room.timer);
    room.timer = null;
    rooms.delete(room.code);
  }
}

// —— 游戏循环（Task 6–8 逐步充实函数体）——
function tick(room) {
  broadcastState(room, Date.now());
}

function broadcastState(room, now) {
  const msg = JSON.stringify({
    t: 'state',
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color,
      x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp),
      weapon: p.weapon, kills: p.kills, deaths: p.deaths,
      respawnIn: p.deadUntil ? Math.max(1, Math.ceil((p.deadUntil - now) / 1000)) : 0,
    })),
    monsters: room.monsters.map(m => ({ x: Math.round(m.x), y: Math.round(m.y) })),
    bosses: room.bosses.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), hp: Math.round(b.hp) })),
    bullets: room.bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), size: b.size })),
    pickups: room.pickups.map(pk => ({ x: Math.round(pk.x), y: Math.round(pk.y), weapon: pk.weapon })),
  });
  for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
}

// —— WebSocket ——
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.room = null; ws.playerId = null;
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'create') {
      if (ws.room) return;
      const code = makeCode();
      const room = {
        code, players: new Map(), monsters: [], bosses: [], bullets: [], pickups: [],
        timer: null, lastMonster: Date.now(), lastBoss: Date.now(),
      };
      rooms.set(code, room);
      enterRoom(ws, room, m.name);
    } else if (m.t === 'join') {
      if (ws.room) return;
      const room = rooms.get(String(m.code || '').toUpperCase());
      if (!room) return send(ws, { t: 'error', msg: '房间不存在' });
      if (room.players.size >= G.ROOM.maxPlayers) return send(ws, { t: 'error', msg: '房间已满' });
      enterRoom(ws, room, m.name);
    } else if (m.t === 'input') {
      const p = ws.room && ws.room.players.get(ws.playerId);
      if (p) p.keys = pickKeys(m.keys);
    }
  });
  ws.on('close', () => leave(ws));
});

server.listen(PORT, () => console.log('游戏服务器: http://localhost:' + PORT));
