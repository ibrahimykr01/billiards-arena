import { GameState, ShotInput, BallGroup, Vec2 } from "./types";
import { TABLE } from "./constants";
import { applyShot, simulateShot, allStopped, step } from "./physics";

/**
 * Cheat helpers (client-side):
 *  - simulateCueTrajectory: runs the shared physics on a cloned state and
 *    returns the cue-ball path as polyline points, so the UI can draw an
 *    accurate preview of where the cue ball will go (including bounces).
 *  - planPerfectShot: brute-force search over candidate (ball, pocket, power,
 *    angle) tuples using real simulation to find a shot that legally pockets
 *    one of the shooter's target balls with 100% certainty.
 */

function cloneState(state: GameState): GameState {
  return {
    ...state,
    balls: state.balls.map(b => ({
      ...b,
      pos: { x: b.pos.x, y: b.pos.y },
      vel: { x: b.vel.x, y: b.vel.y },
    })),
    groups: [...state.groups] as GameState["groups"],
  };
}

/** Seeded RNG that temporarily replaces Math.random for deterministic sims. */
function withSeededRandom<T>(seed: number, fn: () => T): T {
  const orig = Math.random;
  let s = seed >>> 0 || 1;
  Math.random = () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s & 0xffffffff) / 0x100000000;
  };
  try { return fn(); }
  finally { Math.random = orig; }
}

/**
 * Per-ball trajectory produced by simulating the shot on a clone.
 *  - points: sampled positions in chronological order (≈120Hz)
 *  - pocketed: true if this ball ended up in a pocket at the end of the shot
 *  - moved: true if the ball actually traveled (so the caller can skip
 *    drawing stationary balls)
 */
export interface BallTrajectory {
  id: number;
  group: GameState["balls"][number]["group"];
  points: Vec2[];
  pocketed: boolean;
  moved: boolean;
}

/**
 * Simulate the shot on a clone and return per-ball position trails sampled
 * at ~120Hz. Stops when all balls settle. Used by cheat overlay to draw the
 * full predicted future of every ball on the table.
 */
export function simulateAllTrajectories(state: GameState, shot: ShotInput): BallTrajectory[] {
  if (state.shotInProgress || state.winner !== null) return [];
  const clone = cloneState(state);
  return withSeededRandom(1337, () => {
    applyShot(clone, shot);
    const trails: BallTrajectory[] = clone.balls.map(b => ({
      id: b.id,
      group: b.group,
      points: [{ x: b.pos.x, y: b.pos.y }],
      pocketed: b.pocketed,
      moved: false,
    }));
    const DT = 1 / 120;
    const MAX_STEPS = 1200; // ~10s of game time
    let safety = 0;
    while (!allStopped(clone.balls) && safety < MAX_STEPS) {
      step(clone, DT, TABLE);
      for (let i = 0; i < clone.balls.length; i++) {
        const b = clone.balls[i];
        const trail = trails[i];
        if (b.pocketed && trail.pocketed) continue; // already finalized
        const last = trail.points[trail.points.length - 1];
        const dx = b.pos.x - last.x;
        const dy = b.pos.y - last.y;
        if (dx * dx + dy * dy > 0.04) {
          trail.points.push({ x: b.pos.x, y: b.pos.y });
          trail.moved = true;
        }
        if (b.pocketed) trail.pocketed = true;
      }
      safety++;
    }
    return trails;
  });
}

/**
 * Backward-compatible helper: returns only the cue ball's trail.
 */
export function simulateCueTrajectory(state: GameState, shot: ShotInput): Vec2[] {
  const all = simulateAllTrajectories(state, shot);
  const cue = all.find(t => t.id === 0);
  return cue ? cue.points : [];
}

interface Candidate {
  ballId: number;
  pocketIdx: number;
  angle: number;
  power: number;
  score: number;
}

function buildCandidates(state: GameState, seat: 0 | 1): Candidate[] {
  const cue = state.balls[0];
  const myGroup: BallGroup | null = state.groups[seat];
  const targets = state.balls.filter(b => {
    if (b.pocketed || b.id === 0) return false;
    if (myGroup) {
      const remainingMine = state.balls.some(x => x.group === myGroup && !x.pocketed);
      if (remainingMine) return b.group === myGroup;
      return b.id === 8;
    }
    // table open: anything but 8
    return b.id !== 8;
  });
  const candidates: Candidate[] = [];

  for (const ball of targets) {
    for (let p = 0; p < TABLE.pockets.length; p++) {
      const pocket = TABLE.pockets[p];
      const px = pocket.pos.x - ball.pos.x;
      const py = pocket.pos.y - ball.pos.y;
      const pl = Math.hypot(px, py) || 1;
      const ux = px / pl, uy = py / pl;
      const ghost = { x: ball.pos.x - ux * (ball.radius * 2), y: ball.pos.y - uy * (ball.radius * 2) };
      const dx = ghost.x - cue.pos.x;
      const dy = ghost.y - cue.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) continue;
      const angle = Math.atan2(dy, dx);

      // obstruction check: cue->ghost path
      let blocked = false;
      for (const o of state.balls) {
        if (o.pocketed || o === ball || o.id === 0) continue;
        const oxv = o.pos.x - cue.pos.x;
        const oyv = o.pos.y - cue.pos.y;
        const t = (oxv * dx + oyv * dy) / (dist * dist);
        if (t <= 0 || t >= 1) continue;
        const cx = cue.pos.x + dx * t;
        const cy = cue.pos.y + dy * t;
        const distLine = Math.hypot(o.pos.x - cx, o.pos.y - cy);
        if (distLine < o.radius + cue.radius * 0.95) { blocked = true; break; }
      }
      if (blocked) continue;

      // obstruction check: ball->pocket path
      let blocked2 = false;
      for (const o of state.balls) {
        if (o.pocketed || o === ball || o.id === 0) continue;
        const oxv = o.pos.x - ball.pos.x;
        const oyv = o.pos.y - ball.pos.y;
        const t = (oxv * px + oyv * py) / (pl * pl);
        if (t <= 0 || t >= 1) continue;
        const cx = ball.pos.x + px * t;
        const cy = ball.pos.y + py * t;
        const distLine = Math.hypot(o.pos.x - cx, o.pos.y - cy);
        if (distLine < o.radius + ball.radius * 0.95) { blocked2 = true; break; }
      }
      if (blocked2) continue;

      const cutAngle = Math.acos(Math.max(-1, Math.min(1, (-ux * dx - uy * dy) / dist)));
      const score = (1 / (1 + dist * 0.01)) * (1 - cutAngle / Math.PI) * (1 / (1 + pl * 0.005));
      // power scaled to the actual energy needed to reach pocket through ball
      const power = Math.max(0.4, Math.min(1, 0.45 + (dist + pl) / 320 + cutAngle * 0.25));

      candidates.push({ ballId: ball.id, pocketIdx: p, angle, power, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Find a shot that legally pockets a target ball with certainty by simulating
 * candidates with the real physics engine. Returns the first candidate whose
 * simulation pockets the target without scratching. Falls back to the highest-
 * scoring geometric shot if simulation never confirms.
 */
export function planPerfectShot(state: GameState, seat: 0 | 1): ShotInput {
  const candidates = buildCandidates(state, seat);
  // small angle perturbations + power tweaks to test
  const angleOffsets = [0, -0.004, 0.004, -0.008, 0.008];
  const powerScales = [1.0, 0.85, 1.1];
  let fallback: ShotInput | null = null;

  for (const cand of candidates) {
    if (!fallback) {
      fallback = { angle: cand.angle, power: cand.power, spinX: 0, spinY: 0 };
    }
    for (const dp of powerScales) {
      const power = Math.max(0.3, Math.min(1, cand.power * dp));
      for (const da of angleOffsets) {
        const angle = cand.angle + da;
        const ok = withSeededRandom(0xC0FFEE, () => {
          const clone = cloneState(state);
          applyShot(clone, { angle, power, spinX: 0, spinY: 0 });
          const events = simulateShot(clone);
          const cuePocketed = clone.balls[0].pocketed;
          if (cuePocketed) return false;
          if (!events.pocketed.includes(cand.ballId)) return false;
          // Don't pocket the 8 prematurely
          if (cand.ballId !== 8 && events.pocketed.includes(8)) return false;
          return true;
        });
        if (ok) return { angle, power, spinX: 0, spinY: 0 };
      }
    }
    // cap the search at top-N to avoid huge latency
    if (candidates.indexOf(cand) >= 6) break;
  }
  return fallback ?? { angle: 0, power: 0.5, spinX: 0, spinY: 0 };
}
