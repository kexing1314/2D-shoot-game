// server.js — 权威服务器：静态托管 + WebSocket 房间 + 游戏循环
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const G = require('./shared.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

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
  for (const key of ['w', 'a', 's', 'd', 'up', 'down', 'left', 'right', 'r']) out[key] = !!k[key];
  return out;
}

function enterRoom(ws, room, name) {
  const id = 'p' + (++eid);
  const used = new Set([...room.players.values()].map(p => p.color));
  const color = G.COLORS.find(c => !used.has(c)) || G.COLORS[0];
  const others = [...room.players.values()].filter(p => !p.deadUntil);
  const s = G.pickFarthestSpawn(room.map.playerSpawns, others);
  const p = {
    id, ws, name: String(name || '玩家').slice(0, 12), color,
    x: s.x, y: s.y, hp: G.PLAYER.hpMax, weapon: 'pistol',
    kills: 0, deaths: 0, keys: {},
    lastFire: -1e9, lastDamagedAt: -1e9, deadUntil: 0,
    ammo: G.WEAPONS.pistol.mag, reloadUntil: 0, prevR: false,
  };
  room.players.set(id, p);
  ws.room = room; ws.playerId = id;
  send(ws, { t: 'joined', id, code: room.code, color, map: room.mapKey });
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
      const speed = G.PLAYER.speed * (now < (p.panicUntil || 0) ? G.PLAYER.panicMul : 1); // 低血加速
      const m = G.moveWithWalls(p.x, p.y,
        dx / l * speed * dt, dy / l * speed * dt,
        G.PLAYER.r, room.walls);
      p.x = m.x; p.y = m.y;
    }
    G.regenStep(p, now, dt);

    // 换弹：打空自动 / R 键手动（边沿触发防按住连换）；立即补满弹匣，换弹期间不能开火
    const w = G.WEAPONS[p.weapon];
    if (now >= p.reloadUntil && (p.ammo <= 0 || (p.keys.r && !p.prevR && p.ammo < w.mag))) {
      p.ammo = w.mag;
      p.reloadUntil = now + w.reloadMs;
    }
    p.prevR = !!p.keys.r;

    // 射击：方向键合成向量（两键同按斜射，对键抵消不开火）；受伤硬直/换弹期内停火
    const dir = now >= (p.fireStunUntil || 0) && now >= p.reloadUntil ? G.fireDir(p.keys) : null;
    if (dir) {
      const bs = G.weaponFire(p.weapon, p.x, p.y, dir, now, p.lastFire, p.id);
      if (bs) { p.ammo--; p.lastFire = now; p.face = dir; for (const x of bs) x.id = ++eid; room.bullets.push(...bs); }
    }
  }

  // 2. 子弹：推进 + 命中（爆炸弹在射程耗尽/撞墙处引爆）
  room.bullets = room.bullets.filter(b => {
    if (!G.bulletStep(b, dt, room.view)) {
      if (b.explode) boom(room, b, now);
      return false;
    }
    // 命中玩家（不打自己、不打死人）
    for (const p of room.players.values()) {
      if (p.id === b.owner || p.deadUntil) continue;
      if (G.dist(b.x, b.y, p.x, p.y) >= G.PLAYER.r + b.size) continue;
      if (b.pierce) {
        b.hitIds = b.hitIds || [];
        if (b.hitIds.includes(p.id)) continue;
        b.hitIds.push(p.id);
        damagePlayer(room, p, b.dmg, b.owner, now, b);
      } else {
        damagePlayer(room, p, b.dmg, b.owner, now, b);
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
        damageMonster(room, list, i, b.dmg, isBoss, b.owner);
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
        p.ammo = G.WEAPONS[pk.weapon].mag; p.reloadUntil = 0; // 换枪即满弹
        return false;
      }
    }
    return true;
  });

  // 4a. 怪物：A* 绕不可破坏墙追最近活人；可破坏墙挡路站定啃穿；接触伤害 + 冷却
  const alive = [...room.players.values()].filter(p => !p.deadUntil);
  for (const m of room.monsters) {
    const target = nearest(alive, m.x, m.y);
    stepAlongPath(room, m, G.MONSTER.r, target, G.MONSTER.speed, dt, now, 500);
    if (target && now >= m.nextHit && G.dist(m.x, m.y, target.x, target.y) < G.MONSTER.r + G.PLAYER.r) {
      damagePlayer(room, target, G.MONSTER.dmg, null, now, m);
      m.nextHit = now + G.MONSTER.cooldownMs;
    }
  }
  // 4b. Boss：同样绕路追击；玩家进入所持武器射程（= 视野）内则朝其精确角度开火
  for (const bs of room.bosses) {
    const target = nearest(alive, bs.x, bs.y);
    stepAlongPath(room, bs, G.BOSS.r, target, G.BOSS.speed, dt, now, 600);
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
      for (const s of shots) { s.boss = true; s.id = ++eid; }
      room.bullets.push(...shots);
    }
  }

  // 5. 刷怪（房间里有人就刷；全部重生中也刷）
  if (room.players.size > 0) {
    if (now - room.lastMonster >= G.MONSTER.spawnEveryMs && room.monsters.length < G.MONSTER.cap) {
      room.lastMonster = now;
      room.monsters.push(edgeSpawn(room.map));
    }
    if (now - room.lastBoss >= G.BOSS.spawnEveryMs && room.bosses.length < G.BOSS.cap) {
      const s = G.pickBossSpawn(room.map.bossSpawns, room.bosses, alive);
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
  const s = G.pickFarthestSpawn(room.map.playerSpawns, others);
  p.x = s.x; p.y = s.y;
  p.hp = G.PLAYER.hpMax;
  p.deadUntil = 0;
  p.lastDamagedAt = now; // 重生后也走 3s 脱战才回血
  p.weapon = 'pistol';
  p.ammo = G.WEAPONS.pistol.mag; p.reloadUntil = 0;
  p.keys = {};
  p.lastFire = now;
}

// src = 伤害来源位置（子弹/怪物），用于击退方向；缺省不击退
function damagePlayer(room, p, dmg, attackerId, now, src) {
  if (p.deadUntil) return; // 已死亡玩家不再受伤（防止同tick多怪重复计死亡）
  p.hp -= dmg;
  p.lastDamagedAt = now;
  p.fireStunUntil = now + G.PLAYER.fireStunMs; // 受伤硬直：暂停射击（移动不受影响）
  if (src) {
    // 击退：沿 src→玩家 方向推 knockback px，撞墙检测（打不进墙）
    const d = G.dist(src.x, src.y, p.x, p.y) || 1;
    const m = G.moveWithWalls(p.x, p.y,
      (p.x - src.x) / d * G.PLAYER.knockback, (p.y - src.y) / d * G.PLAYER.knockback,
      G.PLAYER.r, room.walls);
    p.x = m.x; p.y = m.y;
  }
  if (p.hp > 0) {
    // 低血肾上腺素：HP 低于 panicBelow 时每次受伤提速，再受伤刷新时长
    if (p.hp < G.PLAYER.panicBelow) p.panicUntil = now + G.PLAYER.panicMs;
    return;
  }
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
  p.ammo = G.WEAPONS.pistol.mag; p.reloadUntil = 0;
}

// 沿 A* 路径推进（限流重算 + id 错峰）；下一歩撞可破坏墙则站定啃墙（MONSTER.wallDmgPerSec，啃穿移除）
function stepAlongPath(room, e, r, target, speed, dt, now, period) {
  if (target && now >= (e.nextPath || 0)) {
    e.nextPath = now + period + (e.id % 5) * 80;
    e.path = G.findPath(room.walls, room.map, e.x, e.y, target.x, target.y, G.PATH_CELL);
  }
  if (e.path && e.path.length && G.dist(e.x, e.y, e.path[0].x, e.path[0].y) < G.PATH_CELL * 0.6) e.path.shift();
  const wp = (e.path && e.path[0]) || target; // 无路径（全封死）才直线
  if (!wp) return;
  const d = G.dist(e.x, e.y, wp.x, wp.y) || 1;
  const nx = (wp.x - e.x) / d * speed * dt, ny = (wp.y - e.y) / d * speed * dt;
  const chew = room.walls.find(w => w.destructible && G.circleRectHit(e.x + nx, e.y + ny, r, w));
  if (chew) {
    chew.hp -= G.MONSTER.wallDmgPerSec * dt;
    if (chew.hp <= 0) room.walls.splice(room.walls.indexOf(chew), 1);
    return;
  }
  const m = G.moveWithWalls(e.x, e.y, nx, ny, r, room.walls);
  e.x = m.x; e.y = m.y;
}

// 对怪物/Boss 结算伤害；死亡则移出数组、记击杀、Boss 掉落所持武器（争夺点）
function damageMonster(room, list, i, dmg, isBoss, killerId) {
  const m = list[i];
  m.hp -= dmg;
  if (m.hp > 0) return;
  list.splice(i, 1);
  const killer = room.players.get(killerId);
  if (killer) killer.kills++;
  if (isBoss) room.pickups.push({ id: ++eid, x: m.x, y: m.y, weapon: m.weapon });
}

// 爆炸弹引爆：AOE 伤玩家（不伤射手/死人，沿爆心→玩家击退）；Boss 弹只炸玩家，不炸怪/其他 Boss
function boom(room, b, now) {
  for (const p of room.players.values()) {
    if (p.id === b.owner || p.deadUntil) continue;
    if (G.dist(b.x, b.y, p.x, p.y) > b.explode + G.PLAYER.r) continue;
    damagePlayer(room, p, b.explodeDmg, b.owner, now, b);
  }
  if (b.boss) return;
  for (const [list, r, isBoss] of [[room.monsters, G.MONSTER.r, false], [room.bosses, G.BOSS.r, true]]) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (G.dist(b.x, b.y, list[i].x, list[i].y) > b.explode + r) continue;
      damageMonster(room, list, i, b.explodeDmg, isBoss, b.owner);
    }
  }
}

function dropWeapon() {
  const names = Object.keys(G.WEAPONS).filter(w => w !== 'pistol');
  return names[Math.floor(Math.random() * names.length)];
}

function edgeSpawn(map) {
  const m = 60; // 距边缘留白，避开 20px 边界墙
  const side = Math.floor(Math.random() * 4);
  const rx = () => m + Math.random() * (map.w - 2 * m);
  const ry = () => m + Math.random() * (map.h - 2 * m);
  const pos = side === 0 ? { x: rx(), y: m }
    : side === 1 ? { x: rx(), y: map.h - m }
    : side === 2 ? { x: m, y: ry() }
    : { x: map.w - m, y: ry() };
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
      weapon: p.weapon, kills: p.kills, deaths: p.deaths, face: p.face,
      ammo: p.ammo, reloading: now < p.reloadUntil,
      boost: p.panicUntil > now, // 低血加速中（客户端画残影提示）
      respawnIn: p.deadUntil ? Math.max(1, Math.ceil((p.deadUntil - now) / 1000)) : 0,
    })),
    // 实体带 id：客户端按 id 匹配前后帧做插值与死亡/消失特效
    monsters: room.monsters.map(m => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y) })),
    bosses: room.bosses.map(b => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), hp: Math.round(b.hp), weapon: b.weapon })),
    bullets: room.bullets.map(b => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), size: b.size, boss: !!b.boss, boom: b.explode || 0 })), // boom = 爆炸半径（0 不爆），客户端冲击波圈与实际伤害范围一致
    pickups: room.pickups.map(pk => ({ id: pk.id, x: Math.round(pk.x), y: Math.round(pk.y), weapon: pk.weapon })),
    // 可破坏墙（地图初始墙不可破坏、不广播；将来玩家放置墙走这里，被啃穿即从列表消失）
    walls: room.walls.filter(w => w.destructible).map(w => ({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h, hp: Math.round(w.hp) })),
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
      const mapKey = G.MAPS[m.map] ? m.map : G.DEFAULT_MAP; // 房主选图，非法值回退默认
      const room = {
        code, mapKey, map: G.MAPS[mapKey],
        // 每房间墙副本：地图模板不可变；可破坏墙/将来玩家放置墙改这份
        walls: G.MAPS[mapKey].walls.map(w => ({ ...w, id: ++eid, destructible: false, hp: Infinity })),
        players: new Map(), monsters: [], bosses: [], bullets: [], pickups: [],
        timer: null, lastMonster: Date.now(), lastBoss: Date.now(),
      };
      room.view = { w: room.map.w, h: room.map.h, walls: room.walls }; // bulletStep 的地图参数
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
