import { TableSpec } from "./types";

// Units: meters scaled. We use a virtual "table unit" coord system.
// Table playfield: 2.24m x 1.12m (9-foot pool). We use 224 x 112 internal units.
export const BALL_RADIUS = 2.85;          // ~57mm diameter
export const TABLE_WIDTH = 224;
export const TABLE_HEIGHT = 112;
export const POCKET_RADIUS = 8.5;         // generous pocket size — more fun, less frustrating
export const CUSHION_RESTITUTION = 0.72;   // slightly livelier rail bounce
export const BALL_RESTITUTION = 0.92;      // slightly less elastic = better chain feel
// Friction: 1 unit ≈ 1 cm, table 224 cm wide.
// Full-power (100%) shot crosses the table in ~0.5 s and stops in ~3 s.
// Default-power (70%) crosses in ~0.9 s and stops in ~2 s — feels snappy.
export const ROLLING_FRICTION = 0.22;      // rolling regime decel ≈ 70 u/s²
export const SLIDING_FRICTION = 0.75;      // sliding regime decel ≈ 165 u/s²
export const SPIN_FRICTION = 1.8;          // spin decays quickly after contact
export const STOP_THRESHOLD = 1.5;         // stop cleanly, no visible micro-drift
export const MAX_SHOT_SPEED = 450;         // full-power shot ≈ 450 u/s (table 224 u wide → ~0.5 s crossing)
export const SHOT_CLOCK_SECONDS = 30;
export const FIXED_DT = 1 / 240;           // physics fixed timestep
export const MAX_SUBSTEPS = 8;

// Pocket mouth geometry — how wide the rail opening is at each pocket.
// POCKET_MOUTH_HALF : half-width of the side pocket opening along the top/bottom rail.
// CORNER_MOUTH      : how far from the corner the left/right/top/bottom rails stay open.
export const POCKET_MOUTH_HALF = POCKET_RADIUS * 2.2;   // ~18.7 units each side of center
export const CORNER_MOUTH      = POCKET_RADIUS * 1.7;   // ~14.5 units from corner

// No jaw bumpers — simpler physics, bigger effective entry window.
// The mouth intervals below are the sole gate-keepers of pocket entry.
const _jaws: { pos: { x: number; y: number }; radius: number }[] = [];

export const TABLE: TableSpec = {
  width: TABLE_WIDTH,
  height: TABLE_HEIGHT,
  cushionRestitution: CUSHION_RESTITUTION,
  pockets: [
    // corner pockets — centered exactly on the playfield corner
    { pos: { x: 0,              y: 0             }, radius: POCKET_RADIUS },
    { pos: { x: TABLE_WIDTH,    y: 0             }, radius: POCKET_RADIUS },
    { pos: { x: 0,              y: TABLE_HEIGHT  }, radius: POCKET_RADIUS },
    { pos: { x: TABLE_WIDTH,    y: TABLE_HEIGHT  }, radius: POCKET_RADIUS },
    // side pockets — 1 unit outside the playfield so the capture zone
    // naturally straddles the rail edge (prevents double-counting the wall)
    { pos: { x: TABLE_WIDTH / 2, y: -1            }, radius: POCKET_RADIUS },
    { pos: { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT + 1 }, radius: POCKET_RADIUS },
  ],
  jaws: _jaws,
  mouths: {
    // Top rail: open near both corners and at the side pocket center
    top: [
      [-Infinity,                              CORNER_MOUTH],
      [TABLE_WIDTH / 2 - POCKET_MOUTH_HALF,   TABLE_WIDTH / 2 + POCKET_MOUTH_HALF],
      [TABLE_WIDTH - CORNER_MOUTH,             Infinity],
    ],
    // Bottom rail: mirror of top
    bottom: [
      [-Infinity,                              CORNER_MOUTH],
      [TABLE_WIDTH / 2 - POCKET_MOUTH_HALF,   TABLE_WIDTH / 2 + POCKET_MOUTH_HALF],
      [TABLE_WIDTH - CORNER_MOUTH,             Infinity],
    ],
    // Left rail: open near top-left and bottom-left corners only
    left: [
      [-Infinity,                CORNER_MOUTH],
      [TABLE_HEIGHT - CORNER_MOUTH, Infinity],
    ],
    // Right rail: mirror of left
    right: [
      [-Infinity,                CORNER_MOUTH],
      [TABLE_HEIGHT - CORNER_MOUTH, Infinity],
    ],
  },
};

export const HEAD_SPOT = { x: TABLE_WIDTH * 0.25, y: TABLE_HEIGHT / 2 };
export const FOOT_SPOT = { x: TABLE_WIDTH * 0.75, y: TABLE_HEIGHT / 2 };
