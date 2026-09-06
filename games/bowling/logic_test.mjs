import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, simulateRoll, scoreFrames, isTenthFrameOver, freshRack,
  oilFactor, LANE_LENGTH, PIN_LAYOUT, MAX_FRAME,
} from './logic.js';

// A dead-straight, full-power roll that lands in the pocket — used across
// tests as a reliable strike ball.
const STRIKE = { power: 1, aim: 0, curve: 0 };

function bowl(game, shot = STRIKE) {
  game.roll(shot);
  let guard = 0;
  while (game.state === 'rolling' && guard < 20000) {
    game.update(0, 1 / 60);
    guard += 1;
  }
}

test('the oil pattern and pin deck are deterministic', () => {
  assert.equal(oilFactor(-5), oilFactor(-5));
  for (let z = 0; z > -LANE_LENGTH; z -= 1) {
    const o = oilFactor(z);
    assert.ok(o >= 0 && o <= 1, `oilFactor(${z}) = ${o} stays in range`);
  }
  assert.equal(PIN_LAYOUT.length, 10);
  assert.equal(new Set(PIN_LAYOUT.map((p) => p.id)).size, 10);
});

test('a dead-centre hit splits the rack instead of guaranteeing a strike', () => {
  // Regression check: pin 1 head-on is the classic "big four" leave — the
  // ball must not just plow through the whole deck by brute force.
  const r = simulateRoll({ power: 1, aim: 0.009, curve: 0, standing: freshRack() });
  assert.ok(r.pins < 10, 'an imprecise line does not accidentally strike');
});

test('a well-placed roll can strike, and the pins are removed from freshRack', () => {
  const r = simulateRoll({ power: 1, aim: 0, curve: 0, standing: freshRack() });
  assert.equal(r.pins, 10);
  assert.equal(r.standing.length, 0);
});

test('aiming well outside the boards is a gutter ball — zero pins, nothing disturbed', () => {
  const r = simulateRoll({ power: 1, aim: 0.15, curve: 0, standing: freshRack() });
  assert.ok(r.gutter);
  assert.equal(r.pins, 0);
  assert.equal(r.standing.length, 10);
});

test('simulateRoll is deterministic for identical inputs', () => {
  const a = simulateRoll({ power: 0.7, aim: 0.01, curve: -0.3, standing: freshRack() });
  const b = simulateRoll({ power: 0.7, aim: 0.01, curve: -0.3, standing: freshRack() });
  assert.deepEqual(a.knocked, b.knocked);
  assert.deepEqual(a.standing, b.standing);
});

test('a leave can be picked up for a spare', () => {
  const standing = new Set([10]);
  let picked = false;
  for (let aim = -0.05; aim <= 0.05 && !picked; aim += 0.002) {
    const r = simulateRoll({ power: 0.8, aim, curve: 0, standing });
    if (r.pins === 1) picked = true;
  }
  assert.ok(picked, 'pin 10 alone is a makeable spare attempt');
});

test('frame scoring: an open frame is just the sum of its two rolls', () => {
  const frames = [{ rolls: [4, 3] }];
  const { frameScores } = scoreFrames(frames);
  assert.equal(frameScores[0], 7);
});

test('frame scoring: a spare gets the next roll as a bonus', () => {
  const frames = [{ rolls: [7, 3] }, { rolls: [4, 2] }];
  const { frameScores, cumulative } = scoreFrames(frames);
  assert.equal(frameScores[0], 10 + 4);
  assert.equal(cumulative[1], 14 + 6);
});

test('frame scoring: a strike gets the next two balls as a bonus, across frames', () => {
  const frames = [{ rolls: [10] }, { rolls: [3, 4] }];
  const { frameScores } = scoreFrames(frames);
  assert.equal(frameScores[0], 10 + 3 + 4);
  assert.equal(frameScores[1], 7);
});

test('frame scoring: incomplete bonus data reports null, not a guess', () => {
  const frames = [{ rolls: [10] }];
  const { frameScores, total } = scoreFrames(frames);
  assert.equal(frameScores[0], null);
  assert.equal(total, 0);
});

test('the 10th frame gives two bonus balls after a strike, one after a spare, none otherwise', () => {
  assert.equal(isTenthFrameOver([10]), false);
  assert.equal(isTenthFrameOver([10, 5]), false);
  assert.equal(isTenthFrameOver([10, 5, 3]), true);
  assert.equal(isTenthFrameOver([7, 3]), false); // spare -> one more ball
  assert.equal(isTenthFrameOver([7, 3, 9]), true);
  assert.equal(isTenthFrameOver([4, 3]), true); // open -> frame over at 2
});

test('a perfect game of twelve strikes scores 300', () => {
  const game = new Game({ players: 1 });
  let guard = 0;
  while (game.state !== 'game-over' && guard < 30) {
    guard += 1;
    bowl(game, STRIKE);
  }
  assert.equal(game.state, 'game-over');
  const [result] = game.standings();
  assert.equal(result.total, 300);
  assert.ok(result.frameScores.every((s) => s === 30));
});

test('an all-gutter game scores zero', () => {
  const game = new Game({ players: 1 });
  let guard = 0;
  while (game.state !== 'game-over' && guard < 40) {
    guard += 1;
    bowl(game, { power: 1, aim: 0.15, curve: 0 });
  }
  const [result] = game.standings();
  assert.equal(result.total, 0);
});

test('a full game is completable and strokes/rolls stay within real bowling limits', () => {
  const game = new Game({ players: 1 });
  let rolls = 0;
  let guard = 0;
  while (game.state !== 'game-over' && guard < 40) {
    guard += 1;
    // Play a mixed game: try to strike, otherwise take whatever the pocket gives.
    game.roll({ power: 1, aim: guard % 3 === 0 ? 0.02 : 0, curve: 0 });
    rolls += 1;
    while (game.state === 'rolling') game.update(0, 1 / 60);
  }
  assert.equal(game.state, 'game-over');
  assert.ok(rolls <= 21, `a 10-frame game never needs more than 21 balls (used ${rolls})`);
  const [result] = game.standings();
  assert.equal(result.total, result.cumulative[MAX_FRAME - 1]);
});

test('up to four players bowl the same frame in turn before it advances', () => {
  const game = new Game({ players: 4 });
  assert.equal(game.turn.player, 0);
  assert.equal(game.turn.frame, 0);
  bowl(game, { power: 1, aim: 0.15, curve: 0 }); // gutter -> roll 1 of frame 0
  assert.equal(game.turn.player, 0);
  bowl(game, { power: 1, aim: 0.15, curve: 0 }); // gutter -> roll 2, frame over
  assert.equal(game.turn.player, 1, 'turn passes to player 2 after player 1 finishes the frame');
  assert.equal(game.turn.frame, 0);
});

test('a strike ends a player\'s frame immediately and passes the turn', () => {
  const game = new Game({ players: 2 });
  bowl(game, STRIKE);
  assert.equal(game.turn.player, 1, 'player 1 struck, so it is already player 2\'s turn');
  assert.equal(game.turn.frame, 0);
});

test('rejects a roll while the ball is still live', () => {
  const game = new Game({ players: 1 });
  game.roll(STRIKE);
  const rejected = game.roll(STRIKE);
  assert.equal(rejected, null);
});

test('player count is clamped to the 1-4 range', () => {
  assert.equal(new Game({ players: 0 }).playerCount, 1);
  assert.equal(new Game({ players: 4 }).playerCount, 4);
  assert.equal(new Game({ players: 9 }).playerCount, 4);
});
