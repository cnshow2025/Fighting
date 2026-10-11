// 3D 画面（斜上方俯视）：只负责把游戏世界画成 3D，规则和网络都沿用 game.js
// 坐标对应：游戏的 x → 3D 的 x，游戏的 y → 3D 的 z，高度是 3D 的 y
import * as THREE from './three.module.min.js';

const TEAM_COLOR = { red: 0xe5484d, blue: 0x3e8ef7 };
const HEIGHT = { crate: 56, sandbag: 46, wall: 80, rock: 60 };

export function create(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0c10);
  const camera = new THREE.PerspectiveCamera(30, 1, 10, 8000);   // 视角窄一点，画面边缘比较不会歪

  // 光：天空光 + 太阳光（不产生影子，手机跑起来比较顺）
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334433, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  scene.add(sun, sun.target);

  let mapRef = null;
  let world = null;            // 地面、边界、障碍物都放在这里，换关卡时整组换掉
  const obstacleMeshes = [];   // 跟 map.obstacles 一一对应
  const playerMeshes = new Map();
  const bulletPool = [];
  const kitPool = [];

  // 自己脚下的白圈
  const meRing = new THREE.Mesh(new THREE.RingGeometry(22, 27, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  meRing.rotation.x = -Math.PI / 2;
  meRing.position.y = 1.5;
  scene.add(meRing);

  // 断墙的砖块纹理（用程序画出来，不用下载图片）
  const brickCanvas = document.createElement('canvas');
  brickCanvas.width = 64; brickCanvas.height = 32;
  {
    const g = brickCanvas.getContext('2d');
    g.fillStyle = '#80838c'; g.fillRect(0, 0, 64, 32);
    g.strokeStyle = '#5b5e66'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 16); g.lineTo(64, 16); g.moveTo(0, 1); g.lineTo(64, 1);
    g.moveTo(32, 0); g.lineTo(32, 16); g.moveTo(16, 16); g.lineTo(16, 32); g.moveTo(48, 16); g.lineTo(48, 32);
    g.stroke();
  }

  function setMap(map) {
    if (map === mapRef) return;
    mapRef = map;
    if (world) scene.remove(world);
    world = new THREE.Group();
    obstacleMeshes.length = 0;

    // 地面 + 格线 + 两边出生区
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.w, map.h), new THREE.MeshLambertMaterial({ color: 0x2f3a2a }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(map.w / 2, 0, map.h / 2);
    world.add(ground);
    const lines = [];
    for (let x = 0; x <= map.w; x += 100) lines.push(x, 0.3, 0, x, 0.3, map.h);
    for (let z = 0; z <= map.h; z += 100) lines.push(0, 0.3, z, map.w, 0.3, z);
    const grid = new THREE.BufferGeometry();
    grid.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    world.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06 })));
    for (const [x, color] of [[60, TEAM_COLOR.red], [map.w - 60, TEAM_COLOR.blue]]) {
      const zone = new THREE.Mesh(new THREE.PlaneGeometry(120, map.h), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
      zone.rotation.x = -Math.PI / 2;
      zone.position.set(x, 0.5, map.h / 2);
      world.add(zone);
    }
    // 外围矮墙
    const borderMat = new THREE.MeshLambertMaterial({ color: 0x444a52 });
    for (const [x, z, w, d] of [[map.w / 2, -6, map.w + 24, 12], [map.w / 2, map.h + 6, map.w + 24, 12], [-6, map.h / 2, 12, map.h], [map.w + 6, map.h / 2, 12, map.h]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 20, d), borderMat);
      b.position.set(x, 10, z);
      world.add(b);
    }

    for (const o of map.obstacles) {
      const m = buildObstacle(o);
      obstacleMeshes.push(m);
      world.add(m.group);
    }
    scene.add(world);

    sun.position.set(map.w / 2 + 500, 1100, map.h / 2 + 400);
    sun.target.position.set(map.w / 2, 0, map.h / 2);
  }

  function buildObstacle(o) {
    const group = new THREE.Group();
    const H = HEIGHT[o.type] || 56;
    const cx = o.x + o.w / 2, cz = o.y + o.h / 2;
    let mat;
    if (o.type === 'crate') {             // 木箱：箱子 + 深色边框
      mat = new THREE.MeshLambertMaterial({ color: 0x9a7442 });
      const geo = new THREE.BoxGeometry(o.w, H, o.h);
      const box = new THREE.Mesh(geo, mat);
      box.position.set(cx, H / 2, cz);
      group.add(box);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x4a3420 }));
      edges.position.copy(box.position);
      group.add(edges);
      const cross = new THREE.BufferGeometry();   // 顶面的交叉木条
      const t = H + 0.5, x0 = o.x + 4, x1 = o.x + o.w - 4, z0 = o.y + 4, z1 = o.y + o.h - 4;
      cross.setAttribute('position', new THREE.Float32BufferAttribute([x0, t, z0, x1, t, z1, x1, t, z0, x0, t, z1], 3));
      group.add(new THREE.LineSegments(cross, new THREE.LineBasicMaterial({ color: 0x4a3420 })));
    } else if (o.type === 'sandbag') {    // 沙包墙：两层圆圆的沙包
      mat = new THREE.MeshLambertMaterial({ color: 0xc2b083 });
      const horiz = o.w >= o.h, len = horiz ? o.w : o.h, th = horiz ? o.h : o.w;
      const n = Math.max(1, Math.round(len / (th * 1.3))), seg = len / n;
      const bagGeo = new THREE.SphereGeometry(1, 12, 8);
      for (let layer = 0; layer < 2; layer++) {
        const count = layer ? n - 1 : n, off = layer ? seg : seg / 2;
        for (let i = 0; i < count; i++) {
          const along = off + seg * i;
          const bag = new THREE.Mesh(bagGeo, mat);
          bag.scale.set(horiz ? seg / 2 : th / 2, 12, horiz ? th / 2 : seg / 2);
          bag.position.set(horiz ? o.x + along : cx, 12 + layer * 22, horiz ? cz : o.y + along);
          group.add(bag);
        }
      }
    } else if (o.type === 'wall') {       // 断墙：砖墙，顶部参差不齐
      const tex = new THREE.CanvasTexture(brickCanvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(o.w, o.h) / 48, H / 24);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat = new THREE.MeshLambertMaterial({ map: tex });
      const box = new THREE.Mesh(new THREE.BoxGeometry(o.w, H, o.h), mat);
      box.position.set(cx, H / 2, cz);
      group.add(box);
      const horiz = o.w >= o.h, len = horiz ? o.w : o.h;
      for (let k = 0; k < len / 30; k++) {   // 墙头的碎块
        const chunk = new THREE.Mesh(new THREE.BoxGeometry(horiz ? 14 : o.w, 6 + (k * 7) % 12, horiz ? o.h : 14), mat);
        const along = 10 + k * 30 + ((k * 13) % 9);
        if (along > len - 8) break;
        chunk.position.set(horiz ? o.x + along : cx, H + chunk.geometry.parameters.height / 2, horiz ? cz : o.y + along);
        group.add(chunk);
      }
    } else {                              // 石头：多面体
      mat = new THREE.MeshLambertMaterial({ color: 0x7a7a80, flatShading: true });
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), mat);
      rock.scale.set(o.w / 2, H / 2, o.h / 2);
      rock.position.set(cx, H / 2 - 4, cz);
      rock.rotation.y = (o.i * 0.7) % Math.PI;
      group.add(rock);
    }
    // 打坏后留下的碎屑
    const rubble = new THREE.Mesh(new THREE.BoxGeometry(o.w * 0.9, 5, o.h * 0.9), new THREE.MeshLambertMaterial({ color: 0x3a3226 }));
    rubble.position.set(cx, 2.5, cz);
    rubble.visible = false;
    const baseColor = mat.color.clone();
    return { group, mat, baseColor, rubble, hp: o.hp, dead: false };
  }

  function updateObstacles() {
    mapRef.obstacles.forEach((o, i) => {
      const m = obstacleMeshes[i];
      if (!m) return;
      if (o.dead && !m.dead) {
        m.dead = true;
        m.group.visible = false;
        world.add(m.rubble);
        m.rubble.visible = true;
      } else if (!o.dead && o.maxHp && o.hp !== m.hp) {
        m.hp = o.hp;
        const d = 1 - o.hp / o.maxHp;           // 被打到会变暗
        m.mat.color.copy(m.baseColor).multiplyScalar(1 - 0.5 * d);
      }
    });
  }

  function makePlayer(team) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: TEAM_COLOR[team] });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(13, 16, 36, 16), mat);
    body.position.y = 18;
    const head = new THREE.Mesh(new THREE.SphereGeometry(11, 16, 12), mat);
    head.position.y = 47;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(26, 6, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    gun.position.set(22, 30, 0);
    g.add(body, head, gun);
    scene.add(g);
    return { g, mat, team, dead: false };
  }

  function getPool(pool, make, n) {
    while (pool.length < n) pool.push(make());
    pool.forEach((m, i) => (m.visible = i < n));
    return pool;
  }
  const bulletGeo = new THREE.SphereGeometry(4.5, 8, 6);
  const bulletMat = [new THREE.MeshBasicMaterial({ color: 0xffb3b5 }), new THREE.MeshBasicMaterial({ color: 0xb8d6ff })];
  const makeBullet = () => { const m = new THREE.Mesh(bulletGeo, bulletMat[0]); scene.add(m); return m; };
  const makeKit = () => {   // 救护包：白盒子 + 红十字 + 地上的绿光
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(26, 18, 26), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 }));
    const red = new THREE.MeshBasicMaterial({ color: 0xe53935 });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(18, 1, 6), red), c2 = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 18), red);
    c1.position.y = c2.position.y = 9.6;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(24, 24), new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.3, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -10;
    const inner = new THREE.Group();
    inner.add(box, c1, c2);
    g.add(inner, glow);
    g.userData.inner = inner;
    scene.add(g);
    return g;
  };


  const camTarget = new THREE.Vector3();
  let camReady = false;

  function render({ state, shown, me, now, dt }) {
    if (!mapRef) return;
    updateObstacles();

    // 玩家
    const seen = new Set();
    for (const p of state.players) {
      const s = shown.get(p.id);
      if (!s) continue;
      seen.add(p.id);
      let pm = playerMeshes.get(p.id);
      if (!pm || pm.team !== p.team) { if (pm) scene.remove(pm.g); pm = makePlayer(p.team); playerMeshes.set(p.id, pm); }
      pm.g.visible = true;
      pm.g.position.set(s.x, 0, s.y);
      pm.g.rotation.y = -p.a;
      if (!p.alive && !pm.dead) {          // 倒下：变灰、躺在地上
        pm.dead = true;
        pm.mat.color.set(0x666666);
        pm.g.rotation.z = Math.PI / 2;
        pm.g.position.y = 14;
      }
      if (p.alive && pm.dead) { pm.dead = false; pm.mat.color.set(TEAM_COLOR[p.team]); pm.g.rotation.z = 0; }
      if (pm.dead) pm.g.position.y = 14;
    }
    for (const [id, pm] of playerMeshes) if (!seen.has(id)) pm.g.visible = false;

    // 子弹
    getPool(bulletPool, makeBullet, state.bullets.length).forEach((m, i) => {
      if (i >= state.bullets.length) return;
      const [x, y, t] = state.bullets[i];
      m.position.set(x, 30, y);
      m.material = bulletMat[t];
    });

    // 救护包
    const kits = state.kits || [];
    getPool(kitPool, makeKit, kits.length).forEach((g, i) => {
      if (i >= kits.length) return;
      g.position.set(kits[i][0], 14 + Math.sin(now / 300) * 3, kits[i][1]);
      g.userData.inner.rotation.y = now / 700;
    });

    // 镜头：活着时跟着自己（斜后上方）；倒下或旁观时看整张地图
    const meShown = me && shown.get(me.id);
    const aspect = renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight);
    let tx, tz, height, back;
    if (meShown && me.alive) {
      const k = aspect < 1 ? Math.min(2.2, 1 / aspect) * 0.85 : 1;
      tx = meShown.x; tz = meShown.y; height = 860 * k; back = 620 * k;
      meRing.visible = true;
      meRing.position.set(meShown.x, 1.5, meShown.y);
    } else {
      tx = mapRef.w / 2; tz = mapRef.h / 2;
      const k = aspect < 1.6 ? 1.6 / aspect : 1;
      height = 1900 * k; back = 1080 * k;
      meRing.visible = false;
    }
    const want = new THREE.Vector3(tx, 0, tz);
    if (!camReady) { camTarget.copy(want); camReady = true; }
    else camTarget.lerp(want, Math.min(1, dt * 10));
    camera.position.set(camTarget.x, height, camTarget.z + back);
    camera.lookAt(camTarget.x, 0, camTarget.z - 20);

    renderer.render(scene, camera);
  }

  // 把 3D 位置换成屏幕坐标（给 2D 叠层画名字和血量用）
  const v = new THREE.Vector3();
  function project(x, y, h) {
    v.set(x, h, y).project(camera);
    const w = renderer.domElement.clientWidth, hh = renderer.domElement.clientHeight;
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * hh, visible: v.z < 1 };
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function resetCamera() { camReady = false; }

  return { setMap, render, project, resize, resetCamera };
}
