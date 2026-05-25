"use client";
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { GameState, Ball, ShotInput, predictCueLine, simulateAllTrajectories, BallTrajectory } from "@billiards/shared";
import { TABLE, TABLE_HEIGHT, TABLE_WIDTH, BALL_RADIUS, POCKET_RADIUS } from "@billiards/shared/constants";

interface Props {
  state: GameState;
  mySeat: 0 | 1 | null;
  onShoot: (shot: ShotInput) => void;
  onPlaceCue: (x: number, y: number) => void;
  cheat?: boolean;
  autoMode?: boolean;
  onAutoShot?: () => void;
  onToggleAuto?: () => void;
  pinkMode?: boolean;
  /** Seats whose ball group should be rendered in pink (visible to both players). */
  pinkSeats?: number[];
}

const PADDING = 32;        // wood frame thickness in unit space
const HUD_SCALE = 4;       // pixels per unit at base; we'll scale to viewport

export const PoolTable: React.FC<Props> = ({ state, mySeat, onShoot, onPlaceCue, cheat = false, autoMode = false, onAutoShot, onToggleAuto, pinkMode = false, pinkSeats = [] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(HUD_SCALE);
  const [angle, setAngle] = useState(0);
  const [power, setPower] = useState(0.70); // 0.70² = ~49% gerçek güç — iyi default
  const [spinX, setSpinX] = useState(0);
  const [spinY, setSpinY] = useState(0);
  const [aiming, setAiming] = useState(true);

  useEffect(() => {
    setAiming(!state.shotInProgress && state.winner === null);
  }, [state.shotInProgress, state.winner]);

  // Per-ball visual state. `pole` is a 3D unit vector tracking the ball's
  // orientation (the "north pole" of the painted band/number). It tumbles as
  // the ball rolls, giving a believable 3D rolling appearance for stripes,
  // numbers, and the cue ball mark.
  const rollMap = useRef<Map<number, {
    roll: number; mx: number; my: number; px: number; py: number;
    pole: { x: number; y: number; z: number };
  }>>(new Map());
  const pocketAnimMap = useRef<Map<number, { start: number; fromX: number; fromY: number; toX: number; toY: number }>>(new Map());

  // Cheat-mode trajectory preview for ALL balls. Recomputed when aim params
  // change. Stationary balls are filtered out by the simulator's `moved` flag.
  const cheatTrajectories = useMemo<BallTrajectory[] | null>(() => {
    if (!cheat) return null;
    if (state.shotInProgress || state.winner !== null) return null;
    if (mySeat === null || state.turn !== mySeat) return null;
    if (state.ballInHand) return null;
    try {
      return simulateAllTrajectories(state, { angle, power, spinX, spinY });
    } catch { return null; }
  }, [cheat, state, angle, power, spinX, spinY, mySeat]);

  // responsive scale
  useEffect(() => {
    const update = () => {
      const wrap = wrapRef.current; if (!wrap) return;
      const w = wrap.clientWidth;
      const wantW = TABLE_WIDTH + PADDING * 2;
      setScale(Math.max(2, Math.min(8, w / wantW)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // render loop: update per-ball visual state then draw
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      for (const b of state.balls) {
        const prev = rollMap.current.get(b.id);
        if (!prev) {
          // Random initial pole so each ball looks oriented differently at rack.
          const th = Math.random() * Math.PI;
          const ph = Math.random() * Math.PI * 2;
          const pole = {
            x: Math.sin(th) * Math.cos(ph),
            y: Math.sin(th) * Math.sin(ph),
            z: Math.cos(th),
          };
          rollMap.current.set(b.id, { roll: 0, mx: 1, my: 0, px: b.pos.x, py: b.pos.y, pole });
        } else {
          const dx = b.pos.x - prev.px;
          const dy = b.pos.y - prev.py;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.02) {
            prev.roll += dist / b.radius;
            prev.mx = dx / dist;
            prev.my = dy / dist;
            // Tumble the pole: rotate around the in-plane axis perpendicular
            // to motion using Rodrigues' rotation formula. This makes the
            // painted band/number actually roll over the top of the ball.
            const ax = -dy / dist, ay = dx / dist; // axis (z = 0)
            const th = dist / b.radius;
            const c = Math.cos(th), s = Math.sin(th);
            const p = prev.pole;
            const kdotv = ax * p.x + ay * p.y; // k.z = 0 so no p.z term
            // k × v with k = (ax, ay, 0)
            const kxvx =  ay * p.z;
            const kxvy = -ax * p.z;
            const kxvz =  ax * p.y - ay * p.x;
            let nx = p.x * c + kxvx * s + ax * kdotv * (1 - c);
            let ny = p.y * c + kxvy * s + ay * kdotv * (1 - c);
            let nz = p.z * c + kxvz * s; // (1-c) term contributes 0 since k.z=0
            const len = Math.hypot(nx, ny, nz) || 1;
            prev.pole = { x: nx / len, y: ny / len, z: nz / len };
          }
          prev.px = b.pos.x;
          prev.py = b.pos.y;
        }

        // pocket fall animation start
        if (b.pocketed) {
          if (!pocketAnimMap.current.has(b.id)) {
            // find nearest pocket
            let bestD = Infinity, bestX = b.pos.x, bestY = b.pos.y;
            for (const p of TABLE.pockets) {
              const d = Math.hypot(p.pos.x - b.pos.x, p.pos.y - b.pos.y);
              if (d < bestD) { bestD = d; bestX = p.pos.x; bestY = p.pos.y; }
            }
            pocketAnimMap.current.set(b.id, {
              start: now, fromX: b.pos.x, fromY: b.pos.y, toX: bestX, toY: bestY,
            });
          }
        } else if (pocketAnimMap.current.has(b.id)) {
          // ball came back (e.g. cue-ball scratch reset)
          pocketAnimMap.current.delete(b.id);
        }
      }

      const myGroup = mySeat !== null ? state.groups[mySeat] : null;
      // Compute which ball groups are pink-activated by any seat.
      const pinkGroupSet = new Set<string>();
      for (const seat of pinkSeats) {
        const g = state.groups[seat as 0 | 1];
        if (g) pinkGroupSet.add(g);
      }
      drawTable(canvasRef.current, state, scale, rollMap.current, pocketAnimMap.current, now, pinkMode, myGroup, pinkGroupSet);
      drawOverlay(overlayRef.current, state, mySeat, angle, power, spinX, spinY, aiming, scale, cheatTrajectories, pinkMode);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, scale, angle, power, spinX, spinY, aiming, mySeat, cheatTrajectories, pinkMode]);

  // ---- input ----
  const screenToWorld = useCallback((cx: number, cy: number): { x: number; y: number } => {
    const c = overlayRef.current!;
    const rect = c.getBoundingClientRect();
    const x = (cx - rect.left) / scale - PADDING;
    const y = (cy - rect.top) / scale - PADDING;
    return { x, y };
  }, [scale]);

  // --- Pointer interaction (aim + drag-to-charge) ---
  // The pointer can be in one of three phases while pressed on the table:
  //   AIM    : default; pointer movement updates the aim angle.
  //   CHARGE : the user has dragged backward (opposite of the current aim)
  //            far enough — we now lock the aim and convert further backward
  //            motion into shot power.
  // On release while in CHARGE we fire if the pull crossed a threshold.
  // This works for both mouse (hover-aim then press-and-pull) and touch
  // (press-and-aim, then drag-back to charge, release to fire).
  const PHASE_IDLE = 0, PHASE_AIM = 1, PHASE_CHARGE = 2;
  const phaseRef = useRef<number>(PHASE_IDLE);
  const downRef = useRef({ x: 0, y: 0 });
  const chargeAngleRef = useRef(0);
  const MAX_PULL_PX = 300; // screen pixels for max power — longer pull = more control
  const CHARGE_TRIGGER_PX = 10; // backward drag distance that switches to CHARGE

  const myTurn = mySeat !== null && state.turn === mySeat && !state.shotInProgress && state.winner === null && !state.ballInHand;

  const updateAim = useCallback((cx: number, cy: number) => {
    if (mySeat === null || state.turn !== mySeat || state.shotInProgress || state.winner !== null || state.ballInHand) return;
    const cue = state.balls[0];
    const w = screenToWorld(cx, cy);
    const a = Math.atan2(w.y - cue.pos.y, w.x - cue.pos.x);
    setAngle(a);
  }, [mySeat, state, screenToWorld]);

  const computePull = useCallback((cx: number, cy: number) => {
    const dx = cx - downRef.current.x;
    const dy = cy - downRef.current.y;
    const aim = chargeAngleRef.current;
    // Pull = projection of the drag vector onto the BACKWARD direction of aim.
    const pull = -(dx * Math.cos(aim) + dy * Math.sin(aim));
    return Math.max(0, Math.min(1, pull / MAX_PULL_PX));
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (mySeat === null) return;
    // Ball-in-hand: tap to place the cue ball.
    if (state.ballInHand && state.turn === mySeat) {
      const w = screenToWorld(e.clientX, e.clientY);
      if (w.x > BALL_RADIUS && w.x < TABLE_WIDTH - BALL_RADIUS && w.y > BALL_RADIUS && w.y < TABLE_HEIGHT - BALL_RADIUS) {
        onPlaceCue(w.x, w.y);
      }
      return;
    }
    if (!myTurn) return;
    phaseRef.current = PHASE_AIM;
    downRef.current = { x: e.clientX, y: e.clientY };
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch {}
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const phase = phaseRef.current;
    if (phase === PHASE_IDLE) {
      // hover (mouse) — pure aim update
      updateAim(e.clientX, e.clientY);
      return;
    }
    if (phase === PHASE_CHARGE) {
      setPower(computePull(e.clientX, e.clientY));
      return;
    }
    // PHASE_AIM (pointer pressed but not yet charging)
    // Decide whether to switch to charging based on a meaningful backward drag.
    const dx = e.clientX - downRef.current.x;
    const dy = e.clientY - downRef.current.y;
    const aim = angle;
    const pullPx = -(dx * Math.cos(aim) + dy * Math.sin(aim));
    if (pullPx > CHARGE_TRIGGER_PX) {
      // commit to charging: lock the aim and convert the drag into power.
      phaseRef.current = PHASE_CHARGE;
      chargeAngleRef.current = aim;
      // re-anchor so the trigger threshold doesn't count toward power
      downRef.current = {
        x: downRef.current.x - Math.cos(aim) * CHARGE_TRIGGER_PX,
        y: downRef.current.y - Math.sin(aim) * CHARGE_TRIGGER_PX,
      };
      setPower(computePull(e.clientX, e.clientY));
      return;
    }
    // Still aiming — update angle based on pointer position
    updateAim(e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasCharging = phaseRef.current === PHASE_CHARGE;
    phaseRef.current = PHASE_IDLE;
    if (wasCharging) {
      const p = computePull(e.clientX, e.clientY);
      setPower(0);
      if (p >= 0.08 && myTurn) {
        onShoot({ angle: chargeAngleRef.current, power: p, spinX, spinY });
      }
    }
  };

  const onPointerCancel = () => {
    phaseRef.current = PHASE_IDLE;
    setPower(0);
  };

  return (
    <div ref={wrapRef} className="w-full max-w-[1100px] mx-auto select-none">
      <div className="relative" style={{ width: (TABLE_WIDTH + PADDING * 2) * scale, height: (TABLE_HEIGHT + PADDING * 2) * scale }}>
        <canvas ref={canvasRef} width={(TABLE_WIDTH + PADDING * 2) * scale} height={(TABLE_HEIGHT + PADDING * 2) * scale}
                className="absolute inset-0 rounded-2xl shadow-glow" />
        <canvas ref={overlayRef} width={(TABLE_WIDTH + PADDING * 2) * scale} height={(TABLE_HEIGHT + PADDING * 2) * scale}
                className="absolute inset-0 rounded-2xl touch-none"
                onPointerMove={onPointerMove}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                style={{ cursor: state.ballInHand && state.turn === mySeat ? "crosshair" : myTurn ? "grab" : "default" }} />
      </div>

      {cheat && (
        <div className="mt-3 flex items-center gap-2 glass rounded-xl p-2 px-3 text-xs"
             style={{ borderColor: "rgba(160,90,255,0.5)", borderWidth: 1 }}>
          <span className="px-2 py-0.5 rounded bg-fuchsia-500/30 text-fuchsia-200 font-bold tracking-wider uppercase">HİLE AKTİF</span>
          <span className="text-white/60">Mor çizgi beyaz topun gideceği yolu gösterir.</span>
          <button
            onClick={() => onToggleAuto?.()}
            className={`ml-auto rounded-lg px-3 py-1.5 font-bold uppercase tracking-wider text-xs
              ${autoMode ? "bg-fuchsia-500 text-black" : "bg-white/10 hover:bg-white/20 text-white"}`}>
            {autoMode ? "Otomatik: AÇIK" : "Otomatik: KAPALI"}
          </button>
          <button
            onClick={() => onAutoShot?.()}
            disabled={mySeat === null || state.turn !== mySeat || state.shotInProgress || state.winner !== null || state.ballInHand}
            className="rounded-lg px-3 py-1.5 font-bold uppercase tracking-wider text-xs btn-neon">
            Mükemmel Vur
          </button>
        </div>
      )}

      {/* HUD: power + spin + shoot */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass rounded-xl p-3">
          <label className="text-xs uppercase tracking-wider text-white/60">Güç</label>
          <input type="range" min={0.05} max={1} step={0.01}
                 value={power}
                 onChange={e => setPower(parseFloat(e.target.value))}
                 className="w-full accent-cyan-400" />
          <div className="flex justify-between text-xs text-white/50 mt-1">
            <span>Hafif</span><span>{Math.round(power * power * 100)}%</span><span>Tam</span>
          </div>
        </div>

        <div className="glass rounded-xl p-3 flex items-center gap-3 min-h-[120px]">
          <div className="text-xs uppercase tracking-wider text-white/60">Istaka Ucu</div>
          <SpinPad spinX={spinX} spinY={spinY} setSpinX={setSpinX} setSpinY={setSpinY} />
        </div>

        <button
          disabled={!myTurn}
          onClick={() => {
            if (!myTurn) return;
            onShoot({ angle, power, spinX, spinY });
          }}
          className={`btn-neon rounded-xl px-6 py-4 text-lg ${!myTurn ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          {state.winner !== null ? "Oyun Bitti" :
            state.ballInHand && state.turn === mySeat ? "Beyaz topu yerleştir" :
            myTurn ? "VUR" :
            state.shotInProgress ? "Vuruş sürüyor..." :
            mySeat === null ? "İzleyici" : "Rakibin sırası"}
        </button>
      </div>
    </div>
  );
};

// ---- Cue ball spin control ----
// Click/drag anywhere on the white ball to set the cue tip contact point.
// Top   → topspin (follow), Bottom → backspin (draw),
// Left/Right → side English. Magnitude = distance from center.
const SpinPad: React.FC<{ spinX: number; spinY: number; setSpinX: (v: number) => void; setSpinY: (v: number) => void }> =
  ({ spinX, spinY, setSpinX, setSpinY }) => {
  const ref = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const update = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const half = r.width / 2;
    let dx = (clientX - cx) / half;
    let dy = (clientY - cy) / half;
    const m = Math.hypot(dx, dy);
    if (m > 0.95) { dx = (dx / m) * 0.95; dy = (dy / m) * 0.95; }
    setSpinX(dx);
    setSpinY(-dy);   // invert: clicking up → topspin (positive)
  };

  const onDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    update(e.clientX, e.clientY);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    update(e.clientX, e.clientY);
  };
  const onUp = () => { draggingRef.current = false; };

  const SIZE = 92;
  const dotX = spinX * (SIZE * 0.42);
  const dotY = -spinY * (SIZE * 0.42);

  return (
    <div className="flex items-center gap-3 ml-auto">
      <div className="text-[10px] uppercase tracking-wider text-white/40 leading-tight text-right">
        <div>Üst</div>
        <div>·</div>
        <div>Alt</div>
      </div>
      <div
        ref={ref}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative rounded-full cursor-crosshair touch-none select-none"
        style={{
          width: SIZE, height: SIZE,
          background: "radial-gradient(circle at 35% 30%, #ffffff 0%, #e6eaf2 55%, #b9c1cf 100%)",
          boxShadow: "inset 0 -10px 18px rgba(0,0,0,0.18), inset 0 6px 10px rgba(255,255,255,0.6), 0 6px 16px rgba(0,0,0,0.45)",
          border: "1px solid rgba(255,255,255,0.4)",
        }}
        title="Tıkla veya sürükle: üst = ileri dönüş, alt = geri dönüş, yanlar = efe"
      >
        {/* faint crosshair */}
        <div className="absolute left-1/2 top-1 bottom-1 w-px bg-black/10" />
        <div className="absolute top-1/2 left-1 right-1 h-px bg-black/10" />
        {/* center mark */}
        <div className="absolute rounded-full bg-black/20"
             style={{ width: 3, height: 3, left: "calc(50% - 1.5px)", top: "calc(50% - 1.5px)" }} />
        {/* contact dot */}
        <div className="absolute rounded-full"
             style={{
               width: 14, height: 14,
               background: "radial-gradient(circle at 30% 30%, #ff5d5d, #b71c1c)",
               boxShadow: "0 0 8px rgba(255,80,80,0.7), inset 0 -2px 3px rgba(0,0,0,0.4)",
               left: `calc(50% + ${dotX}px - 7px)`,
               top: `calc(50% + ${dotY}px - 7px)`,
             }} />
      </div>
      <button
        onClick={() => { setSpinX(0); setSpinY(0); }}
        className="text-[10px] uppercase tracking-wider text-white/50 hover:text-white px-2 py-1 rounded bg-white/5 border border-white/10"
      >Merkez</button>
    </div>
  );
};

// ---- drawing ----
type RollState = Map<number, { roll: number; mx: number; my: number; px: number; py: number; pole: { x: number; y: number; z: number } }>;
type PocketAnims = Map<number, { start: number; fromX: number; fromY: number; toX: number; toY: number }>;
const POCKET_ANIM_MS = 620;
// Phase split: ball glides into the pocket mouth, then drops down out of view.
const POCKET_ANIM_GLIDE = 0.42;

function drawTable(canvas: HTMLCanvasElement | null, s: GameState, scale: number,
                   rolls: RollState, pocketAnims: PocketAnims, now: number,
                   pinkMode: boolean, myGroup: "solid" | "stripe" | "cue" | "eight" | null,
                   pinkGroupSet: Set<string> = new Set()) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d")!;
  const W = (TABLE_WIDTH + PADDING * 2) * scale;
  const H = (TABLE_HEIGHT + PADDING * 2) * scale;
  ctx.clearRect(0, 0, W, H);

  // ============ TABLE FRAME — Arcade billiards style ============
  // Deep navy outer chassis + bright blue cushion rails + ornate golden corner
  // pieces around each pocket and decorative blue diamonds on the rails.
  const cornerR = 22 * (scale / 4);

  // outer drop shadow under the whole table
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 32 * (scale / 4);
  ctx.shadowOffsetY = 10 * (scale / 4);
  ctx.fillStyle = "#000";
  roundRect(ctx, 0, 0, W, H, cornerR);
  ctx.fill();
  ctx.restore();

  // outer chassis: dark navy
  const chassis = ctx.createLinearGradient(0, 0, 0, H);
  chassis.addColorStop(0.00, "#0e1a30");
  chassis.addColorStop(0.50, "#0a1424");
  chassis.addColorStop(1.00, "#050a14");
  ctx.fillStyle = chassis;
  roundRect(ctx, 0, 0, W, H, cornerR);
  ctx.fill();

  // top glossy sheen on the chassis
  ctx.save();
  roundRect(ctx, 0, 0, W, H, cornerR);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  sheen.addColorStop(0, "rgba(120,170,255,0.18)");
  sheen.addColorStop(1, "rgba(120,170,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H * 0.4);
  ctx.restore();

  // outer rim highlight
  ctx.save();
  ctx.strokeStyle = "rgba(160,200,255,0.45)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 1.2, 1.2, W - 2.4, H - 2.4, cornerR - 0.6);
  ctx.stroke();
  ctx.restore();

  // ---- rail: two-layer structure (wood outer + teal cushion inner) ----
  // Like the reference: dark cherry-wood takes the outer 60%, bright teal
  // cushion takes the inner 40%. The cushion is the surface balls bounce off.
  const railOuterInset  = PADDING * 0.14 * scale;
  const cushionBoundary = PADDING * 0.58 * scale; // where wood ends, cushion begins
  const railInnerInset  = PADDING * 0.93 * scale;
  const railR  = Math.max(4, cornerR - 2);
  const cushR  = Math.max(2, railR - 8);
  const feltR  = Math.max(1, railR - 14);

  // --- Layer 1: dark cherry-wood ring (outer portion) ---
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, railOuterInset, railOuterInset,
    W - railOuterInset * 2, H - railOuterInset * 2, railR);
  roundRectPath(ctx, cushionBoundary, cushionBoundary,
    W - cushionBoundary * 2, H - cushionBoundary * 2, cushR);
  const woodGrad = ctx.createLinearGradient(0, railOuterInset, 0, H - railOuterInset);
  woodGrad.addColorStop(0.00, "#8a2424");
  woodGrad.addColorStop(0.30, "#6b1818");
  woodGrad.addColorStop(0.50, "#551212");
  woodGrad.addColorStop(0.70, "#4a1010");
  woodGrad.addColorStop(1.00, "#2e0a0a");
  ctx.fillStyle = woodGrad;
  ctx.fill("evenodd");
  // subtle top sheen on wood
  const woodSheen = ctx.createLinearGradient(railOuterInset, railOuterInset,
    railOuterInset, cushionBoundary);
  woodSheen.addColorStop(0,   "rgba(255,180,140,0.18)");
  woodSheen.addColorStop(0.4, "rgba(255,120,80,0.06)");
  woodSheen.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = woodSheen;
  ctx.fill("evenodd");
  ctx.restore();

  // wood outer edge highlight
  ctx.save();
  ctx.strokeStyle = "rgba(180,80,60,0.55)";
  ctx.lineWidth = 1.2;
  roundRect(ctx, railOuterInset + 1, railOuterInset + 1,
    W - (railOuterInset + 1) * 2, H - (railOuterInset + 1) * 2, railR - 1);
  ctx.stroke();
  ctx.restore();

  // --- Layer 2: teal cushion ring (inner portion) ---
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, cushionBoundary, cushionBoundary,
    W - cushionBoundary * 2, H - cushionBoundary * 2, cushR);
  roundRectPath(ctx, railInnerInset, railInnerInset,
    W - railInnerInset * 2, H - railInnerInset * 2, feltR);
  // radial gradient: bright teal near the felt (inner), darker teal near the wood (outer)
  const cg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28,
                                       W / 2, H / 2, Math.min(W, H) * 0.52);
  cg.addColorStop(0.00, "#50d8e8");   // bright inner edge (near felt)
  cg.addColorStop(0.35, "#28a8be");   // mid teal
  cg.addColorStop(0.70, "#1a7f92");   // deeper teal
  cg.addColorStop(1.00, "#0f5060");   // dark where cushion meets wood
  ctx.fillStyle = cg;
  ctx.fill("evenodd");
  ctx.restore();

  // cushion top-surface highlight: bright line along the felt-facing inner edge
  ctx.save();
  ctx.strokeStyle = "rgba(130,235,250,0.80)";
  ctx.lineWidth = 1.8 * (scale / 4);
  roundRect(ctx, railInnerInset - 1.5 * (scale / 4), railInnerInset - 1.5 * (scale / 4),
    W - (railInnerInset - 1.5 * (scale / 4)) * 2,
    H - (railInnerInset - 1.5 * (scale / 4)) * 2, feltR + 1);
  ctx.stroke();
  // secondary faint highlight just outside
  ctx.strokeStyle = "rgba(80,200,220,0.35)";
  ctx.lineWidth = 3 * (scale / 4);
  roundRect(ctx, railInnerInset - 4 * (scale / 4), railInnerInset - 4 * (scale / 4),
    W - (railInnerInset - 4 * (scale / 4)) * 2,
    H - (railInnerInset - 4 * (scale / 4)) * 2, feltR + 3);
  ctx.stroke();
  ctx.restore();

  // shadow groove between cushion and felt
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.70)";
  ctx.lineWidth = 2.0;
  roundRect(ctx, railInnerInset, railInnerInset,
    W - railInnerInset * 2, H - railInnerInset * 2, feltR);
  ctx.stroke();
  ctx.restore();

  // playfield
  ctx.save();
  ctx.translate(PADDING * scale, PADDING * scale);
  const pW = TABLE_WIDTH * scale, pH = TABLE_HEIGHT * scale;
  // base cloth: vivid arcade-style felt (pink in pink-mode, blue otherwise)
  const cloth = ctx.createLinearGradient(0, 0, 0, pH);
  if (pinkMode) {
    cloth.addColorStop(0, "#ff7fb8");
    cloth.addColorStop(0.5, "#e94d97");
    cloth.addColorStop(1, "#a52969");
  } else {
    cloth.addColorStop(0, "#1f5dd3");
    cloth.addColorStop(0.5, "#1748a8");
    cloth.addColorStop(1, "#0e2f7a");
  }
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, pW, pH);

  // overhead spotlight to give cinematic depth
  const spot = ctx.createRadialGradient(pW / 2, pH / 2, pW * 0.05, pW / 2, pH / 2, pW * 0.65);
  spot.addColorStop(0, "rgba(255,255,255,0.18)");
  spot.addColorStop(0.45, "rgba(255,255,255,0.05)");
  spot.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, pW, pH);

  // felt micro-texture — deterministic so it doesn't flicker frame to frame.
  const feltRand = (i: number, k: number) => {
    const x = Math.sin(i * 91.5347 + k * 47.1239) * 43758.5453;
    return x - Math.floor(x);
  };
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (let i = 0; i < 1400; i++) {
    ctx.fillRect(feltRand(i, 1) * pW, feltRand(i, 2) * pH, 1, 1);
  }
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  for (let i = 0; i < 700; i++) {
    ctx.fillRect(feltRand(i, 3) * pW, feltRand(i, 4) * pH, 1, 1);
  }

  // table lines
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pW * 0.25, 0); ctx.lineTo(pW * 0.25, pH);
  ctx.stroke();
  // foot spot
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath(); ctx.arc(pW * 0.75, pH / 2, 1.5 * (scale / 4), 0, Math.PI * 2); ctx.fill();
  // head spot
  ctx.beginPath(); ctx.arc(pW * 0.25, pH / 2, 1.5 * (scale / 4), 0, Math.PI * 2); ctx.fill();

  // cushion diamonds — small ivory dots on the red rails (8 Ball Pool style).
  const dHalf = 2.2 * (scale / 4);
  const placeDiamond = (x: number, y: number) => {
    // soft halo
    const gd = ctx.createRadialGradient(x, y, 0, x, y, dHalf * 1.8);
    gd.addColorStop(0, "rgba(255,235,200,0.25)");
    gd.addColorStop(1, "rgba(255,235,200,0)");
    ctx.fillStyle = gd;
    ctx.beginPath(); ctx.arc(x, y, dHalf * 1.8, 0, Math.PI * 2); ctx.fill();
    // ivory diamond body with subtle top highlight
    const jg = ctx.createRadialGradient(x - dHalf * 0.3, y - dHalf * 0.3, 0, x, y, dHalf);
    jg.addColorStop(0, "#ffffff");
    jg.addColorStop(0.6, "#f0e2c0");
    jg.addColorStop(1, "#a08560");
    ctx.fillStyle = jg;
    drawDiamond(ctx, x, y, dHalf);
    // thin dark outline
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y - dHalf); ctx.lineTo(x + dHalf, y);
    ctx.lineTo(x, y + dHalf); ctx.lineTo(x - dHalf, y); ctx.closePath();
    ctx.stroke();
  };
  const longCount = 8;
  for (let i = 1; i < longCount; i++) {
    if (i === longCount / 2) continue; // skip the side-pocket position
    const x = (TABLE_WIDTH / longCount) * i * scale;
    placeDiamond(x, -PADDING * 0.25 * scale);
    placeDiamond(x, (TABLE_HEIGHT + PADDING * 0.25) * scale);
  }
  const shortCount = 4;
  for (let i = 1; i < shortCount; i++) {
    const y = (TABLE_HEIGHT / shortCount) * i * scale;
    placeDiamond(-PADDING * 0.25 * scale, y);
    placeDiamond((TABLE_WIDTH + PADDING * 0.25) * scale, y);
  }

  // inner shadow around the felt so the rail visibly stands above the cloth
  ctx.save();
  const innerShadow = ctx.createLinearGradient(0, 0, 0, 8 * (scale / 4));
  innerShadow.addColorStop(0, "rgba(0,0,0,0.55)");
  innerShadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = innerShadow;
  ctx.fillRect(0, 0, pW, 8 * (scale / 4));
  const innerShadowB = ctx.createLinearGradient(0, pH - 6 * (scale / 4), 0, pH);
  innerShadowB.addColorStop(0, "rgba(0,0,0,0)");
  innerShadowB.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = innerShadowB;
  ctx.fillRect(0, pH - 6 * (scale / 4), pW, 6 * (scale / 4));
  const innerShadowL = ctx.createLinearGradient(0, 0, 6 * (scale / 4), 0);
  innerShadowL.addColorStop(0, "rgba(0,0,0,0.4)");
  innerShadowL.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = innerShadowL;
  ctx.fillRect(0, 0, 6 * (scale / 4), pH);
  const innerShadowR = ctx.createLinearGradient(pW - 6 * (scale / 4), 0, pW, 0);
  innerShadowR.addColorStop(0, "rgba(0,0,0,0)");
  innerShadowR.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = innerShadowR;
  ctx.fillRect(pW - 6 * (scale / 4), 0, 6 * (scale / 4), pH);
  ctx.restore();

  // pockets — centered on the physics pocket position (at the felt edge).
  // Size ~1.8× ball diameter so the hole looks proportional to the balls.
  for (const p of TABLE.pockets) {
    const px = p.pos.x * scale, py = p.pos.y * scale;
    const holeR = POCKET_RADIUS * 1.00 * scale;

    // very faint shadow ring around the pocket opening
    const halo = ctx.createRadialGradient(px, py, holeR * 0.7, px, py, holeR * 1.5);
    halo.addColorStop(0, "rgba(0,0,0,0.18)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(px, py, holeR * 1.5, 0, Math.PI * 2); ctx.fill();

    // dark hole with depth gradient
    const g = ctx.createRadialGradient(px - holeR * 0.15, py - holeR * 0.15, 0, px, py, holeR);
    g.addColorStop(0.00, "#1a1a1a");
    g.addColorStop(0.55, "#050505");
    g.addColorStop(1.00, "#000000");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, holeR, 0, Math.PI * 2); ctx.fill();

    // thin dark edge stroke
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(px, py, holeR, 0, Math.PI * 2); ctx.stroke();
  }

  // Pocket "ripple" — a dark ring expanding briefly around a pocket after a
  // ball drops in. Drawn BEFORE the falling ball so the ball sits on top.
  for (const [, pAnim] of pocketAnims) {
    const elapsed = now - pAnim.start;
    if (elapsed >= POCKET_ANIM_MS) continue;
    const k = elapsed / POCKET_ANIM_MS;
    if (k < 0.12 || k > 0.75) continue;
    const rk = (k - 0.12) / 0.63;        // 0..1 across the ripple lifetime
    const ringR = (8 + 14 * rk) * (scale / 4);
    ctx.save();
    ctx.globalAlpha = 0.55 * (1 - rk);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.6 * (1 - rk * 0.7);
    ctx.beginPath();
    ctx.arc(pAnim.toX * scale, pAnim.toY * scale, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // balls
  for (const b of s.balls) {
    const roll = rolls.get(b.id);
    const pAnim = pocketAnims.get(b.id);
    if (b.pocketed) {
      if (!pAnim) continue;
      const elapsed = now - pAnim.start;
      if (elapsed >= POCKET_ANIM_MS) continue;
      const k = elapsed / POCKET_ANIM_MS;

      let drawX: number, drawY: number, fallScale: number, alpha: number;
      if (k < POCKET_ANIM_GLIDE) {
        // Phase 1: glide toward pocket center with ease-out deceleration.
        const u = k / POCKET_ANIM_GLIDE;
        const ease = 1 - (1 - u) * (1 - u);
        drawX = pAnim.fromX + (pAnim.toX - pAnim.fromX) * ease;
        drawY = pAnim.fromY + (pAnim.toY - pAnim.fromY) * ease;
        // subtle size reduction as ball approaches — feels like it's being pulled in
        fallScale = 1 - ease * 0.12;
        alpha = 1;
      } else {
        // Phase 2: ball rapidly swallowed into hole — cubic shrink, quick fade.
        const u = (k - POCKET_ANIM_GLIDE) / (1 - POCKET_ANIM_GLIDE);
        const ease = u * u * u;           // cubic = fast initial drop, then rapid finish
        drawX = pAnim.toX;
        drawY = pAnim.toY;
        fallScale = 1 - u;                // linear shrink to 0 (ball fully disappears)
        alpha = Math.max(0, 1 - u * 1.4); // fade out faster than shrink
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      drawBall(ctx, b, scale, roll, drawX, drawY, fallScale, pinkMode, myGroup, pinkGroupSet);
      ctx.restore();
    } else {
      drawBall(ctx, b, scale, roll, b.pos.x, b.pos.y, 1, pinkMode, myGroup, pinkGroupSet);
    }
  }

  ctx.restore();

  // pocketed tray (top frame)
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = `${10 * (scale / 4)}px Inter, sans-serif`;
  ctx.fillText("BILLIARDS ARENA", 12 * (scale / 4), 18 * (scale / 4));
  ctx.restore();
}

/**
 * Draw a spherical "cap" on the ball at a given 3D pole vector.
 *
 * The cap is the set of points on the unit sphere within angular distance
 * `alpha` from `pole`. We approximate the *visible* portion of the cap by
 * sampling its boundary (a 3D circle), classifying each sample as front-
 * facing (z >= 0) or back-facing, and projecting:
 *   - Front samples → projected directly onto the 2D ball.
 *   - Back samples → snapped to the silhouette circle (z = 0 great circle
 *     of the unit sphere) so the polygon traces along the rim of the ball.
 * This handles ALL pole orientations correctly: small front caps render as
 * tight ellipses, equatorial caps look like crescents, and back caps that
 * wrap around the rim appear as thin slivers along the silhouette.
 */
function drawCap(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  pole: { x: number; y: number; z: number },
  alpha: number,
  fill: string,
) {
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);

  // Orthonormal basis (e1, e2) perpendicular to the pole. If pole is close
  // to vertical we pick e1 = +X to avoid a degenerate cross product.
  let e1x: number, e1y: number, e1z: number;
  const lxy = Math.hypot(pole.x, pole.y);
  if (lxy > 1e-3) {
    e1x = -pole.y / lxy; e1y = pole.x / lxy; e1z = 0;
  } else {
    e1x = 1; e1y = 0; e1z = 0;
  }
  // e2 = pole × e1
  const e2x = pole.y * e1z - pole.z * e1y;
  const e2y = pole.z * e1x - pole.x * e1z;
  const e2z = pole.x * e1y - pole.y * e1x;

  // Sample cap boundary at N points.
  const N = 56;
  const xs: number[] = new Array(N);
  const ys: number[] = new Array(N);
  const zs: number[] = new Array(N);
  let anyVisible = false;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    xs[i] = pole.x * cosA + (e1x * c + e2x * s) * sinA;
    ys[i] = pole.y * cosA + (e1y * c + e2y * s) * sinA;
    zs[i] = pole.z * cosA + (e1z * c + e2z * s) * sinA;
    if (zs[i] >= 0) anyVisible = true;
  }
  if (!anyVisible) return;

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    let px: number, py: number;
    if (zs[i] >= 0) {
      px = cx + xs[i] * r;
      py = cy + ys[i] * r;
    } else {
      // Snap back-facing samples to the silhouette so the polygon's hidden
      // edge follows the rim of the ball.
      const l = Math.hypot(xs[i], ys[i]) || 1;
      px = cx + (xs[i] / l) * r;
      py = cy + (ys[i] / l) * r;
    }
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  b: Ball,
  scale: number,
  roll: { pole: { x: number; y: number; z: number } } | undefined,
  worldX: number,
  worldY: number,
  drawScale: number,
  pinkMode: boolean = false,
  myGroup: "solid" | "stripe" | "cue" | "eight" | null = null,
  pinkGroupSet: Set<string> = new Set(),
) {
  const x = worldX * scale, y = worldY * scale, r = b.radius * scale * drawScale;
  // shadow (skip when ball is shrinking into pocket)
  if (drawScale > 0.7) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath(); ctx.ellipse(x + r * 0.15, y + r * 0.4, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Recolor my-group balls (and the cue ball) pink in pink-mode. The 8 ball
  // and the opponent's balls retain their natural colors.
  let color = ballColors[b.id];
  // pinkMode: local player's own balls pink (HACK-style)
  if (pinkMode && b.id !== 0 && myGroup && b.group === myGroup) {
    color = myGroup === "solid" ? "#d63384" : "#ff6fb3";
  }
  // pinkGroupSet: seats that used kocamasigim — visible to both players
  if (b.id !== 0 && pinkGroupSet.has(b.group)) {
    color = b.group === "solid" ? "#d63384" : "#ff6fb3";
  }
  const pole = roll?.pole ?? { x: 0, y: 0, z: 1 };
  // negated pole = "south pole" / opposite cap on the back of the ball
  const antiPole = { x: -pole.x, y: -pole.y, z: -pole.z };

  // Cap angular half-widths.
  //   - stripe ball: a fairly wide white cap on each pole; the remaining
  //     equatorial band shows the ball color (this is how a real 9-15 ball
  //     looks).
  //   - solid ball: a small white disk hosts the printed number.
  //   - cue ball: tiny red dot to make rolling visible.
  const CAP_STRIPE = 0.95;   // ~54°: leaves ~36° colored band on each side
  const CAP_NUMBER = 0.42;   // small white circle for the number
  const CAP_CUE_DOT = 0.20;  // tiny red dot

  if (b.id === 0) {
    // cue: solid white
    ctx.fillStyle = "#fafafa";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // single red mark on the front pole (if visible)
    drawCap(ctx, x, y, r, pole, CAP_CUE_DOT, "#d61f1f");
  } else if (b.group === "stripe") {
    // Plain solid red ball (same rendering as solid group)
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  } else {
    // solid (or 8): filled colored circle
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // Number printed on a small white disk at the front pole. For stripes the
  // number lives inside the bigger white cap, so we use the same approach for
  // visual consistency. Number text is only drawn when the disk faces enough
  // toward the viewer to be legible.
  if (b.id !== 0) {
    // Which pole faces forward? Whichever has the larger z.
    const front = pole.z >= antiPole.z ? pole : antiPole;
    drawCap(ctx, x, y, r, front, CAP_NUMBER, "#ffffff");
    // Print the number only when the front pole is comfortably visible.
    if (front.z > 0.35) {
      const cosA = Math.cos(CAP_NUMBER);
      const nx = x + front.x * r * cosA;
      const ny = y + front.y * r * cosA;
      // Foreshortening: text scales with the cap's visible area.
      const sz = r * 0.62 * Math.max(0.4, front.z);
      ctx.fillStyle = "#111";
      ctx.font = `bold ${sz}px Inter, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(b.id), nx, ny + sz * 0.05);
    }
  }

  // highlight (lighting, top-left)
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.05, x, y, r);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.25, "rgba(255,255,255,0.0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

  // outline
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
}

// Ball colors used for cheat trajectory lines. Mirrors the table renderer's palette.
const CHEAT_BALL_COLOR: Record<number, string> = {
  1: "#0d1f4a", 2: "#0d1f4a", 3: "#0d1f4a", 4: "#0d1f4a", 5: "#0d1f4a",
  6: "#0d1f4a", 7: "#0d1f4a", 8: "#e6e6e6",
  9: "#e91e8c", 10: "#e91e8c", 11: "#e91e8c", 12: "#e91e8c",
  13: "#e91e8c", 14: "#e91e8c", 15: "#e91e8c",
};

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function drawOverlay(canvas: HTMLCanvasElement | null, s: GameState, mySeat: 0 | 1 | null,
                     angle: number, power: number, spinX: number, spinY: number, aiming: boolean, scale: number,
                     cheatTrajectories: BallTrajectory[] | null, pinkMode: boolean = false) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (s.winner !== null) return;
  if (s.ballInHand) {
    // hint border
    ctx.save();
    ctx.translate(PADDING * scale, PADDING * scale);
    ctx.strokeStyle = "rgba(34,211,238,0.6)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(0, 0, TABLE_WIDTH * scale, TABLE_HEIGHT * scale);
    ctx.restore();
    return;
  }
  if (!aiming || s.shotInProgress || mySeat === null || s.turn !== mySeat) return;

  ctx.save();
  ctx.translate(PADDING * scale, PADDING * scale);
  const cue = s.balls[0];
  // Main aim line extends fully until it hits a ball or a cushion (8 Ball Pool style).
  const pred = predictCueLine(s, angle, Math.max(TABLE_WIDTH, TABLE_HEIGHT) * 2);
  const sx = cue.pos.x * scale, sy = cue.pos.y * scale;
  const ex = pred.end.x * scale, ey = pred.end.y * scale;

  // Determine if the first contact would be a foul (illegal target).
  // Like 8 Ball Pool: red warning if the aim does not hit a legal target ball first.
  // Does not block the shot — purely visual.
  const myGroup = mySeat !== null ? s.groups[mySeat] : null;
  let illegal = false;
  if (pred.hitBallId === null) {
    // no ball would be contacted at all (cushion-only) → foul
    illegal = true;
  } else {
    const obj = s.balls.find(b => b.id === pred.hitBallId);
    if (obj) {
      if (myGroup) {
        const remainingMine = s.balls.some(b => b.group === myGroup && !b.pocketed);
        if (remainingMine) {
          if (obj.group !== myGroup) illegal = true;
        } else {
          if (obj.id !== 8) illegal = true;
        }
      } else {
        // table open: any ball except 8 is legal as first contact
        if (obj.id === 8) illegal = true;
      }
    }
  }

  // Colors switch to red when the predicted contact is illegal.
  const mainColor = illegal ? "rgba(255,70,70,0.95)" : "rgba(255,255,255,0.85)";
  const objColor  = illegal ? "rgba(255,70,70,0.95)" : "rgba(255,210,90,0.95)";
  const cueColor  = illegal ? "rgba(255,70,70,0.95)" : "rgba(120,220,255,0.95)";

  // main aim line (cue ball trajectory until first contact) — solid
  ctx.strokeStyle = mainColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();

  // ghost ball at impact point + post-contact short guides for both balls
  if (pred.hitBallId !== null) {
    const obj = s.balls.find(b => b.id === pred.hitBallId);
    if (obj && !obj.pocketed) {
      // ghost ball outline at contact position
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.beginPath(); ctx.arc(ex, ey, BALL_RADIUS * scale, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ex, ey, BALL_RADIUS * scale, 0, Math.PI * 2); ctx.stroke();

      // Line of centers (normal at contact): from contact point to object-ball center.
      // The object ball departs along this direction.
      const ndx = obj.pos.x - pred.end.x;
      const ndy = obj.pos.y - pred.end.y;
      const nlen = Math.hypot(ndx, ndy) || 1;
      const nx = ndx / nlen, ny = ndy / nlen;

      // Tangent direction (perpendicular to line of centers).
      // The cue ball deflects along the component of its incoming direction
      // that lies on this tangent (stun-shot approximation, matches 8 Ball Pool guide).
      const inDx = Math.cos(angle), inDy = Math.sin(angle);
      // Two tangent options; pick the one with positive dot product with incoming dir.
      let tx = -ny, ty = nx;
      if (inDx * tx + inDy * ty < 0) { tx = -tx; ty = -ty; }

      const SHORT_LEN_UNITS = 17; // length of post-contact guide lines (1/3 of original 50)

      // Object ball guide (yellow) — from object ball center along line of centers
      const objSx = obj.pos.x * scale, objSy = obj.pos.y * scale;
      const objEx = objSx + nx * SHORT_LEN_UNITS * scale;
      const objEy = objSy + ny * SHORT_LEN_UNITS * scale;
      ctx.strokeStyle = objColor;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(objSx, objSy); ctx.lineTo(objEx, objEy); ctx.stroke();

      // Cue ball deflection guide — from ghost ball (contact) along tangent
      const cueEx = ex + tx * SHORT_LEN_UNITS * scale;
      const cueEy = ey + ty * SHORT_LEN_UNITS * scale;
      ctx.strokeStyle = cueColor;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(cueEx, cueEy); ctx.stroke();

      // small markers
      ctx.fillStyle = objColor;
      ctx.beginPath(); ctx.arc(objSx, objSy, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = cueColor;
      ctx.beginPath(); ctx.arc(ex, ey, 2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.beginPath(); ctx.arc(ex, ey, BALL_RADIUS * scale, 0, Math.PI * 2); ctx.fill();
    }
  }

  // CHEAT: full predicted trajectory for every ball that moves. The cue ball
  // gets its own bright purple line, object balls use their own ball color.
  if (cheatTrajectories) {
    ctx.save();
    for (const tr of cheatTrajectories) {
      if (!tr.moved || tr.points.length < 2) continue;
      let stroke: string;
      let glow: string;
      if (tr.id === 0) {
        stroke = "rgba(160, 90, 255, 0.95)";
        glow = "rgba(160, 90, 255, 0.7)";
      } else {
        const base = CHEAT_BALL_COLOR[tr.id] || "#ffffff";
        // semi-transparent overlay using hex -> rgba
        stroke = hexToRgba(base, 0.85);
        glow = hexToRgba(base, 0.55);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = tr.id === 0 ? 1.6 : 1.2;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.moveTo(tr.points[0].x * scale, tr.points[0].y * scale);
      for (let i = 1; i < tr.points.length; i++) {
        ctx.lineTo(tr.points[i].x * scale, tr.points[i].y * scale);
      }
      ctx.stroke();

      const last = tr.points[tr.points.length - 1];
      ctx.shadowBlur = 0;
      if (tr.pocketed) {
        // X mark = ball will be pocketed
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.8;
        const r = 4;
        ctx.beginPath();
        ctx.moveTo(last.x * scale - r, last.y * scale - r);
        ctx.lineTo(last.x * scale + r, last.y * scale + r);
        ctx.moveTo(last.x * scale + r, last.y * scale - r);
        ctx.lineTo(last.x * scale - r, last.y * scale + r);
        ctx.stroke();
      } else {
        ctx.fillStyle = stroke;
        ctx.beginPath(); ctx.arc(last.x * scale, last.y * scale, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // cue stick
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const back = 24 + power * 60; // pixels
  const stickLen = 220 * (scale / 4);
  const tipX = sx - dx * (BALL_RADIUS * scale + back);
  const tipY = sy - dy * (BALL_RADIUS * scale + back);
  const buttX = tipX - dx * stickLen;
  const buttY = tipY - dy * stickLen;
  // shadow
  ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 6 * (scale / 4);
  ctx.beginPath(); ctx.moveTo(tipX + 2, tipY + 4); ctx.lineTo(buttX + 2, buttY + 4); ctx.stroke();
  // body — pink cue in pink-mode, classic wooden cue otherwise
  const grd = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
  if (pinkMode) {
    grd.addColorStop(0, "#ffe1ef");        // soft tip
    grd.addColorStop(0.05, "#ffb3d3");
    grd.addColorStop(0.4, "#e94d97");
    grd.addColorStop(1, "#5c123c");        // deep magenta butt
  } else {
    grd.addColorStop(0, "#f1f1f1");
    grd.addColorStop(0.05, "#bcbcbc");
    grd.addColorStop(0.4, "#7a4a1f");
    grd.addColorStop(1, "#1a0e06");
  }
  ctx.strokeStyle = grd; ctx.lineWidth = 4.5 * (scale / 4);
  ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(buttX, buttY); ctx.stroke();

  ctx.restore();
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + h, y);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x - h, y);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
}

/** Append a rounded-rect sub-path to the current path WITHOUT calling beginPath
 *  — useful when composing complex paths (e.g. even-odd fills for ring shapes). */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ballColors: Record<number, string> = {
  0: "#ffffff",
  // Solid group → gece mavisi (night blue)
  1: "#0d1f4a", 2: "#0d1f4a", 3: "#0d1f4a", 4: "#0d1f4a", 5: "#0d1f4a", 6: "#0d1f4a", 7: "#0d1f4a",
  8: "#0a0a0a",
  // Stripe group → pembe (pink)
  9: "#e91e8c", 10: "#e91e8c", 11: "#e91e8c", 12: "#e91e8c", 13: "#e91e8c", 14: "#e91e8c", 15: "#e91e8c",
};

export default PoolTable;
