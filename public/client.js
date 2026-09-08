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
    else if (m.t === 'state') state = m;
    else if (m.t === 'error') { ws.onclose = null; ws.close(); backToLobby(m.msg); }
  };
  ws.onclose = () => backToLobby('与服务器断开');
}

function startGame(m) {
  myId = m.id;
  roomCode = m.code;
  $('lobby').style.display = 'none';
  $('game').style.display = 'block';
  requestAnimationFrame(render);
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

function render() {
  requestAnimationFrame(render);
  ctx.fillStyle = '#16213e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state) return;
  const me = state.players.find(p => p.id === myId);
  if (!me) return;

  // 镜头跟随，地图边缘钳制
  const camX = clamp(me.x - canvas.width / 2, 0, G.MAP.w - canvas.width);
  const camY = clamp(me.y - canvas.height / 2, 0, G.MAP.h - canvas.height);
  const inView = (x, y, r) =>
    x + r > camX && x - r < camX + canvas.width && y + r > camY && y - r < camY + canvas.height;

  ctx.save();
  ctx.translate(Math.round(-camX), Math.round(-camY));

  // 墙
  ctx.fillStyle = '#3d4a6b';
  for (const w of G.WALLS) {
    if (inView(w.x + w.w / 2, w.y + w.h / 2, Math.max(w.w, w.h) / 2)) ctx.fillRect(w.x, w.y, w.w, w.h);
  }
  // 拾取物（旋转金方块）
  for (const pk of state.pickups) {
    if (!inView(pk.x, pk.y, 12)) continue;
    ctx.save();
    ctx.translate(pk.x, pk.y);
    ctx.rotate(performance.now() / 300);
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(-8, -8, 16, 16);
    ctx.restore();
  }
  // 怪物（红三角）
  ctx.fillStyle = '#ff5252';
  for (const m of state.monsters) if (inView(m.x, m.y, G.MONSTER.r)) tri(m.x, m.y, G.MONSTER.r);
  // Boss（大紫圆 + 血条）
  for (const b of state.bosses) {
    if (!inView(b.x, b.y, G.BOSS.r)) continue;
    ctx.fillStyle = '#9b59b6';
    circ(b.x, b.y, G.BOSS.r);
    bar(b.x, b.y - G.BOSS.r - 10, 48, b.hp / G.BOSS.hp);
  }
  // 子弹（黄点，尺寸来自服务器）
  ctx.fillStyle = '#ffd93d';
  for (const b of state.bullets) if (inView(b.x, b.y, b.size)) circ(b.x, b.y, b.size);
  // 玩家（彩圆 + 昵称 + 血条；自己描白边；死亡中不画）
  for (const p of state.players) {
    if (p.respawnIn > 0 || !inView(p.x, p.y, G.PLAYER.r + 20)) continue;
    ctx.fillStyle = p.color;
    circ(p.x, p.y, G.PLAYER.r);
    if (p.id === myId) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, G.PLAYER.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#eee'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - G.PLAYER.r - 16);
    bar(p.x, p.y - G.PLAYER.r - 10, 32, p.hp / G.PLAYER.hpMax);
  }

  ctx.restore();
  drawHUD(me);
}

function circ(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function tri(x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x - r, y + r); ctx.lineTo(x + r, y + r);
  ctx.closePath(); ctx.fill();
}
function bar(x, y, w, frac) {
  ctx.fillStyle = '#c0392b'; ctx.fillRect(x - w / 2, y - 4, w, 5);
  ctx.fillStyle = '#2ecc71'; ctx.fillRect(x - w / 2, y - 4, w * clamp(frac, 0, 1), 5);
}

// —— HUD ——
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
const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
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
