// shared.js — 双端共享。浏览器经 <script> 挂 window.GameShared；Node 经 require 使用。
// 所有游戏数值的唯一来源：调手感只改这个文件。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GameShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {

const TICK_MS = 33; // 30 tick/s：云端联机降体感延迟（按键等待+插值落后各 ~1/3 缩短）

// 受击僵持（不能攻击，移动不受影响）：无盾/碎盾 stunMs，被盾挡下 stunShieldedMs；击退同档减半
// shieldBreakRegenMs = 碎盾后不受击多久才开始回盾（未碎的普通回盾走 regenDelayMs）
// panic* = 低血肾上腺素：HP 低于 panicBelow 时每次受伤提速 panicMul 倍，持续 panicMs（再受伤刷新时长）
const PLAYER  = { r: 16, hpMax: 100, speed: 200, respawnMs: 3000, regenPerSec: 2, regenDelayMs: 3000,
  stunMs: 750, stunShieldedMs: 400, knockback: 24, knockbackShielded: 12, shieldBreakRegenMs: 20000,
  panicBelow: 50, panicMul: 1.3, panicMs: 3000 };
// 怪物公共参数（个体 r/hp/speed/dmg 在 MONSTER_TYPES）
const MONSTER = { cooldownMs: 1000,
  wallDmgPerSec: 30, // 啃可破坏墙每秒伤害
  knockback: 20, stunMs: 750, // 被子弹命中的击退/僵持（不能接触攻击）
  // 赶路速度分区：近距离（=视野半宽 640×1.2）内原速，中距 ×2，远距 ×3
  zoneClose: 768, zoneMid: 1920, midMul: 2, farMul: 3 };
const monsterSpeedMul = d => d <= MONSTER.zoneClose ? 1 : d <= MONSTER.zoneMid ? MONSTER.midMul : MONSTER.farMul;

// 怪物类型：normal 僵尸 / runner 疾行（小快脆）/ brute 重装（机器人壳，厚慢重击）/ spitter 喷吐（远程弹）
const MONSTER_TYPES = {
  normal:  { r: 14, hp: 50,  speed: 60,  dmg: 14, scale: 1 },
  runner:  { r: 11, hp: 30,  speed: 130, dmg: 8,  scale: 0.7 },
  brute:   { r: 20, hp: 250, speed: 45,  dmg: 25, scale: 1.4 },
  spitter: { r: 14, hp: 40,  speed: 55,  dmg: 10, scale: 0.9, range: 500, rateMs: 2500, bulletDmg: 12, bulletSpeed: 250 },
};
// 波次混编权重（低波次未解锁的类型权重归 normal）
function pickMonsterType(wave, r0) {
  const w = { normal: 0.6, runner: wave >= 2 ? 0.2 : 0, brute: wave >= 3 ? 0.1 : 0, spitter: wave >= 4 ? 0.1 : 0 };
  w.normal = 1 - w.runner - w.brute - w.spitter;
  if (r0 < w.runner) return 'runner';
  if (r0 < w.runner + w.brute) return 'brute';
  if (r0 < w.runner + w.brute + w.spitter) return 'spitter';
  return 'normal';
}
// 精英怪：5% 混入，血×4 体×1.25 伤×1.5，死亡必掉补给
const ELITE = { chance: 0.05, hpMul: 4, dmgMul: 1.5, scaleMul: 1.25 };
const PATH_CELL = 60;  // A* 网格边长（px）

// 波次怪潮：数量/HP/经验全走函数，diff = 难度乘数（将来菜单选项传不同 diff，room 存一个数字）
const WAVE = { baseCount: 14, perWave: 8, maxCount: 100, hpPerWave: 0.18,
  speedPerWave: 0.04, speedCapWaves: 8, restMs: 4000, firstDelayMs: 3000, suppliesPerRest: 2 };
const waveCount    = (wave, diff = 1) => Math.min(Math.round((WAVE.baseCount + WAVE.perWave * wave) * diff), WAVE.maxCount);
const waveHpMul    = (wave, diff = 1) => 1 + (wave - 1) * WAVE.hpPerWave * diff;
const waveSpeedMul = (wave, diff = 1) => 1 + Math.min(wave - 1, WAVE.speedCapWaves) * WAVE.speedPerWave;
const waveXp       = (wave, diff = 1) => Math.round((10 + (wave - 1) * 3) * diff);
const waveBossXp   = (wave, diff = 1) => Math.round((100 + (wave - 1) * 20) * diff);
// 近战前摇：第 1 波 0.7s 轻松躲，第 14 波起 50ms 贴到必中
const waveWindupMs = (wave, diff = 1) => Math.max(50, 550 - (wave - 1) * 50);

// 等级：上限 15，~30 分钟满级；p=进度，六属性倍率（将来加属性只改 levelMul）
// 满级：移速/伤害/护盾/弹速 ×2，换弹 ×2 快，射速 ×3
const LEVELS = { max: 15, shieldBase: 25, xpBase: 30, xpPow: 1.35 };
const levelMul = level => {
  const p = (Math.min(level, LEVELS.max) - 1) / (LEVELS.max - 1);
  return { speed: 1 + p, dmg: 1 + p, shield: 1 + p, bulletSpeed: 1 + p,
    reload: 1 / (1 + p), rate: 1 / (1 + 2 * p) };
};
const shieldMax = level => LEVELS.shieldBase * levelMul(level).shield;
const xpNeed = level => Math.round(LEVELS.xpBase * Math.pow(level, LEVELS.xpPow));
// 穿透数等级档：5 级 ×2 / 10 级 ×3 / 15 级 ×4
const levelPierceMul = level => level >= 15 ? 4 : level >= 10 ? 3 : level >= 5 ? 2 : 1;
// Boss：持枪远程（无碰撞伤害），视野 = 所持武器射程，移速缓慢；攻击节奏 = 开火 burstMs / 停火 restMs 交替
const BOSS    = { r: 32, hp: 450, speed: 40, spawnEveryMs: 25000, cap: 3, burstMs: 3000, restMs: 2000,
  knockback: 10, stunMs: 750 }; // 体型重击退小；被命中停火僵持
const ROOM    = { maxPlayers: 4, codeLen: 4 };

// 武器表：加武器 = 加一行；射击逻辑只读这张表。range = 子弹最大飞行距离（px）
// explode = 爆炸半径（0 不爆），explodeDmg = 爆炸 AOE 伤害：命中任何目标/撞墙/飞到终点都引爆
// pierce = 基础穿透数（子弹可命中 1 + pierce×等级倍率 个目标后消失；0 = 命中即消失）
// mag = 弹匣容量，reloadMs = 换弹时长（打空自动换弹 / R 键手动，期间不能开火）
const WEAPONS = {
  pistol:  { rate: 300, dmg: 25, speed: 1500, count: 1, spread: 0,  pierce: 1, size: 3, range: 600, mag: 12, reloadMs: 1500 },
  mg:      { rate: 100, dmg: 15, speed: 1500, count: 1, spread: 0,  pierce: 2, size: 3, range: 500, mag: 40, reloadMs: 2600 },
  shotgun: { rate: 600, dmg: 20, speed: 1500, count: 5, spread: 15, pierce: 3, size: 3, range: 400, mag: 5,  reloadMs: 2200 },
  rocket:  { rate: 1500, dmg: 30, speed: 1050, count: 1, spread: 0, pierce: 0, size: 8, range: 700, explode: 100, explodeDmg: 50, mag: 1, reloadMs: 3000 },
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
// opts = 等级倍率 { rateMul, speedMul, dmgMul }（缺省 1，Boss 不传）
function weaponFire(weaponKey, x, y, dir, now, lastFireAt, owner, opts) {
  const w = WEAPONS[weaponKey];
  const o = opts || {};
  if (!w || !dir || (!dir.x && !dir.y) || now - lastFireAt < w.rate * (o.rateMul || 1)) return null;
  const base = Math.atan2(dir.y, dir.x);
  const spread = w.spread * Math.PI / 180;
  const bullets = [];
  for (let i = 0; i < w.count; i++) {
    const a = base + (i - (w.count - 1) / 2) * spread;
    bullets.push({
      x, y,
      vx: Math.cos(a) * w.speed * (o.speedMul || 1), vy: Math.sin(a) * w.speed * (o.speedMul || 1),
      dmg: w.dmg * (o.dmgMul || 1), size: w.size, pierce: w.pierce, owner, range: w.range,
      maxHits: 1 + Math.round((w.pierce || 0) * (o.pierceMul || 1)), // 可命中目标数（穿透）
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

// 脱战 regenDelayMs 后回血（regenPerSec/s）；回盾（shieldMax/10 每秒）——碎盾后须不受击 shieldBreakRegenMs 才开始
function regenStep(p, now, dtSec) {
  if (p.deadUntil) return;
  if (now - p.lastDamagedAt >= PLAYER.regenDelayMs && p.hp < PLAYER.hpMax) {
    p.hp = Math.min(PLAYER.hpMax, p.hp + PLAYER.regenPerSec * dtSec);
  }
  const shieldDelay = (p.shield <= 0 && p.shieldBrokenAt) ? PLAYER.shieldBreakRegenMs : PLAYER.regenDelayMs;
  if (p.shieldMax && p.shield < p.shieldMax && now - p.lastDamagedAt >= shieldDelay) {
    p.shield = Math.min(p.shieldMax, p.shield + p.shieldMax / 10 * dtSec);
  }
}

// 网格 A* 寻路：不可破坏墙=不可pass，可破坏墙=高成本可pass（宁可绕路，封死才穿）
// 返回路点数组（格子中心）或 null（不可达）。纯函数，调用方自行限流
function findPath(walls, map, sx, sy, tx, ty, cell) {
  const cols = Math.ceil(map.w / cell), rows = Math.ceil(map.h / cell);
  const block = new Uint8Array(cols * rows);   // 255 不可pass
  const dcost = new Uint8Array(cols * rows);   // 可破坏墙成本
  for (const w of walls) {
    const x0 = Math.max(0, Math.floor(w.x / cell)), x1 = Math.min(cols - 1, Math.floor((w.x + w.w - 1) / cell));
    const y0 = Math.max(0, Math.floor(w.y / cell)), y1 = Math.min(rows - 1, Math.floor((w.y + w.h - 1) / cell));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * cols + x;
      if (w.destructible) dcost[i] = Math.max(dcost[i], 12);
      else block[i] = 255;
    }
  }
  const at = (x, y) => Math.min(cols - 1, Math.max(0, Math.floor(x / cell)))
    + Math.min(rows - 1, Math.max(0, Math.floor(y / cell))) * cols;
  // 起点/终点落在墙格里时，螺旋找最近的可pass格
  const fix = i => {
    if (block[i] !== 255) return i;
    const x0 = i % cols, y0 = (i / cols) | 0;
    for (let r = 1; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const j = y * cols + x;
        if (block[j] !== 255) return j;
      }
    }
    return i;
  };
  const si = fix(at(sx, sy)), ti = fix(at(tx, ty));
  if (si === ti) return [];
  const g = new Float64Array(cols * rows).fill(Infinity);
  const from = new Int32Array(cols * rows).fill(-1);
  const open = [si];
  g[si] = 0;
  const h = i => {
    const dx = Math.abs(i % cols - ti % cols), dy = Math.abs((i / cols | 0) - (ti / cols | 0));
    return dx + dy + 0.4 * Math.min(dx, dy); // octile
  };
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (g[open[k]] + h(open[k]) < g[open[bi]] + h(open[bi])) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === ti) {
      const path = [];
      for (let i = cur; i !== -1 && i !== si; i = from[i]) path.push({ x: (i % cols + 0.5) * cell, y: ((i / cols | 0) + 0.5) * cell });
      return path.reverse();
    }
    const cx = cur % cols, cy = cur / cols | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const ni = y * cols + x;
      if (block[ni] === 255) continue;
      if (dx && dy && (block[cy * cols + x] === 255 || block[y * cols + cx] === 255)) continue; // 禁穿角
      const step = (dx && dy ? 1.41 : 1) + dcost[ni];
      if (g[cur] + step >= g[ni]) continue;
      g[ni] = g[cur] + step;
      from[ni] = cur;
      open.push(ni);
    }
  }
  return null;
}

// 圆-圆推开：重叠则沿圆心线推到 minD  apart；aOnly=只推 a（敌人被玩家挡住滑行），否则各退一半；带撞墙检测
function separate(a, rA, b, rB, walls, aOnly) {
  const minD = rA + rB;
  let d = dist(a.x, a.y, b.x, b.y);
  if (d >= minD) return;
  if (d < 0.01) { d = 0.01; a.x += 0.5; }
  const ux = (a.x - b.x) / d, uy = (a.y - b.y) / d;
  const push = minD - d;
  const ma = moveWithWalls(a.x, a.y, ux * push * (aOnly ? 1 : 0.5), uy * push * (aOnly ? 1 : 0.5), rA, walls);
  a.x = ma.x; a.y = ma.y;
  if (!aOnly) {
    const mb = moveWithWalls(b.x, b.y, -ux * push * 0.5, -uy * push * 0.5, rB, walls);
    b.x = mb.x; b.y = mb.y;
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

return { MAPS, DEFAULT_MAP, TICK_MS, PLAYER, MONSTER, BOSS, ROOM, WEAPONS, COLORS, PATH_CELL,
  WAVE, waveCount, waveHpMul, waveSpeedMul, waveXp, waveBossXp, waveWindupMs,
  MONSTER_TYPES, pickMonsterType, ELITE,
  LEVELS, levelMul, shieldMax, xpNeed, levelPierceMul, monsterSpeedMul,
  dist, circleRectHit, moveWithWalls, fireDir, weaponFire, bulletStep,
  chaseStep, regenStep, findPath, separate, pickFarthestSpawn, pickBossSpawn };
});
