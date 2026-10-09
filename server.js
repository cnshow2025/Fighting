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
const FIRE_COOLDOWN = 300;    // 毫秒
const MATCH_TIME = 60;        // 一局 1 分钟（秒）
const TEAM_SIZE = 5;
const MIN_TEAM = 3;           // 每队至少 3 人，不足的用电脑补
const TICK_RATE = 30;

const WIN_ROUNDS = 2;          // 三战两胜

// ===== 三个关卡（左半边定义，右半边中心对称生成） =====
// 障碍物种类：crate 木箱、sandbag 沙包（可以打坏）；wall 断墙、rock 石头（打不坏）
const OBSTACLE_HP = { crate: 4, sandbag: 6, wall: 0, rock: 0 };
const C = (x, y, w, h) => ({ type: 'crate', x, y, w, h });
const S = (x, y, w, h) => ({ type: 'sandbag', x, y, w, h });
const W = (x, y, w, h) => ({ type: 'wall', x, y, w, h });
const R = (x, y, w, h) => ({ type: 'rock', x, y, w, h });

const LEVELS = [
  { name: '仓库', difficulty: 'easy',      // 掩体多，好躲
    center: [C(768, 468, 64, 64)],
    half: [S(150, 420, 36, 160), C(230, 180, 64, 64), C(230, 756, 64, 64), C(360, 320, 72, 72), C(360, 608, 72, 72),
      S(470, 110, 170, 36), S(470, 854, 170, 36), C(520, 460, 64, 64), C(640, 260, 64, 64), C(640, 676, 64, 64), S(600, 340, 36, 100)] },
  { name: '废墟', difficulty: 'normal',    // 断墙为主，缺口可以穿过
    center: [W(788, 300, 24, 150), W(788, 550, 24, 150)],
    half: [W(200, 250, 24, 150), W(200, 250, 140, 24), W(200, 600, 24, 150), W(200, 726, 140, 24),
      W(430, 170, 120, 24), W(610, 170, 120, 24), W(430, 806, 120, 24), W(610, 806, 120, 24),
      C(470, 460, 64, 64), R(600, 380, 70, 60), S(620, 560, 36, 100)] },
  { name: '荒野', difficulty: 'hard',      // 掩体少，很开阔
    center: [R(760, 460, 80, 80)],
    half: [R(260, 300, 70, 60), R(260, 640, 70, 60), R(560, 170, 80, 70), R(560, 760, 80, 70), S(600, 450, 36, 100)] },
];

function buildObstacles(level) {
  const list = [...level.center];
  for (const o of level.half) list.push(o, { ...o, x: MAP_W - o.x - o.w, y: MAP_H - o.y - o.h });
  return list.map((o, i) => ({ ...o, i, hp: OBSTACLE_HP[o.type], maxHp: OBSTACLE_HP[o.type], dead: false }));
}

let obstacles = [];   // 本局全部障碍物（含已打坏的）
let solid = [];       // 还没被打坏的障碍物

// ===== 静态文件服务 =====
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// 本机局域网 IP（给邀请二维码用）
function localIPs() {
  const ips = [];
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    }
  } catch { /* Termux 新版安卓可能无权读取网卡信息 */ }
  return ips;
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/api/ip') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ips: localIPs(), port: PORT }));
  }
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
const settings = { botFill: true };   // 房主设定：电脑补位
let series = null;                    // 三战两胜：{ level, score: { red, blue } }

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
    minTeam: MIN_TEAM,
    result: lastResult,
    settings,
    players: [...players.values()].filter(p => p.name && !p.isBot).map(p => ({ id: p.id, name: p.name, team: p.team })),
  };
}
function broadcastLobby() { broadcast(lobbyInfo()); }

function pickHost() {
  const first = [...players.values()].find(p => p.name && !p.isBot);
  hostId = first ? first.id : null;
}

// ===== 几何工具 =====
function circleHitsRect(cx, cy, r, o) {
  const nx = Math.max(o.x, Math.min(cx, o.x + o.w));
  const ny = Math.max(o.y, Math.min(cy, o.y + o.h));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// 线段与矩形相交（Liang-Barsky）：返回进入矩形的位置 0~1，没碰到返回 -1
function segEnterT(x1, y1, x2, y2, o) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - o.x, o.x + o.w - x1, y1 - o.y, o.y + o.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return -1;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return -1; if (t > t0) t0 = t; }
      else { if (t < t0) return -1; if (t < t1) t1 = t; }
    }
  }
  return t0;
}
const segHitsRect = (x1, y1, x2, y2, o) => segEnterT(x1, y1, x2, y2, o) >= 0;

function lineClear(x1, y1, x2, y2) {
  for (const o of solid) if (segHitsRect(x1, y1, x2, y2, o)) return false;
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

// ===== 电脑玩家 =====
// 电脑和真人规则一样：只看得到视线内的敌人，子弹、血量都一样
const BOT_LEVELS = {
  easy:   { reaction: 900, aimErr: 0.22, extraCooldown: 500, coverHp: 0, lead: 0 },
  normal: { reaction: 500, aimErr: 0.10, extraCooldown: 150, coverHp: 1, lead: 0.5 },
  hard:   { reaction: 250, aimErr: 0.04, extraCooldown: 0,   coverHp: 2, lead: 0.9 },
};

function createBot(team, n) {
  const bot = {
    id: nextId++, ws: { readyState: 0 }, isBot: true, name: '🤖电脑' + n, team,
    inMatch: false, alive: false, x: 0, y: 0, angle: 0, hp: 0, kills: 0,
    input: { mx: 0, my: 0, ax: 0, ay: 0, fire: false },
  };
  players.set(bot.id, bot);
  return bot;
}

function newBotBrain() {
  return {
    path: [], replanAt: 0, goal: null,
    lastSeen: null, seeSince: 0, hideUntil: 0,
    strafe: Math.random() < 0.5 ? 1 : -1, strafeAt: 0,
    err: 0, errAt: 0, stuckX: 0, stuckY: 0, stuckAt: 0,
  };
}

// 寻路网格
const CELL = 25;
const COLS = Math.ceil(MAP_W / CELL), ROWS = Math.ceil(MAP_H / CELL);
const blocked = new Uint8Array(COLS * ROWS);
function buildGrid() {   // 换关卡或掩体被打坏时重算
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
      blocked[r * COLS + c] = (x < PLAYER_R || y < PLAYER_R || x > MAP_W - PLAYER_R || y > MAP_H - PLAYER_R ||
        solid.some(o => circleHitsRect(x, y, PLAYER_R + 3, o))) ? 1 : 0;
    }
  }
}
const cellOf = (x, y) => [Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL))), Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)))];
const cellCenter = i => ({ x: (i % COLS) * CELL + CELL / 2, y: Math.floor(i / COLS) * CELL + CELL / 2 });

function nearestFree(c, r) {
  for (let d = 0; d < 6; d++) {
    for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && rr >= 0 && cc < COLS && rr < ROWS && !blocked[rr * COLS + cc]) return rr * COLS + cc;
    }
  }
  return r * COLS + c;
}

function findPath(x1, y1, x2, y2) {
  const [sc, sr] = cellOf(x1, y1);
  const [gc, gr] = cellOf(x2, y2);
  const start = sr * COLS + sc, goal = nearestFree(gc, gr);
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const c = cur % COLS, r = (cur - c) / COLS;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const ni = nr * COLS + nc;
      if (blocked[ni] || prev[ni] !== -1) continue;
      if (dr && dc && (blocked[r * COLS + nc] || blocked[nr * COLS + c])) continue; // 不切墙角
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return [];
  const path = [];
  for (let i = goal; i !== start; i = prev[i]) path.push(cellCenter(i));
  return path.reverse();
}

// 身体宽度的通道都没被挡住，才能直接走过去
function wideClear(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1;
  const ox = -dy / l * PLAYER_R, oy = dx / l * PLAYER_R;
  return lineClear(x1, y1, x2, y2) && lineClear(x1 + ox, y1 + oy, x2 + ox, y2 + oy) && lineClear(x1 - ox, y1 - oy, x2 - ox, y2 - oy);
}

// 找附近一个敌人看不到的位置
function findCover(bot, enemy) {
  const [bc, br] = cellOf(bot.x, bot.y);
  let best = null, bestD = Infinity;
  const R = 12;
  for (let r = br - R; r <= br + R; r++) for (let c = bc - R; c <= bc + R; c++) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS || blocked[r * COLS + c]) continue;
    const pt = cellCenter(r * COLS + c);
    const d = Math.hypot(pt.x - bot.x, pt.y - bot.y);
    if (d >= bestD) continue;
    if (!canSee(enemy, { x: pt.x, y: pt.y })) { best = pt; bestD = d; }
  }
  return best;
}

function randomPatrolPoint(bot) {
  // 往地图中间或敌方半场走
  const enemySideX = bot.team === 'red' ? MAP_W * 0.75 : MAP_W * 0.25;
  const x = Math.random() < 0.3 ? MAP_W / 2 + (Math.random() - 0.5) * 500 : enemySideX + (Math.random() - 0.5) * 400;
  return { x, y: 100 + Math.random() * (MAP_H - 200) };
}

function followPath(bot, ai) {
  const path = ai.path;
  if (!path.length) return { x: 0, y: 0 };
  // 跳过可以直接走到的路径点，让路线更顺
  let j = 0;
  for (let k = Math.min(path.length - 1, 10); k > 0; k--) {
    if (wideClear(bot.x, bot.y, path[k].x, path[k].y)) { j = k; break; }
  }
  if (j) path.splice(0, j);
  const t = path[0];
  const dx = t.x - bot.x, dy = t.y - bot.y, d = Math.hypot(dx, dy);
  if (d < 10) { path.shift(); return followPath(bot, ai); }
  return { x: dx / d, y: dy / d };
}

function goTo(bot, ai, now, x, y) {
  if (now >= ai.replanAt || !ai.goal || Math.hypot(ai.goal.x - x, ai.goal.y - y) > 40) {
    ai.goal = { x, y };
    ai.path = findPath(bot.x, bot.y, x, y);
    ai.replanAt = now + 600;
  }
  return followPath(bot, ai);
}

function botThink(bot, now) {
  const ai = bot.ai;
  const lv = BOT_LEVELS[LEVELS[series.level].difficulty];   // 电脑难度随关卡提升
  let move = { x: 0, y: 0 }, aim = null, fire = false;

  // 找视线内最近的敌人
  let target = null, td = Infinity;
  for (const e of players.values()) {
    if (!e.inMatch || !e.alive || e.team === bot.team) continue;
    const d = Math.hypot(e.x - bot.x, e.y - bot.y);
    if (d < td && canSee(bot, e)) { target = e; td = d; }
  }

  if (target) {
    if (!ai.seeSince) ai.seeSince = now;
    // 估计目标移动速度，用来提前量瞄准
    let vx = 0, vy = 0;
    if (ai.lastSeen && ai.lastSeen.id === target.id && now - ai.lastSeen.t < 200) {
      const dt = (now - ai.lastSeen.t) / 1000 || 1 / TICK_RATE;
      vx = (target.x - ai.lastSeen.x) / dt;
      vy = (target.y - ai.lastSeen.y) / dt;
    }
    ai.lastSeen = { id: target.id, x: target.x, y: target.y, t: now };

    const flight = td / BULLET_SPEED * lv.lead;
    if (now >= ai.errAt) { ai.err = (Math.random() * 2 - 1) * lv.aimErr; ai.errAt = now + 300; }
    const ang = Math.atan2(target.y + vy * flight - bot.y, target.x + vx * flight - bot.x) + ai.err;
    aim = { x: Math.cos(ang), y: Math.sin(ang) };
    fire = now - ai.seeSince >= lv.reaction && now - bot.lastShot >= FIRE_COOLDOWN + lv.extraCooldown;

    if (bot.hp <= lv.coverHp) {
      // 血少：躲到掩体后面
      const cover = findCover(bot, target);
      if (cover) { move = goTo(bot, ai, now, cover.x, cover.y); ai.hideUntil = now + 2500; }
    } else {
      // 左右闪避，太远就靠近，太近就后退
      if (now >= ai.strafeAt) { ai.strafe = Math.random() < 0.5 ? 1 : -1; ai.strafeAt = now + 600 + Math.random() * 800; }
      const dx = (target.x - bot.x) / td, dy = (target.y - bot.y) / td;
      const fwd = td > 520 ? 0.8 : td < 260 ? -0.6 : 0;
      move = { x: -dy * ai.strafe * 0.8 + dx * fwd, y: dx * ai.strafe * 0.8 + dy * fwd };
      ai.path = [];
    }
  } else {
    ai.seeSince = 0;
    if (now < ai.hideUntil) {
      move = { x: 0, y: 0 };               // 躲着等一下
    } else if (ai.lastSeen && now - ai.lastSeen.t < 8000) {
      move = goTo(bot, ai, now, ai.lastSeen.x, ai.lastSeen.y);   // 去敌人最后出现的地方找
      if (Math.hypot(ai.lastSeen.x - bot.x, ai.lastSeen.y - bot.y) < 30) ai.lastSeen = null;
    } else {
      if (!ai.goal || Math.hypot(ai.goal.x - bot.x, ai.goal.y - bot.y) < 40 || !ai.path.length) {
        const pt = randomPatrolPoint(bot);
        ai.goal = pt;
        ai.path = findPath(bot.x, bot.y, pt.x, pt.y);
        ai.replanAt = now + 600;
      }
      move = followPath(bot, ai);
    }
  }

  // 卡住了就换方向、重新找路
  if (now >= ai.stuckAt) {
    if ((move.x || move.y) && Math.hypot(bot.x - ai.stuckX, bot.y - ai.stuckY) < 5) {
      ai.strafe = -ai.strafe;
      ai.replanAt = 0;
      if (!target) ai.goal = null;
    }
    ai.stuckX = bot.x; ai.stuckY = bot.y; ai.stuckAt = now + 700;
  }

  if (!aim && (move.x || move.y)) aim = move;
  bot.input = { mx: move.x, my: move.y, ax: aim ? aim.x : 0, ay: aim ? aim.y : 0, fire };
}

// ===== 开始 / 结束 =====
// 一场比赛：第 1 局在第 1 关、第 2 局在第 2 关……先赢 2 局的队获胜；平局重打同一关
function startSeries() {
  const prev = series;
  series = { level: 0, score: { red: 0, blue: 0 } };
  if (!startRound()) { series = prev; return false; }
  return true;
}

function startRound() {
  const level = LEVELS[series.level];
  for (const p of [...players.values()]) if (p.isBot) players.delete(p.id);
  const red = [...players.values()].filter(p => p.team === 'red');
  const blue = [...players.values()].filter(p => p.team === 'blue');
  if (settings.botFill) {
    // 用电脑补位：每队至少 3 人，并且两队人数一样
    const target = Math.max(red.length, blue.length, MIN_TEAM);
    // 第 2、3 关：全是电脑的那一队多 1 人
    const extra = series.level >= 1 ? 1 : 0;
    const redTarget = Math.min(TEAM_SIZE, target + (red.length === 0 && blue.length > 0 ? extra : 0));
    const blueTarget = Math.min(TEAM_SIZE, target + (blue.length === 0 && red.length > 0 ? extra : 0));
    let n = 1;
    while (red.length < redTarget) red.push(createBot('red', n++));
    while (blue.length < blueTarget) blue.push(createBot('blue', n++));
  }
  if (red.length === 0 || blue.length === 0) return false;

  obstacles = buildObstacles(level);
  solid = obstacles.slice();
  buildGrid();

  for (const p of players.values()) p.inMatch = false;
  const place = (list, x) => {
    list.forEach((p, i) => {
      p.inMatch = true;
      p.x = x;
      p.y = MAP_H / 2 + (i - (list.length - 1) / 2) * 90;
      p.angle = x < MAP_W / 2 ? 0 : Math.PI;
      p.hp = MAX_HP;
      p.alive = true;
      p.kills = 0;
      p.lastShot = 0;
      p.input = { mx: 0, my: 0, ax: 0, ay: 0, fire: false };
      if (p.isBot) p.ai = newBotBrain();
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
    map: { w: MAP_W, h: MAP_H, obstacles },
    playerR: PLAYER_R, bulletR: BULLET_R, maxHp: MAX_HP, matchTime: MATCH_TIME,
    level: series.level + 1, levelName: level.name, difficulty: level.difficulty, score: series.score,
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
  const played = series.level;
  if (winner !== 'draw') series.score[winner]++;
  const seriesOver = series.score.red >= WIN_ROUNDS || series.score.blue >= WIN_ROUNDS;
  if (winner !== 'draw' && !seriesOver) series.level++;
  lastResult = {
    winner, reason, red: aliveCount('red'), blue: aliveCount('blue'),
    level: played + 1, levelName: LEVELS[played].name,
    score: { ...series.score }, seriesOver,
    seriesWinner: seriesOver ? (series.score.red > series.score.blue ? 'red' : 'blue') : null,
    nextLevel: series.level + 1, nextLevelName: LEVELS[series.level].name,
  };
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

  for (const p of players.values()) if (p.isBot && p.inMatch && p.alive) botThink(p, now);

  // 移动 + 射击
  for (const p of players.values()) {
    if (!p.inMatch || !p.alive) continue;
    const inp = p.input;
    let mx = inp.mx, my = inp.my;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }

    const nx = Math.max(PLAYER_R, Math.min(MAP_W - PLAYER_R, p.x + mx * PLAYER_SPEED * dt));
    if (!solid.some(o => circleHitsRect(nx, p.y, PLAYER_R, o))) p.x = nx;
    const ny = Math.max(PLAYER_R, Math.min(MAP_H - PLAYER_R, p.y + my * PLAYER_SPEED * dt));
    if (!solid.some(o => circleHitsRect(p.x, ny, PLAYER_R, o))) p.y = ny;

    if (inp.ax || inp.ay) p.angle = Math.atan2(inp.ay, inp.ax);

    if (inp.fire && now - p.lastShot >= FIRE_COOLDOWN) {   // 子弹无限
      p.lastShot = now;
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
    // 先找子弹最先打到的障碍物
    let hitObs = null, hitT = Infinity;
    for (const o of solid) {
      const t = segEnterT(b.x, b.y, x2, y2, o);
      if (t >= 0 && t < hitT) { hitT = t; hitObs = o; }
    }
    if (hitObs) damageObstacle(hitObs);
    let gone = x2 < 0 || y2 < 0 || x2 > MAP_W || y2 > MAP_H || !!hitObs;
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
            if (killer) killer.kills++;
            broadcast({ t: 'kill', killer: killer ? killer.name : '?', killerTeam: b.team, victim: p.name });
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

// 木箱、沙包被打几枪会碎掉
function damageObstacle(o) {
  if (!o.maxHp) return;
  o.hp--;
  if (o.hp <= 0) {
    o.dead = true;
    solid = obstacles.filter(q => !q.dead);
    buildGrid();
    for (const p of players.values()) if (p.isBot && p.ai) p.ai.replanAt = 0;
  }
  broadcast({ t: 'obs', i: o.i, hp: o.hp });
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
        list.push({ id: p.id, name: p.name, team: p.team, x: Math.round(p.x), y: Math.round(p.y), a: +p.angle.toFixed(2), hp: p.hp, alive: p.alive, bot: !!p.isBot });
      }
    }
    const bl = [];
    for (const b of bullets) {
      if ((v.inMatch && b.team === v.team) || seen(b.x, b.y)) bl.push([Math.round(b.x), Math.round(b.y), b.team === 'red' ? 0 : 1]);
    }
    send(v, {
      t: 'state',
      time: Math.max(0, Math.ceil(timeLeft)),
      me: v.inMatch ? { id: v.id, x: v.x, y: v.y, hp: v.hp, alive: v.alive, kills: v.kills, team: v.team } : null,
      players: list,
      bullets: bl,
      red, blue,
    });
  }
}

// ===== 连接处理 =====
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  const p = { id: nextId++, ws, name: '', team: null, inMatch: false, alive: false, x: 0, y: 0, angle: 0, hp: 0, kills: 0, input: { mx: 0, my: 0, ax: 0, ay: 0, fire: false } };
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
        const count = [...players.values()].filter(q => q.team === m.team && q !== p && !q.isBot).length;
        if (count >= TEAM_SIZE) { send(p, { t: 'error', msg: '这一队已经满 5 人了' }); break; }
        p.team = m.team;
        broadcastLobby();
        break;
      }
      case 'leaveTeam': {
        if (phase === 'playing') break;
        p.team = null;
        broadcastLobby();
        break;
      }
      case 'start': {
        if (p.id !== hostId || phase === 'playing') break;
        if (!startSeries()) send(p, { t: 'error', msg: '红蓝两队都至少要有 1 人才能开始（或打开“电脑补位”）' });
        break;
      }
      case 'next': {   // 下一关（或平局重打这一关）
        if (p.id !== hostId || phase !== 'ended' || !series || (lastResult && lastResult.seriesOver)) break;
        if (!startRound()) send(p, { t: 'error', msg: '红蓝两队都至少要有 1 人才能开始（或打开“电脑补位”）' });
        break;
      }
      case 'settings': {
        if (p.id !== hostId || phase === 'playing') break;
        if (typeof m.botFill === 'boolean') settings.botFill = m.botFill;
        broadcastLobby();
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
  const ips = localIPs();
  for (const ip of ips) console.log(`  其他手机浏览器打开： http://${ip}:${PORT}`);
  if (!ips.length) {
    console.log('  未能自动获取 IP。安卓热点通常是 http://192.168.43.1:' + PORT);
    console.log('  （或在 设置 > 热点 / WLAN 中查看本机 IP）');
  }
  console.log(`  本机自己玩：打开 http://localhost:${PORT}`);
});
