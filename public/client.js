// client.js — 大厅、连接、渲染。游戏状态全部来自服务器 state 消息。
const G = window.GameShared;
const $ = id => document.getElementById(id);
const wsUrl = () => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;

let ws = null, myId = null, state = null, roomCode = '';

function go(msg) {
  $('msg').textContent = '';
  ws = new WebSocket(wsUrl());
  ws.onopen = () => ws.send(JSON.stringify(msg));
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'joined') startGame(m);
    else if (m.t === 'state') {
      if (state) detect(state, m);
      prev = state; state = m; recvTime = performance.now();
    }
    else if (m.t === 'error') { ws.onclose = null; ws.close(); backToLobby(m.msg); }
  };
  ws.onclose = () => backToLobby('与服务器断开');
}

function startGame(m) {
  myId = m.id;
  roomCode = m.code;
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
$('createBtn').onclick = () => go({ t: 'create', name: name() });
$('joinBtn').onclick = () => go({ t: 'join', name: name(), code: $('code').value.trim().toUpperCase() });

// —— 渲染 ——
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

let prev = null, recvTime = 0;   // 插值：实体画在 prev 与 state 之间
let parts = [];                  // 粒子（世界坐标，纯客户端特效，上限 300）
let rings = [];                  // 爆炸冲击波圈（半径 = 服务器广播的实际伤害半径）
let lastFrame = performance.now();
let shake = 0, flash = 0;        // 自己受击反馈：屏幕震动 / 红闪
const recoil = new Map();        // 玩家id → 后坐截止时刻（新子弹在谁身边冒出谁后坐）

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
  const camX = clamp(me.x - canvas.width / 2, 0, G.MAP.w - canvas.width);
  const camY = clamp(me.y - canvas.height / 2, 0, G.MAP.h - canvas.height);
  const shX = shake ? (Math.random() - 0.5) * shake : 0;
  const shY = shake ? (Math.random() - 0.5) * shake : 0;
  const inView = (x, y, r) =>
    x + r > camX && x - r < camX + canvas.width && y + r > camY && y - r < camY + canvas.height;

  ctx.save();
  ctx.translate(Math.round(-camX + shX), Math.round(-camY + shY));

  // 地面网格（随镜头滚动，提供速度感）
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(camX / 100) * 100; x <= camX + canvas.width; x += 100) { ctx.moveTo(x, camY); ctx.lineTo(x, camY + canvas.height); }
  for (let y = Math.floor(camY / 100) * 100; y <= camY + canvas.height; y += 100) { ctx.moveTo(camX, y); ctx.lineTo(camX + canvas.width, y); }
  ctx.stroke();

  // 墙（主体 + 亮顶边 + 暗底边，假 3D）
  for (const w of G.WALLS) {
    if (!inView(w.x + w.w / 2, w.y + w.h / 2, Math.max(w.w, w.h) / 2)) continue;
    ctx.fillStyle = '#3d4a6b';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.fillStyle = '#5a6a94';
    ctx.fillRect(w.x, w.y, w.w, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(w.x, w.y + w.h - 4, w.w, 4);
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
  // 怪物（红三角：光晕 + 呼吸脉动 + 描边）
  for (const m0 of state.monsters) {
    const m = lp(m0, maps.monsters);
    if (!inView(m.x, m.y, G.MONSTER.r + 10)) continue;
    const pulse = 1 + 0.08 * Math.sin(t / 150 + m0.id);
    ctx.globalAlpha = 0.15; ctx.fillStyle = '#ff5252';
    circ(m.x, m.y, G.MONSTER.r * 1.7);
    ctx.globalAlpha = 1;
    triPath(m.x, m.y, G.MONSTER.r * pulse);
    ctx.fillStyle = '#ff5252'; ctx.fill();
    ctx.strokeStyle = '#ff8a80'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  // Boss（紫渐变球 + 光晕 + 武器名 + 血条）
  for (const b0 of state.bosses) {
    const b = lp(b0, maps.bosses);
    if (!inView(b.x, b.y, G.BOSS.r + 24)) continue;
    ctx.globalAlpha = 0.2; ctx.fillStyle = '#9b59b6';
    circ(b.x, b.y, G.BOSS.r * 1.5);
    ctx.globalAlpha = 1;
    const gr = ctx.createRadialGradient(b.x - 10, b.y - 10, 4, b.x, b.y, G.BOSS.r);
    gr.addColorStop(0, '#d7bde2'); gr.addColorStop(1, '#7d3c98');
    ctx.fillStyle = gr;
    circ(b.x, b.y, G.BOSS.r);
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
  // 玩家（渐变球 + 光晕 + 昵称 + 血条；自己描白边；死亡中不画）
  for (const p0 of state.players) {
    if (p0.respawnIn > 0) continue;
    const p = lp(p0, maps.players);
    if (!inView(p.x, p.y, G.PLAYER.r + 24)) continue;
    ctx.globalAlpha = 0.18; ctx.fillStyle = p0.color;
    circ(p.x, p.y, G.PLAYER.r * 1.7);
    ctx.globalAlpha = 1;
    // 低血加速：蓝色残影（上一帧+中间位置）+ 脉冲圆环
    if (p0.boost) {
      const o = maps.players && maps.players.get(p0.id);
      ctx.globalAlpha = 0.2; ctx.fillStyle = '#4dd0e1';
      if (o) circ(o.x, o.y, G.PLAYER.r * 0.9);
      circ(o ? (o.x + p.x) / 2 : p.x, o ? (o.y + p.y) / 2 : p.y, G.PLAYER.r * 0.7);
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t / 100);
      ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, G.PLAYER.r + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 炮管（朝向来自服务器开火记录）+ 后坐 2px（100ms 回弹）
    if (p0.face) {
      const rec = (recoil.get(p0.id) || 0) > t ? 2 : 0;
      ctx.strokeStyle = '#cfd8e3'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x + p0.face.x * 6, p.y + p0.face.y * 6);
      ctx.lineTo(p.x + p0.face.x * (G.PLAYER.r + 6 - rec), p.y + p0.face.y * (G.PLAYER.r + 6 - rec));
      ctx.stroke();
    }
    const gr = ctx.createRadialGradient(p.x - 5, p.y - 5, 2, p.x, p.y, G.PLAYER.r);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, p0.color);
    ctx.fillStyle = gr;
    circ(p.x, p.y, G.PLAYER.r);
    if (p0.id === myId) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, G.PLAYER.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#eee'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(p0.name, p.x, p.y - G.PLAYER.r - 16);
    bar(p.x, p.y - G.PLAYER.r - 10, 32, p0.hp / G.PLAYER.hpMax);
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
  // 换弹中：血条上方黄色闪烁小字（纯视觉，服务器 authoritative）
  if (me.reloading && Math.sin(performance.now() / 120) > 0) {
    ctx.fillStyle = '#ffd700';
    ctx.fillText('换弹中…', hx + hw / 2, y - 6);
  }
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
  const mw = 200, mh = mw * G.MAP.h / G.MAP.w; // 200 × 112.5
  const ox = canvas.width - mw - 10, oy = 10;
  const sx = mw / G.MAP.w, sy = mh / G.MAP.h;
  const dot = (x, y, r) => { ctx.beginPath(); ctx.arc(ox + x * sx, oy + y * sy, r, 0, Math.PI * 2); ctx.fill(); };

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(ox, oy, mw, mh);
  ctx.fillStyle = '#3d4a6b';
  for (const w of G.WALLS) ctx.fillRect(ox + w.x * sx, oy + w.y * sy, Math.max(1, w.w * sx), Math.max(1, w.h * sy));
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
