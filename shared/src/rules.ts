import { Ball, BallGroup, GameState } from "./types";
import { createInitialBalls, applyShot, simulateShotRecording, ShotEvents, ShotFrame, ShotSoundEvent } from "./physics";
import { HEAD_SPOT, SHOT_CLOCK_SECONDS } from "./constants";

export function createInitialState(): GameState {
  return {
    balls: createInitialBalls(),
    turn: 0,
    groups: [null, null],
    ballInHand: false,
    shotInProgress: false,
    winner: null,
    foul: false,
    message: "Açılış vuruşu",
    shotClock: SHOT_CLOCK_SECONDS,
    frame: 0,
  };
}

export interface ShotResult {
  events: ShotEvents;
  foul: boolean;
  reason?: string;
  switchTurn: boolean;
  winner: 0 | 1 | null;
  groupAssigned?: { player: 0 | 1; group: BallGroup };
  frames: ShotFrame[];
  sounds: ShotSoundEvent[];
  duration: number;
}

export function executeShot(
  state: GameState,
  shot: { power: number; angle: number; spinX: number; spinY: number }
): ShotResult {
  applyShot(state, shot);
  const recording = simulateShotRecording(state);
  const events = recording.events;

  let foul = false;
  let reason = "";
  let switchTurn = true;
  let winner: 0 | 1 | null = null;
  let groupAssigned: { player: 0 | 1; group: BallGroup } | undefined;

  const cue = state.balls[0];
  const eight = state.balls.find(b => b.id === 8)!;
  const player = state.turn;
  const opponent: 0 | 1 = player === 0 ? 1 : 0;

  // Cue scratched?
  if (cue.pocketed) {
    foul = true;
    reason = "Beyaz top deliğe düştü";
  }

  // No ball hit
  if (events.firstHitId === null && !foul) {
    foul = true;
    reason = "Hiçbir topa değmedi";
  }

  // Pre-assignment: any pocketed solid/stripe assigns groups
  const pocketedThisShot = state.balls.filter(b => events.pocketed.includes(b.id));
  const pocketedNon8Cue = pocketedThisShot.filter(b => b.group === "solid" || b.group === "stripe");

  if (state.groups[0] === null && state.groups[1] === null && pocketedNon8Cue.length > 0 && !pocketedThisShot.some(b => b.id === 8)) {
    // Assign by first legally pocketed ball group
    const first = pocketedNon8Cue[0];
    state.groups[player] = first.group;
    state.groups[opponent] = first.group === "solid" ? "stripe" : "solid";
    groupAssigned = { player, group: first.group };
  }

  // Wrong-ball-first foul — only when the table was NOT open at the start
  // of this shot. On the break / first legal pot the table is still open,
  // so any first-ball contact is legal (standard 8-ball rule).
  if (!foul && state.groups[player] && !groupAssigned) {
    const first = state.balls.find(b => b.id === events.firstHitId);
    const myGroup = state.groups[player];
    const remainingMine = state.balls.some(b => b.group === myGroup && !b.pocketed);
    const targetGroup: BallGroup = remainingMine ? myGroup! : "eight";
    if (first && first.group !== targetGroup) {
      foul = true;
      reason = "İlk önce yanlış topa vuruldu";
    }
  }

  // 8-ball outcomes
  const eightPocketed = events.pocketed.includes(8);
  if (eightPocketed) {
    const myGroup = state.groups[player];
    const myRemaining = myGroup ? state.balls.some(b => b.group === myGroup && !b.pocketed) : true;
    if (myRemaining || cue.pocketed) {
      // illegal 8 -> opponent wins
      winner = opponent;
      reason = "8 numara kural dışı sokuldu";
    } else {
      winner = player;
      reason = "8 numara kurallı sokuldu";
    }
  }

  // Did the shooter pocket one of their own?
  let shooterPocketedOwn = false;
  if (state.groups[player]) {
    shooterPocketedOwn = pocketedThisShot.some(b => b.group === state.groups[player]);
  } else if (groupAssigned) {
    shooterPocketedOwn = true;
  }

  if (winner === null) {
    if (foul) {
      switchTurn = true;
      state.ballInHand = true;
    } else if (shooterPocketedOwn) {
      switchTurn = false;
    } else {
      switchTurn = true;
    }
  } else {
    switchTurn = false;
  }

  // respawn cue if scratched and game not over
  if (cue.pocketed && winner === null) {
    cue.pocketed = false;
    cue.pos = { ...HEAD_SPOT };
    cue.vel = { x: 0, y: 0 };
    cue.spin = 0;
    cue.side = 0;
  }

  if (winner !== null) {
    state.winner = winner;
    state.message = reason;
  } else if (foul) {
    state.foul = true;
    state.message = `Faul: ${reason}. Rakip elinde top hakkı kazandı.`;
    state.turn = opponent;
  } else if (switchTurn) {
    state.foul = false;
    state.message = "";
    state.turn = opponent;
  } else {
    state.foul = false;
    state.message = "Vurmaya devam et";
  }

  state.shotClock = SHOT_CLOCK_SECONDS;

  return {
    events, foul, reason, switchTurn, winner, groupAssigned,
    frames: recording.frames,
    sounds: recording.sounds,
    duration: recording.duration,
  };
}

export function placeCueAt(state: GameState, x: number, y: number): boolean {
  if (!state.ballInHand) return false;
  const cue = state.balls[0];
  // ensure no overlap
  for (const b of state.balls) {
    if (b.id === 0 || b.pocketed) continue;
    const dx = b.pos.x - x;
    const dy = b.pos.y - y;
    if (dx * dx + dy * dy < (b.radius + cue.radius) ** 2) return false;
  }
  cue.pos = { x, y };
  cue.vel = { x: 0, y: 0 };
  state.ballInHand = false;
  return true;
}
