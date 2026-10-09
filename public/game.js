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
  let endTimer = null;
  const shown = new Map();   // id -> 平滑显示用的位置
  const killFeed = [];       // { text, color, until }

  // ===== 界面切换 =====
  function showScreen(name) {
    for (const s of ['joinScreen', 'lobbyScreen']) $(s).classList.toggle('show', s === name);
    canvas.style.display = name === 'game' ? 'block' : 'none';
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
        break;
      case 'start':
        map = m.map;
        cfg = { playerR: m.playerR, bulletR: m.bulletR, maxHp: m.maxHp, matchTime: m.matchTime };
        state = null;
        endResult = null;
        shown.clear();
        killFeed.length = 0;
        clearTimeout(endTimer);
        inGame = true;
        showScreen('game');
        resize();
        break;
      case 'state': state = m; break;
      case 'kill': {
        const color = m.killerTeam === 'red' ? '#ff6b6f' : '#6aa8ff';
        killFeed.push({ text: `${m.killer} 击倒 ${m.victim}`, color, until: Date.now() + 5000 });
        if (killFeed.length > 4) killFeed.shift();
        break;
      }
      case 'end':
        endResult = m.result;
        endTimer = setTimeout(() => {
          inGame = false;
          if (lobby) renderLobby();
          showScreen('lobbyScreen');
        }, 4000);
        break;
      case 'error': toast(m.msg); break;
    }
  }

  // ===== 大厅 =====
  function resultText(r) {
    if (!r) return '';
    const w = r.winner === 'red' ? '红队获胜！' : r.winner === 'blue' ? '蓝队获胜！' : '平局';
    return `${w}（${r.reason}，红 ${r.red} : 蓝 ${r.blue}）`;
  }

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
    $('result').textContent = resultText(lobby.result);

    const isHost = lobby.hostId === myId;
    const playing = lobby.phase === 'playing';
    $('startBtn').style.display = isHost && !playing ? 'block' : 'none';
    $('invites').style.display = isHost ? 'flex' : 'none';
    $('lobbyHint').textContent = playing ? '游戏进行中，请等待下一局'
      : isHost ? '你是房主，人齐后按“开始游戏”' : '等待房主开始游戏…';
    document.querySelectorAll('.team button').forEach(b => (b.disabled = playing));

    // 电脑补位 / 难度（只有房主能改）
    const st = lobby.settings;
    const canEdit = isHost && !playing;
    $('botFill').checked = st.botFill;
    $('botFill').disabled = !canEdit;
    document.querySelectorAll('.botbox .lv').forEach(b => {
      b.classList.toggle('on', b.dataset.lv === st.difficulty);
      b.disabled = !canEdit && b.dataset.lv !== st.difficulty;
    });
    const red = ps.filter(p => p.team === 'red').length, blue = ps.filter(p => p.team === 'blue').length;
    const n = Math.max(red, blue, lobby.minTeam);
    const bots = (n - red) + (n - blue);
    $('botHint').textContent = !st.botFill ? '电脑补位已关闭：只有真人对打，两队都至少要有 1 人'
      : bots ? `每队至少 ${lobby.minTeam} 人。开局时会加入 ${bots} 个电脑（红队 ${n - red} 个、蓝队 ${n - blue} 个），变成 ${n}v${n}`
      : `两队人数一样，不需要电脑（${n}v${n}）`;
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

  document.querySelectorAll('.botbox .lv').forEach(b => {
    b.onclick = () => sendMsg({ t: 'settings', difficulty: b.dataset.lv });
  });

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
  function resize() {
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
    for (const o of map.obstacles) {
      ctx.fillStyle = '#7a6448';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = '#4a3a28';
      ctx.lineWidth = 3;
      ctx.strokeRect(o.x + 1.5, o.y + 1.5, o.w - 3, o.h - 3);
    }
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
      ctx.fillStyle = TEAM_COLOR[p.team];
      ctx.beginPath();
      ctx.arc(s.x, s.y, R, 0, Math.PI * 2);
      ctx.fill();
      if (me && p.id === me.id) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, s.x, s.y - R - 14);
      for (let i = 0; i < cfg.maxHp; i++) {
        ctx.fillStyle = i < p.hp ? '#4ade80' : 'rgba(255,255,255,0.2)';
        ctx.fillRect(s.x - 15 + i * 11, s.y - R - 9, 9, 4);
      }
    }

    // ===== 屏幕上的 HUD =====
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px sans-serif';
    const mm = Math.floor(state.time / 60), ss = String(state.time % 60).padStart(2, '0');
    ctx.fillStyle = state.time <= 30 ? '#ff6b6f' : '#fff';
    ctx.fillText(`${mm}:${ss}`, vw / 2, 30);
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = TEAM_COLOR.red;
    ctx.fillText(`红 ${state.red}`, vw / 2 - 80, 30);
    ctx.fillStyle = TEAM_COLOR.blue;
    ctx.fillText(`蓝 ${state.blue}`, vw / 2 + 80, 30);

    if (me) {
      ctx.textAlign = 'left';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(`❤ ${me.hp}/${cfg.maxHp}`, 14, 30);
      ctx.fillStyle = '#ffd166';
      ctx.fillText('子弹 ∞', 14, 56);
      ctx.fillStyle = '#ccc';
      ctx.fillText(`击倒 ${me.kills}`, 14, 82);
      if (!me.alive) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff6b6f';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('你已倒下 —— 正在观看队友视野', vw / 2, vh - 24);
      }
    } else {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ccc';
      ctx.font = '16px sans-serif';
      ctx.fillText('旁观中', vw / 2, vh - 20);
    }

    // 击倒消息
    ctx.textAlign = 'right';
    ctx.font = '14px sans-serif';
    let fy = 24;
    const t = Date.now();
    for (const k of killFeed) {
      if (k.until < t) continue;
      ctx.fillStyle = k.color;
      ctx.fillText(k.text, vw - 12, fy);
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
      ctx.fillText('左边拖动移动　　右边拖动瞄准开火', vw / 2, vh - 20);
    }

    // 结算
    if (endResult) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, vw, vh);
      ctx.textAlign = 'center';
      const r = endResult;
      ctx.fillStyle = r.winner === 'red' ? TEAM_COLOR.red : r.winner === 'blue' ? TEAM_COLOR.blue : '#fff';
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText(r.winner === 'red' ? '红队获胜！' : r.winner === 'blue' ? '蓝队获胜！' : '平局', vw / 2, vh / 2 - 10);
      ctx.fillStyle = '#fff';
      ctx.font = '18px sans-serif';
      ctx.fillText(`${r.reason}（红 ${r.red} : 蓝 ${r.blue}）`, vw / 2, vh / 2 + 30);
    }
  }
  requestAnimationFrame(frame);

  connect();
})();
