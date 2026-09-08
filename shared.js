// shared.js — 双端共享。浏览器经 <script> 挂 window.GameShared；Node 经 require 使用。
// 所有游戏数值的唯一来源：调手感只改这个文件。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GameShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {

const MAP = { w: 3200, h: 1800 };
const TICK_MS = 50;

// fireStunMs = 受伤后停火硬直；knockback = 每次受击被推开的距离(px)
// panic* = 低血肾上腺素：HP 低于 panicBelow 时每次受伤提速 panicMul 倍，持续 panicMs（再受伤刷新时长）
const PLAYER  = { r: 16, hpMax: 100, speed: 200, respawnMs: 3000, regenPerSec: 2, regenDelayMs: 3000, fireStunMs: 500, knockback: 24,
  panicBelow: 50, panicMul: 1.3, panicMs: 3000 };
const MONSTER = { r: 14, hp: 50,  speed: 60, dmg: 10, cooldownMs: 1000, spawnEveryMs: 5000,  cap: 20 };
// Boss：持枪远程（无碰撞伤害），视野 = 所持武器射程，移速缓慢；攻击节奏 = 开火 burstMs / 停火 restMs 交替
const BOSS    = { r: 32, hp: 300, speed: 40, spawnEveryMs: 40000, cap: 2, burstMs: 3000, restMs: 2000 };
const ROOM    = { maxPlayers: 4, codeLen: 4 };

// 武器表：加武器 = 加一行；射击逻辑只读这张表。range = 子弹最大飞行距离（px）
const WEAPONS = {
  pistol:  { rate: 300, dmg: 25, speed: 500, count: 1, spread: 0,  pierce: false, size: 3, range: 600 },
  mg:      { rate: 100, dmg: 15, speed: 500, count: 1, spread: 0,  pierce: false, size: 3, range: 500 },
  shotgun: { rate: 600, dmg: 15, speed: 500, count: 5, spread: 15, pierce: false, size: 3, range: 400 },
  cannon:  { rate: 800, dmg: 60, speed: 300, count: 1, spread: 0,  pierce: true,  size: 8, range: 1100 },
};

const COLORS = ['#4a9eff', '#ff9f43', '#2ecc71', '#e84393'];

// 四周边界墙（厚 20）+ 内部障碍。内部墙布局须避开 Boss 刷新点周边（空旷区）
const WALLS = [
  { x: 0, y: 0, w: MAP.w, h: 20 },
  { x: 0, y: MAP.h - 20, w: MAP.w, h: 20 },
  { x: 0, y: 0, w: 20, h: MAP.h },
  { x: MAP.w - 20, y: 0, w: 20, h: MAP.h },
  { x: 700,  y: 400,  w: 240, h: 40 },
  { x: 1500, y: 300,  w: 40,  h: 300 },
  { x: 2200, y: 500,  w: 300, h: 40 },
  { x: 900,  y: 1000, w: 40,  h: 350 },
  { x: 1300, y: 800,  w: 200, h: 200 },
  { x: 1600, y: 1200, w: 400, h: 40 },
  { x: 2400, y: 1100, w: 40,  h: 300 },
];

// 重生点：四角。重生时选离其他玩家最远的
const PLAYER_SPAWNS = [
  { x: 200, y: 200 }, { x: 3000, y: 200 },
  { x: 200, y: 1600 }, { x: 3000, y: 1600 },
];

// Boss 固定刷新点（周边空旷，形成天然争夺区）
const BOSS_SPAWNS = [
  { x: 400, y: 1500 }, { x: 2800, y: 300 }, { x: 1600, y: 1500 },
];

function dist(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

function circleRectHit(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return dist(cx, cy, nx, ny) < r;
}

// 轴分离碰撞：先试 X 再试 Y，被挡的轴不动（贴墙滑动）
function moveWithWalls(x, y, dx, dy, r, walls) {
  let nx = x + dx;
  if (walls.some(w => circleRectHit(nx, y, r, w))) nx = x;
  let ny = y + dy;
  if (walls.some(w => circleRectHit(nx, ny, r, w))) ny = y;
  return { x: nx, y: ny };
}

// 方向键合成射击方向：右−左、下−上；两键同按出斜向，对键抵消；全零 → null
function fireDir(keys) {
  const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (!dx && !dy) return null;
  const l = Math.hypot(dx, dy);
  return { x: dx / l, y: dy / l };
}

// dir = 单位向量 {x,y}。冷却未到 / 参数非法 → null；否则返回子弹数组（扇形以 dir 为中心对称展开）
function weaponFire(weaponKey, x, y, dir, now, lastFireAt, owner) {
  const w = WEAPONS[weaponKey];
  if (!w || !dir || (!dir.x && !dir.y) || now - lastFireAt < w.rate) return null;
  const base = Math.atan2(dir.y, dir.x);
  const spread = w.spread * Math.PI / 180;
  const bullets = [];
  for (let i = 0; i < w.count; i++) {
    const a = base + (i - (w.count - 1) / 2) * spread;
    bullets.push({
      x, y,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      dmg: w.dmg, size: w.size, pierce: w.pierce, owner, range: w.range,
    });
  }
  return bullets;
}

// 推进一颗子弹；false = 移除（射程耗尽、出图或撞墙，穿透弹撞墙同样移除）
function bulletStep(b, dtSec, walls) {
  b.range -= Math.hypot(b.vx, b.vy) * dtSec;
  b.x += b.vx * dtSec;
  b.y += b.vy * dtSec;
  if (b.range <= 0) return false;
  if (b.x < 0 || b.y < 0 || b.x > MAP.w || b.y > MAP.h) return false;
  return !walls.some(w => circleRectHit(b.x, b.y, b.size, w));
}

// 直线追击（受墙阻挡；不做寻路——被墙卡住属可接受行为）
function chaseStep(e, r, target, speed, dtSec, walls) {
  if (!target) return;
  const d = dist(e.x, e.y, target.x, target.y);
  if (d === 0) return;
  const p = moveWithWalls(e.x, e.y,
    (target.x - e.x) / d * speed * dtSec,
    (target.y - e.y) / d * speed * dtSec, r, walls);
  e.x = p.x; e.y = p.y;
}

// 脱战 regenDelayMs 后每秒回 regenPerSec，hpMax 封顶
function regenStep(p, now, dtSec) {
  if (p.deadUntil) return;
  if (now - p.lastDamagedAt >= PLAYER.regenDelayMs && p.hp < PLAYER.hpMax) {
    p.hp = Math.min(PLAYER.hpMax, p.hp + PLAYER.regenPerSec * dtSec);
  }
}

function pickFarthestSpawn(spawns, others) {
  let best = spawns[0], bestD = -1;
  for (const s of spawns) {
    const d = others.length ? Math.min(...others.map(o => dist(s.x, s.y, o.x, o.y))) : Infinity;
    if (d > bestD) { bestD = d; best = s; }
  }
  return best;
}

function pickBossSpawn(spawns, bosses, players) {
  const free = spawns.filter(s => !bosses.some(b => dist(b.x, b.y, s.x, s.y) < 100));
  if (!free.length) return null;
  return pickFarthestSpawn(free, players);
}

return { MAP, TICK_MS, PLAYER, MONSTER, BOSS, ROOM, WEAPONS, COLORS, WALLS, PLAYER_SPAWNS, BOSS_SPAWNS,
  dist, circleRectHit, moveWithWalls, fireDir, weaponFire, bulletStep,
  chaseStep, regenStep, pickFarthestSpawn, pickBossSpawn };
});
