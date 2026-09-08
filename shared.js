// shared.js — 双端共享。浏览器经 <script> 挂 window.GameShared；Node 经 require 使用。
// 所有游戏数值的唯一来源：调手感只改这个文件。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GameShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {

const MAP = { w: 3200, h: 1800 };
const TICK_MS = 50;

const PLAYER  = { r: 16, hpMax: 100, speed: 200, respawnMs: 3000, regenPerSec: 2, regenDelayMs: 3000 };
const MONSTER = { r: 14, hp: 50,  speed: 60, dmg: 10, cooldownMs: 1000, spawnEveryMs: 5000,  cap: 20 };
const BOSS    = { r: 32, hp: 300, speed: 80, dmg: 25, cooldownMs: 1000, spawnEveryMs: 40000, cap: 2 };
const ROOM    = { maxPlayers: 4, codeLen: 4 };

// 武器表：加武器 = 加一行；射击逻辑只读这张表
const WEAPONS = {
  pistol:  { rate: 300, dmg: 25, speed: 500, count: 1, spread: 0,  pierce: false, size: 3 },
  mg:      { rate: 100, dmg: 15, speed: 500, count: 1, spread: 0,  pierce: false, size: 3 },
  shotgun: { rate: 600, dmg: 15, speed: 500, count: 3, spread: 15, pierce: false, size: 3 },
  cannon:  { rate: 800, dmg: 60, speed: 300, count: 1, spread: 0,  pierce: true,  size: 8 },
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

const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

// 冷却未到 / 参数非法 → null；否则返回子弹数组（扇形以 dir 为中心对称展开）
function weaponFire(weaponKey, x, y, dir, now, lastFireAt, owner) {
  const w = WEAPONS[weaponKey];
  if (!w || !DIRS[dir] || now - lastFireAt < w.rate) return null;
  const base = Math.atan2(DIRS[dir].y, DIRS[dir].x);
  const spread = w.spread * Math.PI / 180;
  const bullets = [];
  for (let i = 0; i < w.count; i++) {
    const a = base + (i - (w.count - 1) / 2) * spread;
    bullets.push({
      x, y,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      dmg: w.dmg, size: w.size, pierce: w.pierce, owner,
    });
  }
  return bullets;
}

// 推进一颗子弹；false = 移除（出图或撞墙，穿透弹撞墙同样移除）
function bulletStep(b, dtSec, walls) {
  b.x += b.vx * dtSec;
  b.y += b.vy * dtSec;
  if (b.x < 0 || b.y < 0 || b.x > MAP.w || b.y > MAP.h) return false;
  return !walls.some(w => circleRectHit(b.x, b.y, b.size, w));
}

return { MAP, TICK_MS, PLAYER, MONSTER, BOSS, ROOM, WEAPONS, COLORS, WALLS, PLAYER_SPAWNS, BOSS_SPAWNS,
  dist, circleRectHit, moveWithWalls, DIRS, weaponFire, bulletStep };
});
