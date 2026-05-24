import { GameState, ShotInput, BallGroup, Ball, applyShot, simulateShot } from "../../../shared/src";
import { TABLE } from "../../../shared/src/constants";

export type AIDifficulty = "easy" | "medium" | "hard" | "pro";

/**
 * Per-difficulty knobs:
 *   - searchTopN: how many candidate shots to verify with real physics simulation.
 *     Higher = AI considers more options and finds harder potting solutions.
 *   - aimNoise / powerNoise: human-like error applied AFTER the perfect shot is
 *     selected. Easy AI knows the right answer but still misses.
 *   - safetyMissChance: chance the AI gives up on potting and plays a defensive
 *     bump shot (only meaningful at low difficulty).
 */
const DIFF: Record<AIDifficulty, {
  searchTopN: number;
  aimNoise: number;
  powerNoise: number;
  safetyMissChance: number;
}> = {
  easy:   { searchTopN: 3,  aimNoise: 0.085, powerNoise: 0.18, safetyMissChance: 0.25 },
  medium: { searchTopN: 6,  aimNoise: 0.035, powerNoise: 0.10, safetyMissChance: 0.08 },
  hard:   { searchTopN: 10, aimNoise: 0.012, powerNoise: 0.05, safetyMissChance: 0.00 },
  pro:    { searchTopN: 16, aimNoise: 0.004, powerNoise: 0.02, safetyMissChance: 0.00 },
};

interface Candidate {
  ballId: number;
  angle: number;
  power: number;
  score: number;
}

/** Deep-clone state so simulation never mutates the live game. */
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

/**
 * Generate (target ball, pocket) candidates with geometric scoring and
 * obstruction filtering. Output is sorted by score descending.
 */
function buildCandidates(state: GameState, seat: 0 | 1): Candidate[] {
  const cue = state.balls[0];
  const myGroup: BallGroup | null = state.groups[seat];
  const remainingMine = state.balls.filter(b =>
    !b.pocketed && (myGroup ? b.group === myGroup : (b.group === "solid" || b.group === "stripe")));
  const targets: Ball[] = remainingMine.length > 0
    ? remainingMine
    : state.balls.filter(b => !b.pocketed && b.id === 8);

  const out: Candidate[] = [];
  for (const ball of targets) {
    for (const pocket of TABLE.pockets) {
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

      // Obstruction: cue -> ghost
      let blocked = false;
      for (const o of state.balls) {
        if (o.pocketed || o === ball || o.id === 0) continue;
        const ox = o.pos.x - cue.pos.x;
        const oy = o.pos.y - cue.pos.y;
        const t = (ox * dx + oy * dy) / (dist * dist);
        if (t <= 0 || t >= 1) continue;
        const cx = cue.pos.x + dx * t;
        const cy = cue.pos.y + dy * t;
        if (Math.hypot(o.pos.x - cx, o.pos.y - cy) < o.radius + cue.radius * 0.95) {
          blocked = true; break;
        }
      }
      if (blocked) continue;

      // Obstruction: ball -> pocket
      let blocked2 = false;
      for (const o of state.balls) {
        if (o.pocketed || o === ball || o.id === 0) continue;
        const ox = o.pos.x - ball.pos.x;
        const oy = o.pos.y - ball.pos.y;
        const t = (ox * px + oy * py) / (pl * pl);
        if (t <= 0 || t >= 1) continue;
        const cx = ball.pos.x + px * t;
        const cy = ball.pos.y + py * t;
        if (Math.hypot(o.pos.x - cx, o.pos.y - cy) < o.radius + ball.radius * 0.95) {
          blocked2 = true; break;
        }
      }
      if (blocked2) continue;

      const cutAngle = Math.acos(Math.max(-1, Math.min(1, (-ux * dx - uy * dy) / dist)));
      const score = (1 / (1 + dist * 0.01)) * (1 - cutAngle / Math.PI) * (1 / (1 + pl * 0.005));
      const power = Math.max(0.4, Math.min(1, 0.45 + (dist + pl) / 320 + cutAngle * 0.25));
      out.push({ ballId: ball.id, angle, power, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Verify a candidate by simulating it on a clone. Returns true if the target
 * ball is pocketed and the cue ball is not scratched (and 8 is not pocketed
 * unless it's the legal winning shot).
 */
function simulateVerify(state: GameState, cand: Candidate, isOn8: boolean): boolean {
  const clone = cloneState(state);
  applyShot(clone, { angle: cand.angle, power: cand.power, spinX: 0, spinY: 0 });
  const events = simulateShot(clone);
  if (clone.balls[0].pocketed) return false;
  if (!events.pocketed.includes(cand.ballId)) return false;
  if (!isOn8 && events.pocketed.includes(8)) return false;
  return true;
}

/**
 * Defensive "safety" shot: lightly tap the nearest target ball so the opponent
 * inherits a tough leave. Used by easy AI to mimic giving up on hard layouts.
 */
function safetyShot(state: GameState, seat: 0 | 1): ShotInput {
  const cue = state.balls[0];
  const myGroup: BallGroup | null = state.groups[seat];
  const remaining = state.balls.filter(b =>
    !b.pocketed && b.id !== 0 && (myGroup ? b.group === myGroup : b.id !== 8));
  const target = remaining.length > 0 ? remaining[0] : state.balls.find(b => !b.pocketed && b.id === 8);
  if (!target) return { angle: 0, power: 0.3, spinX: 0, spinY: 0 };
  const dx = target.pos.x - cue.pos.x;
  const dy = target.pos.y - cue.pos.y;
  return { angle: Math.atan2(dy, dx), power: 0.32, spinX: 0, spinY: 0 };
}

/**
 * Plan a shot for the AI using simulation-verified candidates.
 *
 *  1. Build geometrically viable candidates (target, pocket).
 *  2. For the top N (per difficulty), verify with a real physics simulation.
 *  3. Pick the first one that legally pockets the target.
 *  4. Add human-like aim/power noise based on difficulty.
 *  5. Easy AI may instead opt for a defensive safety shot.
 */
export function planAIShot(state: GameState, seat: 0 | 1, difficulty: AIDifficulty): ShotInput {
  const cfg = DIFF[difficulty];
  const candidates = buildCandidates(state, seat);

  // Decide if this AI plays safe instead of attempting a pot.
  if (cfg.safetyMissChance > 0 && Math.random() < cfg.safetyMissChance) {
    return safetyShot(state, seat);
  }

  // No candidates at all (all blocked / no targets) -> safety.
  if (candidates.length === 0) {
    return safetyShot(state, seat);
  }

  const myGroup = state.groups[seat];
  const isOn8 = !!myGroup && !state.balls.some(b => b.group === myGroup && !b.pocketed);

  // Find a verified perfect shot among the top N candidates.
  let chosen: Candidate | null = null;
  const limit = Math.min(cfg.searchTopN, candidates.length);
  for (let i = 0; i < limit; i++) {
    if (simulateVerify(state, candidates[i], isOn8)) {
      chosen = candidates[i];
      break;
    }
  }
  // Fallback to the highest-scored geometric candidate.
  if (!chosen) chosen = candidates[0];

  // Inject human-like error AFTER picking the ideal shot.
  const angle = chosen.angle + (Math.random() - 0.5) * 2 * cfg.aimNoise;
  const power = Math.max(0.25, Math.min(1, chosen.power + (Math.random() - 0.5) * 2 * cfg.powerNoise));
  return { angle, power, spinX: 0, spinY: 0 };
}

export function aiPlaceCue(state: GameState): { x: number; y: number } {
  // simplest: head spot, nudged if blocked
  let x = TABLE.width * 0.25;
  let y = TABLE.height / 2;
  for (let i = 0; i < 20; i++) {
    let blocked = false;
    for (const b of state.balls) {
      if (b.id === 0 || b.pocketed) continue;
      const dx = b.pos.x - x, dy = b.pos.y - y;
      if (dx * dx + dy * dy < (b.radius * 2.2) ** 2) { blocked = true; break; }
    }
    if (!blocked) return { x, y };
    x += 6;
  }
  return { x, y };
}
