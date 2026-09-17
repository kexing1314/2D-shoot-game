// shared.js — 双端共享。浏览器经 <script> 挂 window.GameShared；Node 经 require 使用。
// 所有游戏数值的唯一来源：调手感只改这个文件。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GameShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {

const TICK_MS = 33; // 30 tick/s：云端联机降体感延迟（按键等待+插值落后各 ~1/3 缩短）

// fireStunMs = 受伤后停火硬直；knockback = 每次受击被推开的距离(px)
// panic* = 低血肾上腺素：HP 低于 panicBelow 时每次受伤提速 panicMul 倍，持续 panicMs（再受伤刷新时长）
const PLAYER  = { r: 16, hpMax: 100, speed: 200, respawnMs: 3000, regenPerSec: 2, regenDelayMs: 3000, fireStunMs: 500, knockback: 24,
  panicBelow: 50, panicMul: 1.3, panicMs: 3000 };
const MONSTER = { r: 14, hp: 50,  speed: 60, dmg: 10, cooldownMs: 1000, spawnEveryMs: 5000,  cap: 20 };
// Boss：持枪远程（无碰撞伤害），视野 = 所持武器射程，移速缓慢；攻击节奏 = 开火 burstMs / 停火 restMs 交替
const BOSS    = { r: 32, hp: 300, speed: 40, spawnEveryMs: 40000, cap: 2, burstMs: 3000, restMs: 2000 };
const ROOM    = { maxPlayers: 4, codeLen: 4 };

// 武器表：加武器 = 加一行；射击逻辑只读这张表。range = 子弹最大飞行距离（px）
// explode = 爆炸半径（0 不爆），explodeDmg = 爆炸 AOE 伤害：飞到射程终点或撞墙时引爆
// mag = 弹匣容量，reloadMs = 换弹时长（打空自动换弹 / R 键手动，期间不能开火）
const WEAPONS = {
  pistol:  { rate: 300, dmg: 25, speed: 500, count: 1, spread: 0,  pierce: false, size: 3, range: 600, mag: 12, reloadMs: 1500 },
  mg:      { rate: 100, dmg: 15, speed: 500, count: 1, spread: 0,  pierce: false, size: 3, range: 500, mag: 40, reloadMs: 2600 },
  shotgun: { rate: 600, dmg: 20, speed: 500, count: 5, spread: 15, pierce: false, size: 3, range: 400, mag: 5,  reloadMs: 2200 },
  cannon:  { rate: 800, dmg: 80, speed: 300, count: 1, spread: 0,  pierce: true,  size: 8, range: 640, explode: 160, explodeDmg: 40, mag: 2, reloadMs: 3000 },
};

const COLORS = ['#4a9eff', '#ff9f43', '#2ecc71', '#e84393'];

// 地图表：加地图 = 加一项；floor = 客户端地砖 key；walls = 边界墙（厚 20）+ 内部障碍
// 内部墙布局须避开 Boss 刷新点周边（空旷区），间距断言在 test.js 自动把关
function bounds(w, h) {
  return [
    { x: 0, y: 0, w, h: 20 }, { x: 0, y: h - 20, w, h: 20 },
    { x: 0, y: 0, w: 20, h }, { x: w - 20, y: 0, w: 20, h },
  ];
}
const MAPS = {
  grass: { // 中央十字堡垒围出环形走廊 + 四象限对称 L 掩体
    name: '草地要塞', floor: 'grass', w: 4800, h: 2700,
    walls: [...bounds(4800, 2700),
      { x: 2250, y: 1200, w: 300, h: 300 },
      { x: 2350, y: 700, w: 100, h: 500 }, { x: 2350, y: 1500, w: 100, h: 500 },
      { x: 1750, y: 1300, w: 500, h: 100 }, { x: 2550, y: 1300, w: 500, h: 100 },
      { x: 800, y: 800, w: 400, h: 60 }, { x: 800, y: 800, w: 60, h: 400 },
      { x: 3600, y: 800, w: 400, h: 60 }, { x: 3940, y: 800, w: 60, h: 400 },
      { x: 800, y: 1840, w: 400, h: 60 }, { x: 800, y: 1500, w: 60, h: 400 },
      { x: 3600, y: 1840, w: 400, h: 60 }, { x: 3940, y: 1500, w: 60, h: 400 },
      { x: 1400, y: 1300, w: 120, h: 120 }, { x: 3280, y: 1300, w: 120, h: 120 },
      { x: 2340, y: 380, w: 120, h: 120 }, { x: 2340, y: 2200, w: 120, h: 120 }],
    playerSpawns: [{ x: 250, y: 250 }, { x: 4550, y: 250 }, { x: 250, y: 2450 }, { x: 4550, y: 2450 }],
    bossSpawns: [{ x: 600, y: 2100 }, { x: 4200, y: 600 }, { x: 2400, y: 2500 }],
  },
  desert: { // 中央环形废墟（四边留门洞）+ 角落残垣
    name: '沙漠废墟', floor: 'dirt', w: 4800, h: 2700,
    walls: [...bounds(4800, 2700),
      { x: 1900, y: 900, w: 400, h: 80 }, { x: 2500, y: 900, w: 400, h: 80 },
      { x: 1900, y: 1720, w: 400, h: 80 }, { x: 2500, y: 1720, w: 400, h: 80 },
      { x: 1900, y: 900, w: 80, h: 900 }, { x: 2820, y: 900, w: 80, h: 900 },
      { x: 500, y: 1200, w: 180, h: 180 }, { x: 4120, y: 1200, w: 180, h: 180 },
      { x: 1200, y: 2200, w: 180, h: 180 }, { x: 3420, y: 2200, w: 180, h: 180 },
      { x: 1200, y: 320, w: 180, h: 180 }, { x: 3420, y: 320, w: 180, h: 180 }],
    playerSpawns: [{ x: 250, y: 250 }, { x: 4550, y: 250 }, { x: 250, y: 2450 }, { x: 4550, y: 2450 }],
    bossSpawns: [{ x: 2400, y: 450 }, { x: 700, y: 2300 }, { x: 3800, y: 2400 }],
  },
  ice: { // 三道横墙夹两条长廊 + 中心站房
    name: '冰原站台', floor: 'ice', w: 4200, h: 2400,
    walls: [...bounds(4200, 2400),
      { x: 600, y: 800, w: 1200, h: 60 }, { x: 2400, y: 800, w: 1200, h: 60 },
      { x: 600, y: 1540, w: 1200, h: 60 }, { x: 2400, y: 1540, w: 1200, h: 60 },
      { x: 1900, y: 1050, w: 400, h: 300 }],
    playerSpawns: [{ x: 250, y: 250 }, { x: 3950, y: 250 }, { x: 250, y: 2150 }, { x: 3950, y: 2150 }],
    bossSpawns: [{ x: 2100, y: 300 }, { x: 2100, y: 2100 }, { x: 300, y: 1200 }],
  },
  clay: { // 交错断墙形成蛇形通道
    name: '陶土峡谷', floor: 'clay', w: 5200, h: 2600,
    walls: [...bounds(5200, 2600),
      { x: 1200, y: 200, w: 60, h: 1000 }, { x: 2000, y: 1400, w: 60, h: 1000 },
      { x: 2800, y: 200, w: 60, h: 1000 }, { x: 3600, y: 1400, w: 60, h: 1000 },
      { x: 4400, y: 200, w: 60, h: 1000 },
      { x: 600, y: 1300, w: 140, h: 140 }, { x: 2500, y: 1200, w: 140, h: 140 },
      { x: 4700, y: 1300, w: 140, h: 140 }],
    playerSpawns: [{ x: 250, y: 250 }, { x: 4950, y: 250 }, { x: 250, y: 2350 }, { x: 4950, y: 2350 }],
    bossSpawns: [{ x: 600, y: 400 }, { x: 2600, y: 2200 }, { x: 4750, y: 400 }],
  },
};
const DEFAULT_MAP = 'grass';

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
      explode: w.explode || 0, explodeDmg: w.explodeDmg || 0,
    });
  }
  return bullets;
}

// 推进一颗子弹；false = 移除（射程耗尽、出图或撞墙，穿透弹撞墙同样移除）。map = 地图表项
function bulletStep(b, dtSec, map) {
  b.range -= Math.hypot(b.vx, b.vy) * dtSec;
  b.x += b.vx * dtSec;
  b.y += b.vy * dtSec;
  if (b.range <= 0) return false;
  if (b.x < 0 || b.y < 0 || b.x > map.w || b.y > map.h) return false;
  return !map.walls.some(w => circleRectHit(b.x, b.y, b.size, w));
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

return { MAPS, DEFAULT_MAP, TICK_MS, PLAYER, MONSTER, BOSS, ROOM, WEAPONS, COLORS,
  dist, circleRectHit, moveWithWalls, fireDir, weaponFire, bulletStep,
  chaseStep, regenStep, pickFarthestSpawn, pickBossSpawn };
});
