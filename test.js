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

console.log('all tests passed');
