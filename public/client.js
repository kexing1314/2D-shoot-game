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

// Task 10 替换为完整渲染
function render() {}
