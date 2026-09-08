// test.js — node test.js 直接运行，全过打印 all tests passed
const assert = require('node:assert');
const G = require('./shared.js');

// —— Task 1: 数据有效性 ——
// 点 (px,py) 距矩形边缘是否小于 d
const near = (px, py, w, d) => px + d > w.x && px - d < w.x + w.w && py + d > w.y && py - d < w.y + w.h;

assert.equal(G.TICK_MS, 50);
assert.ok(G.COLORS.length >= G.ROOM.maxPlayers, '颜色数须不少于最大玩家数');

for (const w of G.WALLS) {
  assert.ok(w.x >= 0 && w.y >= 0 && w.x + w.w <= G.MAP.w && w.y + w.h <= G.MAP.h,
    '墙越界: ' + JSON.stringify(w));
}
for (const s of G.BOSS_SPAWNS) {
  for (const w of G.WALLS) {
    assert.ok(!near(s.x, s.y, w, 150), 'Boss 刷新点距墙须 >150px: ' + JSON.stringify(s));
  }
}
for (const s of G.PLAYER_SPAWNS) {
  for (const w of G.WALLS) {
    assert.ok(!near(s.x, s.y, w, 40), '玩家刷新点撞墙: ' + JSON.stringify(s));
  }
}
for (const [name, wp] of Object.entries(G.WEAPONS)) {
  for (const f of ['rate', 'dmg', 'speed', 'count', 'spread', 'pierce', 'size']) {
    assert.ok(f in wp, `武器 ${name} 缺字段 ${f}`);
  }
}

// —— Task 2: 几何与移动 ——
assert.equal(G.dist(0, 0, 3, 4), 5);

// 圆 (90,100) r16 vs 墙 x∈[100,120]：最近点 (100,100)，距 10 < 16 → 命中
assert.equal(G.circleRectHit(90, 100, 16, { x: 100, y: 0, w: 20, h: 200 }), true);
// 距 50 > 16 → 未命中
assert.equal(G.circleRectHit(50, 100, 16, { x: 100, y: 0, w: 20, h: 200 }), false);

// X 方向被墙挡住（100+60=160 撞进墙），Y 方向自由 → 贴墙滑动
{
  const wall = [{ x: 100, y: 0, w: 20, h: 200 }];
  const p = G.moveWithWalls(50, 50, 60, 30, 16, wall);
  assert.equal(p.x, 50);   // X 被挡，回到原位
  assert.equal(p.y, 80);   // Y 照常
}
// 空旷处自由移动
{
  const p = G.moveWithWalls(500, 500, 10, -10, 16, G.WALLS);
  assert.equal(p.x, 510);
  assert.equal(p.y, 490);
}

// —— Task 3: 射击与子弹 ——
{
  const bs = G.weaponFire('pistol', 0, 0, 'right', 1000, 0, 'p1');
  assert.equal(bs.length, 1);
  assert.deepEqual({ dmg: bs[0].dmg, vx: bs[0].vx, vy: bs[0].vy, owner: bs[0].owner, pierce: bs[0].pierce },
    { dmg: 25, vx: 500, vy: 0, owner: 'p1', pierce: false });
  // 冷却未到（200ms < 300ms）→ null
  assert.equal(G.weaponFire('pistol', 0, 0, 'right', 1200, 1000, 'p1'), null);
  // 未知武器 / 非法方向 → null
  assert.equal(G.weaponFire('nope', 0, 0, 'right', 9e9, 0, 'p1'), null);
  assert.equal(G.weaponFire('pistol', 0, 0, 'nope', 9e9, 0, 'p1'), null);
}
{
  // 霰弹 3 颗扇形：朝 right 时 vy 分别 <0 / =0 / >0
  const sg = G.weaponFire('shotgun', 0, 0, 'right', 5000, 0, 'p1');
  assert.equal(sg.length, 3);
  assert.ok(sg[0].vy < 0);
  assert.ok(Math.abs(sg[1].vy) < 1e-9);
  assert.ok(sg[2].vy > 0);
}
{
  // 重炮：慢速大弹、穿透
  const cn = G.weaponFire('cannon', 0, 0, 'left', 9000, 0, 'p1');
  assert.equal(cn[0].pierce, true);
  assert.equal(cn[0].vx, -300);
  assert.equal(cn[0].size, 8);
}
{
  const b = { x: 100, y: 100, vx: 500, vy: 0, size: 3, pierce: false };
  assert.equal(G.bulletStep(b, 0.05, []), true);
  assert.equal(b.x, 125);
  // 撞墙移除
  const b2 = { x: 190, y: 100, vx: 500, vy: 0, size: 3, pierce: true };
  assert.equal(G.bulletStep(b2, 0.05, [{ x: 200, y: 0, w: 20, h: 200 }]), false);
  // 出图移除（穿透弹也一样）
  const b3 = { x: 3190, y: 100, vx: 500, vy: 0, size: 3, pierce: true };
  assert.equal(G.bulletStep(b3, 0.05, []), false);
}

console.log('all tests passed');
