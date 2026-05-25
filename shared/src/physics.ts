import * as Matter from "matter-js";
import {
  Ball,
  GameState,
  ShotInput,
  Vec2,
  TableSpec,
} from "./types";
import {
  BALL_RADIUS,
  BALL_RESTITUTION,
  CUSHION_RESTITUTION,
  FIXED_DT,
  HEAD_SPOT,
  FOOT_SPOT,
  MAX_SHOT_SPEED,
  MAX_SUBSTEPS,
  ROLLING_FRICTION,
  SLIDING_FRICTION,
  SPIN_FRICTION,
  STOP_THRESHOLD,
  TABLE,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from "./constants";

// ---------- vector helpers ----------
export const v = {
  add: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y }),
  mul: (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s }),
  dot: (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y,
  len: (a: Vec2): number => Math.hypot(a.x, a.y),
  norm: (a: Vec2): Vec2 => {
    const l = Math.hypot(a.x, a.y) || 1;
    return { x: a.x / l, y: a.y / l };
  },
};

// ---------- initial rack ----------
export function createInitialBalls(): Ball[] {
  const balls: Ball[] = [];
  // cue ball at head spot
  balls.push({
    id: 0,
    group: "cue",
    pos: { ...HEAD_SPOT },
    vel: { x: 0, y: 0 },
    spin: 0,
    side: 0,
    pocketed: false,
    radius: BALL_RADIUS,
  });

  // rack at foot spot - triangle of 15
  // standard 8-ball rack: row1 1ball, row2 alternating, 8 in middle of row3
  // For correctness we place: apex(1), row2 random solid/stripe, center 8, others alternated
  const rackOrder = [1, 11, 2, 8, 10, 3, 14, 7, 12, 13, 4, 5, 6, 15, 9];
  const r = BALL_RADIUS;
  const dx = r * Math.sqrt(3) * 1.001;
  const dy = r * 1.001;
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const id = rackOrder[idx++];
      const x = FOOT_SPOT.x + row * dx;
      const y = FOOT_SPOT.y - row * dy + col * dy * 2;
      balls.push({
        id,
        group: id === 8 ? "eight" : id < 8 ? "solid" : "stripe",
        pos: { x, y },
        vel: { x: 0, y: 0 },
        spin: 0,
        side: 0,
        pocketed: false,
        radius: BALL_RADIUS,
      });
    }
  }
  // sort by id for stability
  balls.sort((a, b) => a.id - b.id);
  return balls;
}

// ---------- shot application ----------
export function applyShot(state: GameState, shot: ShotInput): void {
  const cue = state.balls[0];
  if (cue.pocketed) return;
  const power = Math.max(0, Math.min(1, shot.power));
  // Quadratic power curve: 50% drag → 25% speed, 80% drag → 64% speed.
  // This matches the real feel of a cue — gentle taps are much softer,
  // and you need to really commit to get a hard shot.
  const speed = power * power * MAX_SHOT_SPEED;
  const dir: Vec2 = { x: Math.cos(shot.angle), y: Math.sin(shot.angle) };
  cue.vel.x = dir.x * speed;
  cue.vel.y = dir.y * speed;
  // english (spin) - simplified scalar models
  cue.spin = Math.max(-1, Math.min(1, shot.spinY)) * power;       // top/back
  cue.side = Math.max(-1, Math.min(1, shot.spinX)) * power;       // side
  state.shotInProgress = true;
  state.frame++;
}

// ---------- step simulation until balls stop ----------
export interface ShotEvents {
  pocketed: number[];           // ball ids
  firstHitId: number | null;    // first ball cue contacted
  cushionHits: number;
  ballHits: number;
  cueOffTable: boolean;
}

export interface ShotFrame {
  t: number;                    // seconds since shot started
  balls: { id: number; x: number; y: number; pocketed: boolean }[];
}

export interface ShotSoundEvent {
  t: number;                    // seconds since shot start
  type: "ball" | "cushion" | "pocket";
  strength: number;             // 0..1
  ids?: number[];
}

export interface ShotRecording {
  events: ShotEvents;
  frames: ShotFrame[];
  sounds: ShotSoundEvent[];
  duration: number;             // seconds
}

interface Recorder {
  onBallHit?: (strength: number, idA: number, idB: number) => void;
  onCushion?: (strength: number, id: number) => void;
  onPocket?: (id: number) => void;
}

export function simulateShot(state: GameState, table: TableSpec = TABLE): ShotEvents {
  const events: ShotEvents = {
    pocketed: [], firstHitId: null, cushionHits: 0, ballHits: 0, cueOffTable: false,
  };
  let safety = 0;
  while (!allStopped(state.balls) && safety < 60_000) {
    stepFixed(state, table, FIXED_DT, events);
    safety++;
  }
  for (const b of state.balls) if (v.len(b.vel) < STOP_THRESHOLD) b.vel = { x: 0, y: 0 };
  state.shotInProgress = false;
  return events;
}

/**
 * Matter.js-backed shot recording.
 *
 * Ball–ball collision resolution is delegated to Matter.js (10 position
 * iterations + 8 velocity iterations per step) which handles multi-ball chain
 * reactions far more accurately than a single-pass pairwise approach.
 *
 * Wall bounce, Coulomb friction, cue-ball spin effects, and pocket detection
 * remain as custom code so we keep exact control over restitution per surface,
 * the blended sliding/rolling deceleration model, and pocket entry geometry.
 *
 * IMPORTANT — velocity unit convention:
 *   Our physics model stores velocities in UNITS PER SECOND (ball.vel.x = 185
 *   means 185 table-units per second).  Matter.js body.velocity is in UNITS
 *   PER ENGINE-STEP (displacement added each Engine.update tick).  We convert
 *   at every boundary using toStep/toSec so the two worlds never mix.
 */
export function simulateShotRecording(state: GameState, table: TableSpec = TABLE): ShotRecording {
  // --- Velocity unit helpers ---
  const toStep = (vSec: number)  => vSec  * FIXED_DT;   // per-sec  → per-step
  const toSec  = (vStep: number) => vStep / FIXED_DT;   // per-step → per-sec

  // ---- Matter.js engine (zero gravity = top-down view) ----
  const engine = Matter.Engine.create({
    gravity: { x: 0, y: 0, scale: 0 },
    positionIterations: 10,
    velocityIterations: 8,
    constraintIterations: 2,
  });

  // ---- Create a dynamic circle body for every active ball ----
  const mBodies = new Map<number, Matter.Body>();
  const cueSpin = { spin: 0, side: 0 }; // managed separately; Matter.js has no spin model

  for (const ball of state.balls) {
    if (ball.pocketed) continue;
    const body = Matter.Bodies.circle(ball.pos.x, ball.pos.y, ball.radius, {
      restitution: BALL_RESTITUTION,
      friction: 0,
      frictionAir: 0,      // Coulomb deceleration applied manually each step
      frictionStatic: 0,
      density: 1,
      label: `ball:${ball.id}`,
    });
    // ball.vel is per-sec; Matter.js needs per-step
    Matter.Body.setVelocity(body, { x: toStep(ball.vel.x), y: toStep(ball.vel.y) });
    Matter.Composite.add(engine.world, body);
    mBodies.set(ball.id, body);
    if (ball.id === 0) { cueSpin.spin = ball.spin; cueSpin.side = ball.side; }
  }

  // ---- Sound + event tracking ----
  const events: ShotEvents = {
    pocketed: [], firstHitId: null, cushionHits: 0, ballHits: 0, cueOffTable: false,
  };
  const sounds: ShotSoundEvent[] = [];
  let firstHitDetected = false;
  // `t` is declared below but closures capture it by reference — OK.
  let t = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Matter.Events.on(engine, "collisionStart", (event: any) => {
    for (const pair of event.pairs as Matter.Pair[]) {
      const la = (pair.bodyA as Matter.Body & { label: string }).label;
      const lb = (pair.bodyB as Matter.Body & { label: string }).label;
      if (!la.startsWith("ball:") || !lb.startsWith("ball:")) continue;

      events.ballHits++;
      const idA = parseInt(la.split(":")[1], 10);
      const idB = parseInt(lb.split(":")[1], 10);

      // Ball-hit sound — relative speed (per-step → per-sec for normalisation)
      const relSpd = Math.hypot(
        pair.bodyA.velocity.x - pair.bodyB.velocity.x,
        pair.bodyA.velocity.y - pair.bodyB.velocity.y,
      );
      sounds.push({ t, type: "ball", strength: Math.min(1, toSec(relSpd) / 150), ids: [idA, idB] });

      if (!firstHitDetected && (idA === 0 || idB === 0)) {
        events.firstHitId = idA === 0 ? idB : idA;
        firstHitDetected = true;
      }

      // Top/back spin transfer: cue ball follows through or draws back after contact.
      if ((idA === 0 || idB === 0) && Math.abs(cueSpin.spin) > 0.01) {
        const cueBody = mBodies.get(0);
        if (cueBody) {
          const spd    = Math.hypot(cueBody.velocity.x, cueBody.velocity.y); // per-step
          const spdSec = toSec(spd);
          if (spdSec > 1) {
            // transfer in per-sec space, then convert to per-step delta
            const transferSec  = cueSpin.spin * spdSec * 0.55;
            const transferStep = toStep(transferSec);
            Matter.Body.setVelocity(cueBody, {
              x: cueBody.velocity.x + (cueBody.velocity.x / spd) * transferStep,
              y: cueBody.velocity.y + (cueBody.velocity.y / spd) * transferStep,
            });
            cueSpin.spin *= 0.35; // spin mostly consumed at contact
          }
        }
      }
    }
  });

  // ---- Helpers shared with custom wall/pocket code ----
  const inMouth = (coord: number, intervals: [number, number][]): boolean => {
    for (const [a, b] of intervals) if (coord >= a && coord <= b) return true;
    return false;
  };

  // ---- Simulation loop ----
  const pocketedIds = new Set<number>();
  const pocketedPositions = new Map<number, { x: number; y: number }>();
  const frames: ShotFrame[] = [];
  const STEP_MS    = FIXED_DT * 1000;
  const FRAME_EVERY = Math.max(1, Math.round((1 / 60) / FIXED_DT)); // ~4 steps per frame

  let stepIdx = 0, safety = 0;

  const captureFrame = () => {
    const ballArr: ShotFrame["balls"] = [];
    for (const ball of state.balls) {
      const body = mBodies.get(ball.id);
      if (body && !pocketedIds.has(ball.id)) {
        ballArr.push({ id: ball.id, x: body.position.x, y: body.position.y, pocketed: false });
      } else if (pocketedIds.has(ball.id)) {
        const pos = pocketedPositions.get(ball.id) ?? { x: ball.pos.x, y: ball.pos.y };
        ballArr.push({ id: ball.id, x: pos.x, y: pos.y, pocketed: true });
      } else {
        // Pre-existing pocketed ball — keep at its stored position
        ballArr.push({ id: ball.id, x: ball.pos.x, y: ball.pos.y, pocketed: true });
      }
    }
    frames.push({ t, balls: ballArr });
  };
  captureFrame();

  while (safety < 60_000) {
    // 1) Matter.js resolves ball–ball contacts with iterative constraint solving
    Matter.Engine.update(engine, STEP_MS);
    t += FIXED_DT;
    stepIdx++;
    safety++;

    // 2) Coulomb (blended sliding/rolling) friction applied manually to each body.
    //    All friction constants and blend thresholds are in UNITS/SEC, so we
    //    convert body.velocity (per-step) to per-sec, compute, then convert back.
    for (const [id, body] of mBodies) {
      if (pocketedIds.has(id)) continue;
      const vx = body.velocity.x, vy = body.velocity.y;   // per-step
      const speedStep = Math.hypot(vx, vy);
      if (speedStep > 0.00001) {
        const speedSec = toSec(speedStep);                 // per-sec
        const tt = Math.min(1, Math.max(0, (speedSec - 40) / 90));
        const blend = tt * tt * (3 - 2 * tt);             // smoothstep
        const decelSec = ROLLING_FRICTION * 320 + (SLIDING_FRICTION * 220 - ROLLING_FRICTION * 320) * blend;
        const newSpeedSec = Math.max(0, speedSec - decelSec * FIXED_DT);
        const k = newSpeedSec / speedSec;
        Matter.Body.setVelocity(body, { x: vx * k, y: vy * k });
      }

      // Side English: continuous Magnus-like lateral curve on the cue ball.
      // Acceleration = side * 30 units/sec²; convert to per-step velocity delta.
      if (id === 0 && Math.abs(cueSpin.side) > 0.001) {
        const vx2 = body.velocity.x, vy2 = body.velocity.y;
        const perp = { x: -vy2, y: vx2 };
        const pl   = Math.hypot(perp.x, perp.y) || 1;
        const accStep = cueSpin.side * 30 * FIXED_DT * FIXED_DT; // acc(u/s²) * dt² = Δv per-step
        Matter.Body.setVelocity(body, {
          x: vx2 + (perp.x / pl) * accStep,
          y: vy2 + (perp.y / pl) * accStep,
        });
        cueSpin.side *= Math.exp(-SPIN_FRICTION * FIXED_DT);
        cueSpin.spin *= Math.exp(-SPIN_FRICTION * FIXED_DT);
      }
    }

    // 3) Custom axis-aligned wall bounce — exact CUSHION_RESTITUTION control
    for (const [id, body] of mBodies) {
      if (pocketedIds.has(id)) continue;
      const r = BALL_RADIUS;
      let bounced = false;

      if (body.position.x - r < 0 && !inMouth(body.position.y, table.mouths.left)) {
        Matter.Body.setPosition(body, { x: r, y: body.position.y });
        Matter.Body.setVelocity(body, { x:  Math.abs(body.velocity.x) * table.cushionRestitution, y: body.velocity.y });
        bounced = true;
      } else if (body.position.x + r > table.width && !inMouth(body.position.y, table.mouths.right)) {
        Matter.Body.setPosition(body, { x: table.width - r, y: body.position.y });
        Matter.Body.setVelocity(body, { x: -Math.abs(body.velocity.x) * table.cushionRestitution, y: body.velocity.y });
        bounced = true;
      }
      if (body.position.y - r < 0 && !inMouth(body.position.x, table.mouths.top)) {
        Matter.Body.setPosition(body, { x: body.position.x, y: r });
        Matter.Body.setVelocity(body, { x: body.velocity.x, y:  Math.abs(body.velocity.y) * table.cushionRestitution });
        bounced = true;
      } else if (body.position.y + r > table.height && !inMouth(body.position.x, table.mouths.bottom)) {
        Matter.Body.setPosition(body, { x: body.position.x, y: table.height - r });
        Matter.Body.setVelocity(body, { x: body.velocity.x, y: -Math.abs(body.velocity.y) * table.cushionRestitution });
        bounced = true;
      }

      if (bounced) {
        events.cushionHits++;
        // Convert per-step speed to per-sec for consistent sound strength
        const spd = Math.hypot(body.velocity.x, body.velocity.y);
        sounds.push({ t, type: "cushion", strength: Math.min(1, toSec(spd) / 200), ids: [id] });
      }
    }

    // 4) Pocket detection
    for (const [id, body] of mBodies) {
      if (pocketedIds.has(id)) continue;
      for (const p of table.pockets) {
        const dx = body.position.x - p.pos.x;
        const dy = body.position.y - p.pos.y;
        const threshold = p.radius + BALL_RADIUS * 0.6;
        if (dx * dx + dy * dy < threshold * threshold) {
          pocketedPositions.set(id, { x: body.position.x, y: body.position.y });
          pocketedIds.add(id);
          events.pocketed.push(id);
          Matter.Composite.remove(engine.world, body);
          sounds.push({ t, type: "pocket", strength: 1, ids: [id] });
          break;
        }
      }
    }

    // 5) Frame capture at ~60 fps
    if (stepIdx % FRAME_EVERY === 0) captureFrame();

    // 6) Early exit when all active balls have stopped.
    //    Compare per-sec speed against STOP_THRESHOLD (which is in per-sec units).
    let allStop = true;
    for (const [id, body] of mBodies) {
      if (pocketedIds.has(id)) continue;
      if (toSec(Math.hypot(body.velocity.x, body.velocity.y)) > STOP_THRESHOLD) {
        allStop = false; break;
      }
    }
    if (allStop) break;
  }

  captureFrame(); // final frame

  // ---- Sync Matter.js final state back into state.balls ----
  for (const [id, body] of mBodies) {
    const ball = state.balls.find(b => b.id === id);
    if (!ball) continue;
    if (pocketedIds.has(id)) {
      ball.pocketed = true;
      ball.vel = { x: 0, y: 0 };
      const pp = pocketedPositions.get(id);
      if (pp) { ball.pos.x = pp.x; ball.pos.y = pp.y; }
    } else {
      ball.pos.x = body.position.x;
      ball.pos.y = body.position.y;
      // Convert per-step back to per-sec before storing
      ball.vel.x = toSec(body.velocity.x);
      ball.vel.y = toSec(body.velocity.y);
      if (v.len(ball.vel) < STOP_THRESHOLD) ball.vel = { x: 0, y: 0 };
    }
  }

  Matter.Engine.clear(engine);
  state.shotInProgress = false;
  return { events, frames, sounds, duration: t };
}

export function allStopped(balls: Ball[]): boolean {
  for (const b of balls) {
    if (b.pocketed) continue;
    if (Math.hypot(b.vel.x, b.vel.y) > STOP_THRESHOLD) return false;
  }
  return true;
}

// Step the world by `dt` real seconds, broken into fixed substeps
export function step(state: GameState, dt: number, table: TableSpec, events?: ShotEvents): void {
  const subs = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / FIXED_DT)));
  const sdt = dt / subs;
  for (let i = 0; i < subs; i++) stepFixed(state, table, sdt, events);
}

function stepFixed(state: GameState, table: TableSpec, dt: number, events?: ShotEvents, recorder?: Recorder): void {
  const balls = state.balls;
  // 1) integrate
  for (const b of balls) {
    if (b.pocketed) continue;
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;

    // friction: constant-deceleration (Coulomb) model with a smooth
    // blend between sliding (fast) and rolling (slow) regimes so the ball
    // doesn't visibly "snap" from fast to slow. Real pool feel.
    const speed = Math.hypot(b.vel.x, b.vel.y);
    if (speed > 0) {
      // smooth blend factor: 0 at low speed (full rolling), 1 at high speed (full sliding)
      const t = Math.min(1, Math.max(0, (speed - 40) / 90));
      const blend = t * t * (3 - 2 * t); // smoothstep
      const slidingDecel = SLIDING_FRICTION * 220;
      const rollingDecel = ROLLING_FRICTION * 320;
      const decel = rollingDecel + (slidingDecel - rollingDecel) * blend;
      const newSpeed = Math.max(0, speed - decel * dt);
      const k = newSpeed / speed;
      b.vel.x *= k;
      b.vel.y *= k;

      // english couples to lateral curve over time (very simplified Magnus-like)
      if (Math.abs(b.side) > 0.001) {
        const perp = { x: -b.vel.y, y: b.vel.x };
        const pl = Math.hypot(perp.x, perp.y) || 1;
        const acc = (b.side * 30) * dt;
        b.vel.x += (perp.x / pl) * acc;
        b.vel.y += (perp.y / pl) * acc;
      }
    }
    // spin decay
    b.spin *= Math.exp(-SPIN_FRICTION * dt);
    b.side *= Math.exp(-SPIN_FRICTION * dt);
  }

  // 2) ball-ball collisions (pairwise; with positional correction)
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (a.pocketed) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (b.pocketed) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const r = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < r * r) {
        const d = Math.sqrt(d2) || 0.0001;
        const nx = dx / d;
        const ny = dy / d;
        // positional correction (split push)
        const overlap = r - d;
        a.pos.x -= nx * overlap * 0.5;
        a.pos.y -= ny * overlap * 0.5;
        b.pos.x += nx * overlap * 0.5;
        b.pos.y += ny * overlap * 0.5;

        // capture pre-collision velocities (needed for spin transfer)
        const preAvx = a.vel.x, preAvy = a.vel.y;
        const preBvx = b.vel.x, preBvy = b.vel.y;

        // relative velocity along normal
        const rvx = b.vel.x - a.vel.x;
        const rvy = b.vel.y - a.vel.y;
        const velAlongNormal = rvx * nx + rvy * ny;
        if (velAlongNormal < 0) {
          const e = BALL_RESTITUTION;
          const jImp = -(1 + e) * velAlongNormal / 2; // equal mass
          const ix = jImp * nx;
          const iy = jImp * ny;
          a.vel.x -= ix;
          a.vel.y -= iy;
          b.vel.x += ix;
          b.vel.y += iy;

          // tiny natural variation (helps avoid robotic perfectly elastic chains)
          const jitter = 0.0025;
          a.vel.x += (Math.random() - 0.5) * jitter * Math.abs(jImp);
          a.vel.y += (Math.random() - 0.5) * jitter * Math.abs(jImp);
          b.vel.x += (Math.random() - 0.5) * jitter * Math.abs(jImp);
          b.vel.y += (Math.random() - 0.5) * jitter * Math.abs(jImp);

          // side spin throws contact line slightly
          if (a.id === 0 && Math.abs(a.side) > 0.001) {
            const tx = -ny;
            const ty = nx;
            const throwAcc = a.side * 4;
            b.vel.x += tx * throwAcc;
            b.vel.y += ty * throwAcc;
            a.side *= 0.6;
          }

          // Top/back spin transfer (FOLLOW / STOP / DRAW shots).
          // After a square hit, a ball without spin stops (impulse zeroed normal).
          // Topspin (spin > 0): cue ball follows through along its pre-collision direction.
          // Backspin (spin < 0): cue ball draws back the opposite way.
          // Only the cue ball carries this kind of spin in our model.
          const cueIsA = a.id === 0;
          const cueIsB = b.id === 0;
          if (cueIsA || cueIsB) {
            const cueBall = cueIsA ? a : b;
            const preVx = cueIsA ? preAvx : preBvx;
            const preVy = cueIsA ? preAvy : preBvy;
            const preSpeed = Math.hypot(preVx, preVy);
            if (preSpeed > 1 && Math.abs(cueBall.spin) > 0.01) {
              const dirX = preVx / preSpeed;
              const dirY = preVy / preSpeed;
              // transfer scales with spin magnitude and pre-impact speed
              const transfer = cueBall.spin * preSpeed * 0.55;
              cueBall.vel.x += dirX * transfer;
              cueBall.vel.y += dirY * transfer;
              cueBall.spin *= 0.35; // most spin is consumed at contact
            }
          }

          if (events) {
            events.ballHits++;
            if (a.id === 0 && events.firstHitId === null) events.firstHitId = b.id;
            if (b.id === 0 && events.firstHitId === null) events.firstHitId = a.id;
          }
          if (recorder?.onBallHit) {
            const strength = Math.min(1, Math.abs(jImp) / 120);
            recorder.onBallHit(strength, a.id, b.id);
          }
        }
      }
    }
  }

  // 3) cushion collisions (axis-aligned rectangle) — but the cushion is
  // INTERRUPTED at each pocket mouth. While the ball's center sits inside a
  // mouth interval along the cushion axis, the flat wall reflection is
  // disabled so the ball can travel into the pocket. The jaw bumpers
  // (handled below) deflect balls that approach the mouth at a sharp angle.
  const inMouth = (coord: number, intervals: [number, number][]): boolean => {
    for (const [a, b] of intervals) if (coord >= a && coord <= b) return true;
    return false;
  };
  for (const b of balls) {
    if (b.pocketed) continue;
    let bounced = false;
    if (b.pos.x - b.radius < 0 && !inMouth(b.pos.y, table.mouths.left)) {
      b.pos.x = b.radius;
      b.vel.x = -b.vel.x * table.cushionRestitution;
      bounced = true;
    } else if (b.pos.x + b.radius > table.width && !inMouth(b.pos.y, table.mouths.right)) {
      b.pos.x = table.width - b.radius;
      b.vel.x = -b.vel.x * table.cushionRestitution;
      bounced = true;
    }
    if (b.pos.y - b.radius < 0 && !inMouth(b.pos.x, table.mouths.top)) {
      b.pos.y = b.radius;
      b.vel.y = -b.vel.y * table.cushionRestitution;
      bounced = true;
    } else if (b.pos.y + b.radius > table.height && !inMouth(b.pos.x, table.mouths.bottom)) {
      b.pos.y = table.height - b.radius;
      b.vel.y = -b.vel.y * table.cushionRestitution;
      bounced = true;
    }

    // 3b) jaw bumpers — circular cushion ends at each pocket mouth.
    for (const j of table.jaws) {
      const dx = b.pos.x - j.pos.x;
      const dy = b.pos.y - j.pos.y;
      const minDist = b.radius + j.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 < minDist * minDist && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        // position correction — push the ball out along the contact normal
        b.pos.x += nx * (minDist - d);
        b.pos.y += ny * (minDist - d);
        // velocity reflection along the normal (only if moving into the jaw)
        const vn = b.vel.x * nx + b.vel.y * ny;
        if (vn < 0) {
          const e = table.cushionRestitution;
          b.vel.x -= (1 + e) * vn * nx;
          b.vel.y -= (1 + e) * vn * ny;
          bounced = true;
        }
      }
    }

    if (bounced) {
      if (recorder?.onCushion) {
        const speed = Math.hypot(b.vel.x, b.vel.y);
        recorder.onCushion(Math.min(1, speed / 200), b.id);
      }
      // cushion absorbs side spin a bit and converts top/back to forward push
      b.vel.x += b.spin * b.vel.x * 0.05;
      b.vel.y += b.spin * b.vel.y * 0.05;
      b.spin *= 0.7;
      if (events) events.cushionHits++;
    }
  }

  // 4) pockets
  // A ball drops when its edge overlaps the pocket enough. Using a generous
  // threshold (pocket_radius + 0.6 * ball_radius) so "close" shots still
  // score — avoids the frustrating "perfect-aim only" feeling.
  for (const b of balls) {
    if (b.pocketed) continue;
    for (const p of table.pockets) {
      const dx = b.pos.x - p.pos.x;
      const dy = b.pos.y - p.pos.y;
      const threshold = p.radius + b.radius * 0.6;
      if (dx * dx + dy * dy < threshold * threshold) {
        b.pocketed = true;
        b.vel = { x: 0, y: 0 };
        if (events) events.pocketed.push(b.id);
        recorder?.onPocket?.(b.id);
        break;
      }
    }
  }
}

// ---------- helpers used by AI / preview ----------
export function predictCueLine(state: GameState, angle: number, maxLen = TABLE_WIDTH * 1.2): {
  end: Vec2; hitBallId: number | null;
} {
  const cue = state.balls[0];
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const r = cue.radius;
  let bestT = maxLen;
  let hit: number | null = null;
  for (const b of state.balls) {
    if (b.pocketed || b.id === 0) continue;
    // ray-circle intersection (radii sum)
    const ox = cue.pos.x - b.pos.x;
    const oy = cue.pos.y - b.pos.y;
    const A = dir.x * dir.x + dir.y * dir.y;
    const B = 2 * (ox * dir.x + oy * dir.y);
    const R = r + b.radius;
    const C = ox * ox + oy * oy - R * R;
    const disc = B * B - 4 * A * C;
    if (disc < 0) continue;
    const t = (-B - Math.sqrt(disc)) / (2 * A);
    if (t > 0 && t < bestT) {
      bestT = t;
      hit = b.id;
    }
  }
  // also check cushions
  const tx = dir.x > 0 ? (TABLE_WIDTH - r - cue.pos.x) / dir.x : dir.x < 0 ? (r - cue.pos.x) / dir.x : Infinity;
  const ty = dir.y > 0 ? (TABLE_HEIGHT - r - cue.pos.y) / dir.y : dir.y < 0 ? (r - cue.pos.y) / dir.y : Infinity;
  const tc = Math.min(tx, ty);
  if (tc > 0 && tc < bestT) {
    bestT = tc;
    hit = null;
  }
  return {
    end: { x: cue.pos.x + dir.x * bestT, y: cue.pos.y + dir.y * bestT },
    hitBallId: hit,
  };
}
