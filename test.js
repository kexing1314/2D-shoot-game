// test.js — node test.js 直接运行，全过打印 all tests passed
const assert = require('node:assert');
const G = require('./shared.js');

// —— Task 1: 数据有效性 ——
// 点 (px,py) 距矩形边缘是否小于 d
const near = (px, py, w, d) => px + d > w.x && px - d < w.x + w.w && py + d > w.y && py - d < w.y + w.h;

assert.equal(G.TICK_MS, 33);
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
  for (const f of ['rate', 'dmg', 'speed', 'count', 'spread', 'pierce', 'size', 'range', 'mag', 'reloadMs']) {
    assert.ok(f in wp, `武器 ${name} 缺字段 ${f}`);
  }
  assert.ok(wp.mag > 0 && wp.reloadMs > 0, `武器 ${name} 弹匣/换弹时长须为正`);
}
// 换弹数值：手枪 12发/1.5s、机枪 40/2.6s、霰弹 5/2.2s、加农 2/3s
assert.deepEqual(Object.entries(G.WEAPONS).map(([, w]) => [w.mag, w.reloadMs]),
  [[12, 1500], [40, 2600], [5, 2200], [2, 3000]]);

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
  // fireDir：单键 / 双键斜向 / 对键抵消 / 全空
  assert.deepEqual(G.fireDir({ right: true }), { x: 1, y: 0 });
  {
    const d = G.fireDir({ right: true, up: true });
    assert.ok(Math.abs(d.x - Math.SQRT1_2) < 1e-9);
    assert.ok(Math.abs(d.y + Math.SQRT1_2) < 1e-9);
  }
  assert.equal(G.fireDir({ left: true, right: true }), null);
  assert.equal(G.fireDir({}), null);
}
{
  const bs = G.weaponFire('pistol', 0, 0, { x: 1, y: 0 }, 1000, 0, 'p1');
  assert.equal(bs.length, 1);
  assert.deepEqual({ dmg: bs[0].dmg, vx: bs[0].vx, vy: bs[0].vy, owner: bs[0].owner, pierce: bs[0].pierce, range: bs[0].range },
    { dmg: 25, vx: 500, vy: 0, owner: 'p1', pierce: false, range: 600 });
  // 冷却未到（200ms < 300ms）→ null
  assert.equal(G.weaponFire('pistol', 0, 0, { x: 1, y: 0 }, 1200, 1000, 'p1'), null);
  // 未知武器 / 非法方向（null、零向量）→ null
  assert.equal(G.weaponFire('nope', 0, 0, { x: 1, y: 0 }, 9e9, 0, 'p1'), null);
  assert.equal(G.weaponFire('pistol', 0, 0, null, 9e9, 0, 'p1'), null);
  assert.equal(G.weaponFire('pistol', 0, 0, { x: 0, y: 0 }, 9e9, 0, 'p1'), null);
}
{
  // 斜向射击：45° 方向 vx=vy（速度 500/√2）
  const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  const bs = G.weaponFire('pistol', 0, 0, d, 9e9, 0, 'p1');
  assert.ok(Math.abs(bs[0].vx - 500 * Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(bs[0].vy - 500 * Math.SQRT1_2) < 1e-9);
}
{
  // 霰弹 5 颗扇形：朝 right 时 vy 依次 <0 / <0 / =0 / >0 / >0
  const sg = G.weaponFire('shotgun', 0, 0, { x: 1, y: 0 }, 5000, 0, 'p1');
  assert.equal(sg.length, 5);
  assert.ok(sg[0].vy < 0);
  assert.ok(sg[1].vy < 0);
  assert.ok(Math.abs(sg[2].vy) < 1e-9);
  assert.ok(sg[3].vy > 0);
  assert.ok(sg[4].vy > 0);
  // 斜向中心展开：朝 45° 时全部子弹 vx>0 且 vy>0 分量存在
  const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  const sg2 = G.weaponFire('shotgun', 0, 0, d, 9e9, 0, 'p1');
  assert.equal(sg2.length, 5);
  assert.ok(sg2.every(b => b.vx > 0));
}
{
  // 重炮：慢速大弹、穿透、射程终点爆炸（直击 80 / 爆炸 40 / 半径 160 / 射程 640 = 横向视野一半）
  const cn = G.weaponFire('cannon', 0, 0, { x: -1, y: 0 }, 9000, 0, 'p1');
  assert.equal(cn[0].pierce, true);
  assert.equal(cn[0].vx, -300);
  assert.equal(cn[0].size, 8);
  assert.equal(cn[0].dmg, 80);
  assert.equal(cn[0].range, 640);
  assert.equal(cn[0].explode, 160);
  assert.equal(cn[0].explodeDmg, 40);
  // 非爆炸武器 explode = 0
  const ps = G.weaponFire('pistol', 0, 0, { x: 1, y: 0 }, 9000, 0, 'p1');
  assert.equal(ps[0].explode, 0);
  assert.equal(ps[0].explodeDmg, 0);
}
{
  const b = { x: 100, y: 100, vx: 500, vy: 0, size: 3, pierce: false, range: 600 };
  assert.equal(G.bulletStep(b, 0.05, []), true);
  assert.equal(b.x, 125);
  assert.equal(b.range, 575); // 每 tick 扣飞行距离 500×0.05=25
  // 撞墙移除
  const b2 = { x: 190, y: 100, vx: 500, vy: 0, size: 3, pierce: true, range: 600 };
  assert.equal(G.bulletStep(b2, 0.05, [{ x: 200, y: 0, w: 20, h: 200 }]), false);
  // 出图移除（穿透弹也一样）
  const b3 = { x: 3190, y: 100, vx: 500, vy: 0, size: 3, pierce: true, range: 600 };
  assert.equal(G.bulletStep(b3, 0.05, []), false);
  // 射程耗尽移除：剩 20px，飞 25px → 消失
  const b4 = { x: 100, y: 100, vx: 500, vy: 0, size: 3, pierce: false, range: 20 };
  assert.equal(G.bulletStep(b4, 0.05, []), false);
  // 斜向飞行按实际距离扣（vx=vy≈353.55，速度 500）
  const s = 500 / Math.SQRT2;
  const b5 = { x: 100, y: 100, vx: s, vy: s, size: 3, pierce: false, range: 500 };
  assert.equal(G.bulletStep(b5, 0.05, []), true);
  assert.ok(Math.abs(b5.range - 475) < 1e-9);
}

// —— Task 4: 追击 / 恢复 / 选点 ——
{
  const m = { x: 0, y: 0 };
  G.chaseStep(m, 14, { x: 100, y: 0 }, 60, 0.05, []);
  assert.ok(Math.abs(m.x - 3) < 1e-9); // 60 px/s × 0.05s
  G.chaseStep(m, 14, null, 60, 0.05, []);
  assert.ok(Math.abs(m.x - 3) < 1e-9); // 无目标不动
}
{
  const p = { hp: 50, lastDamagedAt: 0, deadUntil: 0 };
  G.regenStep(p, 2999, 0.05);
  assert.equal(p.hp, 50);                    // 未脱战 3s，不回
  G.regenStep(p, 3000, 0.05);
  assert.ok(Math.abs(p.hp - 50.1) < 1e-9);   // +2/s × 0.05s
  p.hp = 99.95;
  G.regenStep(p, 99999, 0.05);
  assert.equal(p.hp, 100);                   // 封顶
  p.hp = 50; p.deadUntil = 5;
  G.regenStep(p, 99999, 0.05);
  assert.equal(p.hp, 50);                    // 死亡不回
}
{
  const spawns = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
  assert.deepEqual(G.pickFarthestSpawn(spawns, [{ x: 0, y: 0 }]), { x: 200, y: 0 });
  assert.deepEqual(G.pickFarthestSpawn(spawns, []), { x: 0, y: 0 });
}
{
  // (400,1500) 被 Boss 占据 → 只能选另两个；玩家在 (400,1500) → 选最远的 (2800,300)
  const s = G.pickBossSpawn(G.BOSS_SPAWNS, [{ x: 400, y: 1500 }], [{ x: 400, y: 1500 }]);
  assert.deepEqual(s, { x: 2800, y: 300 });
  // 全部被占 → null
  const all = G.pickBossSpawn(G.BOSS_SPAWNS, G.BOSS_SPAWNS.map(p => ({ x: p.x, y: p.y })), []);
  assert.equal(all, null);
}

console.log('all tests passed');
