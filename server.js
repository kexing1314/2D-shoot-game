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
  const used = new Set([...room.players.values()].map(p => p.color));
  const color = G.COLORS.find(c => !used.has(c)) || G.COLORS[0];
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
  const now = Date.now();
  const dt = G.TICK_MS / 1000;

  // 1. 玩家：移动 + 回血 + 重生
  for (const p of room.players.values()) {
    if (p.deadUntil) {
      if (now >= p.deadUntil) respawn(room, p, now);
      continue;
    }
    const dx = (p.keys.d ? 1 : 0) - (p.keys.a ? 1 : 0);
    const dy = (p.keys.s ? 1 : 0) - (p.keys.w ? 1 : 0);
    if (dx || dy) {
      const l = Math.hypot(dx, dy); // 斜向不超速
      const m = G.moveWithWalls(p.x, p.y,
        dx / l * G.PLAYER.speed * dt, dy / l * G.PLAYER.speed * dt,
        G.PLAYER.r, G.WALLS);
      p.x = m.x; p.y = m.y;
    }
    G.regenStep(p, now, dt);

    // 射击：方向键合成向量（两键同按斜射，对键抵消不开火）
    const dir = G.fireDir(p.keys);
    if (dir) {
      const bs = G.weaponFire(p.weapon, p.x, p.y, dir, now, p.lastFire, p.id);
      if (bs) { p.lastFire = now; room.bullets.push(...bs); }
    }
  }

  // 2. 子弹：推进 + 命中
  room.bullets = room.bullets.filter(b => {
    if (!G.bulletStep(b, dt, G.WALLS)) return false;
    // 命中玩家（不打自己、不打死人）
    for (const p of room.players.values()) {
      if (p.id === b.owner || p.deadUntil) continue;
      if (G.dist(b.x, b.y, p.x, p.y) >= G.PLAYER.r + b.size) continue;
      if (b.pierce) {
        b.hitIds = b.hitIds || [];
        if (b.hitIds.includes(p.id)) continue;
        b.hitIds.push(p.id);
        damagePlayer(room, p, b.dmg, b.owner, now);
      } else {
        damagePlayer(room, p, b.dmg, b.owner, now);
        return false;
      }
    }
    if (b.boss) return true; // Boss 子弹只打玩家，不打怪/其他 Boss
    // 命中怪物 / Boss
    for (const [list, r, isBoss] of [[room.monsters, G.MONSTER.r, false], [room.bosses, G.BOSS.r, true]]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (G.dist(b.x, b.y, m.x, m.y) >= r + b.size) continue;
        const tag = (isBoss ? 'b' : 'm') + m.id;
        if (b.pierce) {
          b.hitIds = b.hitIds || [];
          if (b.hitIds.includes(tag)) continue;
          b.hitIds.push(tag);
        }
        m.hp -= b.dmg;
        if (m.hp <= 0) {
          list.splice(i, 1);
          const killer = room.players.get(b.owner);
          if (killer) killer.kills++;
          // Boss 掉落它手里那把武器（争夺点）
          if (isBoss) room.pickups.push({ id: ++eid, x: m.x, y: m.y, weapon: m.weapon });
        }
        if (!b.pierce) return false;
      }
    }
    return true;
  });

  // 3. 拾取物：碰到活人即换武器
  room.pickups = room.pickups.filter(pk => {
    for (const p of room.players.values()) {
      if (!p.deadUntil && G.dist(p.x, p.y, pk.x, pk.y) < G.PLAYER.r + 10) {
        p.weapon = pk.weapon;
        return false;
      }
    }
    return true;
  });

  // 4a. 怪物：追最近的活人，接触伤害 + 冷却
  const alive = [...room.players.values()].filter(p => !p.deadUntil);
  for (const m of room.monsters) {
    const target = nearest(alive, m.x, m.y);
    G.chaseStep(m, G.MONSTER.r, target, G.MONSTER.speed, dt, G.WALLS);
    if (target && now >= m.nextHit && G.dist(m.x, m.y, target.x, target.y) < G.MONSTER.r + G.PLAYER.r) {
      damagePlayer(room, target, G.MONSTER.dmg, null, now);
      m.nextHit = now + G.MONSTER.cooldownMs;
    }
  }
  // 4b. Boss：缓慢追击；玩家进入所持武器射程（= 视野）内则朝其精确角度开火
  for (const bs of room.bosses) {
    const target = nearest(alive, bs.x, bs.y);
    G.chaseStep(bs, G.BOSS.r, target, G.BOSS.speed, dt, G.WALLS);
    if (!target) continue;
    const d = G.dist(bs.x, bs.y, target.x, target.y);
    if (d <= 0 || d > G.WEAPONS[bs.weapon].range) continue;
    // 攻击节奏：开火 burstMs / 停火 restMs 交替（只在锁定目标时推进；停火期只追不打）
    if (now >= bs.phaseEnd) {
      bs.firing = !bs.firing;
      bs.phaseEnd = now + (bs.firing ? G.BOSS.burstMs : G.BOSS.restMs);
    }
    if (!bs.firing) continue;
    const dir = { x: (target.x - bs.x) / d, y: (target.y - bs.y) / d };
    const shots = G.weaponFire(bs.weapon, bs.x, bs.y, dir, now, bs.lastFire, null);
    if (shots) {
      bs.lastFire = now;
      for (const s of shots) s.boss = true;
      room.bullets.push(...shots);
    }
  }

  // 5. 刷怪（房间里有人就刷；全部重生中也刷）
  if (room.players.size > 0) {
    if (now - room.lastMonster >= G.MONSTER.spawnEveryMs && room.monsters.length < G.MONSTER.cap) {
      room.lastMonster = now;
      room.monsters.push(edgeSpawn());
    }
    if (now - room.lastBoss >= G.BOSS.spawnEveryMs && room.bosses.length < G.BOSS.cap) {
      const s = G.pickBossSpawn(G.BOSS_SPAWNS, room.bosses, alive);
      if (s) {
        room.lastBoss = now;
        room.bosses.push({ id: ++eid, x: s.x, y: s.y, hp: G.BOSS.hp, weapon: dropWeapon(), lastFire: 0, firing: false, phaseEnd: 0 });
      }
    }
  }

  broadcastState(room, now);
}

function respawn(room, p, now) {
  const others = [...room.players.values()].filter(o => o.id !== p.id && !o.deadUntil);
  const s = G.pickFarthestSpawn(G.PLAYER_SPAWNS, others);
  p.x = s.x; p.y = s.y;
  p.hp = G.PLAYER.hpMax;
  p.deadUntil = 0;
  p.lastDamagedAt = now; // 重生后也走 3s 脱战才回血
  p.weapon = 'pistol';
  p.keys = {};
  p.lastFire = now;
}

function damagePlayer(room, p, dmg, attackerId, now) {
  if (p.deadUntil) return; // 已死亡玩家不再受伤（防止同tick多怪重复计死亡）
  p.hp -= dmg;
  p.lastDamagedAt = now;
  if (p.hp > 0) return;
  p.hp = 0;
  p.deaths++;
  p.deadUntil = now + G.PLAYER.respawnMs;
  p.keys = {};
  if (attackerId) {
    const a = room.players.get(attackerId);
    if (a) a.kills++;
  }
  // 死亡掉落手中武器（pistol 不掉），成为争夺点
  if (p.weapon !== 'pistol') {
    room.pickups.push({ id: ++eid, x: p.x, y: p.y, weapon: p.weapon });
  }
  p.weapon = 'pistol';
}

function dropWeapon() {
  const names = Object.keys(G.WEAPONS).filter(w => w !== 'pistol');
  return names[Math.floor(Math.random() * names.length)];
}

function edgeSpawn() {
  const m = 60; // 距边缘留白，避开 20px 边界墙
  const side = Math.floor(Math.random() * 4);
  const rx = () => m + Math.random() * (G.MAP.w - 2 * m);
  const ry = () => m + Math.random() * (G.MAP.h - 2 * m);
  const pos = side === 0 ? { x: rx(), y: m }
    : side === 1 ? { x: rx(), y: G.MAP.h - m }
    : side === 2 ? { x: m, y: ry() }
    : { x: G.MAP.w - m, y: ry() };
  return { id: ++eid, x: pos.x, y: pos.y, hp: G.MONSTER.hp, nextHit: 0 };
}

function nearest(list, x, y) {
  let best = null, bd = Infinity;
  for (const o of list) {
    const d = G.dist(x, y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
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
    bosses: room.bosses.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), hp: Math.round(b.hp), weapon: b.weapon })),
    bullets: room.bullets.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), size: b.size, boss: !!b.boss })),
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
    if (!m || typeof m !== 'object') return;
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
