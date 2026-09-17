// client.js — 大厅、连接、渲染。游戏状态全部来自服务器 state 消息。
const G = window.GameShared;
const $ = id => document.getElementById(id);
const wsUrl = () => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;

let ws = null, myId = null, state = null, roomCode = '';
let pingMs = 0;                // 网络延迟（ping/pong RTT 指数平滑）
setInterval(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); }, 2000);

function go(msg) {
  $('msg').textContent = '';
  pingMs = 0;
  ws = new WebSocket(wsUrl());
  ws.onopen = () => ws.send(JSON.stringify(msg));
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'joined') startGame(m);
    else if (m.t === 'state') {
      if (state) detect(state, m);
      prev = state; state = m; recvTime = performance.now();
    }
    else if (m.t === 'pong') {
      const rtt = Date.now() - m.ts;
      pingMs = pingMs ? Math.round(pingMs * 0.7 + rtt * 0.3) : rtt;
    }
    else if (m.t === 'error') { ws.onclose = null; ws.close(); backToLobby(m.msg); }
  };
  ws.onclose = () => backToLobby('与服务器断开');
}

function startGame(m) {
  myId = m.id;
  roomCode = m.code;
  curMapKey = G.MAPS[m.map] ? m.map : G.DEFAULT_MAP; // 房主选的图，joined 带回
  curMap = G.MAPS[curMapKey];
  $('lobby').style.display = 'none';
  $('game').style.display = 'block';
}

function backToLobby(msg) {
  myId = null; state = null;
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  $('game').style.display = 'none';
  $('lobby').style.display = 'block';
  if (msg) $('msg').textContent = msg;
}

const name = () => $('name').value.trim() || '玩家';
$('createBtn').onclick = () => go({ t: 'create', name: name(), map: selMap });
$('joinBtn').onclick = () => go({ t: 'join', name: name(), code: $('code').value.trim().toUpperCase() });

// —— 大厅地图选择卡：小 canvas 画墙布局预览，点选高亮 ——
let selMap = G.DEFAULT_MAP;
function buildMapCards() {
  const box = $('maps');
  box.innerHTML = '';
  for (const [key, mp] of Object.entries(G.MAPS)) {
    const card = document.createElement('div');
    card.className = 'mapcard' + (key === selMap ? ' sel' : '');
    const cv = document.createElement('canvas');
    cv.width = 150; cv.height = Math.round(150 * mp.h / mp.w);
    const c = cv.getContext('2d');
    c.fillStyle = '#0d1526'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#e8722a';
    for (const w of mp.walls) {
      c.fillRect(w.x / mp.w * cv.width, w.y / mp.h * cv.height,
        Math.max(1, w.w / mp.w * cv.width), Math.max(1, w.h / mp.h * cv.height));
    }
    const label = document.createElement('div');
    label.textContent = mp.name;
    card.append(cv, label);
    card.onclick = () => { selMap = key; buildMapCards(); };
    box.appendChild(card);
  }
}
buildMapCards();

// —— 渲染 ——
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

let prev = null, recvTime = 0;   // 插值：实体画在 prev 与 state 之间
let curMapKey = G.DEFAULT_MAP, curMap = G.MAPS[G.DEFAULT_MAP]; // 当前房间的地图（joined 带回）
const FLOORS = {};               // 地砖图（同包 CC0，按地图 floor key）
for (const k of ['grass', 'dirt', 'ice', 'clay']) {
  const im = new Image();
  im.src = 'assets/floor_' + k + '.png';
  FLOORS[k] = im;
}
const floorPat = {};             // 地砖 canvas pattern 缓存

// 墙材质随地图主题：主体/描边/高光/细节纹（细节按墙坐标种子画，稳定不闪）
const WALL_STYLE = {
  grass: { fill: '#5c6b52', edge: '#39462f', hi: '#7d9070', detail: 'seam' },  // 苔石+石缝
  dirt:  { fill: '#c9a15f', edge: '#8a6a35', hi: '#e0be82', detail: 'crack' }, // 砂岩+裂纹
  ice:   { fill: '#a8cdd6', edge: '#6f97a3', hi: '#e6f4f7', detail: 'crack' }, // 冰块+冰裂
  clay:  { fill: '#b0763f', edge: '#6f4a26', hi: '#cf9459', detail: 'pit' },   // 土坯+土坑
};

// 静态墙（地图模板）+ 服务器广播的可破坏墙；被啃穿的墙从 state 列表消失即不再画
function allWalls() {
  return state && state.walls && state.walls.length ? curMap.walls.concat(state.walls) : curMap.walls;
}

// 装饰 props（无碰撞，纯客户端）：种子随机撒灌木/木箱/桶，避开墙与刷新点
const propsCache = {};
function propsOf(key) {
  if (propsCache[key]) return propsCache[key];
  const mp = G.MAPS[key];
  let s = 987654321;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const list = [];
  for (let i = 0; i < 80 && list.length < 24; i++) {
    const x = 120 + rnd() * (mp.w - 240), y = 120 + rnd() * (mp.h - 240);
    if (mp.walls.some(w => x > w.x - 50 && x < w.x + w.w + 50 && y > w.y - 50 && y < w.y + w.h + 50)) continue;
    if (mp.playerSpawns.some(p => G.dist(x, y, p.x, p.y) < 300)) continue;
    if (mp.bossSpawns.some(p => G.dist(x, y, p.x, p.y) < 300)) continue;
    list.push({ x, y, k: list.length % 3 });
  }
  return propsCache[key] = list;
}
function drawProps() {
  for (const p of propsOf(curMapKey)) {
    if (p.k === 0) { // 灌木：双绿圆
      ctx.fillStyle = '#2e8b4a'; circ(p.x, p.y, 14);
      ctx.fillStyle = '#3aa655'; circ(p.x - 6, p.y - 5, 9);
    } else if (p.k === 1) { // 木箱：棕方块+板条
      ctx.fillStyle = '#a9743f'; ctx.fillRect(p.x - 11, p.y - 11, 22, 22);
      ctx.strokeStyle = '#7d5426'; ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 11, p.y - 11, 22, 22);
      ctx.beginPath(); ctx.moveTo(p.x - 11, p.y); ctx.lineTo(p.x + 11, p.y); ctx.stroke();
    } else { // 桶：灰圆+环
      ctx.fillStyle = '#8a8f98'; circ(p.x, p.y, 10);
      ctx.strokeStyle = '#5f646c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
    }
  }
}
let parts = [];                  // 粒子（世界坐标，纯客户端特效，上限 300）
let rings = [];                  // 爆炸冲击波圈（半径 = 服务器广播的实际伤害半径）
let lastFrame = performance.now();
let shake = 0, flash = 0;        // 自己受击反馈：屏幕震动 / 红闪
const recoil = new Map();        // 玩家id → 后坐截止时刻（新子弹在谁身边冒出谁后坐）
const aimAngle = new Map();      // 实体id → 平滑后的朝向角

// 朝向平滑：最短弧逼近目标角。逐帧位移差只有 ~1px 且带取整噪声，
// 直接 atan2 会每帧乱跳（敌人转向时尤其明显），渐变转向顺带消抖
function turnToward(cur, tgt, k) {
  let d = tgt - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}
// 目标朝向：有稳定来源用稳定来源，否则位移差推算（阈值过滤静止噪声），都没有 = null 保持原角
function targetAngle(stable, o, x, y, threshold) {
  if (stable) return Math.atan2(stable.y, stable.x);
  if (o && Math.abs(x - o.x) + Math.abs(y - o.y) > threshold) return Math.atan2(y - o.y, x - o.x);
  return null;
}

// —— 人物精灵（Kenney Top-down Shooter，CC0；纯俯视，旋转即任意朝向）——
// 槽位 = COLORS 下标；姿势：hold 待命 / gun 手枪 / machine 长枪 / reload 换弹
const SPR = {};
for (let c = 0; c < 4; c++) for (const pose of ['hold', 'gun', 'machine', 'reload']) {
  const im = new Image();
  im.src = 'assets/char' + c + '_' + pose + '.png';
  SPR[c + '_' + pose] = im;
}
for (const k of ['mon_stand', 'boss_hold', 'boss_machine']) {
  const im = new Image();
  im.src = 'assets/' + k + '.png';
  SPR[k] = im;
}
const POSE_BY_WEAPON = { pistol: 'gun', mg: 'machine', shotgun: 'machine', cannon: 'machine' };

// 状态 diff → 推测事件放粒子（子弹消失≈命中/撞墙，客户端不区分，火花一样小）
function detect(p0, s) {
  const gone = (a, b) => a.filter(x => !b.some(y => y.id === x.id));
  const born = (a, b) => b.filter(x => !a.some(y => y.id === x.id));
  for (const b of born(p0.bullets, s.bullets)) {                                             // 枪口闪光 + 射手后坐
    burst(b.x, b.y, 3, '#fff8c4', 60, 0.12, 2);
    if (b.boss) continue;
    const shooter = s.players.find(p => p.respawnIn === 0 && Math.hypot(p.x - b.x, p.y - b.y) < G.PLAYER.r + 14);
    if (shooter) recoil.set(shooter.id, performance.now() + 100);
  }
  for (const b of gone(p0.bullets, s.bullets)) {
    if (b.boom) { // 加农炮爆炸：冲击波圈扩散到真实伤害半径（b.boom = 半径）+ 外橙内黄双层粒子
      rings.push({ x: b.x, y: b.y, r: b.boom, life: 0.35, max: 0.35 });
      burst(b.x, b.y, 30, '#ff9800', 300, 0.6, 5);
      burst(b.x, b.y, 12, '#ffe082', 160, 0.4, 4);
    } else burst(b.x, b.y, 5, b.boss ? '#ff5252' : '#ffd93d', 120, 0.25, 2); // 命中火花
  }
  for (const m of gone(p0.monsters, s.monsters)) burst(m.x, m.y, 14, '#ff7043', 180, 0.5, 3);
  for (const b of gone(p0.bosses, s.bosses)) burst(b.x, b.y, 40, '#b06ce0', 260, 0.8, 5);    // Boss 大紫爆
  for (const pk of gone(p0.pickups, s.pickups)) burst(pk.x, pk.y, 10, '#ffd700', 150, 0.4, 3);
  for (const w of gone(p0.walls || [], s.walls || [])) // 可破坏墙被啃穿：木屑爆
    burst(w.x + w.w / 2, w.y + w.h / 2, 16, '#a9743f', 180, 0.5, 3);
  for (const q0 of p0.players) { // 玩家死亡爆炸（本色）
    const q1 = s.players.find(p => p.id === q0.id);
    if (!q1 || q0.respawnIn > 0 || q1.respawnIn === 0) continue;
    burst(q1.x, q1.y, q0.id === myId ? 30 : 22, q1.color, 220, 0.7, 4);
    if (q0.id === myId) { shake = 14; flash = 1; }
  }
  const me0 = p0.players.find(p => p.id === myId), me1 = s.players.find(p => p.id === myId);
  if (me0 && me1 && me0.respawnIn === 0 && me1.respawnIn === 0 && me1.hp < me0.hp) { // 自己受伤
    shake = Math.min(12, shake + (me0.hp - me1.hp) * 0.3);
    flash = Math.min(1, flash + 0.5);
  }
}

function burst(x, y, n, color, speed, life, size) {
  for (let i = 0; i < n && parts.length < 300; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size });
  }
}

function render() {
  requestAnimationFrame(render);
  const t = performance.now();
  const dt = Math.min(0.05, (t - lastFrame) / 1000);
  lastFrame = t;

  ctx.fillStyle = '#101828';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state) return;
  const meCur = state.players.find(p => p.id === myId);
  if (!meCur) return;

  // 实体插值：按收包时长 / TICK_MS 画在前后帧之间（画面落后一 tick 换 60fps 平滑）
  const al = clamp((t - recvTime) / G.TICK_MS, 0, 1);
  const mk = k => prev ? new Map(prev[k].map(e => [e.id, e])) : null;
  const maps = { players: mk('players'), monsters: mk('monsters'), bosses: mk('bosses'), bullets: mk('bullets') };
  const lp = (e, map) => {
    const o = map && map.get(e.id);
    if (!o || e.respawnIn > 0 || o.respawnIn > 0) return e; // 新实体/重生瞬移不插值
    return { ...e, x: o.x + (e.x - o.x) * al, y: o.y + (e.y - o.y) * al };
  };

  // 镜头跟随（插值位置），地图边缘钳制 + 受击震动
  const me = lp(meCur, maps.players);
  shake = Math.max(0, shake - dt * 30);
  const camX = clamp(me.x - canvas.width / 2, 0, curMap.w - canvas.width);
  const camY = clamp(me.y - canvas.height / 2, 0, curMap.h - canvas.height);
  const shX = shake ? (Math.random() - 0.5) * shake : 0;
  const shY = shake ? (Math.random() - 0.5) * shake : 0;
  const inView = (x, y, r) =>
    x + r > camX && x - r < camX + canvas.width && y + r > camY && y - r < camY + canvas.height;

  ctx.save();
  ctx.translate(Math.round(-camX + shX), Math.round(-camY + shY));

  // 地面：同包 CC0 地砖 pattern（每张地图一个主题）+ 种子散布装饰 props
  const fimg = FLOORS[curMap.floor];
  if (fimg && fimg.complete && fimg.width) {
    if (!floorPat[curMap.floor]) floorPat[curMap.floor] = ctx.createPattern(fimg, 'repeat');
    ctx.fillStyle = floorPat[curMap.floor];
    ctx.fillRect(0, 0, curMap.w, curMap.h);
  } else {
    ctx.fillStyle = '#101828';
    ctx.fillRect(0, 0, curMap.w, curMap.h);
  }
  drawProps();

  // 墙：材质随地图主题（苔石/砂岩/冰块/土坯）；可破坏墙恒为木箱色（"摆上去的东西"）
  for (const w of allWalls()) {
    if (!inView(w.x + w.w / 2, w.y + w.h / 2, Math.max(w.w, w.h) / 2)) continue;
    if (w.destructible) {
      ctx.fillStyle = '#a9743f';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = '#7d5426'; ctx.lineWidth = 6;
      ctx.strokeRect(w.x + 3, w.y + 3, w.w - 6, w.h - 6);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(w.x + 8, w.y + 8, Math.max(0, w.w - 16), Math.max(0, w.h - 16));
      continue;
    }
    const st = WALL_STYLE[curMap.floor] || WALL_STYLE.grass;
    ctx.fillStyle = st.fill;
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = st.edge; ctx.lineWidth = 4;
    ctx.strokeRect(w.x + 2, w.y + 2, w.w - 4, w.h - 4);
    ctx.strokeStyle = st.hi; ctx.lineWidth = 2;   // 左上受光边
    ctx.beginPath();
    ctx.moveTo(w.x + 5, w.y + w.h - 6); ctx.lineTo(w.x + 5, w.y + 5); ctx.lineTo(w.x + w.w - 6, w.y + 5);
    ctx.stroke();
    // 主题细节纹（种子 = 墙坐标）
    ctx.strokeStyle = st.edge; ctx.fillStyle = st.edge;
    ctx.globalAlpha = 0.35; ctx.lineWidth = 2;
    const sd = w.x * 7 + w.y * 13;
    if (st.detail === 'seam') {
      for (let y = w.y + 18 + (sd % 8); y < w.y + w.h - 6; y += 24) {
        ctx.beginPath(); ctx.moveTo(w.x + 6, y); ctx.lineTo(w.x + w.w - 6, y); ctx.stroke();
      }
    } else if (st.detail === 'crack') {
      ctx.beginPath();
      ctx.moveTo(w.x + 8 + (sd % 12), w.y + 6);
      ctx.lineTo(w.x + w.w * 0.5, w.y + w.h * 0.5);
      ctx.lineTo(w.x + w.w - 8 - (sd % 10), w.y + w.h - 6);
      ctx.stroke();
    } else {
      for (let i = 0; i < 3; i++) {
        const px = w.x + 10 + ((sd >> (i * 3)) % Math.max(1, w.w - 20));
        const py = w.y + 10 + ((sd >> (i * 5)) % Math.max(1, w.h - 20));
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  // 拾取物（旋转金方块 + 脉冲光环）
  for (const pk of state.pickups) {
    if (!inView(pk.x, pk.y, 20)) continue;
    ctx.globalAlpha = 0.18 + 0.07 * Math.sin(t / 200 + pk.x);
    ctx.fillStyle = '#ffd700';
    circ(pk.x, pk.y, 17);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(pk.x, pk.y);
    ctx.rotate(t / 300);
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(-8, -8, 16, 16);
    ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 2;
    ctx.strokeRect(-8, -8, 16, 16);
    ctx.restore();
  }
  // Boss 红色警戒线：最近活人进入所持武器射程即锁定（虚线流动；停火期也显示 = 被锁定）
  {
    const living = state.players.filter(p => p.respawnIn === 0);
    for (const b0 of state.bosses) {
      if (!living.length) break;
      let tgt = null, bd = Infinity;
      for (const p of living) { const d = G.dist(b0.x, b0.y, p.x, p.y); if (d < bd) { bd = d; tgt = p; } }
      if (!tgt || bd > G.WEAPONS[b0.weapon].range) continue;
      const bb = lp(b0, maps.bosses), tt = lp(tgt, maps.players);
      ctx.strokeStyle = 'rgba(255,80,80,0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -t / 30;
      ctx.beginPath(); ctx.moveTo(bb.x, bb.y); ctx.lineTo(tt.x, tt.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // 怪物（僵尸精灵：朝追击方向旋转 + 跑动颠簸；红色地面环辨识）
  for (const m0 of state.monsters) {
    const m = lp(m0, maps.monsters);
    if (!inView(m.x, m.y, G.MONSTER.r + 24)) continue;
    const o = maps.monsters && maps.monsters.get(m0.id);
    const moving = o && Math.abs(m.x - o.x) + Math.abs(m.y - o.y) > 0.4;
    const tgt = moving ? Math.atan2(m.y - o.y, m.x - o.x) : null;
    const ang = tgt === null ? (aimAngle.get('m' + m0.id) || 0)
      : turnToward(aimAngle.get('m' + m0.id) || 0, tgt, 0.12);
    aimAngle.set('m' + m0.id, ang);
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#ff5252';
    ctx.beginPath(); ctx.ellipse(m.x, m.y + 4, 15, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const img = SPR.mon_stand;
    if (img && img.complete && img.width) {
      const bob = moving ? Math.sin(t / 60 + m0.id) * 1.5 : 0;
      ctx.save();
      ctx.translate(m.x + Math.cos(ang) * bob, m.y + Math.sin(ang) * bob);
      ctx.rotate(ang);
      ctx.imageSmoothingEnabled = false;
      const S = 0.9;
      ctx.drawImage(img, -img.width * S / 2, -img.height * S / 2, img.width * S, img.height * S);
      ctx.restore();
      ctx.imageSmoothingEnabled = true;
    } else {
      triPath(m.x, m.y, G.MONSTER.r);
      ctx.fillStyle = '#ff5252'; ctx.fill();
    }
  }
  // Boss（机器人精英精灵：体型为玩家 2 倍、常持仓枪姿势；紫光晕 + 武器名 + 血条）
  for (const b0 of state.bosses) {
    const b = lp(b0, maps.bosses);
    if (!inView(b.x, b.y, G.BOSS.r + 32)) continue;
    const o = maps.bosses && maps.bosses.get(b0.id);
    const moving = o && Math.abs(b.x - o.x) + Math.abs(b.y - o.y) > 0.4;
    const tgt = moving ? Math.atan2(b.y - o.y, b.x - o.x) : null;
    const ang = tgt === null ? (aimAngle.get('b' + b0.id) || 0)
      : turnToward(aimAngle.get('b' + b0.id) || 0, tgt, 0.12);
    aimAngle.set('b' + b0.id, ang);
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#9b59b6';
    ctx.beginPath(); ctx.ellipse(b.x, b.y + 8, 36, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const img = SPR.boss_machine;
    if (img && img.complete && img.width) {
      const bob = moving ? Math.sin(t / 80 + b0.id) * 1.5 : 0;
      ctx.save();
      ctx.translate(b.x + Math.cos(ang) * bob, b.y + Math.sin(ang) * bob);
      ctx.rotate(ang);
      ctx.imageSmoothingEnabled = false;
      const S = 2.0;
      ctx.drawImage(img, -img.width * S / 2, -img.height * S / 2, img.width * S, img.height * S);
      ctx.restore();
      ctx.imageSmoothingEnabled = true;
    } else {
      const gr = ctx.createRadialGradient(b.x - 10, b.y - 10, 4, b.x, b.y, G.BOSS.r);
      gr.addColorStop(0, '#d7bde2'); gr.addColorStop(1, '#7d3c98');
      ctx.fillStyle = gr;
      circ(b.x, b.y, G.BOSS.r);
    }
    bar(b.x, b.y - G.BOSS.r - 10, 48, b0.hp / G.BOSS.hp);
    ctx.fillStyle = '#ffd700'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(WEAPON_NAMES[b0.weapon] || b0.weapon || '', b.x, b.y - G.BOSS.r - 18);
  }
  // 子弹（拖尾光条：上一帧位置→插值位置；光晕+核心；Boss 弹红色）
  ctx.lineCap = 'round';
  for (const b0 of state.bullets) {
    const b = lp(b0, maps.bullets);
    if (!inView(b.x, b.y, b0.size * 3 + 30)) continue;
    const o = maps.bullets && maps.bullets.get(b0.id);
    const col = b0.boss ? '#ff5252' : '#ffd93d';
    ctx.strokeStyle = col; ctx.globalAlpha = 0.35; ctx.lineWidth = b0.size * 2;
    ctx.beginPath(); ctx.moveTo(o ? o.x : b.x, o ? o.y : b.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.globalAlpha = 0.25; ctx.fillStyle = col;
    circ(b.x, b.y, b0.size * 2.2);
    ctx.globalAlpha = 1;
    circ(b.x, b.y, b0.size);
  }
  // 玩家（CC0 俯视精灵小人：朝 aim 角旋转、姿势随武器/换弹切换；地面色环辨识队伍；死亡中不画）
  for (const p0 of state.players) {
    if (p0.respawnIn > 0) continue;
    const p = lp(p0, maps.players);
    if (!inView(p.x, p.y, G.PLAYER.r + 40)) continue;
    // 瞄准角：服务器 face（稳定）优先，否则位移差推算；最短弧平滑消抖
    const oPrev = maps.players && maps.players.get(p0.id);
    const tgt = targetAngle(p0.face, oPrev, p.x, p.y, 0.4);
    const ang = tgt === null ? (aimAngle.get(p0.id) || 0)
      : turnToward(aimAngle.get(p0.id) || 0, tgt, p0.face ? 0.5 : 0.25);
    aimAngle.set(p0.id, ang);
    // 地面投影 + 队伍色环（精灵本身不带队伍色，靠色环/昵称/小地图辨识）
    ctx.globalAlpha = 0.3; ctx.fillStyle = p0.color;
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 6, 20, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 6, 15, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // 低血加速：脉冲圆环
    if (p0.boost) {
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t / 100);
      ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, G.PLAYER.r + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const slot = Math.max(0, G.COLORS.indexOf(p0.color));
    const pose = p0.reloading ? 'reload' : (p0.face ? (POSE_BY_WEAPON[p0.weapon] || 'gun') : 'hold');
    const img = SPR[slot + '_' + pose];
    if (img && img.complete && img.width) {
      const rec = (recoil.get(p0.id) || 0) > t ? 3 : 0;          // 后坐：沿瞄准反方向退 3px
      const moving = oPrev && Math.abs(p.x - oPrev.x) + Math.abs(p.y - oPrev.y) > 0.3;
      const bob = moving ? Math.sin(t / 70) * 1.5 : 0;           // 走路颠簸（素材无走路帧，用它代步态）
      ctx.save();
      ctx.translate(p.x + Math.cos(ang) * (bob - rec), p.y + Math.sin(ang) * (bob - rec));
      ctx.rotate(ang);
      ctx.imageSmoothingEnabled = false;                          // 像素风保持锐利
      const S = 1.0;
      ctx.drawImage(img, -img.width * S / 2, -img.height * S / 2, img.width * S, img.height * S);
      ctx.restore();
      ctx.imageSmoothingEnabled = true;
    } else { // 精灵未加载完的回退：旧渐变球
      const gr = ctx.createRadialGradient(p.x - 5, p.y - 5, 2, p.x, p.y, G.PLAYER.r);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, p0.color);
      ctx.fillStyle = gr;
      circ(p.x, p.y, G.PLAYER.r);
    }
    if (p0.id === myId) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, G.PLAYER.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#eee'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(p0.name, p.x, p.y - G.PLAYER.r - 16);
    bar(p.x, p.y - G.PLAYER.r - 10, 32, p0.hp / G.PLAYER.hpMax);
    // 自己换弹中：头顶黄字闪烁提示
    if (p0.id === myId && p0.reloading && Math.sin(t / 120) > 0) {
      ctx.fillStyle = '#ffd700';
      ctx.fillText('换弹中…', p.x, p.y - G.PLAYER.r - 24);
    }
  }
  // 爆炸冲击波圈：橙环扩散到真实伤害半径 + 内部火光填充，随扩散淡出
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i];
    g.life -= dt;
    if (g.life <= 0) { rings.splice(i, 1); continue; }
    const k = 1 - g.life / g.max; // 0→1 扩散进度
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#ff9800'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r * k, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = (1 - k) * 0.22; ctx.fillStyle = '#ffb74d';
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r * k, 0, Math.PI * 2); ctx.fill();
  }
  // 粒子（世界坐标：阻尼 + 淡出缩小）
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.life -= dt;
    if (q.life <= 0) { parts.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.vx *= 1 - 3 * dt; q.vy *= 1 - 3 * dt;
    const k = q.life / q.max;
    ctx.globalAlpha = k; ctx.fillStyle = q.color;
    circ(q.x, q.y, q.size * k);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // 常驻暗角（纵深感）
  const vg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.45,
    canvas.width / 2, canvas.height / 2, canvas.height * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 低血量（<30%）红色呼吸脉冲警告
  if (meCur.respawnIn === 0 && meCur.hp < G.PLAYER.hpMax * 0.3) {
    const rg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, canvas.height * 0.35,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.8);
    rg.addColorStop(0, 'rgba(255,0,0,0)');
    rg.addColorStop(1, `rgba(255,0,0,${(0.18 + 0.12 * Math.sin(t / 250)).toFixed(3)})`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  // 自己受伤红闪（全屏叠加）
  if (flash > 0) {
    flash = Math.max(0, flash - dt * 4);
    ctx.fillStyle = `rgba(255,60,60,${(flash * 0.25).toFixed(3)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawHUD(meCur);
}

function circ(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function triPath(x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x - r, y + r); ctx.lineTo(x + r, y + r);
  ctx.closePath();
}
function bar(x, y, w, frac) {
  frac = clamp(frac, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - w / 2 - 1, y - 5, w + 2, 7);
  ctx.fillStyle = frac > 0.5 ? '#2ecc71' : frac > 0.25 ? '#f1c40f' : '#e74c3c';
  ctx.fillRect(x - w / 2, y - 4, w * frac, 5);
}

// —— HUD ——
// 加武器时在 WEAPONS 表加数值、这里加一行中文名
const WEAPON_NAMES = { pistol: '手枪', mg: '机枪', shotgun: '霰弹枪', cannon: '加农炮' };

function statusBar(me) {
  const bw = 620, bh = 54;
  const x = (canvas.width - bw) / 2, y = canvas.height - bh - 10;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 10); ctx.fill();
  // 大血条（绿→黄→红）
  const frac = clamp(me.hp / G.PLAYER.hpMax, 0, 1);
  const hx = x + 16, hy = y + 18, hw = 220, hh = 18;
  ctx.fillStyle = '#333'; ctx.fillRect(hx, hy, hw, hh);
  ctx.fillStyle = frac > 0.5 ? '#2ecc71' : frac > 0.25 ? '#f1c40f' : '#e74c3c';
  ctx.fillRect(hx, hy, hw * frac, hh);
  ctx.fillStyle = '#fff'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`${me.hp} / ${G.PLAYER.hpMax}`, hx + hw / 2, hy + 14);
  // 武器名 + 详情（伤害/射程/穿透，数值直接读武器表，加武器零改动）
  const tx = hx + hw + 20;
  ctx.textAlign = 'left';
  ctx.font = '16px sans-serif'; ctx.fillStyle = '#ffd700';
  const wname = WEAPON_NAMES[me.weapon] || me.weapon;
  ctx.fillText(wname, tx, y + 25);
  const nameW = ctx.measureText(wname).width; // 必须在 16px 字体下量
  const w = G.WEAPONS[me.weapon];
  if (w) {
    ctx.font = '12px sans-serif'; ctx.fillStyle = '#999';
    ctx.fillText(`伤害 ${w.dmg}${w.count > 1 ? '×' + w.count : ''} · 射程 ${w.range}${w.pierce ? ' · 穿透' : ''}${w.explode ? ` · 爆炸 ${w.explodeDmg}` : ''}`,
      tx + nameW + 10, y + 25);
  }
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#ccc';
  ctx.fillText(`击杀 ${me.kills} · 死亡 ${me.deaths} · 弹药 ${me.ammo}/${w ? w.mag : '?'}`, tx, y + 44);
}

function drawHUD(me) {
  // 计分板（左上，按击杀降序）
  ctx.textAlign = 'left';
  ctx.font = '14px sans-serif';
  const rows = [...state.players].sort((a, b) => b.kills - a.kills);
  rows.forEach((p, i) => {
    ctx.fillStyle = p.color;
    ctx.fillText(`${p.name}  ${p.kills}/${p.deaths}`, 12, 24 + i * 20);
  });
  // 房间码（顶中，便于转发）
  ctx.fillStyle = '#888';
  ctx.textAlign = 'center';
  ctx.fillText('房间 ' + roomCode, canvas.width / 2, 20);
  // 雷达小地图（右上）
  minimap();
  // 网络延迟：小地图正下方，绿/黄/红三档
  if (pingMs) {
    const mh = 200 * curMap.h / curMap.w;
    ctx.textAlign = 'right';
    ctx.font = '14px sans-serif';
    ctx.fillStyle = pingMs < 60 ? '#2ecc71' : pingMs < 120 ? '#f1c40f' : '#e74c3c';
    ctx.fillText(pingMs + ' ms', canvas.width - 10, 10 + mh + 18);
  }
  // 底部状态栏（自己的血量/武器/K-D）
  statusBar(me);
  // 死亡遮罩
  if (me.respawnIn > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(me.respawnIn + ' 秒后重生', canvas.width / 2, canvas.height / 2);
  }
}

function minimap() {
  const mw = 200, mh = mw * curMap.h / curMap.w;
  const ox = canvas.width - mw - 10, oy = 10;
  const sx = mw / curMap.w, sy = mh / curMap.h;
  const dot = (x, y, r) => { ctx.beginPath(); ctx.arc(ox + x * sx, oy + y * sy, r, 0, Math.PI * 2); ctx.fill(); };

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(ox, oy, mw, mh);
  ctx.fillStyle = (WALL_STYLE[curMap.floor] || WALL_STYLE.grass).edge; // 小地图墙色跟主题
  for (const w of allWalls()) ctx.fillRect(ox + w.x * sx, oy + w.y * sy, Math.max(1, w.w * sx), Math.max(1, w.h * sy));
  ctx.fillStyle = '#ffd700';
  for (const pk of state.pickups) dot(pk.x, pk.y, 1.5);
  ctx.fillStyle = '#ff5252';
  for (const m of state.monsters) dot(m.x, m.y, 1);
  ctx.fillStyle = '#9b59b6';
  for (const b of state.bosses) dot(b.x, b.y, 4); // Boss 大紫点
  for (const p of state.players) {
    if (p.respawnIn > 0) continue;
    ctx.fillStyle = p.color;
    dot(p.x, p.y, p.id === myId ? 3.5 : 2.5);
    if (p.id === myId) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
  }
}

// —— 输入：按键变化时才发 input ——
const keys = {};
const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyR: 'r',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function sendInput() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'input', keys }));
}
addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault(); // 方向键不滚页面
  if (!keys[k]) { keys[k] = true; sendInput(); }
});
addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (!k) return;
  if (keys[k]) { keys[k] = false; sendInput(); }
});

// 渲染循环全局唯一：脚本加载即启动，state 为空时 render 自行早退
requestAnimationFrame(render);
