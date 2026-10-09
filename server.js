// 局域网 5v5 掩体射击游戏 —— 服务器
// 运行：node server.js   然后其他手机浏览器打开 http://<本机IP>:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ===== 游戏参数 =====
const MAP_W = 1600;
const MAP_H = 1000;
const PLAYER_R = 18;
const PLAYER_SPEED = 220;     // 像素/秒
const BULLET_SPEED = 750;     // 像素/秒
const BULLET_R = 4;
const MAX_HP = 3;             // 中 3 枪倒下
const START_AMMO = 30;        // 每人开局子弹
const FIRE_COOLDOWN = 300;    // 毫秒
const MATCH_TIME = 180;       // 一局 3 分钟（秒）
const TEAM_SIZE = 5;
const TICK_RATE = 30;

// ===== 地图遮蔽物（左半边定义，右半边中心对称生成） =====
const HALF_OBSTACLES = [
  { x: 150, y: 450, w: 80, h: 100 },
  { x: 320, y: 150, w: 60, h: 200 },
  { x: 320, y: 650, w: 60, h: 200 },
  { x: 540, y: 60, w: 180, h: 50 },
  { x: 540, y: 890, w: 180, h: 50 },
  { x: 520, y: 430, w: 110, h: 140 },
  { x: 470, y: 260, w: 50, h: 90 },
  { x: 470, y: 650, w: 50, h: 90 },
];
const OBSTACLES = [{ x: 760, y: 410, w: 80, h: 180 }];
for (const o of HALF_OBSTACLES) {
  OBSTACLES.push(o);
  OBSTACLES.push({ x: MAP_W - o.x - o.w, y: MAP_H - o.y - o.h, w: o.w, h: o.h });
}

// ===== 静态文件服务 =====
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ===== 游戏状态 =====
const players = new Map();   // id -> player
let nextId = 1;
let hostId = null;
let phase = 'lobby';         // lobby | playing | ended
let bullets = [];
let timeLeft = 0;
let lastResult = null;

function send(p, msg) {
  if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s);
}

function lobbyInfo() {
  return {
    t: 'lobby',
    phase,
    hostId,
    teamSize: TEAM_SIZE,
    result: lastResult,
    players: [...players.values()].filter(p => p.name).map(p => ({ id: p.id, name: p.name, team: p.team })),
  };
}
function broadcastLobby() { broadcast(lobbyInfo()); }

function pickHost() {
  const first = [...players.values()].find(p => p.name);
  hostId = first ? first.id : null;
}

// ===== 几何工具 =====
function circleHitsRect(cx, cy, r, o) {
  const nx = Math.max(o.x, Math.min(cx, o.x + o.w));
  const ny = Math.max(o.y, Math.min(cy, o.y + o.h));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// 线段与矩形相交（Liang-Barsky）
function segHitsRect(x1, y1, x2, y2, o) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - o.x, o.x + o.w - x1, y1 - o.y, o.y + o.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

function lineClear(x1, y1, x2, y2) {
  for (const o of OBSTACLES) if (segHitsRect(x1, y1, x2, y2, o)) return false;
  return true;
}

// 视线：目标中心或身体左右两侧任一点没被挡住，就算看得到
function canSee(viewer, target) {
  const dx = target.x - viewer.x, dy = target.y - viewer.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len * PLAYER_R * 0.9, py = dx / len * PLAYER_R * 0.9;
  return lineClear(viewer.x, viewer.y, target.x, target.y) ||
    lineClear(viewer.x, viewer.y, target.x + px, target.y + py) ||
    lineClear(viewer.x, viewer.y, target.x - px, target.y - py);
}

function distToSegSq(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx - px, cy = y1 + t * dy - py;
  return cx * cx + cy * cy;
}

// ===== 开始 / 结束 =====
function startMatch() {
  const red = [...players.values()].filter(p => p.team === 'red');
  const blue = [...players.values()].filter(p => p.team === 'blue');
  if (red.length === 0 || blue.length === 0) return false;

  for (const p of players.values()) p.inMatch = false;
  const place = (list, x) => {
    list.forEach((p, i) => {
      p.inMatch = true;
      p.x = x;
      p.y = MAP_H / 2 + (i - (list.length - 1) / 2) * 90;
      p.angle = x < MAP_W / 2 ? 0 : Math.PI;
      p.hp = MAX_HP;
      p.ammo = START_AMMO;
      p.alive = true;
      p.kills = 0;
      p.lastShot = 0;
      p.input = { mx: 0, my: 0, ax: 0, ay: 0, fire: false };
    });
  };
  place(red, 60);
  place(blue, MAP_W - 60);

  bullets = [];
  timeLeft = MATCH_TIME;
  lastResult = null;
  phase = 'playing';
  broadcast({
    t: 'start',
    map: { w: MAP_W, h: MAP_H, obstacles: OBSTACLES },
    playerR: PLAYER_R, bulletR: BULLET_R, maxHp: MAX_HP,
  });
  broadcastLobby();
  return true;
}

function aliveCount(team) {
  let n = 0;
  for (const p of players.values()) if (p.inMatch && p.team === team && p.alive) n++;
  return n;
}

function endMatch(winner, reason) {
  phase = 'ended';
  lastResult = { winner, reason, red: aliveCount('red'), blue: aliveCount('blue') };
  broadcast({ t: 'end', result: lastResult });
  broadcastLobby();
}

function checkWin() {
  const r = aliveCount('red'), b = aliveCount('blue');
  if (r === 0 && b === 0) return endMatch('draw', '双方全灭');
  if (r === 0) return endMatch('blue', '红队全灭');
  if (b === 0) return endMatch('red', '蓝队全灭');
  if (timeLeft <= 0) {
    if (r > b) endMatch('red', '时间到，红队存活人数多');
    else if (b > r) endMatch('blue', '时间到，蓝队存活人数多');
    else endMatch('draw', '时间到，存活人数相同');
  }
}

// ===== 每帧更新 =====
function tick(dt) {
  if (phase !== 'playing') return;
  const now = Date.now();
  timeLeft -= dt;

  // 移动 + 射击
  for (const p of players.values()) {
    if (!p.inMatch || !p.alive) continue;
    const inp = p.input;
    let mx = inp.mx, my = inp.my;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }

    const nx = Math.max(PLAYER_R, Math.min(MAP_W - PLAYER_R, p.x + mx * PLAYER_SPEED * dt));
    if (!OBSTACLES.some(o => circleHitsRect(nx, p.y, PLAYER_R, o))) p.x = nx;
    const ny = Math.max(PLAYER_R, Math.min(MAP_H - PLAYER_R, p.y + my * PLAYER_SPEED * dt));
    if (!OBSTACLES.some(o => circleHitsRect(p.x, ny, PLAYER_R, o))) p.y = ny;

    if (inp.ax || inp.ay) p.angle = Math.atan2(inp.ay, inp.ax);

    if (inp.fire && p.ammo > 0 && now - p.lastShot >= FIRE_COOLDOWN) {
      p.lastShot = now;
      p.ammo--;
      bullets.push({
        x: p.x, y: p.y,
        vx: Math.cos(p.angle) * BULLET_SPEED,
        vy: Math.sin(p.angle) * BULLET_SPEED,
        owner: p.id, team: p.team,
      });
    }
  }

  // 子弹
  const kept = [];
  for (const b of bullets) {
    const x2 = b.x + b.vx * dt, y2 = b.y + b.vy * dt;
    let gone = x2 < 0 || y2 < 0 || x2 > MAP_W || y2 > MAP_H || !lineClear(b.x, b.y, x2, y2);
    if (!gone) {
      for (const p of players.values()) {
        if (!p.inMatch || !p.alive || p.team === b.team) continue;
        const rr = PLAYER_R + BULLET_R;
        if (distToSegSq(p.x, p.y, b.x, b.y, x2, y2) < rr * rr) {
          gone = true;
          p.hp--;
          if (p.hp <= 0) {
            p.alive = false;
            const killer = players.get(b.owner);
            const taken = p.ammo;
            p.ammo = 0;
            if (killer) {
              killer.ammo += taken;   // 对方剩下的子弹转到击倒者手上
              killer.kills++;
            }
            broadcast({ t: 'kill', killer: killer ? killer.name : '?', killerTeam: b.team, victim: p.name, ammo: taken });
          }
          break;
        }
      }
    }
    if (!gone) { b.x = x2; b.y = y2; kept.push(b); }
  }
  bullets = kept;

  checkWin();
  if (phase === 'playing') sendStates();
}

// 每个人只收到他能看到的敌人（防偷看）
function sendStates() {
  const all = [...players.values()];
  const red = aliveCount('red'), blue = aliveCount('blue');
  for (const v of all) {
    if (v.ws.readyState !== 1) continue;
    let eyes;
    if (v.inMatch && v.alive) eyes = [v];
    else if (v.inMatch) eyes = all.filter(p => p.inMatch && p.alive && p.team === v.team); // 倒下后看队友视野
    else eyes = null; // 没参赛的旁观者看全部

    const seen = (x, y, target) => !eyes || eyes.some(e => target ? canSee(e, target) : lineClear(e.x, e.y, x, y));

    const list = [];
    for (const p of all) {
      if (!p.inMatch) continue;
      const friendly = v.inMatch && p.team === v.team;
      if (friendly || (p.alive && seen(p.x, p.y, p))) {
        list.push({ id: p.id, name: p.name, team: p.team, x: Math.round(p.x), y: Math.round(p.y), a: +p.angle.toFixed(2), hp: p.hp, alive: p.alive });
      }
    }
    const bl = [];
    for (const b of bullets) {
      if ((v.inMatch && b.team === v.team) || seen(b.x, b.y)) bl.push([Math.round(b.x), Math.round(b.y), b.team === 'red' ? 0 : 1]);
    }
    send(v, {
      t: 'state',
      time: Math.max(0, Math.ceil(timeLeft)),
      me: v.inMatch ? { id: v.id, x: v.x, y: v.y, hp: v.hp, ammo: v.ammo, alive: v.alive, kills: v.kills, team: v.team } : null,
      players: list,
      bullets: bl,
      red, blue,
    });
  }
}

// ===== 连接处理 =====
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  const p = { id: nextId++, ws, name: '', team: null, inMatch: false, alive: false, x: 0, y: 0, angle: 0, hp: 0, ammo: 0, kills: 0, input: { mx: 0, my: 0, ax: 0, ay: 0, fire: false } };
  players.set(p.id, p);
  send(p, { t: 'welcome', id: p.id });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'join': {
        p.name = String(m.name || '').trim().slice(0, 12) || '玩家' + p.id;
        if (!hostId) pickHost();
        broadcastLobby();
        break;
      }
      case 'team': {
        if (phase === 'playing' || !p.name) break;
        if (m.team !== 'red' && m.team !== 'blue') break;
        const count = [...players.values()].filter(q => q.team === m.team && q !== p).length;
        if (count >= TEAM_SIZE) { send(p, { t: 'error', msg: '这一队已经满 5 人了' }); break; }
        p.team = m.team;
        broadcastLobby();
        break;
      }
      case 'start': {
        if (p.id !== hostId || phase === 'playing') break;
        if (!startMatch()) send(p, { t: 'error', msg: '红蓝两队都至少要有 1 人才能开始' });
        break;
      }
      case 'input': {
        const n = v => (typeof v === 'number' && isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
        p.input = { mx: n(m.mx), my: n(m.my), ax: n(m.ax), ay: n(m.ay), fire: !!m.fire };
        break;
      }
    }
  });

  ws.on('close', () => {
    players.delete(p.id);
    if (hostId === p.id) pickHost();
    if (phase === 'playing') checkWin();
    broadcastLobby();
  });
});

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  tick(Math.min(0.1, (now - last) / 1000));
  last = now;
}, 1000 / TICK_RATE);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`游戏服务器已启动，端口 ${PORT}`);
  let found = false;
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) {
          console.log(`  其他手机浏览器打开： http://${a.address}:${PORT}`);
          found = true;
        }
      }
    }
  } catch { /* Termux 新版安卓可能无权读取网卡信息 */ }
  if (!found) {
    console.log('  未能自动获取 IP。安卓热点通常是 http://192.168.43.1:' + PORT);
    console.log('  （或在 设置 > 热点 / WLAN 中查看本机 IP）');
  }
  console.log(`  本机自己玩：打开 http://localhost:${PORT}`);
});
