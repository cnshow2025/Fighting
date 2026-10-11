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
  // 画面：每个人在自己手机上选（记在这只手机上）
  // '2d' 俯视、'3d' 斜上方 3D、'fpp' 第一人称、'tpp' 第三人称
  const VIEWS = ['2d', '3d', 'fpp', 'tpp'];
  let view = '2d';
  try { const v = localStorage.getItem('view'); if (VIEWS.includes(v)) view = v; } catch {}
  let use3d = view !== '2d';
  const isFP = () => view === 'fpp' || view === 'tpp';
  let r3 = null, r3Loading = null;
  function ensure3d() {
    if (!r3Loading) {
      r3Loading = import('./render3d.js').then(mod => {
        r3 = mod.create($('canvas3d'));
        r3.resize(vw, vh);
        if (map) r3.setMap(map);
      }).catch(() => {
        view = '2d';
        use3d = false;
        r3Loading = null;
        toast('这只手机不支持 3D，已改用 2D');
        updateViewButtons();
      });
    }
    return r3Loading;
  }
  let endResult = null;
  // 刺激感：倒数、大字播报、命中标记、中弹闪红和画面抖动
  let lastCd = null, lastTime = null, goUntil = 0;
  let banner = null;                 // { text, color, until }
  let hitMark = null;                // { x, y, until }
  let hurtUntil = 0, shakeUntil = 0;
  const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
  const showBanner = (text, color) => { banner = { text, color, until: performance.now() + 1800 }; };
  const shown = new Map();   // id -> 平滑显示用的位置
  const killFeed = [];       // { text, color, until }

  // ===== 界面切换 =====
  function showScreen(name) {
    for (const s of ['joinScreen', 'lobbyScreen']) $(s).classList.toggle('show', s === name);
    canvas.style.display = name === 'game' ? 'block' : 'none';
    $('canvas3d').style.display = name === 'game' && use3d ? 'block' : 'none';
    updateEndPanel();
  }

  // 结算画面上的按钮：房主可以“重新开始”，每个人都可以“回到大厅”
  function updateEndPanel() {
    // 游戏中房主才有的“回大厅”按钮
    $('abortBtn').style.display = inGame && !endResult && lobby && lobby.hostId === myId ? 'block' : 'none';
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
        if (use3d) ensure3d();
        if (r3) { r3.setMap(map); r3.resetCamera(); }
        fpYaw = null;   // 第一、三人称：开局时面向服务器给的方向
        releaseTouches();
        cfg = { playerR: m.playerR, bulletR: m.bulletR, maxHp: m.maxHp, matchTime: m.matchTime,
          level: m.level, levelName: m.levelName, score: m.score, introUntil: performance.now() + 2500 };
        state = null;
        endResult = null;
        shown.clear();
        killFeed.length = 0;
        lastCd = lastTime = null;
        banner = hitMark = null;
        inGame = true;
        showScreen('game');
        resize();
        break;
      case 'state': onState(m); break;
      case 'lastman': {   // 一队只剩最后一人
        Sfx.lastman();
        showBanner(m.id === myId ? '你是最后一人！撑住！' : `${TEAM_NAME[m.team]}只剩最后一人！`, m.team === 'red' ? '#ff6b6f' : '#6aa8ff');
        break;
      }
      case 'medkit':
        if (m.id === myId) Sfx.medkit();
        killFeed.push({ text: `${m.name} 吃到救护包，补满血`, color: '#4ade80', until: Date.now() + 4000 });
        if (killFeed.length > 4) killFeed.shift();
        break;
      case 'obs': {   // 木箱、沙包被打到
        const o = map && map.obstacles[m.i];
        if (o) {
          o.hp = m.hp;
          if (m.hp <= 0) o.dead = true;
          // 依距离决定碎裂声大小
          const me = state && state.me;
          const d = me ? Math.hypot(o.x + o.w / 2 - me.x, o.y + o.h / 2 - me.y) : 600;
          const vol = 1 - d / 1200;
          if (vol > 0.05) (m.hp <= 0 ? Sfx.smash : Sfx.crack)(vol);
        }
        break;
      }
      case 'kill': {
        const color = m.killerTeam === 'red' ? '#ff6b6f' : '#6aa8ff';
        killFeed.push({ text: `${m.killer} 击倒 ${m.victim}`, color, until: Date.now() + 5000 });
        if (killFeed.length > 4) killFeed.shift();
        if (m.killerId === myId) Sfx.kill();
        if (m.victimId === myId) { Sfx.death(); vibrate(300); }
        if (m.streak >= 2) {   // 连杀播报
          Sfx.streak();
          showBanner(`${m.killer} ${['', '', '双杀', '三杀', '四杀', '五杀'][Math.min(m.streak, 5)]}！`, color);
        }
        break;
      }
      case 'end': {
        endResult = m.result;
        releaseTouches();
        const r = m.result, myTeam = state && state.me ? state.me.team : null;
        const won = r.seriesOver ? r.seriesWinner : r.winner;
        if (won === 'draw') Sfx.draw();
        else if (!myTeam || won === myTeam) Sfx.win(r.seriesOver);
        else Sfx.lose();
        updateEndPanel();
        break;
      }
      case 'abort':   // 房主中止了这一局
        inGame = false;
        releaseTouches();
        endResult = null;
        if (lobby) renderLobby();
        showScreen('lobbyScreen');
        toast('房主结束了这一局，回到大厅');
        break;
      case 'error': toast(m.msg); break;
    }
  }

  // 每次收到服务器画面：处理音效事件、开局倒数、最后 10 秒
  function onState(m) {
    state = m;
    for (const e of m.ev || []) {
      if (e.k === 'sh') Sfx.shot(e.v, !!e.me);
      else if (e.k === 'hit') { Sfx.hit(); hitMark = { x: e.x, y: e.y, until: performance.now() + 250 }; }
      else if (e.k === 'hurt') { Sfx.hurt(); vibrate(80); hurtUntil = performance.now() + 400; shakeUntil = performance.now() + 220; }
    }
    if (m.cd !== lastCd) {
      if (m.cd > 0) Sfx.beep();
      else if (lastCd > 0) { Sfx.go(); goUntil = performance.now() + 800; }
      lastCd = m.cd;
    }
    if (m.cd === 0 && m.time <= 10 && m.time > 0 && m.time !== lastTime) Sfx.tick();
    lastTime = m.time;
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
    document.querySelectorAll('[data-invite]').forEach(b => (b.style.display = isHost ? 'block' : 'none'));
    $('lobbyHint').textContent = playing ? '游戏进行中，请等待下一局' : isHost ? '' : '等待房主开始…';
    document.querySelectorAll('.team button[data-team]').forEach(b => (b.disabled = playing));
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
  document.querySelectorAll('.team button[data-team]').forEach(b => {
    b.onclick = () => sendMsg({ t: 'team', team: b.dataset.team });
  });
  $('startBtn').onclick = () => sendMsg({ t: 'start' });
  $('leaveTeamBtn').onclick = () => sendMsg({ t: 'leaveTeam' });
  function updateViewButtons() {
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  }
  document.querySelectorAll('[data-view]').forEach(b => {
    b.onclick = () => {
      view = b.dataset.view;
      use3d = view !== '2d';
      try { localStorage.setItem('view', view); } catch {}
      if (use3d) ensure3d();   // 先在大厅里载入，开局时就不用等
      updateViewButtons();
    };
  });
  updateViewButtons();
  if (use3d) ensure3d();
  $('restartBtn').onclick = () => sendMsg(endResult && !endResult.seriesOver ? { t: 'next' } : { t: 'start' });
  $('abortBtn').onclick = () => {
    if (confirm('确定要结束这一局，让大家回到大厅吗？')) sendMsg({ t: 'abort' });
  };
  $('backLobbyBtn').onclick = () => {
    inGame = false;
    if (lobby) renderLobby();
    showScreen('lobbyScreen');
  };
  const updateMute = () => ($('muteBtn').textContent = Sfx.muted ? '🔇' : '🔊');
  $('muteBtn').onclick = () => { Sfx.setMuted(!Sfx.muted); updateMute(); };
  updateMute();
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
  // 第一、三人称：自己面对的方向（弧度）、转身用的手指、按住开火键的手指
  let fpYaw = null;
  const look = { id: null, x0: 0, x: 0 };
  // 转身像摇杆：按住往左/右推就一直转，推得越远转得越快，放开就停
  const TURN_R = 70, TURN_DEAD = 0.12, TURN_SPEED = 3.5;   // 推满的距离（像素）、中间不转的范围、最快每秒转几弧度（约 200°）
  const lookPush = () => Math.max(-1, Math.min(1, (look.x - look.x0) / TURN_R));
  let fireTouch = null;
  const fpActive = () => isFP() && use3d && r3 && fpYaw !== null && state && state.me && state.me.alive;
  // 左下角固定的移动圆圈；右下角的大圆圈：中间是开火键，外圈拖动转身
  const movePad = () => ({ x: 100 + safe.left, y: vh - 100 - safe.bottom });
  const turnPad = () => ({ x: vw - 120 - safe.right, y: vh - 115 - safe.bottom, R: 85, r: 38 });

  function stickVec(s) {
    let dx = s.x - s.ox, dy = s.y - s.oy;
    const l = Math.hypot(dx, dy);
    if (l > STICK_R) { dx = dx / l * STICK_R; dy = dy / l * STICK_R; }
    return { x: dx / STICK_R, y: dy / STICK_R };
  }

  // 放开所有手指的记录（开局、结束、换画面时用，避免“卡住的手指”让转身失灵或一直开火）
  function releaseTouches() {
    for (const s of Object.values(sticks)) s.id = null;
    look.id = null;
    fireTouch = null;
  }
  // 手机有时不会通知“手指放开了”：检查记录的手指是否真的还在屏幕上
  function dropStaleTouches(e) {
    const on = new Set(Array.from(e.touches, t => t.identifier));
    for (const s of Object.values(sticks)) if (s.id !== null && !on.has(s.id)) s.id = null;
    if (look.id !== null && !on.has(look.id)) look.id = null;
    if (fireTouch !== null && !on.has(fireTouch)) fireTouch = null;
  }

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    dropStaleTouches(e);
    const fp = fpActive();
    for (const t of e.changedTouches) {
      if (fp && t.clientX >= window.innerWidth / 2) {
        // 右半边：按在开火键上 = 开火（按住往左右拖还能同时转身）；其他地方 = 只转身
        const tp = turnPad();
        if (Math.hypot(t.clientX - tp.x, t.clientY - tp.y) < tp.r + 6 && fireTouch === null) fireTouch = t.identifier;
        if (look.id === null) { look.id = t.identifier; look.x0 = look.x = t.clientX; }
        continue;
      }
      if (fp && sticks.move.id === null) {   // 左半边：移动摇杆以左下角圆圈为中心
        const mp = movePad();
        sticks.move.id = t.identifier;
        sticks.move.ox = mp.x; sticks.move.oy = mp.y;
        sticks.move.x = t.clientX; sticks.move.y = t.clientY;
        continue;
      }
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
      if (t.identifier === look.id) look.x = t.clientX;   // 转身的推动距离，每一帧在 frame() 里转
      for (const s of Object.values(sticks)) {
        if (s.id === t.identifier) { s.x = t.clientX; s.y = t.clientY; }
      }
    }
  }, { passive: false });

  const endTouch = e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      for (const s of Object.values(sticks)) if (s.id === t.identifier) s.id = null;
      if (look.id === t.identifier) look.id = null;
      if (fireTouch === t.identifier) fireTouch = null;
    }
    dropStaleTouches(e);
  };
  canvas.addEventListener('touchend', endTouch, { passive: false });
  canvas.addEventListener('touchcancel', endTouch, { passive: false });

  setInterval(() => {
    if (!inGame) return;
    const mv = sticks.move.id !== null ? stickVec(sticks.move) : { x: 0, y: 0 };
    if (fpActive()) {
      // 摇杆往上 = 往自己面对的方向走，左右 = 横着走；枪口永远朝正前方
      const f = { x: Math.cos(fpYaw), y: Math.sin(fpYaw) }, r = { x: -f.y, y: f.x };
      sendMsg({ t: 'input', mx: f.x * -mv.y + r.x * mv.x, my: f.y * -mv.y + r.y * mv.x, ax: f.x, ay: f.y, fire: fireTouch !== null });
      return;
    }
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
    if (r3) r3.resize(vw, vh);
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

  // 血量一律分成 3 块显示（6 点血时中 2 枪才黑一块）
  const HP_BLOCKS = 3;
  const litBlocks = hp => Math.ceil(hp / (cfg.maxHp / HP_BLOCKS));

  // 圆圈切成 3 块饼，血少了就有一块变黑
  function drawPie(x, y, R, p, isMe) {
    const slice = Math.PI * 2 / HP_BLOCKS, lit = litBlocks(p.hp);
    for (let i = 0; i < HP_BLOCKS; i++) {
      const a0 = -Math.PI / 2 + i * slice;
      ctx.fillStyle = i < lit ? TEAM_COLOR[p.team] : '#111';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, R, a0, a0 + slice);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < HP_BLOCKS; i++) {
      const a0 = -Math.PI / 2 + i * slice;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a0) * R, y + Math.sin(a0) * R);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.strokeStyle = isMe ? '#fff' : TEAM_COLOR[p.team];
    ctx.lineWidth = isMe ? 3 : 2;
    ctx.stroke();
  }

  // 第一、三人称：画面正中间的准星
  function drawCrosshair() {
    const cx = vw / 2, cy = vh / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 14);
    ctx.stroke();
  }

  // 第一、三人称：左上角的小地图（掩体、救护包、队友、看得到的敌人、自己和方向），返回占用的高度
  function drawMinimap(me) {
    const w = Math.min(160, vw * 0.22), h = w * map.h / map.w;
    const x0 = 10 + safe.left, y0 = 10 + safe.top, k = w / map.w;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, w, h);
    ctx.fillStyle = 'rgba(200,190,170,0.75)';
    for (const o of map.obstacles) if (!o.dead) ctx.fillRect(x0 + o.x * k, y0 + o.y * k, Math.max(1.5, o.w * k), Math.max(1.5, o.h * k));
    ctx.fillStyle = '#4ade80';
    for (const [x, y] of state.kits || []) ctx.fillRect(x0 + x * k - 2, y0 + y * k - 2, 4, 4);
    for (const p of state.players) {
      if (!p.alive || p.id === me.id) continue;
      const s = shown.get(p.id);
      ctx.fillStyle = TEAM_COLOR[p.team];
      ctx.beginPath();
      ctx.arc(x0 + s.x * k, y0 + s.y * k, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const ms = shown.get(me.id);
    if (ms) {   // 自己：白色箭头指向面对的方向
      const mx = x0 + ms.x * k, my = y0 + ms.y * k, a = fpYaw;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(a) * 7, my + Math.sin(a) * 7);
      ctx.lineTo(mx + Math.cos(a + 2.5) * 5, my + Math.sin(a + 2.5) * 5);
      ctx.lineTo(mx + Math.cos(a - 2.5) * 5, my + Math.sin(a - 2.5) * 5);
      ctx.closePath();
      ctx.fill();
    }
    return h + 10;
  }

  // 3D 用的血条：3 个小长方块，血少了就有一块变黑
  function drawHpBar(x, y, p, isMe) {
    const bw = 11, bh = 6, gap = 2, total = HP_BLOCKS * bw + (HP_BLOCKS - 1) * gap, lit = litBlocks(p.hp);
    const x0 = x - total / 2;
    ctx.fillStyle = isMe ? '#fff' : 'rgba(0,0,0,0.6)';   // 外框：自己是白色
    ctx.fillRect(x0 - 2, y - 2, total + 4, bh + 4);
    for (let i = 0; i < HP_BLOCKS; i++) {
      ctx.fillStyle = i < lit ? TEAM_COLOR[p.team] : '#111';
      ctx.fillRect(x0 + i * (bw + gap), y, bw, bh);
    }
  }

  // 上方显示用的小人头：圆头 + 肩膀
  function drawHead(x, y, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y - 4, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y + 9, 9, 6.5, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  let cam2d = null;

  // 屏幕位置：命中标记要画在被打中的人身上（第一、三人称画在准星上）
  function worldToScreen(x, y) {
    if (fpActive()) return { x: vw / 2, y: vh / 2 };
    if (use3d && r3) { const p = r3.project(x, y, 40); return p.visible ? p : null; }
    if (!cam2d) return null;
    return { x: vw / 2 + (x - cam2d.camX) * cam2d.scale, y: vh / 2 + (y - cam2d.camY) * cam2d.scale };
  }

  function drawEffects(now) {
    // 中弹：画面边缘闪红
    if (now < hurtUntil) {
      const a = (hurtUntil - now) / 400;
      const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.3, vw / 2, vh / 2, Math.max(vw, vh) * 0.75);
      g.addColorStop(0, 'rgba(255,0,0,0)');
      g.addColorStop(1, `rgba(255,0,0,${0.55 * a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vw, vh);
    }
    // 画面抖一下
    const shaking = now < shakeUntil;
    const tf = shaking ? `translate(${(Math.random() - 0.5) * 12}px,${(Math.random() - 0.5) * 12}px)` : '';
    if (canvas.style.transform !== tf) { canvas.style.transform = tf; $('canvas3d').style.transform = tf; }
    // 命中标记：白色 X
    if (hitMark && now < hitMark.until) {
      const p = worldToScreen(hitMark.x, hitMark.y);
      if (p) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(p.x + dx * 6, p.y + dy * 6); ctx.lineTo(p.x + dx * 14, p.y + dy * 14); }
        ctx.stroke();
      }
    }
    // 大字播报（连杀、最后一人）
    if (banner && now < banner.until && !endResult) {
      ctx.globalAlpha = Math.min(1, (banner.until - now) / 400);
      ctx.textAlign = 'center';
      ctx.font = 'bold 34px sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(banner.text, vw / 2, vh * 0.3);
      ctx.fillStyle = banner.color;
      ctx.fillText(banner.text, vw / 2, vh * 0.3);
      ctx.globalAlpha = 1;
    }
    // 开局倒数 3、2、1、开打！
    if (!endResult && state && (state.cd > 0 || now < goUntil)) {
      const txt = state.cd > 0 ? String(state.cd) : '开打！';
      ctx.textAlign = 'center';
      const cy = vh / 2 + 125;   // 放在自己人物下方，不挡住人
      ctx.font = `bold ${state.cd > 0 ? 84 : 60}px sans-serif`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(txt, vw / 2, cy);
      ctx.fillStyle = state.cd > 0 ? '#ffd166' : '#4ade80';
      ctx.fillText(txt, vw / 2, cy);
    }
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    requestAnimationFrame(frame);
    if (!inGame || !map) return;
    if (look.id !== null && fpActive()) {   // 按住往左右推：持续转身
      const o = lookPush(), a = Math.abs(o);
      if (a > TURN_DEAD) fpYaw += Math.sign(o) * TURN_SPEED * Math.pow((a - TURN_DEAD) / (1 - TURN_DEAD), 1.5) * dt;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const in3d = use3d && r3;
    if (in3d) ctx.clearRect(0, 0, vw, vh);   // 3D 画面在下面那层，这层只画文字和按钮
    else { ctx.fillStyle = '#0b0c10'; ctx.fillRect(0, 0, vw, vh); }
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

    if (in3d) {
      if (isFP() && fpYaw === null && me) {   // 开局时先面向服务器给的方向
        const mine = state.players.find(p => p.id === me.id);
        if (mine) fpYaw = mine.a;
      }
      r3.render({ state, shown, me, now, dt, view, yaw: fpYaw });
      // 3D 时，名字和血条画在上面这层 2D 画布上
      for (const p of state.players) {
        if (!p.alive) continue;
        if (fpActive() && p.id === me.id) continue;   // 第一、三人称不画自己的（左上角已经有血量，也不挡准星）
        const s = shown.get(p.id);
        const pt = r3.project(s.x, s.y, 70);   // 头顶上方，不挡住立体人的头
        if (!pt.visible) continue;
        drawHpBar(pt.x, pt.y - 6, p, me && p.id === me.id);
        ctx.fillStyle = '#fff';
        ctx.font = p.bot ? 'bold 12px sans-serif' : 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, pt.x, pt.y - 14);
      }
    } else {
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
      cam2d = { camX, camY, scale };
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

      // 救护包：白底红十字，轻轻闪动
      if (state.kits) {
        const pulse = 1 + 0.08 * Math.sin(now / 200);
        for (const [x, y] of state.kits) {
          const h = 14 * pulse;
          ctx.fillStyle = 'rgba(74,222,128,0.25)';
          ctx.beginPath();
          ctx.arc(x, y, h + 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#c62828';
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x - h, y - h, h * 2, h * 2, 5);
          else ctx.rect(x - h, y - h, h * 2, h * 2);   // 旧手机浏览器没有圆角方法
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#e53935';
          ctx.fillRect(x - h * 0.2, y - h * 0.65, h * 0.4, h * 1.3);
          ctx.fillRect(x - h * 0.65, y - h * 0.2, h * 1.3, h * 0.4);
        }
      }

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
        drawPie(s.x, s.y, R, p, me && p.id === me.id);
        ctx.fillStyle = '#fff';
        ctx.font = p.bot ? 'bold 13px sans-serif' : 'bold 18px sans-serif';   // 真人名字大一点
        ctx.textAlign = 'center';
        ctx.fillText(p.name, s.x, s.y - R - 8);
      }

    }

    // ===== 屏幕上的 HUD =====
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif';
    const mm = Math.floor(state.time / 60), ss = String(state.time % 60).padStart(2, '0');
    ctx.fillStyle = state.time <= 30 ? '#ff6b6f' : '#fff';
    ctx.fillText(`${mm}:${ss}`, vw / 2, 30 + safe.top);
    // 两队还在场上的人数：几个人头就是剩几个人，倒下一个就少一个
    for (let i = 0; i < state.red; i++) drawHead(vw / 2 - 52 - i * 22, 22 + safe.top, TEAM_COLOR.red);
    for (let i = 0; i < state.blue; i++) drawHead(vw / 2 + 52 + i * 22, 22 + safe.top, TEAM_COLOR.blue);
    if (cfg.level) {   // 关卡和比分
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#ddd';
      ctx.fillText(`第 ${cfg.level} 关 · ${cfg.levelName}　比分 红 ${cfg.score.red} : 蓝 ${cfg.score.blue}`, vw / 2, 52 + safe.top);
    }

    const fpOn = fpActive();
    let hudY = 0;   // 第一、三人称时左上角先放小地图，文字往下移
    if (fpOn) {
      hudY = drawMinimap(me) + 4;
      drawCrosshair();
    }
    if (me) {
      ctx.textAlign = 'left';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(`❤ ${me.hp}/${cfg.maxHp}`, 14 + safe.left, 30 + safe.top + hudY);
      ctx.fillStyle = '#ffd166';
      ctx.fillText('子弹 ∞', 14 + safe.left, 56 + safe.top + hudY);
      ctx.fillStyle = '#ccc';
      ctx.fillText(`击倒 ${me.kills}`, 14 + safe.left, 82 + safe.top + hudY);
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
    let fy = 108 + safe.top;   // 留出右上角“回大厅”和静音按钮的位置
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
    if (fpOn) {
      // 左下角：移动圆圈（一直显示）
      const mp = movePad();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, STICK_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      if (sticks.move.id === null) ctx.fillText('移动', mp.x, mp.y + 5);
      // 右下角：外圈转身、中间开火
      const tp = turnPad();
      ctx.fillStyle = look.id !== null ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, tp.R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('◀', tp.x - tp.R + 16, tp.y + 5);
      ctx.fillText('▶', tp.x + tp.R - 16, tp.y + 5);
      ctx.fillText('转身', tp.x, tp.y + tp.R - 12);
      if (look.id !== null) {   // 显示现在往哪边推、推多远
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(tp.x + lookPush() * (tp.R - 16), tp.y, 16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = fireTouch !== null ? 'rgba(229,72,77,0.9)' : 'rgba(229,72,77,0.6)';
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, tp.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 17px sans-serif';
      ctx.fillText('开火', tp.x, tp.y + 6);
    }
    if (me && me.alive && sticks.move.id === null && sticks.aim.id === null && look.id === null && state.time > cfg.matchTime - 10) {   // 开局前 10 秒显示操作提示
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '15px sans-serif';
      ctx.fillText(fpOn ? '左边拖动移动　　右边按住往左右推转身　　按住开火键射击（按住往左右推可边打边转）' : '左边拖动移动　　右边拖动瞄准开火', vw / 2, vh - 20 - safe.bottom);
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

    drawEffects(now);

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
      if (r.mvp) {   // 这一关击倒最多的人
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(`⭐ MVP：${r.mvp.name}（击倒 ${r.mvp.kills}）`, vw / 2, vh / 2 + 64);
      }
    }
  }
  requestAnimationFrame(frame);

  connect();
})();
