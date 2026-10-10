// 局域网 5v5 掩体射击游戏 —— 手机端
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');

  let ws;
  let myId = null;
  let myName = '';
  let lobby = null;
  let inGame = false;
  let map = null;
  let cfg = { playerR: 18, bulletR: 4, maxHp: 3, matchTime: 60 };
  let state = null;
  let endResult = null;
  const shown = new Map();   // id -> 平滑显示用的位置
  const killFeed = [];       // { text, color, until }

  // ===== 界面切换 =====
  function showScreen(name) {
    for (const s of ['joinScreen', 'lobbyScreen']) $(s).classList.toggle('show', s === name);
    canvas.style.display = name === 'game' ? 'block' : 'none';
    updateEndPanel();
  }

  // 结算画面上的按钮：房主可以“重新开始”，每个人都可以“回到大厅”
  function updateEndPanel() {
    const show = inGame && !!endResult;
    $('endPanel').style.display = show ? 'flex' : 'none';
    if (!show) return;
    const isHost = lobby && lobby.hostId === myId;
    const r = endResult;
    $('restartBtn').textContent = r.seriesOver ? '再来一场' : r.winner === 'draw' ? '重打这一关' : `下一关：第 ${r.nextLevel} 关`;
    $('endWait').textContent = r.seriesOver ? '等待房主重新开始…' : '等待房主开始下一关…';
    $('restartBtn').style.display = isHost ? 'block' : 'none';
    $('endWait').style.display = isHost ? 'none' : 'block';
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.style.display = 'none'), 2500);
  }

  // ===== 网络 =====
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => { if (myName) sendMsg({ t: 'join', name: myName }); };
    ws.onmessage = e => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      inGame = false;
      toast('与服务器断开，正在重连…');
      setTimeout(connect, 1500);
    };
  }
  function sendMsg(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function onMessage(m) {
    switch (m.t) {
      case 'welcome': myId = m.id; break;
      case 'lobby':
        lobby = m;
        if (!inGame && myName) { renderLobby(); showScreen('lobbyScreen'); }
        updateEndPanel();
        break;
      case 'start':
        map = m.map;
        cfg = { playerR: m.playerR, bulletR: m.bulletR, maxHp: m.maxHp, matchTime: m.matchTime,
          level: m.level, levelName: m.levelName, score: m.score, introUntil: performance.now() + 2500 };
        state = null;
        endResult = null;
        shown.clear();
        killFeed.length = 0;
        inGame = true;
        showScreen('game');
        resize();
        break;
      case 'state': state = m; break;
      case 'obs': {   // 木箱、沙包被打到
        const o = map && map.obstacles[m.i];
        if (o) { o.hp = m.hp; if (m.hp <= 0) o.dead = true; }
        break;
      }
      case 'kill': {
        const color = m.killerTeam === 'red' ? '#ff6b6f' : '#6aa8ff';
        killFeed.push({ text: `${m.killer} 击倒 ${m.victim}`, color, until: Date.now() + 5000 });
        if (killFeed.length > 4) killFeed.shift();
        break;
      }
      case 'end':
        endResult = m.result;
        updateEndPanel();
        break;
      case 'error': toast(m.msg); break;
    }
  }

  // ===== 大厅 =====
  function renderLobby() {
    const ps = lobby.players;
    for (const team of ['red', 'blue']) {
      const list = ps.filter(p => p.team === team);
      $(team + 'Count').textContent = `${list.length}/${lobby.teamSize}`;
      $(team + 'List').innerHTML = list.map(p =>
        `<li class="${p.id === myId ? 'me' : ''}">${esc(p.name)}${p.id === lobby.hostId ? ' 👑' : ''}</li>`).join('');
    }
    const waiting = ps.filter(p => !p.team);
    $('waitingList').textContent = waiting.length ? '未选队：' + waiting.map(p => p.name).join('、') : '';

    const isHost = lobby.hostId === myId;
    const playing = lobby.phase === 'playing';
    $('startBtn').style.display = isHost && !playing ? 'block' : 'none';
    $('invites').style.display = isHost ? 'flex' : 'none';
    $('lobbyHint').textContent = playing ? '游戏进行中，请等待下一局' : isHost ? '' : '等待房主开始…';
    document.querySelectorAll('.team button').forEach(b => (b.disabled = playing));
    const mine = ps.find(p => p.id === myId);
    $('leaveTeamBtn').style.display = mine && mine.team && !playing ? 'block' : 'none';

    // 电脑补位开关（只有房主看得到）
    $('botBox').style.display = isHost && !playing ? 'flex' : 'none';
    $('botFill').checked = lobby.settings.botFill;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 通过邀请二维码打开时，网址带 ?team=red 或 ?team=blue
  const TEAM_NAME = { red: '红队', blue: '蓝队' };
  let invitedTeam = new URLSearchParams(location.search).get('team');
  if (!TEAM_NAME[invitedTeam]) invitedTeam = null;
  if (invitedTeam) {
    const b = $('inviteBanner');
    b.textContent = `你被邀请加入${TEAM_NAME[invitedTeam]}`;
    b.style.background = invitedTeam === 'red' ? '#e5484d' : '#3e8ef7';
    b.style.display = 'block';
    $('joinBtn').textContent = `加入${TEAM_NAME[invitedTeam]}`;
  }

  // iPhone / iPad 的 Safari 不能自动全屏，提示加到主屏幕
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (isIOS && !standalone) $('iosHint').style.display = 'block';

  try { $('nameInput').value = localStorage.getItem('name') || ''; } catch {}
  $('joinBtn').onclick = () => {
    myName = $('nameInput').value.trim() || '玩家';
    try { localStorage.setItem('name', myName); } catch {}
    sendMsg({ t: 'join', name: myName });
    if (invitedTeam) {
      sendMsg({ t: 'team', team: invitedTeam });
      invitedTeam = null;
      history.replaceState(null, '', location.pathname);
    }
  };
  document.querySelectorAll('.team button').forEach(b => {
    b.onclick = () => sendMsg({ t: 'team', team: b.dataset.team });
  });
  $('startBtn').onclick = () => sendMsg({ t: 'start' });
  $('leaveTeamBtn').onclick = () => sendMsg({ t: 'leaveTeam' });
  $('restartBtn').onclick = () => sendMsg(endResult && !endResult.seriesOver ? { t: 'next' } : { t: 'start' });
  $('backLobbyBtn').onclick = () => {
    inGame = false;
    if (lobby) renderLobby();
    showScreen('lobbyScreen');
  };
  $('helpBtn').onclick = () => $('helpModal').classList.add('show');
  $('helpClose').onclick = () => $('helpModal').classList.remove('show');
  $('botFill').onchange = () => sendMsg({ t: 'settings', botFill: $('botFill').checked });
  // ===== 邀请二维码 =====
  let qrTeam = 'red';
  let addrGuess = null;
  const isLocal = h => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

  async function guessAddr() {
    if (!isLocal(location.hostname)) return location.host;
    const port = location.port || '80';
    try {
      const r = await (await fetch('/api/ip')).json();
      if (r.ips && r.ips.length) return r.ips[0] + ':' + port;
    } catch {}
    return '192.168.43.1:' + port;   // 安卓热点常见地址
  }

  function drawQR() {
    const addr = $('qrAddr').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const url = `http://${addr}/?team=${qrTeam}`;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount(), margin = 2, cell = 8;
    const c = $('qrCanvas'), size = (n + margin * 2) * cell;
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
      if (qr.isDark(r, k)) g.fillRect((k + margin) * cell, (r + margin) * cell, cell, cell);
    }
  }

  document.querySelectorAll('[data-invite]').forEach(b => {
    b.onclick = async () => {
      qrTeam = b.dataset.invite;
      $('qrTitle').textContent = `扫码加入${TEAM_NAME[qrTeam]}`;
      $('qrTitle').style.color = qrTeam === 'red' ? '#e5484d' : '#3e8ef7';
      if (!addrGuess) addrGuess = await guessAddr();
      if (!$('qrAddr').value) $('qrAddr').value = addrGuess;
      drawQR();
      $('qrModal').classList.add('show');
    };
  });
  $('qrAddr').oninput = drawQR;
  $('qrClose').onclick = () => $('qrModal').classList.remove('show');

  // 全屏 + 横屏（手机上体验更好）
  document.addEventListener('click', () => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    }
  });

  // ===== 触控摇杆 =====
  const STICK_R = 60;
  const sticks = {
    move: { id: null, ox: 0, oy: 0, x: 0, y: 0 },
    aim: { id: null, ox: 0, oy: 0, x: 0, y: 0 },
  };
  let lastAim = { x: 1, y: 0 };

  function stickVec(s) {
    let dx = s.x - s.ox, dy = s.y - s.oy;
    const l = Math.hypot(dx, dy);
    if (l > STICK_R) { dx = dx / l * STICK_R; dy = dy / l * STICK_R; }
    return { x: dx / STICK_R, y: dy / STICK_R };
  }

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const s = t.clientX < window.innerWidth / 2 ? sticks.move : sticks.aim;
      if (s.id !== null) continue;
      s.id = t.identifier;
      s.ox = s.x = t.clientX;
      s.oy = s.y = t.clientY;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      for (const s of Object.values(sticks)) {
        if (s.id === t.identifier) { s.x = t.clientX; s.y = t.clientY; }
      }
    }
  }, { passive: false });

  const endTouch = e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      for (const s of Object.values(sticks)) if (s.id === t.identifier) s.id = null;
    }
  };
  canvas.addEventListener('touchend', endTouch, { passive: false });
  canvas.addEventListener('touchcancel', endTouch, { passive: false });

  setInterval(() => {
    if (!inGame) return;
    const mv = sticks.move.id !== null ? stickVec(sticks.move) : { x: 0, y: 0 };
    let fire = false;
    if (sticks.aim.id !== null) {
      const a = stickVec(sticks.aim);
      const l = Math.hypot(a.x, a.y);
      if (l > 0.2) lastAim = { x: a.x / l, y: a.y / l };
      fire = l > 0.45;   // 右摇杆推远一点就自动开火
    }
    sendMsg({ t: 'input', mx: mv.x, my: mv.y, ax: lastAim.x, ay: lastAim.y, fire });
  }, 1000 / 30);

  // ===== 绘图 =====
  let dpr = 1, vw = 0, vh = 0;
  // iPhone 刘海 / 动态岛等安全区域，HUD 文字要避开
  let safe = { top: 0, right: 0, bottom: 0, left: 0 };
  function readSafeArea() {
    const cs = getComputedStyle($('safeArea'));
    safe = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
  }

  function resize() {
    readSafeArea();
    dpr = window.devicePixelRatio || 1;
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = vw * dpr;
    canvas.height = vh * dpr;
  }
  window.addEventListener('resize', resize);
  resize();

  const TEAM_COLOR = { red: '#e5484d', blue: '#3e8ef7' };

  // 遮蔽物后面的阴影（从自己的位置看过去被挡住的区域）
  function drawShadows(px, py) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const FAR = 4000;
    for (const o of map.obstacles) {
      if (o.dead) continue;
      const c = [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]];
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4];
        const pa = proj(a, px, py, FAR), pb = proj(b, px, py, FAR);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.lineTo(pa[0], pa[1]);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  function proj(p, px, py, far) {
    const dx = p[0] - px, dy = p[1] - py;
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] + dx / l * far, p[1] + dy / l * far];
  }

  // ===== 障碍物的样子 =====
  function drawObstacle(o) {
    const { x, y, w, h } = o;
    if (o.dead) {   // 打坏后留下一点碎屑痕迹
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      return;
    }
    const horiz = w >= h;
    if (o.type === 'crate') {             // 木箱
      ctx.fillStyle = '#9a7442';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#5e4424';
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 5); ctx.lineTo(x + w - 5, y + h - 5);
      ctx.moveTo(x + w - 5, y + 5); ctx.lineTo(x + 5, y + h - 5);
      ctx.stroke();
    } else if (o.type === 'sandbag') {    // 沙包墙：一排沙包
      const len = horiz ? w : h, th = horiz ? h : w;
      const n = Math.max(1, Math.round(len / (th * 1.3))), seg = len / n;
      ctx.fillStyle = '#6e6448';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#c2b083';
      ctx.strokeStyle = '#8a7a52';
      ctx.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        const cx = horiz ? x + seg * (i + 0.5) : x + w / 2, cy = horiz ? y + h / 2 : y + seg * (i + 0.5);
        ctx.beginPath();
        ctx.ellipse(cx, cy, (horiz ? seg : th) / 2 - 1, (horiz ? th : seg) / 2 - 1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (o.type === 'wall') {       // 断墙：砖块
      ctx.fillStyle = '#80838c';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#5b5e66';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const bw = 24, bh = 12;
      if (horiz) {
        for (let yy = y + bh; yy < y + h; yy += bh) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
        for (let yy = y, row = 0; yy < y + h; yy += bh, row++)
          for (let xx = x + (row % 2 ? bw / 2 : bw); xx < x + w; xx += bw) { ctx.moveTo(xx, yy); ctx.lineTo(xx, Math.min(yy + bh, y + h)); }
      } else {
        for (let xx = x + bh; xx < x + w; xx += bh) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
        for (let xx = x, col = 0; xx < x + w; xx += bh, col++)
          for (let yy = y + (col % 2 ? bw / 2 : bw); yy < y + h; yy += bw) { ctx.moveTo(xx, yy); ctx.lineTo(Math.min(xx + bh, x + w), yy); }
      }
      ctx.stroke();
      ctx.strokeStyle = '#4a4c52';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    } else {                              // 石头：切角的不规则形状
      const c = Math.min(w, h) * 0.28;
      const pts = [[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]];
      ctx.fillStyle = '#76767a';
      ctx.strokeStyle = '#4e4e52';
      ctx.lineWidth = 3;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.ellipse(x + w * 0.38, y + h * 0.35, w * 0.22, h * 0.16, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // 被打到的木箱、沙包会变暗、出现裂痕
    if (o.maxHp && o.hp < o.maxHp) {
      const d = 1 - o.hp / o.maxHp;
      ctx.fillStyle = `rgba(0,0,0,${0.45 * d})`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(20,10,0,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const cracks = Math.ceil(d * 3);
      for (let k = 0; k < cracks; k++) {
        const sx = x + w * (0.2 + 0.3 * ((o.i + k) % 3)), sy = y + h * (0.15 + 0.25 * k);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + w * 0.15, sy + h * 0.2);
        ctx.lineTo(sx + w * 0.05, sy + h * 0.35);
      }
      ctx.stroke();
    }
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    requestAnimationFrame(frame);
    if (!inGame || !map) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(0, 0, vw, vh);
    if (!state) return;

    const me = state.me;
    const visibleIds = new Set();
    for (const p of state.players) {
      visibleIds.add(p.id);
      const s = shown.get(p.id);
      if (!s) shown.set(p.id, { x: p.x, y: p.y });
      else {
        const k = Math.min(1, dt * 18);
        s.x += (p.x - s.x) * k;
        s.y += (p.y - s.y) * k;
      }
    }
    for (const id of shown.keys()) if (!visibleIds.has(id)) shown.delete(id);

    // 镜头
    let camX, camY, scale;
    const meShown = me && shown.get(me.id);
    if (meShown && me.alive) {
      scale = Math.min(vw, vh) / 520;
      camX = meShown.x; camY = meShown.y;
    } else {
      scale = Math.min(vw / map.w, vh / map.h) * 0.95;
      camX = map.w / 2; camY = map.h / 2;
    }
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (vw / 2 - camX * scale), dpr * (vh / 2 - camY * scale));

    // 地面
    ctx.fillStyle = '#2a3326';
    ctx.fillRect(0, 0, map.w, map.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.w; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, map.h); }
    for (let y = 0; y <= map.h; y += 100) { ctx.moveTo(0, y); ctx.lineTo(map.w, y); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(229,72,77,0.12)';
    ctx.fillRect(0, 0, 120, map.h);
    ctx.fillStyle = 'rgba(62,142,247,0.12)';
    ctx.fillRect(map.w - 120, 0, 120, map.h);

    if (meShown && me.alive) drawShadows(meShown.x, meShown.y);

    // 遮蔽物
    for (const o of map.obstacles) drawObstacle(o);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, map.w, map.h);

    // 子弹
    for (const [x, y, t] of state.bullets) {
      ctx.fillStyle = t === 0 ? '#ffb3b5' : '#b8d6ff';
      ctx.beginPath();
      ctx.arc(x, y, cfg.bulletR, 0, Math.PI * 2);
      ctx.fill();
    }

    // 玩家
    const R = cfg.playerR;
    for (const p of state.players) {
      const s = shown.get(p.id);
      if (!p.alive) {
        ctx.strokeStyle = 'rgba(200,200,200,0.5)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(s.x - 10, s.y - 10); ctx.lineTo(s.x + 10, s.y + 10);
        ctx.moveTo(s.x + 10, s.y - 10); ctx.lineTo(s.x - 10, s.y + 10);
        ctx.stroke();
        continue;
      }
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(p.a) * (R + 12), s.y + Math.sin(p.a) * (R + 12));
      ctx.stroke();
      // 圆圈切成和血量一样多的饼块，每中一枪就有一块变黑
      const slice = Math.PI * 2 / cfg.maxHp;
      for (let i = 0; i < cfg.maxHp; i++) {
        const a0 = -Math.PI / 2 + i * slice;
        ctx.fillStyle = i < p.hp ? TEAM_COLOR[p.team] : '#111';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.arc(s.x, s.y, R, a0, a0 + slice);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < cfg.maxHp; i++) {
        const a0 = -Math.PI / 2 + i * slice;
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + Math.cos(a0) * R, s.y + Math.sin(a0) * R);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, R, 0, Math.PI * 2);
      ctx.strokeStyle = me && p.id === me.id ? '#fff' : TEAM_COLOR[p.team];
      ctx.lineWidth = me && p.id === me.id ? 3 : 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = p.bot ? 'bold 13px sans-serif' : 'bold 18px sans-serif';   // 真人名字大一点
      ctx.textAlign = 'center';
      ctx.fillText(p.name, s.x, s.y - R - 8);
    }

    // ===== 屏幕上的 HUD =====
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif';
    const mm = Math.floor(state.time / 60), ss = String(state.time % 60).padStart(2, '0');
    ctx.fillStyle = state.time <= 30 ? '#ff6b6f' : '#fff';
    ctx.fillText(`${mm}:${ss}`, vw / 2, 30 + safe.top);
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = TEAM_COLOR.red;
    ctx.fillText(`红 ${state.red}`, vw / 2 - 80, 30 + safe.top);
    ctx.fillStyle = TEAM_COLOR.blue;
    ctx.fillText(`蓝 ${state.blue}`, vw / 2 + 80, 30 + safe.top);
    if (cfg.level) {   // 关卡和比分
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#ddd';
      ctx.fillText(`第 ${cfg.level} 关 · ${cfg.levelName}　比分 红 ${cfg.score.red} : 蓝 ${cfg.score.blue}`, vw / 2, 52 + safe.top);
    }

    if (me) {
      ctx.textAlign = 'left';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(`❤ ${me.hp}/${cfg.maxHp}`, 14 + safe.left, 30 + safe.top);
      ctx.fillStyle = '#ffd166';
      ctx.fillText('子弹 ∞', 14 + safe.left, 56 + safe.top);
      ctx.fillStyle = '#ccc';
      ctx.fillText(`击倒 ${me.kills}`, 14 + safe.left, 82 + safe.top);
      if (!me.alive) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff6b6f';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('你已倒下 —— 正在观看队友视野', vw / 2, vh - 24 - safe.bottom);
      }
    } else {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ccc';
      ctx.font = '16px sans-serif';
      ctx.fillText('旁观中', vw / 2, vh - 20 - safe.bottom);
    }

    // 击倒消息
    ctx.textAlign = 'right';
    ctx.font = '14px sans-serif';
    let fy = 24 + safe.top;
    const t = Date.now();
    for (const k of killFeed) {
      if (k.until < t) continue;
      ctx.fillStyle = k.color;
      ctx.fillText(k.text, vw - 12 - safe.right, fy);
      fy += 20;
    }

    // 摇杆
    for (const s of Object.values(sticks)) {
      if (s.id === null) continue;
      const v = stickVec(s);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.ox, s.oy, STICK_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = s === sticks.aim && Math.hypot(v.x, v.y) > 0.45 ? 'rgba(255,107,111,0.6)' : 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(s.ox + v.x * STICK_R, s.oy + v.y * STICK_R, 24, 0, Math.PI * 2);
      ctx.fill();
    }
    if (me && me.alive && sticks.move.id === null && sticks.aim.id === null && state.time > cfg.matchTime - 10) {   // 开局前 10 秒显示操作提示
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '15px sans-serif';
      ctx.fillText('左边拖动移动　　右边拖动瞄准开火', vw / 2, vh - 20 - safe.bottom);
    }

    // 开局显示关卡名称
    if (!endResult && cfg.introUntil && now < cfg.introUntil) {
      ctx.globalAlpha = Math.min(1, (cfg.introUntil - now) / 600);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 42px sans-serif';
      ctx.fillText(`第 ${cfg.level} 关 · ${cfg.levelName}`, vw / 2, vh / 2 - 60);
      ctx.font = '18px sans-serif';
      ctx.fillText(`三战两胜　目前比分 红 ${cfg.score.red} : 蓝 ${cfg.score.blue}`, vw / 2, vh / 2 - 28);
      ctx.globalAlpha = 1;
    }

    // 结算
    if (endResult) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, vw, vh);
      ctx.textAlign = 'center';
      const r = endResult;
      const sc = `比分 红 ${r.score.red} : 蓝 ${r.score.blue}`;
      let title, color, sub;
      if (r.seriesOver) {
        title = `${TEAM_NAME[r.seriesWinner]}赢得整场比赛！`;
        color = TEAM_COLOR[r.seriesWinner];
        sub = `第 ${r.level} 关：${r.reason}`;
      } else if (r.winner === 'draw') {
        title = `第 ${r.level} 关平局`;
        color = '#fff';
        sub = `${r.reason}，不计分，重打这一关`;
      } else {
        title = `第 ${r.level} 关 ${TEAM_NAME[r.winner]}获胜！`;
        color = TEAM_COLOR[r.winner];
        sub = r.reason;
      }
      ctx.fillStyle = color;
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText(title, vw / 2, vh / 2 - 30);
      ctx.fillStyle = '#fff';
      ctx.font = '17px sans-serif';
      ctx.fillText(sub, vw / 2, vh / 2 + 4);
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(sc, vw / 2, vh / 2 + 36);
    }
  }
  requestAnimationFrame(frame);

  connect();
})();
