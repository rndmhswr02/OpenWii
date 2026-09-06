/**
 * Bowling — one lane, up to 4 players, real 10-frame scoring.
 *
 * No renderer, no DOM. The lane is a flat, deterministic physical model: an
 * oil pattern controls how much a ball can hook, and a fixed 1-10 pin deck
 * is knocked down by a continuous roll simulation sampled at a fixed
 * timestep. Tests and the renderer see exactly the same numbers.
 */

// ── Lane geometry (metres) ──────────────────────────────────────────────────
export const LANE_LENGTH = 15;          // 60ft, foul line to the head pin
export const FOUL_Z = 0;
export const PIN_DECK_Z = -LANE_LENGTH;     // z of pin 1
export const LANE_HALF_WIDTH = 0.529;       // 21in of playable boards, half-width
export const GUTTER_WIDTH = 0.229;          // 9in gutters either side
export const BALL_RADIUS = 0.108;
export const PIN_RADIUS = 0.06;
export const PIN_SPACING = 0.305;           // 12in centre-to-centre
export const ROW_DEPTH = PIN_SPACING * (Math.sqrt(3) / 2);
export const MAX_FRAME = 10;
export const PINS_PER_RACK = 10;

// Standard 1–10 pin deck, apex toward the bowler (matches USBC numbering).
export const PIN_LAYOUT = [
  { id: 1, x: 0, row: 0 },
  { id: 2, x: -PIN_SPACING / 2, row: 1 },
  { id: 3, x: PIN_SPACING / 2, row: 1 },
  { id: 4, x: -PIN_SPACING, row: 2 },
  { id: 5, x: 0, row: 2 },
  { id: 6, x: PIN_SPACING, row: 2 },
  { id: 7, x: -PIN_SPACING * 1.5, row: 3 },
  { id: 8, x: -PIN_SPACING / 2, row: 3 },
  { id: 9, x: PIN_SPACING / 2, row: 3 },
  { id: 10, x: PIN_SPACING * 1.5, row: 3 },
].map((p) => ({ ...p, z: PIN_DECK_Z - p.row * ROW_DEPTH }));

// Pins that can chain-knock each other once one of them falls.
const ADJACENCY = {
  1: [2, 3],
  2: [1, 3, 4, 5],
  3: [1, 2, 5, 6],
  4: [2, 5, 7, 8],
  5: [2, 3, 4, 6, 8, 9],
  6: [3, 5, 9, 10],
  7: [4, 8],
  8: [4, 5, 7, 9],
  9: [5, 6, 8, 10],
  10: [6, 9],
};

/** Fresh set of ids for a full rack. */
export function freshRack() {
  return new Set(PIN_LAYOUT.map((p) => p.id));
}

/**
 * House-shot oil pattern: heavy near the foul line (the ball skids through
 * it), thinning out toward the pins (the ball grips and "reads the lane").
 * Deterministic function of z alone, like golf's terrainHeight.
 */
export function oilFactor(z) {
  const t = Math.min(1, Math.max(0, -z / LANE_LENGTH)); // 0 at foul line, 1 at the pins
  const grip = Math.max(0, (t - 0.55) / 0.45);
  return 0.15 + 0.85 * grip ** 1.4;
}

const BASE_SPEED = 9.2;          // m/s at full power
const MIN_SPEED_FACTOR = 0.5;
const FRICTION_DECEL = 0.35;
const HOOK_ACCEL = 3.1;          // m/s^2 of lateral break at full grip
const DT = 1 / 120;

/**
 * Simulate one full roll deterministically: same power/aim/curve/standing
 * always produces the same path and the same pins knocked.
 *
 * @param {number} power  0..1 swing strength.
 * @param {number} aim    Radians off the centre line at release.
 * @param {number} curve  -1..1 hook direction/strength (wrist snap).
 * @param {Iterable<number>} standing  Pin ids currently standing.
 */
export function simulateRoll({ power, aim = 0, curve = 0, standing }) {
  const p = Math.max(0.16, Math.min(1, power));
  const c = Math.max(-1, Math.min(1, curve));
  const speed = BASE_SPEED * (MIN_SPEED_FACTOR + (1 - MIN_SPEED_FACTOR) * p);

  let x = 0;
  let z = FOUL_Z;
  let vx = Math.sin(aim) * speed;
  let vz = -Math.cos(aim) * speed;
  const path = [{ x, z }];

  const stillStanding = new Set(standing);
  const rows = [...PIN_LAYOUT].sort((a, b) => b.z - a.z); // nearest (pin 1) first
  let nextRow = 0;
  const knocked = [];
  let gutter = false;
  let died = false;
  let t = 0;
  let entryX = null; // lateral position where the ball first reaches the deck

  while (t < 6) {
    const grip = oilFactor(z);
    const speedNow = Math.hypot(vx, vz);
    if (speedNow > 0.05) {
      const decel = FRICTION_DECEL * (0.4 + 0.6 * grip) * DT;
      const scale = Math.max(0, (speedNow - decel) / speedNow);
      vx *= scale;
      vz *= scale;
    }
    vx += c * HOOK_ACCEL * grip * DT; // hook grows as the ball grips near the pins
    x += vx * DT;
    z += vz * DT;
    t += DT;
    path.push({ x, z });

    if (Math.abs(x) > LANE_HALF_WIDTH) { gutter = true; break; }
    if (entryX === null && z <= PIN_DECK_Z) entryX = x;

    while (nextRow < rows.length && rows[nextRow].z >= z) {
      const pin = rows[nextRow];
      nextRow += 1;
      if (!stillStanding.has(pin.id)) continue;
      // Straight geometric contact: the ball is wide enough to clip a pin
      // whose centre falls within one ball-plus-pin radius of its path.
      const reach = BALL_RADIUS + PIN_RADIUS;
      if (Math.abs(x - pin.x) < reach) {
        stillStanding.delete(pin.id);
        knocked.push(pin.id);
      }
    }

    if (nextRow >= rows.length) break; // passed the whole deck
    if (Math.hypot(vx, vz) < 0.12 && z > PIN_DECK_Z) { died = true; break; }
  }

  // Whether a strike is even possible comes down to the pocket, not raw
  // power: pins 1&3 (or 1&2) leave a gap a well-thrown ball slips into,
  // driving it sideways through the rack. Hitting flush on pin 1 instead
  // splits the force evenly and the corner pins are left standing — the
  // classic "big four" leave. Distance from that gap sets how well this
  // shot's knocked pins carry into their neighbours.
  const pocketGap = PIN_SPACING / 4;
  const pocketDist = entryX == null ? Infinity
    : Math.min(Math.abs(entryX - pocketGap), Math.abs(entryX + pocketGap));
  const pocketQuality = Math.max(0, 1 - pocketDist / (pocketGap * 1.35));

  if (!gutter && knocked.length > 0 && p > 0.3 && pocketQuality > 0) {
    let changed = true;
    let guard = 0;
    let chainPower = p * pocketQuality;
    while (changed && guard < 8) {
      changed = false;
      guard += 1;
      for (const id of [...knocked]) {
        for (const n of ADJACENCY[id] ?? []) {
          if (stillStanding.has(n) && chainPower > 0.16) {
            stillStanding.delete(n);
            knocked.push(n);
            changed = true;
          }
        }
      }
      chainPower -= 0.24;
    }
  }

  return {
    knocked: gutter ? [] : knocked,
    standing: gutter ? [...standing] : [...stillStanding],
    pins: gutter ? 0 : knocked.length,
    gutter,
    died,
    path,
  };
}

/** Is the 10th frame finished, given only its own rolls? */
export function isTenthFrameOver(rolls) {
  if (rolls.length < 2) return false;
  if (rolls.length >= 3) return true;
  return !(rolls[0] === 10 || rolls[0] + rolls[1] === 10);
}

/**
 * Standard 10-frame scoring: strikes get the next two balls, spares get the
 * next one, open frames just sum. Frames that can't be scored yet (still
 * waiting on bonus balls) come back as null.
 */
export function scoreFrames(frames) {
  const flat = frames.flatMap((f) => f.rolls);
  const frameScores = [];
  let idx = 0;

  for (let f = 0; f < frames.length; f += 1) {
    const rolls = frames[f].rolls;
    if (rolls.length === 0) { frameScores.push(null); continue; }

    if (f < MAX_FRAME - 1) {
      if (rolls[0] === 10) {
        const bonus = flat.slice(idx + 1, idx + 3);
        frameScores.push(bonus.length < 2 ? null : 10 + bonus[0] + bonus[1]);
        idx += 1;
      } else if (rolls.length === 2 && rolls[0] + rolls[1] === 10) {
        const bonus = flat.slice(idx + 2, idx + 3);
        frameScores.push(bonus.length < 1 ? null : 10 + bonus[0]);
        idx += 2;
      } else if (rolls.length === 2) {
        frameScores.push(rolls[0] + rolls[1]);
        idx += 2;
      } else {
        frameScores.push(null);
        idx += 1;
      }
    } else {
      frameScores.push(isTenthFrameOver(rolls) ? rolls.reduce((a, b) => a + b, 0) : null);
      idx += rolls.length;
    }
  }

  let total = 0;
  let lastKnown = 0;
  const cumulative = frameScores.map((s) => {
    if (s == null) return null;
    total += s;
    lastKnown = total;
    return total;
  });
  return { frameScores, cumulative, total: lastKnown };
}

/** One lane, one shared frame clock, up to 4 players bowling in turn. */
export class Game {
  constructor({ players = 1, onEvent = () => {} } = {}) {
    this.onEvent = onEvent;
    const n = Math.max(1, Math.min(4, Math.round(players)));
    this.players = Array.from({ length: n }, (_, i) => ({
      id: i,
      frames: Array.from({ length: MAX_FRAME }, () => ({ rolls: [] })),
    }));
    this.turn = { frame: 0, player: 0 };
    this.standing = freshRack();
    this.state = 'aim';   // aim | rolling | game-over
    this.lastResult = null;
    this.ball = { x: 0, z: FOUL_Z, pathT: 0 };
  }

  get playerCount() { return this.players.length; }
  get activePlayer() { return this.players[this.turn.player]; }
  get activeFrame() { return this.activePlayer.frames[this.turn.frame]; }

  /** Does the next ball face a full, fresh rack of 10? */
  isFreshRack() {
    const rolls = this.activeFrame.rolls;
    if (this.turn.frame < MAX_FRAME - 1) return rolls.length === 0;
    if (rolls.length === 0) return true;
    if (rolls.length === 1) return rolls[0] === 10;
    if (rolls.length === 2) return rolls[0] === 10 ? rolls[1] === 10 : rolls[0] + rolls[1] === 10;
    return false;
  }

  roll({ power, aim = 0, curve = 0 }) {
    if (this.state !== 'aim') return null;
    if (this.isFreshRack()) this.standing = freshRack();
    const result = simulateRoll({ power, aim, curve, standing: this.standing });
    this.lastResult = result; // pins are only committed to `standing` on settle
    this.ball = { x: 0, z: FOUL_Z, pathT: 0 };
    this.state = 'rolling';
    this.onEvent({
      type: 'released', player: this.turn.player, frame: this.turn.frame,
      gutter: result.gutter, aim, power,
    });
    return this.lastResult;
  }

  /** Advance the ball animation along the recorded path. */
  update(now, dt) {
    if (this.state !== 'rolling') return;
    const path = this.lastResult.path;
    this.ball.pathT += dt * 110;
    const i = Math.min(path.length - 1, Math.floor(this.ball.pathT));
    this.ball.x = path[i].x;
    this.ball.z = path[i].z;
    if (i >= path.length - 1) this._settle();
  }

  _settle() {
    const before = this.standing.size;
    this.standing = new Set(this.lastResult.standing);
    const pins = this.lastResult.gutter ? 0 : before - this.standing.size;
    const { gutter } = this.lastResult;
    const frameRolls = this.activeFrame.rolls;
    frameRolls.push(pins);
    const tenth = this.turn.frame === MAX_FRAME - 1;
    const over = tenth ? isTenthFrameOver(frameRolls) : (frameRolls[0] === 10 || frameRolls.length === 2);

    this.onEvent({
      type: 'pins', pins, gutter, over,
      player: this.turn.player, frame: this.turn.frame, rolls: [...frameRolls],
    });

    if (over) {
      const { frameScores, cumulative } = scoreFrames(this.activePlayer.frames);
      this.onEvent({
        type: 'frame-done', player: this.turn.player, frame: this.turn.frame,
        frameScore: frameScores[this.turn.frame], total: cumulative[this.turn.frame],
      });
      this._advanceTurn();
    } else {
      this.state = 'aim';
    }
  }

  _advanceTurn() {
    this.standing = freshRack();
    const nextPlayer = this.turn.player + 1;
    if (nextPlayer < this.playerCount) {
      this.turn.player = nextPlayer;
      this.state = 'aim';
    } else if (this.turn.frame < MAX_FRAME - 1) {
      this.turn = { frame: this.turn.frame + 1, player: 0 };
      this.state = 'aim';
    } else {
      this.state = 'game-over';
      const standings = this.players.map((pl) => scoreFrames(pl.frames).total);
      this.onEvent({ type: 'game-over', standings });
    }
  }

  standings() {
    return this.players.map((pl) => scoreFrames(pl.frames));
  }
}
