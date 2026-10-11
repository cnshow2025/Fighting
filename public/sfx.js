// 音效：全部用 Web Audio 在手机上即时合成，不用下载音效文件，离线也能用
window.Sfx = (() => {
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('muted') === '1'; } catch {}
  const VOLUME = 0.6;

  // 手机浏览器要等使用者点一下画面才允许出声
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }
  for (const e of ['touchend', 'click', 'keydown']) addEventListener(e, unlock, { passive: true });

  const ok = () => ctx && !muted;
  let noiseBuf = null;
  function noise() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    return s;
  }
  function env(g, t, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  // 一个音：频率、长度、波形、音量、延迟、滑到哪个频率
  function tone(freq, dur, type = 'sine', vol = 0.3, when = 0, slideTo = 0) {
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    env(g, t, vol, dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  // 一段杂音（枪声、碎裂声）
  function burst(dur, vol, filterType, freq, when = 0, q = 1) {
    const t = ctx.currentTime + when;
    const s = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    env(g, t, vol, dur);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + dur + 0.05);
  }
  const notes = (list, type, vol, gap, dur) => list.forEach((f, i) => tone(f, dur, type, vol, i * gap));

  let lastOtherShot = 0;
  return {
    // 开枪：自己的比较大声；别人的依距离变小声
    shot(vol = 1, mine = false) {
      if (!ok()) return;
      if (!mine) {
        if (ctx.currentTime - lastOtherShot < 0.04) return;   // 很多人同时开枪时不要叠太多
        lastOtherShot = ctx.currentTime;
      }
      const v = mine ? 0.8 : 0.55 * vol;
      burst(0.12, v, 'bandpass', mine ? 1700 : 1100, 0, 0.8);
      tone(mine ? 170 : 120, 0.08, 'triangle', v * 0.6, 0, 60);
    },
    hit() { if (ok()) { tone(1500, 0.05, 'square', 0.12); tone(2200, 0.05, 'sine', 0.12, 0.03); } },
    hurt() { if (ok()) { tone(200, 0.25, 'sawtooth', 0.28, 0, 60); burst(0.15, 0.4, 'lowpass', 600); } },
    kill() { if (ok()) { tone(880, 0.1, 'square', 0.16); tone(1320, 0.2, 'square', 0.16, 0.09); } },
    death() { if (ok()) tone(440, 0.7, 'sawtooth', 0.22, 0, 90); },
    crack(vol = 1) { if (ok()) burst(0.07, 0.35 * vol, 'bandpass', 900, 0, 2); },
    smash(vol = 1) { if (ok()) { burst(0.4, 0.6 * vol, 'lowpass', 1300); tone(90, 0.3, 'triangle', 0.3 * vol, 0, 45); } },
    medkit() { if (ok()) notes([523, 659, 784, 1047], 'sine', 0.2, 0.07, 0.12); },
    beep() { if (ok()) tone(660, 0.15, 'square', 0.18); },
    go() { if (ok()) { tone(990, 0.45, 'square', 0.2); tone(1320, 0.45, 'square', 0.12, 0.05); } },
    tick() { if (ok()) tone(1000, 0.04, 'square', 0.1); },
    streak() { if (ok()) notes([659, 784, 988, 1319], 'square', 0.16, 0.08, 0.14); },
    lastman() { if (ok()) notes([880, 660, 880, 660], 'triangle', 0.22, 0.13, 0.12); },
    win(big) { if (ok()) notes(big ? [523, 659, 784, 1047, 784, 1047] : [523, 659, 784, 1047], 'triangle', 0.28, 0.13, 0.22); },
    lose() { if (ok()) notes([440, 392, 349, 262], 'triangle', 0.28, 0.18, 0.3); },
    draw() { if (ok()) notes([523, 523], 'triangle', 0.24, 0.2, 0.2); },
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem('muted', m ? '1' : '0'); } catch {}
      if (master) master.gain.value = m ? 0 : VOLUME;
    },
  };
})();
