import * as THREE from '/vendor/three/three.module.js';
import { consumeLaunchSplash } from '../../core/splash.js';

// Carry the menu's launch banner across the navigation, then fade it out.
consumeLaunchSplash();
import { createChannel } from '../../core/channel.js';
import { SwingDetector } from '../../core/gesture.js';
import {
  Game, PIN_LAYOUT, LANE_HALF_WIDTH, GUTTER_WIDTH,
  BALL_RADIUS, FOUL_Z, PIN_DECK_Z, MAX_FRAME, scoreFrames,
} from './logic.js';

/**
 * Bowling — renderer. One lane, real 10-frame scoring, up to 4 players
 * passing a single phone. Aim with the pointer, swing to release; flick the
 * wrist through the swing to hook the ball into the pocket.
 */

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1622);
scene.fog = new THREE.Fog(0x1a1622, 22, 46);

const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 80);

scene.add(new THREE.AmbientLight(0xccd6ff, 0.55));
const overhead = new THREE.DirectionalLight(0xfff3d8, 1.1);
overhead.position.set(0, 12, -6);
scene.add(overhead);
const approachLight = new THREE.PointLight(0xff9ecb, 0.6, 20);
approachLight.position.set(0, 4, 4);
scene.add(approachLight);

const mat = (c, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });

// ── Lane ─────────────────────────────────────────────────────────────────
const APPROACH_LEN = 5;
const BACK_WALL_Z = PIN_DECK_Z - 2.2;
const laneCenterZ = (FOUL_Z + BACK_WALL_Z) / 2;
const lane = new THREE.Mesh(
  new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2, FOUL_Z - BACK_WALL_Z),
  mat(0xd9b46a, 0.35, 0.05),
);
lane.rotation.x = -Math.PI / 2;
lane.position.set(0, 0, laneCenterZ);
scene.add(lane);

const approach = new THREE.Mesh(
  new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2 + 1.2, APPROACH_LEN),
  mat(0x2a2438, 0.9),
);
approach.rotation.x = -Math.PI / 2;
approach.position.set(0, -0.01, FOUL_Z + APPROACH_LEN / 2);
scene.add(approach);

const foulLine = new THREE.Mesh(
  new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2, 0.06),
  new THREE.MeshBasicMaterial({ color: 0xff5d6c }),
);
foulLine.rotation.x = -Math.PI / 2;
foulLine.position.set(0, 0.005, FOUL_Z);
scene.add(foulLine);

// Gutters either side, sunk slightly below the lane surface.
for (const side of [-1, 1]) {
  const gutter = new THREE.Mesh(
    new THREE.PlaneGeometry(GUTTER_WIDTH, FOUL_Z - BACK_WALL_Z),
    mat(0x151020, 0.6),
  );
  gutter.rotation.x = -Math.PI / 2;
  gutter.position.set(side * (LANE_HALF_WIDTH + GUTTER_WIDTH / 2), -0.03, laneCenterZ);
  scene.add(gutter);
}

// Seven classic aiming arrows, ~4.5m out from the foul line.
{
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x2a2438 });
  const arrowZ = FOUL_Z - 4.5;
  for (let i = 0; i < 7; i += 1) {
    const ax = (i - 3) * (LANE_HALF_WIDTH * 1.5 / 3);
    const tri = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 3), arrowMat);
    tri.rotation.x = -Math.PI / 2;
    tri.rotation.z = Math.PI;
    tri.position.set(ax, 0.006, arrowZ);
    scene.add(tri);
  }
}

// Back cushion behind the pin deck.
const cushion = new THREE.Mesh(
  new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2 + 1, 2.4),
  mat(0x120e1c, 1),
);
cushion.position.set(0, 1.1, BACK_WALL_Z);
scene.add(cushion);

// Low side walls for containment.
for (const side of [-1, 1]) {
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(FOUL_Z - BACK_WALL_Z, 0.6),
    mat(0x241f33, 0.8),
  );
  wall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  wall.position.set(side * (LANE_HALF_WIDTH + GUTTER_WIDTH + 0.03), 0.3, laneCenterZ);
  scene.add(wall);
}

// ── Pins ─────────────────────────────────────────────────────────────────
function buildPinMesh() {
  const profile = [
    [0, 0], [0.088, 0], [0.11, 0.05], [0.104, 0.12], [0.078, 0.19],
    [0.05, 0.245], [0.058, 0.27], [0.09, 0.31], [0.098, 0.335], [0.06, 0.37], [0, 0.39],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 20),
    mat(0xf4f0e8, 0.35),
  );
  const stripe = new THREE.Mesh(
    new THREE.TorusGeometry(0.083, 0.02, 8, 20),
    mat(0xe23b3b, 0.4),
  );
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = 0.29;
  const group = new THREE.Group();
  group.add(body, stripe);
  return group;
}

const pins = PIN_LAYOUT.map((p) => {
  const mesh = buildPinMesh();
  mesh.position.set(p.x, 0, p.z);
  scene.add(mesh);
  return {
    id: p.id, mesh, x0: p.x, z0: p.z,
    knockedVisual: false, fallT: 0,
    axis: new THREE.Vector3(1, 0, 0),
  };
});

function resetPinsVisual() {
  for (const pin of pins) {
    pin.knockedVisual = false;
    pin.fallT = 0;
    pin.mesh.position.set(pin.x0, 0, pin.z0);
    pin.mesh.rotation.set(0, 0, 0);
    pin.mesh.visible = true;
  }
}

// ── Ball ─────────────────────────────────────────────────────────────────
const BALL_COLORS = [0x3fa7ff, 0xff5d6c, 0x7ee08a, 0xffd166];
const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 24, 18), mat(BALL_COLORS[0], 0.25, 0.15));
scene.add(ball);
for (const [dx, dz] of [[0.03, 0], [-0.015, 0.026], [-0.015, -0.026]]) {
  const hole = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.9 }),
  );
  hole.position.set(dx, BALL_RADIUS - 0.01, dz);
  ball.add(hole);
}

// Aim marker on the approach.
const aimArrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 4),
  new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 }));
scene.add(aimArrow);

// ── Wiring ─────────────────────────────────────────────────────────────────
const swing = new SwingDetector({ onThreshold: 130, minTravel: 22 });
let players = 1;
let game = null;
let started = false;
let aimAngle = 0;
const aimHistory = []; // {t, x} pointer samples, used to read wrist-flick curve

const channel = createChannel({
  onA: () => {
    if (!started) return startGame();
    if (game && game.state === 'game-over') return startGame();
    return undefined;
  },
  onSample: (sample, dt, now) => {
    const s = swing.update(channel.pointer.rateDps, dt, now);
    if (s && started && game && game.state === 'aim') {
      const power = Math.min(1, s.peak / 480);
      const aim = releaseAim(now);
      const curve = readCurve(now);
      game.roll({ power, aim, curve });
      channel.feedback({ type: 'slice', combo: 1 });
      channel.audio.play('impact');
      flashPower(power, curve);
    }
  },
});

const CURVE_DEADZONE = 0.02;  // ignore hand wobble smaller than this
const CURVE_SENSITIVITY = 9;  // scales what's left after the deadzone

function readCurve(now) {
  // Wrist-flick curve: how far the aim moved in the last ~260ms before the
  // swing landed. Below CURVE_DEADZONE it's treated as incidental hand
  // wobble and ignored outright — raise this if straight throws still drift,
  // lower it if intentional hooks feel unresponsive. CURVE_SENSITIVITY sets
  // how quickly a deliberate flick past the deadzone ramps up to full curve.
  const recent = aimHistory.filter((h) => now - h.t < 260);
  if (recent.length < 2) return 0;
  const delta = recent[recent.length - 1].x - recent[0].x;
  if (Math.abs(delta) < CURVE_DEADZONE) return 0;
  const shaped = delta - Math.sign(delta) * CURVE_DEADZONE;
  return Math.max(-1, Math.min(1, shaped * CURVE_SENSITIVITY));
}

const AIM_SMOOTH_MS = 120; // average the last ~120ms of aim instead of one instant sample

function releaseAim(now) {
  // A single instantaneous pointer reading can catch a jittery outlier right
  // at the moment the swing registers. Averaging a short recent window makes
  // "aim dead centre and hold it" behave consistently.
  const recent = aimHistory.filter((h) => now - h.t < AIM_SMOOTH_MS);
  if (recent.length === 0) return aimAngle;
  const avgX = recent.reduce((sum, h) => sum + h.x, 0) / recent.length;
  return (avgX - 0.5) * 2 * 0.032;
}

function startGame() {
  started = true;
  game = new Game({ players, onEvent: handleEvent });
  resetPinsVisual();
  $('overlay').classList.add('hide');
  ball.material.color.setHex(BALL_COLORS[0]);
  syncHud();
  buildScoreboard();
}

function flashPower(p, c) {
  const el = $('power');
  el.style.width = `${Math.round(p * 100)}%`;
  el.parentElement.classList.add('on');
  const dot = $('curvedot');
  dot.style.left = `${50 + c * 45}%`;
  $('curvewrap').classList.add('on');
  clearTimeout(flashPower.t);
  flashPower.t = setTimeout(() => {
    el.parentElement.classList.remove('on');
    $('curvewrap').classList.remove('on');
  }, 1400);
}

const RESULT_NAMES = { strike: 'STRIKE!', spare: 'SPARE!', gutter: 'gutter ball' };

function handleEvent(e) {
  if (e.type === 'released') {
    $('banner').classList.remove('on');
  } else if (e.type === 'pins') {
    syncHud();
    const rolls = e.rolls;
    let label;
    if (e.gutter) label = RESULT_NAMES.gutter;
    else if (rolls[rolls.length - 1] === 10 && (rolls.length === 1 || (game.turn.frame === MAX_FRAME - 1))) {
      label = e.pins === 10 ? RESULT_NAMES.strike : `${e.pins} pin${e.pins === 1 ? '' : 's'}`;
    } else if (rolls.length >= 2 && rolls[rolls.length - 2] !== 10
      && rolls[rolls.length - 2] + rolls[rolls.length - 1] === 10) {
      label = RESULT_NAMES.spare;
    } else {
      label = `${e.pins} pin${e.pins === 1 ? '' : 's'}`;
    }
    const banner = $('banner');
    banner.textContent = label;
    banner.className = label === RESULT_NAMES.strike ? 'on strike' : label === RESULT_NAMES.gutter ? 'on gutter' : 'on';
    clearTimeout(handleEvent.t);
    handleEvent.t = setTimeout(() => banner.classList.remove('on'), 1300);
  } else if (e.type === 'frame-done') {
    updateScoreboard();
  } else if (e.type === 'game-over') {
    showFinalStandings(e.standings);
  }
  if (game) ball.material.color.setHex(BALL_COLORS[game.turn.player % BALL_COLORS.length]);
}

function syncHud() {
  if (!game) return;
  const tenth = game.turn.frame === MAX_FRAME - 1;
  const ballNo = game.activeFrame.rolls.length + 1;
  $('turn').textContent = game.playerCount > 1 ? `Player ${game.turn.player + 1}` : 'Your turn';
  $('frameinfo').textContent = `frame ${game.turn.frame + 1}${tenth ? ' (final)' : ''} · ball ${ballNo}`;
  $('pinsleft').textContent = `${game.standing.size} pin${game.standing.size === 1 ? '' : 's'}`;
}

// ── Scoreboard ───────────────────────────────────────────────────────────
function formatFrameBoxes(rolls, isTenth) {
  const sym = (n) => (n === 0 ? '−' : n === 10 ? 'X' : String(n));
  const boxes = Array(isTenth ? 3 : 2).fill(null);
  if (!isTenth) {
    if (rolls.length >= 1) {
      if (rolls[0] === 10) boxes[1] = { t: 'X', k: 'strike' };
      else {
        boxes[0] = { t: sym(rolls[0]) };
        if (rolls.length >= 2) {
          boxes[1] = rolls[0] + rolls[1] === 10 ? { t: '/', k: 'spare' } : { t: sym(rolls[1]) };
        }
      }
    }
    return boxes;
  }
  if (rolls.length >= 1) boxes[0] = { t: sym(rolls[0]), k: rolls[0] === 10 ? 'strike' : undefined };
  if (rolls.length >= 2) {
    if (rolls[0] === 10) boxes[1] = { t: sym(rolls[1]), k: rolls[1] === 10 ? 'strike' : undefined };
    else boxes[1] = rolls[0] + rolls[1] === 10 ? { t: '/', k: 'spare' } : { t: sym(rolls[1]) };
  }
  if (rolls.length >= 3) {
    boxes[2] = { t: sym(rolls[2]), k: rolls[2] === 10 ? 'strike' : undefined };
    if (rolls[0] === 10 && rolls[1] !== 10 && rolls[1] + rolls[2] === 10) boxes[2] = { t: '/', k: 'spare' };
  }
  return boxes;
}

function buildScoreboard() {
  const board = $('scoreboard');
  board.innerHTML = '';
  for (let pl = 0; pl < game.playerCount; pl += 1) {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.id = `srow-${pl}`;
    const name = document.createElement('div');
    name.className = 'score-name';
    name.textContent = `P${pl + 1}`;
    name.style.background = `#${BALL_COLORS[pl % BALL_COLORS.length].toString(16).padStart(6, '0')}`;
    name.style.color = '#1a1622';
    const frames = document.createElement('div');
    frames.className = 'score-frames';
    for (let f = 0; f < MAX_FRAME; f += 1) {
      const cell = document.createElement('div');
      cell.className = `frame-cell${f === MAX_FRAME - 1 ? ' tenth' : ''}`;
      cell.id = `fcell-${pl}-${f}`;
      cell.innerHTML = '<div class="frame-rolls"></div><div class="frame-cum"></div>';
      frames.appendChild(cell);
    }
    const total = document.createElement('div');
    total.className = 'score-total';
    total.id = `stotal-${pl}`;
    total.textContent = '0';
    row.append(name, frames, total);
    board.appendChild(row);
  }
  updateScoreboard();
}

function updateScoreboard() {
  if (!game) return;
  for (let pl = 0; pl < game.playerCount; pl += 1) {
    const { cumulative, total } = playerScore(game.players[pl]);
    for (let f = 0; f < MAX_FRAME; f += 1) {
      const rolls = game.players[pl].frames[f].rolls;
      const boxes = formatFrameBoxes(rolls, f === MAX_FRAME - 1);
      const cell = $(`fcell-${pl}-${f}`);
      const rollsEl = cell.querySelector('.frame-rolls');
      rollsEl.innerHTML = boxes.map((b) => (b ? `<span class="${b.k ?? ''}">${b.t}</span>` : '<span></span>')).join('');
      cell.querySelector('.frame-cum').textContent = cumulative[f] == null ? '' : cumulative[f];
      cell.classList.toggle('current', started && pl === game.turn.player && f === game.turn.frame && game.state !== 'game-over');
    }
    $(`stotal-${pl}`).textContent = total;
    $(`srow-${pl}`).classList.toggle('active', started && pl === game.turn.player && game.state !== 'game-over');
  }
}

// scoreFrames comes straight from logic.js — no re-derivation needed here.
function playerScore(player) { return scoreFrames(player.frames); }

function showFinalStandings(standings) {
  const order = standings.map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s);
  const best = order[0].s;
  const rows = order.map(({ s, i }) => `
    <div class="standing-row ${s === best ? 'winner' : ''}">
      <span>${game.playerCount > 1 ? `Player ${i + 1}` : 'You'}</span><span>${s}</span>
    </div>`).join('');
  $('panel').innerHTML = `<h1>🎳 <em>Game Over</em></h1>
    <div id="standings">${rows}</div>
    <div class="cta"><strong>A</strong> play again · <strong>B</strong> menu</div>`;
  $('overlay').classList.remove('hide');
  channel.feedback({ type: 'slice', combo: 3 });
  channel.audio.play('swipe');
}

// ── Player picker (menu) ───────────────────────────────────────────────────
document.querySelectorAll('.pcount').forEach((el) => {
  el.addEventListener('click', () => {
    players = Number(el.dataset.n);
    document.querySelectorAll('.pcount').forEach((e) => e.classList.toggle('sel', e === el));
  });
});
window.addEventListener('keydown', (ev) => {
  if (!started && ['1', '2', '3', '4'].includes(ev.key)) {
    players = Number(ev.key);
    document.querySelectorAll('.pcount').forEach((e) => e.classList.toggle('sel', e.dataset.n === ev.key));
  }
});

// ── Loop ───────────────────────────────────────────────────────────────────
let last = performance.now();
let fps = 0; let frames = 0; let fpsMark = last;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (dt <= 0) return;
  frames += 1;
  if (now - fpsMark >= 500) { fps = (frames * 1000) / (now - fpsMark); frames = 0; fpsMark = now; }

  const aim = channel.poll(now);
  aimAngle = (aim.x - 0.5) * 2 * 0.032;
  aimHistory.push({ t: now, x: aim.x });
  while (aimHistory.length && now - aimHistory[0].t > 400) aimHistory.shift();

  if (game && game.state === 'rolling') game.update(now, dt);
  step(now, dt);
  renderer.render(scene, camera);
}

/** Scene/camera sync — split out for verification. */
function step(now, dt) {
  const aiming = started && game && game.state === 'aim';
  const rolling = started && game && game.state === 'rolling';

  let bx = 0;
  let bz = FOUL_Z + 2.4;
  if (aiming) {
    bx = Math.sin(aimAngle) * 1.4;
  } else if (rolling) {
    bx = game.ball.x;
    bz = game.ball.z;
    const rollDist = dt * 9; // approximate roll speed for the spin feel
    ball.rotation.x += rollDist / BALL_RADIUS;
  }
  ball.position.set(bx, BALL_RADIUS, bz);

  aimArrow.visible = aiming;
  if (aiming) {
    const ax = bx + Math.sin(aimAngle) * 1.1;
    const az = bz - Math.cos(aimAngle) * 1.1;
    aimArrow.position.set(ax, 0.35, az);
    aimArrow.rotation.set(0, -aimAngle, Math.PI / 2);
  }

  // Pin fall / reset animation.
  for (const pin of pins) {
    const standingNow = !game || game.standing.has(pin.id);
    if (standingNow && pin.knockedVisual) {
      pin.knockedVisual = false;
      pin.fallT = 0;
      pin.mesh.position.set(pin.x0, 0, pin.z0);
      pin.mesh.rotation.set(0, 0, 0);
    } else if (!standingNow && !pin.knockedVisual) {
      pin.knockedVisual = true;
      pin.fallT = 0;
      const a = Math.random() * Math.PI * 2;
      pin.axis.set(Math.cos(a), 0, Math.sin(a));
    }
    if (pin.knockedVisual && pin.fallT < 1) {
      pin.fallT = Math.min(1, pin.fallT + dt / 0.4);
      const angle = (Math.PI / 2 + 0.3) * Math.min(1, pin.fallT * 1.3);
      pin.mesh.rotation.set(0, 0, 0);
      pin.mesh.rotateOnAxis(pin.axis, angle);
      pin.mesh.position.set(
        pin.x0 + pin.axis.z * 0.16 * pin.fallT,
        0,
        pin.z0 - pin.axis.x * 0.16 * pin.fallT,
      );
    }
  }

  // Camera: behind the approach while aiming, chasing the ball while rolling.
  let camX; let camY; let camZ; let lookZ;
  if (rolling) {
    camX = bx * 0.6;
    camY = 0.9;
    camZ = bz + 2.6;
    lookZ = bz - 3;
  } else {
    camX = Math.sin(aimAngle) * 0.6;
    camY = 1.35;
    camZ = FOUL_Z + 4.4;
    lookZ = PIN_DECK_Z;
  }
  camera.position.lerp(new THREE.Vector3(camX, camY, camZ), Math.min(1, dt * 4));
  camera.lookAt(camX * 0.3, 0.4, lookZ);
}

function resize() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  channel.pointer.setViewport(w, h);
}
window.addEventListener('resize', resize);

setInterval(() => {
  if (!$('debug').classList.contains('on')) return;
  $('debug').textContent = [
    `fps       ${fps.toFixed(0)}`,
    `state     ${game ? game.state : 'menu'}`,
    `turn      p${game ? game.turn.player + 1 : '-'} · frame ${game ? game.turn.frame + 1 : '-'}`,
    `aim       ${aimAngle.toFixed(4)} rad`,
    `gyro map  ${channel.pointer.describeMap()}`,
    `sensor    ${channel.link.rate.toFixed(0)} Hz`,
  ].join('\n');
}, 250);

resize();
camera.position.set(0, 1.35, FOUL_Z + 4.4);
camera.lookAt(0, 0.4, PIN_DECK_Z);
requestAnimationFrame(frame);

window.__openwii = {
  get game() { return game; }, channel, pointer: channel.pointer, scene, camera, renderer, step, startGame,
  fps: () => fps,
};