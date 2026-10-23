import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../.claude/skills/anatomy/kit/iso-kit.mjs";
import { kitScript } from "../.claude/skills/anatomy/scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";
const FILE = theme === "light" ? "test-rig-light.html" : "test-rig.html";

const WIDTH = 640;
const HEIGHT = 460;

// Model: a probe presses a key that rides on a slider held up by two springs.
const SPRING_RATE = 0.45; // N/mm each
const SPRINGS = 2;
const PER_TURN = 20; // dial: mm per revolution
const APPROACH = 16; // probe travel before it touches the key
const TRAVEL = 16; // slider travel at full press
const DEPTH_MOST = APPROACH + TRAVEL;

// Base
const PLATE = { x: -130, y: -84, w: 260, d: 170, r: 9 };
const PLATE_H = 12;
const FOOT_H = 5;

// Guide rods
const RODS = [-34, 34];
const ROD_Y = -52;
const ROD_R = 3.2;
const ROD_TOP = 172;
const SEAT_TOP = 9;
const SPRING_R = 7.2;
const SPRING_TURNS = 8;

// Slider
const BLOCK = { x: -44, y: -60, w: 88, d: 20, r: 3 };
const BLOCK_Z = 62;
const BLOCK_TOP = 76;
const BOSS_Z = 59;
const COLLAR_TOP = 82;
const DECK = { x: -34, y: -40, w: 68, d: 88, r: 5 };
const DECK_Z = 70;
const FLAG = { x: 34, y: -14, w: 52, d: 14, r: 3 };
const PAD_AT = [76, -7];
const TIP_Z = 77.2;
const KEY_AT = [0, 6];
const BEZEL = { x: -27, y: -16, w: 54, d: 44, r: 8 };
const BEZEL_TOP = 80;
const KEY_TOP = 89;

// Header and probe
const HEADER = { x: -46, y: -60, w: 92, d: 20, r: 3 };
const HEADER_Z = 164;
const ARM = { x: -7, y: -40, w: 14, d: 56, r: 2 };
const HOUSING_R = 9;
const HOUSING_Z = 114;
const PROBE_Z = KEY_TOP + APPROACH; // pad underside at rest
const PAD_R = 8;
const PAD_H = 5;
const STEM_R = 2.6;
const STEM_L = 44;

// Dial gauge
const DIAL = [74, -7];
const DIAL_R = 19;
const DIAL_Z = 112;
const DIAL_H = 10;
const DIAL_TOP = DIAL_Z + DIAL_H;
const BARREL_Z = 86;
const POST = [112, -7];
const POST_R = 4.6;
const POST_TOP = 132;

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    [0, ROD_Y, ROD_TOP + 6],
    [POST[0] + 8, POST[1], POST_TOP],
    [-46, -60, ROD_TOP + 6],
  ],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 45 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// A vertical coil spring, split into the half behind the rod and the half in front.
function coilV(cx, cy, r, z0, z1, turns) {
  const count = Math.round(turns * 20);
  const back = [];
  const front = [];
  let run = [];
  let near = null;
  for (let index = 0; index <= count; index++) {
    const share = index / count;
    const angle = share * turns * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const flat = k.iso([cx + r * c, cy + r * s, z0 + (z1 - z0) * share], P);
    const facing = k.depthOf([c, s, 0], P) > 0;
    if (near === null) near = facing;
    if (facing !== near) {
      run.push(flat);
      (near ? front : back).push(k.pathOf(run));
      run = [flat];
      near = facing;
      continue;
    }
    run.push(flat);
  }
  if (run.length > 1) (near ? front : back).push(k.pathOf(run));
  return { back: back.join(""), front: front.join("") };
}

// ---------------------------------------------------------------- base
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));

  const strip = { x: -112, y: PLATE.y + PLATE.d - 17, w: 168, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));

  const tag = { x: -112, y: 40, w: 46, d: 14, r: 2 };
  out.push(S(k.slabOf(tag, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(tag, 1.6), 0.8, P), { tone: "faint" }));
  out.push(L([0, 1, 2].map((row) => k.onTop([[tag.x + 7, tag.y + 3.6 + row * 2.8], [tag.x + (row === 1 ? 30 : 40), tag.y + 3.6 + row * 2.8]], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([tag.x + 3.4, tag.y + 7, 0.8]), at([tag.x + tag.w - 3.4, tag.y + 7, 0.8])], { size: 0.4 }));

  // Feet for the posts and the travel scale
  const [rx, ry] = POST;
  out.push(S(k.cylinder(rx, ry, 11, 0, 4, P, 36, 0.4), { tone: "mid" }));
  out.push(L(k.ring(rx, ry, 8.6, 4, P, 28), { tone: "lo" }));
  out.push(D([0, 1, 2].map((i) => at([rx + 9.4 * Math.cos(i * 2.094 + 0.5), ry + 9.4 * Math.sin(i * 2.094 + 0.5), 4])), { size: 0.4 }));
  for (const x of RODS) {
    out.push(S(k.cylinder(x, ROD_Y, 7, 0, 2.5, P, 24, 0.3), { tone: "mid" }));
    out.push(D([0, 1, 2].map((i) => at([x + 5.4 * Math.cos(i * 2.094 + 1), ROD_Y + 5.4 * Math.sin(i * 2.094 + 1), 2.5])), { size: 0.35 }));
    out.push(S(k.cylinder(x, ROD_Y, 5.6, 2.5, SEAT_TOP - 2.5, P, 24), { tone: "mid" }));
    out.push(L(k.sideArc(x, ROD_Y, 5.6, 5.5, P, 14), { tone: "faint" }));
  }
  return out.join("");
}

// ---------------------------------------------------------------- guide rods
function rodStatic(x) {
  return S(k.cylinder(x, ROD_Y, ROD_R, SEAT_TOP, ROD_TOP - SEAT_TOP, P, 22), { tone: "mid", crease: "none" });
}

const springRest = (x) => coilV(x, ROD_Y, SPRING_R, SEAT_TOP, BOSS_Z, SPRING_TURNS);

// ---------------------------------------------------------------- slider
function sliderBlock() {
  const out = [];
  for (const x of RODS) out.push(S(k.cylinder(x, ROD_Y, 5.4, BOSS_Z, BLOCK_Z - BOSS_Z, P, 22), { tone: "mid" }));
  out.push(S(k.slabOf(BLOCK, BLOCK_Z, BLOCK_TOP - BLOCK_Z, P, 4, 0.7), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BLOCK, 3), BLOCK_TOP, P, 3), { tone: "faint" }));
  for (const x of RODS) {
    out.push(S(k.cylinder(x, ROD_Y, 5.4, BLOCK_TOP, COLLAR_TOP - BLOCK_TOP, P, 22), { tone: "mid" }));
    out.push(L(k.ring(x, ROD_Y, 4.2, COLLAR_TOP, P, 18), { tone: "faint" }));
  }
  out.push(D([at([BLOCK.x + 4, BLOCK.y + 4, BLOCK_TOP]), at([BLOCK.x + 4, BLOCK.y + BLOCK.d - 4, BLOCK_TOP]), at([BLOCK.x + BLOCK.w - 4, BLOCK.y + 4, BLOCK_TOP]), at([BLOCK.x + BLOCK.w - 4, BLOCK.y + BLOCK.d - 4, BLOCK_TOP])], { size: 0.45 }));
  return out.join("");
}

function sliderDeck() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(DECK, 4), 8, 0.1, P)}" style="filter:blur(5px);opacity:.45"/>`];
  out.push(S(k.slabOf(DECK, DECK_Z, BLOCK_TOP - DECK_Z, P, 6, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(DECK, 3), BLOCK_TOP, P, 6), { tone: "faint" }));
  out.push(D([at([DECK.x + 5, DECK.y + DECK.d - 5, BLOCK_TOP]), at([DECK.x + DECK.w - 5, DECK.y + DECK.d - 5, BLOCK_TOP])], { size: 0.45 }));
  out.push(D([-24, -8, 8, 24].map((x) => at([x, DECK.y + DECK.d - 2.4, BLOCK_TOP])), { size: 0.35, tone: "lo" }));
  // Flag that the dial plunger rides on
  out.push(S(k.slabOf(FLAG, DECK_Z, BLOCK_TOP - DECK_Z, P, 3, 0.5), { tone: "mid" }));
  out.push(L(k.lineOnTop([FLAG.x, FLAG.y + FLAG.d / 2], [FLAG.x + FLAG.w - 6, FLAG.y + FLAG.d / 2], BLOCK_TOP, P), { tone: "faint" }));
  out.push(D([at([FLAG.x + 6, FLAG.y + FLAG.d - 3, BLOCK_TOP]), at([FLAG.x + FLAG.w - 14, FLAG.y + FLAG.d - 3, BLOCK_TOP])], { size: 0.4 }));
  out.push(S(k.cylinder(PAD_AT[0], PAD_AT[1], 3.4, BLOCK_TOP, TIP_Z - BLOCK_TOP, P, 18), { tone: "hi", crease: "none" }));
  // Key seat: bezel, key
  out.push(S(k.slabOf(BEZEL, BLOCK_TOP, BEZEL_TOP - BLOCK_TOP, P, 6, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BEZEL, 2.6), BEZEL_TOP, P, 6), { tone: "faint" }));
  const bezelScrews = k.corners(BEZEL, 4.2);
  out.push(D(bezelScrews.map(([x, y]) => at([x, y, BEZEL_TOP])), { size: 0.4 }));
  out.push(L(bezelScrews.map(([x, y]) => k.ring(x, y, 1.5, BEZEL_TOP, P, 12)).join(""), { tone: "lo" }));
  const key = { x: -18, y: KEY_AT[1] - 14, w: 36, d: 28, r: 10 };
  out.push(S(k.slabOf(key, BEZEL_TOP, KEY_TOP - BEZEL_TOP, P, 8, 1.2), { tone: "hi", lit: true }));
  out.push(L(k.planOutline(k.insetPlan(key, 3), KEY_TOP, P, 8), { tone: "faint" }));
  return out.join("");
}

// ---------------------------------------------------------------- header, arm, probe
function header() {
  const out = [];
  out.push(S(k.slabOf(HEADER, HEADER_Z, ROD_TOP - HEADER_Z + 0, P, 4, 0.7), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(HEADER, 3), ROD_TOP, P, 3), { tone: "faint" }));
  for (const x of RODS) {
    out.push(S(k.cylinder(x, ROD_Y, 4.6, ROD_TOP, 4, P, 20), { tone: "mid" }));
    out.push(L(k.knurl(x, ROD_Y, 4.6, ROD_TOP, ROD_TOP + 4, 20, P), { tone: "lo" }));
    out.push(L(k.ring(x, ROD_Y, 2.2, ROD_TOP + 4, P, 12), { tone: "faint" }));
  }
  out.push(D([at([HEADER.x + 5, HEADER.y + 5, ROD_TOP]), at([HEADER.x + 5, HEADER.y + HEADER.d - 5, ROD_TOP]), at([HEADER.x + HEADER.w - 5, HEADER.y + 5, ROD_TOP]), at([HEADER.x + HEADER.w - 5, HEADER.y + HEADER.d - 5, ROD_TOP])], { size: 0.45 }));
  return out.join("");
}

function rodMarks() {
  return RODS.map((x) => [100, 128, 148].map((z) => L(k.sideArc(x, ROD_Y, ROD_R, z, P, 12), { tone: "faint" })).join("")).join("");
}

function probeMoving() {
  const [hx, hy] = KEY_AT;
  const out = [];
  out.push(S(k.cylinder(hx, hy, STEM_R, PROBE_Z + PAD_H + 2, STEM_L - 2, P, 18), { tone: "hi", crease: "none", lit: true }));
  out.push(L([14, 22, 30].map((rise) => k.sideArc(hx, hy, STEM_R, PROBE_Z + PAD_H + rise, P, 10)).join(""), { tone: "lo" }));
  out.push(S(k.cylinder(hx, hy, 4, PROBE_Z + PAD_H, 2, P, 20), { tone: "hi" }));
  out.push(S(k.cylinder(hx, hy, PAD_R, PROBE_Z, PAD_H, P, 36, 0.5), { tone: "hi" }));
  out.push(L(k.ring(hx, hy, PAD_R - 1.4, PROBE_Z + PAD_H, P, 30), { tone: "lo" }));
  return out.join("");
}

function housing() {
  const [hx, hy] = KEY_AT;
  const out = [];
  out.push(S(k.cylinder(hx, hy, HOUSING_R, HOUSING_Z, HEADER_Z - HOUSING_Z, P, 36), { tone: "mid" }));
  out.push(S(k.cylinder(hx, hy, HOUSING_R + 0.9, HOUSING_Z, 3, P, 36), { tone: "mid" }));
  out.push(L([HOUSING_Z + 12, HOUSING_Z + 36].map((z) => k.sideArc(hx, hy, HOUSING_R, z, P, 20)).join(""), { tone: "faint" }));
  out.push(L(k.knurl(hx, hy, HOUSING_R, HOUSING_Z + 12, HOUSING_Z + 36, 40, P), { tone: "lo" }));
  // lock screw on the front of the housing
  out.push(S(k.slabOf({ x: hx - 1.6, y: hy + HOUSING_R - 0.4, w: 3.2, d: 3, r: 0.8 }, HOUSING_Z + 40, 3.4, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(hx, hy + HOUSING_R + 4.4, 2.3, HOUSING_Z + 39.2, 5, P, 16), { tone: "mid" }));
  out.push(L(k.knurl(hx, hy + HOUSING_R + 4.4, 2.3, HOUSING_Z + 39.2, HOUSING_Z + 44.2, 14, P), { tone: "lo" }));
  return out.join("");
}

function arm() {
  const [hx, hy] = KEY_AT;
  const out = [];
  out.push(S(k.slabOf(ARM, HEADER_Z, ROD_TOP - HEADER_Z, P, 4, 0.6), { tone: "mid" }));
  out.push(L(k.lineOnTop([hx, ARM.y + 4], [hx, hy - 12], ROD_TOP, P), { tone: "faint" }));
  out.push(D([at([hx, ARM.y + 5, ROD_TOP]), at([hx, hy - 12, ROD_TOP])], { size: 0.45 }));
  out.push(S(k.cylinder(hx, hy, 4.4, ROD_TOP, 4, P, 22), { tone: "mid" }));
  out.push(L(k.knurl(hx, hy, 4.4, ROD_TOP, ROD_TOP + 4, 22, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([hx, hy], [hx + 4.4, hy], ROD_TOP + 4, P), { tone: "hi" }));
  out.push(D([at([hx, hy, ROD_TOP + 4])], { size: 0.5, tone: "hi" }));
  return out.join("");
}

// ---------------------------------------------------------------- dial gauge
function plunger() {
  const [x, y] = DIAL;
  return [S(k.cylinder(x, y, 2.4, TIP_Z, 2.8, P, 16), { tone: "hi", lit: true }), S(k.cylinder(x, y, 1.5, TIP_Z + 2.8, 120 - TIP_Z - 2.8, P, 14), { tone: "hi", crease: "none", lit: true })].join("");
}

function dialBody() {
  const [x, y] = DIAL;
  const out = [];
  out.push(S(k.cylinder(x, y, 3.8, BARREL_Z, DIAL_Z - BARREL_Z, P, 18), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 4.8, BARREL_Z, 2.4, P, 18), { tone: "mid" }));
  out.push(L([BARREL_Z + 10, BARREL_Z + 17].map((z) => k.sideArc(x, y, 3.8, z, P, 10)).join(""), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, DIAL_R, DIAL_Z, DIAL_H, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, DIAL_R, DIAL_TOP - 3.4, DIAL_TOP, 84, P, 0.3), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, DIAL_R, DIAL_TOP - 3.4, P, 40), { tone: "faint" }));
  out.push(L(k.ring(x, y, DIAL_R - 2.2, DIAL_TOP, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, DIAL_R - 3, 50, 5, DIAL_TOP, [1.3, 2.8], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(S(k.slabOf({ x: x - 3, y: y - DIAL_R - 3.4, w: 6, d: 4, r: 1.2 }, DIAL_Z + 1.5, 5, P, 3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + DIAL_R - 1, y: y - 2.4, w: 5, d: 4.8, r: 1.2 }, DIAL_Z + 2, 5, P, 3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + DIAL_R + 3.6, y: y - 3.2, w: 2.6, d: 6.4, r: 1.2 }, DIAL_Z + 1.2, 6.6, P, 3), { tone: "mid" }));
  out.push(L(k.ring(x, y, 1.6, DIAL_TOP, P, 16), { tone: "mid" }));
  out.push(k.faceTextSvg(k.topMatrix([x, y + 8.6], DIAL_TOP, P, "x"), "mm", { size: 2.4, tone: "lo", anchor: "middle" }));
  return out.join("");
}

function dialStand() {
  const [x, y] = POST;
  const out = [];
  out.push(S(k.cylinder(x, y, POST_R, 4, 100 - 4, P, 22), { tone: "mid", crease: "none" }));
  out.push(L([30, 60, 80].map((z) => k.sideArc(x, y, POST_R, z, P, 12)).join(""), { tone: "faint" }));
  const armPlan = { x: DIAL[0] + DIAL_R - 1, y: y - 3, w: x - 8 - (DIAL[0] + DIAL_R - 1), d: 6, r: 1.5 };
  out.push(S(k.slabOf({ x: x - 8, y: y - 8, w: 16, d: 16, r: 3 }, 100, 28, P, 4, 0.6), { tone: "mid" }));
  out.push(S(k.slabOf({ x: DIAL[0] + DIAL_R - 1, y: y - 3, w: x - 8 - (DIAL[0] + DIAL_R - 1) + 1, d: 6, r: 1.5 }, DIAL_Z, DIAL_H, P, 3, 0.4), { tone: "mid" }));
  out.push(D([at([armPlan.x + 4, y, DIAL_TOP]), at([armPlan.x + armPlan.w - 3, y, DIAL_TOP])], { size: 0.4 }));
  out.push(S(k.cylinder(x, y, POST_R, 128, POST_TOP - 128, P, 22), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 3.4, POST_TOP, 2, P, 18), { tone: "mid" }));
  out.push(L(k.ring(x, y, 2, POST_TOP + 2, P, 12), { tone: "faint" }));
  // clamp thumb screw on the +x side
  out.push(S(k.slabOf({ x: x + 8, y: y - 1.2, w: 3, d: 2.4, r: 0.6 }, 112, 3.4, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(x + 12.4, y, 2.4, 110.8, 6, P, 16), { tone: "mid" }));
  out.push(L(k.knurl(x + 12.4, y, 2.4, 110.8, 116.8, 14, P), { tone: "lo" }));
  return out.join("");
}

const needleAt = (turn) => {
  const angle = turn * Math.PI * 2;
  const [x, y] = DIAL;
  return k.lineOnTop([x - Math.sin(angle) * 3.4, y + Math.cos(angle) * 3.4], [x + Math.sin(angle) * (DIAL_R - 4), y - Math.cos(angle) * (DIAL_R - 4)], DIAL_TOP + 0.2, P);
};

// ---------------------------------------------------------------- assemble
const springs = RODS.map(springRest);
const g = (part, inner, extra = "") => `<g data-part="${part}"${extra}>${inner}</g>`;
const moveZ = (dz) => k.translateAlong(P, [0, 0, dz]);

const body = [
  base(),
  ...RODS.map((x, i) => {
    return [
      `<path data-part="spring-back-${i}" class="iso-line tr-coil" data-tone="lo" d="${springs[i].back}"/>`,
      rodStatic(x),
      `<path data-part="spring-front-${i}" class="iso-line tr-coil" data-tone="mid" d="${springs[i].front}"/>`,
    ].join("");
  }),
  g("slider-block", sliderBlock()),
  RODS.map((_, i) => g(`rod-upper-${i}`, "")).join(""),
  g("slider-deck", sliderDeck()),
  header(),
  rodMarks(),
  g("probe", probeMoving()),
  housing(),
  arm(),
  g("plunger", plunger()),
  dialBody(),
  `<path data-part="needle" class="iso-line" data-tone="lit" data-free="start" d="${needleAt(0)}" style="stroke-width:1.1"/>`,
  dialStand(),
];

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A key press test fixture. A glass key sits on a deck that slides up and down two guide rods, held up by two coil springs. A probe hangs from an arm above it and comes down onto the key; the deck follows it down, compressing the springs. A pointer on the deck reads a travel scale, and a dial gauge beside the deck has its plunger on a flag and its needle turns with the travel. Press the probe down and the readout gives the force and travel.",
  body,
});

const live = `
const P = ${JSON.stringify(P)};
const DIAL = ${JSON.stringify(DIAL)};
const DIAL_R = ${DIAL_R}, DIAL_TOP = ${DIAL_TOP}, PER_TURN = ${PER_TURN};
const RODS = ${JSON.stringify(RODS)}, ROD_Y = ${ROD_Y}, ROD_R = ${ROD_R}, ROD_TOP = ${ROD_TOP};
const SEAT_TOP = ${SEAT_TOP}, BOSS_Z = ${BOSS_Z}, COLLAR_TOP = ${COLLAR_TOP}, SPRING_R = ${SPRING_R}, SPRING_TURNS = ${SPRING_TURNS};
const APPROACH = ${APPROACH}, TRAVEL = ${TRAVEL}, DEPTH_MOST = ${DEPTH_MOST};
const RATE = ${SPRING_RATE * SPRINGS};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const part = (name) => svg.querySelector('[data-part="' + name + '"]');
const block = part("slider-block"), deck = part("slider-deck"), probe = part("probe"), plunger = part("plunger"), needle = part("needle");
const uppers = RODS.map((_, i) => part("rod-upper-" + i));
const backs = RODS.map((_, i) => part("spring-back-" + i));
const fronts = RODS.map((_, i) => part("spring-front-" + i));
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
${coilV.toString().replace(/\bk\./g, "")}
const needleAt = ${needleAt.toString().replace(/\bk\./g, "")};
let depth = 0, target = 0;
let frame = 0, last = 0, clock = 0, touring = true, visible = false, idleTimer = 0;
const ease = (t) => t * t * (3 - 2 * t);
function tourAt(t) {
  const s = t % 9;
  if (s < 1) return 0;
  if (s < 3.4) return DEPTH_MOST * 0.94 * ease((s - 1) / 2.4);
  if (s < 4.8) return DEPTH_MOST * 0.94;
  if (s < 7.2) return DEPTH_MOST * 0.94 * (1 - ease((s - 4.8) / 2.4));
  return 0;
}
const travelOf = (d) => clamp(d - APPROACH, 0, TRAVEL);
function draw() {
  const x = travelOf(depth);
  const force = RATE * x;
  probe.setAttribute("transform", translateAlong(P, [0, 0, -depth]));
  const slide = translateAlong(P, [0, 0, -x]);
  block.setAttribute("transform", slide);
  deck.setAttribute("transform", slide);
  plunger.setAttribute("transform", slide);
  RODS.forEach((rx, i) => {
    const spring = coilV(rx, ROD_Y, SPRING_R, SEAT_TOP, BOSS_Z - x, SPRING_TURNS);
    backs[i].setAttribute("d", spring.back);
    fronts[i].setAttribute("d", spring.front);
    const from = COLLAR_TOP - x;
    uppers[i].innerHTML = solidSvg(cylinder(rx, ROD_Y, ROD_R, from, ROD_TOP - from, P, 22), { tone: "mid", crease: "none" });
  });
  needle.setAttribute("d", needleAt(x / PER_TURN));
  const text = force.toFixed(1) + " N \\u00b7 travel " + x.toFixed(1) + " mm";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(Math.round(x * 10) / 10));
  stage.setAttribute("aria-valuetext", (depth < APPROACH ? "Probe above the key, " : "Pressing, ") + text);
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) { clock += dt; target = tourAt(clock); }
  depth = still.matches ? target : depth + (target - depth) * (1 - Math.exp(-dt / 0.07));
  if (Math.abs(target - depth) < 0.005) depth = target;
  draw();
  frame = visible && (touring || depth !== target) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (next) => {
  touring = false;
  target = clamp(next, 0, DEPTH_MOST);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { touring = !still.matches; clock = 0; run(); }, 3600);
  run();
};
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) { touring = false; target = 0; }
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  const share = clamp(((event.clientY - box.top) / box.height - 0.12) / 0.7, 0, 1);
  steer(share * DEPTH_MOST);
});
stage.addEventListener("pointerleave", () => steer(target));
stage.addEventListener("keydown", (event) => {
  let to = null;
  if (event.key === "ArrowDown") to = target + 4;
  if (event.key === "ArrowUp") to = target - 4;
  if (event.key === "PageDown" || event.key === "End") to = DEPTH_MOST;
  if (event.key === "PageUp" || event.key === "Home") to = 0;
  if (to === null) return;
  event.preventDefault();
  steer(to);
});
draw();
`;

const css = `.tr-coil{stroke-width:1.5}`;

const card = k.plateHtml({
  fig: "Fig 1",
  title: "Key press test",
  hint: "Move down to press the key",
  readout: "0.0 N · travel 0.0 mm",
  keys: [
    { mark: "lit", label: "Key, probe and needle: the part pressed, what presses it and what reads it" },
    { mark: "raised", label: "Deck on two springs, 0.45 N/mm each" },
  ],
  caption: `A probe comes down onto a key that rides on a deck held up by two ${SPRING_RATE} N/mm springs. The probe moves ${APPROACH} mm before it touches, then pushes the deck down up to ${TRAVEL} mm, which takes ${(SPRING_RATE * SPRINGS * TRAVEL).toFixed(1)} N. The dial turns once for ${PER_TURN} mm of travel, so each tick is ${(PER_TURN / 50).toFixed(1)} mm.`,
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Key press test: arrow keys move the probe down and up" aria-valuemin="0" aria-valuemax="${TRAVEL}" aria-valuenow="0">${svg}</div>`,
});

const page = k.pageHtml({ title: "Key press test", theme, body: card, script: kitScript() + live }).replace("</style>", `${css}</style>`);
writeFileSync(join(HERE, FILE), page);
console.log("wrote", FILE);
