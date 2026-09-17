// test.js — node test.js 直接运行，全过打印 all tests passed
const assert = require('node:assert');
const G = require('./shared.js');

// —— Task 1: 数据有效性 ——
// 点 (px,py) 距矩形边缘是否小于 d
const near = (px, py, w, d) => px + d > w.x && px - d < w.x + w.w && py + d > w.y && py - d < w.y + w.h;

assert.equal(G.TICK_MS, 33);
assert.ok(G.COLORS.length >= G.ROOM.maxPlayers, '颜色数须不少于最大玩家数');

assert.ok(Object.keys(G.MAPS).length >= 4, '地图至少 4 张');
for (const [key, mp] of Object.entries(G.MAPS)) {
  assert.ok(mp.name && mp.floor && mp.w > 0 && mp.h > 0, `地图 ${key} 缺 name/floor/尺寸`);
  for (const w of mp.walls) {
    assert.ok(w.x >= 0 && w.y >= 0 && w.x + w.w <= mp.w && w.y + w.h <= mp.h,
      `地图 ${key} 墙越界: ` + JSON.stringify(w));
  }
  for (const s of mp.bossSpawns) {
    for (const w of mp.walls) {
      assert.ok(!near(s.x, s.y, w, 150), `地图 ${key} Boss 刷新点距墙须 >150px: ` + JSON.stringify(s));
    }
  }
  for (const s of mp.playerSpawns) {
    for (const w of mp.walls) {
      assert.ok(!near(s.x, s.y, w, 40), `地图 ${key} 玩家刷新点撞墙: ` + JSON.stringify(s));
    }
  }
}
for (const [name, wp] of Object.entries(G.WEAPONS)) {
  for (const f of ['rate', 'dmg', 'speed', 'count', 'spread', 'pierce', 'size', 'range', 'mag', 'reloadMs']) {
    assert.ok(f in wp, `武器 ${name} 缺字段 ${f}`);
  }
  assert.ok(wp.mag > 0 && wp.reloadMs > 0, `武器 ${name} 弹匣/换弹时长须为正`);
}
// 换弹数值：手枪 12发/1.5s、机枪 40/2.6s、霰弹 5/2.2s、火箭 1/3s
assert.deepEqual(Object.entries(G.WEAPONS).map(([, w]) => [w.mag, w.reloadMs]),
  [[12, 1500], [40, 2600], [5, 2200], [1, 3000]]);

// —— 等级 / 波次 / 经验（合作化轮）——
{
  const m1 = G.levelMul(1), m15 = G.levelMul(G.LEVELS.max);
  assert.deepEqual([m1.speed, m1.dmg, m1.shield, m1.bulletSpeed, m1.reload, m1.rate], [1, 1, 1, 1, 1, 1]);
  // 满级：移速/伤害/护盾/弹速 ×2，换弹 ×2 快，射速 ×3
  assert.ok(Math.abs(m15.speed - 2) < 1e-9 && Math.abs(m15.dmg - 2) < 1e-9);
  assert.ok(Math.abs(m15.shield - 2) < 1e-9 && Math.abs(m15.bulletSpeed - 2) < 1e-9);
  assert.ok(Math.abs(m15.reload - 0.5) < 1e-9);
  assert.ok(Math.abs(m15.rate - 1 / 3) < 1e-9);
  assert.equal(G.shieldMax(1), 25);
  assert.equal(G.shieldMax(15), 50);
  assert.equal(G.xpNeed(1), 30);
  assert.ok(G.xpNeed(14) > G.xpNeed(7) && G.xpNeed(7) > G.xpNeed(1)); // 越升越贵
  // 波次：数量/经验随波次与难度缩放、封顶 100
  assert.equal(G.waveCount(1), 22);
  assert.equal(G.waveCount(10), 94);
  assert.equal(G.waveCount(99), 100);
  assert.equal(G.waveCount(1, 2), 44);
  assert.equal(G.waveXp(1), 10);
  assert.equal(G.waveXp(10), 37);
  assert.equal(G.waveBossXp(1), 100);
  // 等级倍率进 weaponFire：弹速/伤害乘上、冷却按 rateMul 缩
  const bs = G.weaponFire('pistol', 0, 0, { x: 1, y: 0 }, 9000, 0, 'p1', { rateMul: 0.5, speedMul: 2, dmgMul: 2 });
  assert.equal(bs[0].vx, 3000); // 1500×2 等级弹速
  assert.equal(bs[0].dmg, 50);
  assert.equal(G.weaponFire('pistol', 0, 0, { x: 1, y: 0 }, 9100, 9000, 'p1', { rateMul: 0.5 }), null); // 150ms 冷却未到
}
{
  // 穿透：武器基础数 + 等级档（5/10/15 级 ×2/×3/×4）
  assert.equal(G.WEAPONS.pistol.pierce, 1);
  assert.equal(G.WEAPONS.mg.pierce, 2);
  assert.equal(G.WEAPONS.shotgun.pierce, 3);
  assert.equal(G.WEAPONS.rocket.pierce, 0);
  assert.equal(G.levelPierceMul(4), 1);
  assert.equal(G.levelPierceMul(5), 2);
  assert.equal(G.levelPierceMul(10), 3);
  assert.equal(G.levelPierceMul(15), 4);
  assert.equal(G.weaponFire('mg', 0, 0, { x: 1, y: 0 }, 9000, 0, 'p1', { pierceMul: 2 })[0].maxHits, 5); // 1+2×2
  assert.equal(G.weaponFire('pistol', 0, 0, { x: 1, y: 0 }, 9000, 0, 'p1')[0].maxHits, 2);               // 1+1×1
  // 赶路速度分区：近（≤768=视野半宽640×1.2）原速 / 中 ×2 / 远 ×3
  assert.equal(G.monsterSpeedMul(100), 1);
  assert.equal(G.monsterSpeedMul(768), 1);
  assert.equal(G.monsterSpeedMul(1000), 2);
  assert.equal(G.monsterSpeedMul(3000), 3);
  // 近战前摇：第 1 波 0.7s 可躲，第 14 波起 50ms 贴到必中
  assert.equal(G.waveWindupMs(1), 550);
  assert.equal(G.waveWindupMs(11), 50);
  assert.equal(G.waveWindupMs(99), 50);
  // 怪物类型表 + 混编 + 精英
  assert.deepEqual(Object.keys(G.MONSTER_TYPES).sort(), ['brute', 'normal', 'runner', 'spitter']);
  assert.equal(G.pickMonsterType(1, 0.99), 'normal');   // 第 1 波只有普通
  assert.equal(G.pickMonsterType(5, 0.1), 'runner');
  assert.equal(G.pickMonsterType(5, 0.25), 'brute');
  assert.equal(G.pickMonsterType(5, 0.35), 'spitter');
  assert.equal(G.pickMonsterType(5, 0.9), 'normal');
  assert.equal(G.ELITE.chance, 0.05);
  assert.ok(G.MONSTER_TYPES.spitter.range === 500 && G.MONSTER_TYPES.brute.hp === 250);
  // 加压后的 Boss 参数
  assert.equal(G.BOSS.hp, 450);
  assert.equal(G.BOSS.cap, 3);
  assert.equal(G.BOSS.spawnEveryMs, 25000);
  // 碰撞推开：重叠圆推到恰好相切；aOnly 只推 a，否则各退一半
  const a = { x: 0, y: 0 }, b = { x: 20, y: 0 };
  G.separate(a, 16, b, 16, [], true);
  assert.ok(Math.abs(G.dist(a.x, a.y, b.x, b.y) - 32) < 1e-9);
  const c = { x: 0, y: 0 }, d2 = { x: 20, y: 0 };
  G.separate(c, 16, d2, 16, [], false);
  assert.ok(Math.abs(G.dist(c.x, c.y, d2.x, d2.y) - 32) < 1e-9);
  assert.ok(c.x < 0 && d2.x > 20);
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
  const p = G.moveWithWalls(500, 500, 10, -10, 16, G.MAPS.grass.walls);
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
    { dmg: 25, vx: 1500, vy: 0, owner: 'p1', pierce: 1, range: 600 });
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
  assert.ok(Math.abs(bs[0].vx - 1500 * Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(bs[0].vy - 1500 * Math.SQRT1_2) < 1e-9);
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
  // 火箭筒：慢速大弹、不穿透、命中即爆（直击 30 / 爆炸 50 / 半径 100 / 射程 700）
  const cn = G.weaponFire('rocket', 0, 0, { x: -1, y: 0 }, 9000, 0, 'p1');
  assert.equal(cn[0].pierce, 0);
  assert.equal(cn[0].maxHits, 1);
  assert.equal(cn[0].vx, -1050);
  assert.equal(cn[0].size, 8);
  assert.equal(cn[0].dmg, 30);
  assert.equal(cn[0].range, 700);
  assert.equal(cn[0].explode, 100);
  assert.equal(cn[0].explodeDmg, 50);
  // 非爆炸武器 explode = 0
  const ps = G.weaponFire('pistol', 0, 0, { x: 1, y: 0 }, 9000, 0, 'p1');
  assert.equal(ps[0].explode, 0);
  assert.equal(ps[0].explodeDmg, 0);
}
{
  const TM = { w: 3200, h: 1800, walls: [] }; // bulletStep 只需要地图的尺寸+墙
  const b = { x: 100, y: 100, vx: 500, vy: 0, size: 3, pierce: false, range: 600 };
  assert.equal(G.bulletStep(b, 0.05, TM), true);
  assert.equal(b.x, 125);
  assert.equal(b.range, 575); // 每 tick 扣飞行距离 500×0.05=25
  // 撞墙移除
  const b2 = { x: 190, y: 100, vx: 500, vy: 0, size: 3, pierce: true, range: 600 };
  assert.equal(G.bulletStep(b2, 0.05, { ...TM, walls: [{ x: 200, y: 0, w: 20, h: 200 }] }), false);
  // 出图移除（穿透弹也一样）
  const b3 = { x: 3190, y: 100, vx: 500, vy: 0, size: 3, pierce: true, range: 600 };
  assert.equal(G.bulletStep(b3, 0.05, TM), false);
  // 射程耗尽移除：剩 20px，飞 25px → 消失
  const b4 = { x: 100, y: 100, vx: 500, vy: 0, size: 3, pierce: false, range: 20 };
  assert.equal(G.bulletStep(b4, 0.05, TM), false);
  // 斜向飞行按实际距离扣（vx=vy≈353.55，速度 500）
  const s = 500 / Math.SQRT2;
  const b5 = { x: 100, y: 100, vx: s, vy: s, size: 3, pierce: false, range: 500 };
  assert.equal(G.bulletStep(b5, 0.05, TM), true);
  assert.ok(Math.abs(b5.range - 475) < 1e-9);
}

// —— A* 寻路（敌人绕路/啃墙的地基）——
{
  const M = { w: 600, h: 600 }; // 10×10 格 @60px
  // 空旷地：有路
  let p = G.findPath([], M, 60, 300, 540, 300, 60);
  assert.ok(p && p.length >= 1);
  // 不可破坏墙封中段（顶部留口）→ 绕顶口，路点全部避开墙列（x∈240-360 且 y≥120）
  p = G.findPath([{ x: 280, y: 120, w: 40, h: 480, destructible: false }], M, 60, 300, 540, 300, 60);
  assert.ok(p && p.some(pt => pt.y < 120));
  assert.ok(p.every(pt => !(pt.x > 240 && pt.x < 360 && pt.y >= 120)));
  // 同位置可破坏墙全封 → 唯一路线是穿墙（高成本但可达）
  p = G.findPath([{ x: 280, y: 0, w: 40, h: 600, destructible: true }], M, 60, 300, 540, 300, 60);
  assert.ok(p && p.some(pt => pt.x >= 240 && pt.x <= 360));
  // 不可破坏全封 → null
  assert.equal(G.findPath([{ x: 280, y: 0, w: 40, h: 600, destructible: false }], M, 60, 300, 540, 300, 60), null);
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
  // 碎盾回盾冷却 20s（未碎仍 3s）
  const p = { hp: 100, shield: 0, shieldMax: 25, shieldBrokenAt: 1000, lastDamagedAt: 1000, deadUntil: 0 };
  G.regenStep(p, 20999, 0.05);
  assert.equal(p.shield, 0);                 // 碎盾后 20s 前不回盾
  G.regenStep(p, 21000, 0.05);
  assert.ok(p.shield > 0);                   // 20s 到开始回
  const q = { hp: 100, shield: 10, shieldMax: 25, lastDamagedAt: 0, deadUntil: 0 };
  G.regenStep(q, 3000, 0.05);
  assert.ok(q.shield > 10);                  // 没碎：脱战 3s 照回
}
{
  const spawns = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
  assert.deepEqual(G.pickFarthestSpawn(spawns, [{ x: 0, y: 0 }]), { x: 200, y: 0 });
  assert.deepEqual(G.pickFarthestSpawn(spawns, []), { x: 0, y: 0 });
}
{
  const BS = G.MAPS.grass.bossSpawns; // (600,2100) (4200,600) (2400,2500)
  // 第一点被 Boss 占据 → 只能选另两个；玩家在该点 → 选最远的 (4200,600)
  const s = G.pickBossSpawn(BS, [{ x: BS[0].x, y: BS[0].y }], [{ x: BS[0].x, y: BS[0].y }]);
  assert.deepEqual(s, BS[1]);
  // 全部被占 → null
  const all = G.pickBossSpawn(BS, BS.map(p => ({ x: p.x, y: p.y })), []);
  assert.equal(all, null);
}

console.log('all tests passed');
