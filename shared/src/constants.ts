import { TableSpec } from "./types";

// Units: meters scaled. We use a virtual "table unit" coord system.
// Table playfield: 2.24m x 1.12m (9-foot pool). We use 224 x 112 internal units.
export const BALL_RADIUS = 2.85;          // ~57mm diameter
export const TABLE_WIDTH = 224;
export const TABLE_HEIGHT = 112;
export const POCKET_RADIUS = 6.2;
export const CUSHION_RESTITUTION = 0.78;
export const BALL_RESTITUTION = 0.96;
// Friction values are tuned for a constant-deceleration (Coulomb) model
// in physics.ts. They are scaled there into units/sec^2.
// Higher = slows faster.
export const ROLLING_FRICTION = 0.06;      // gentle tail: ball coasts to a stop, no snap
export const SLIDING_FRICTION = 0.25;      // sliding (high-speed): keeps speed mid-shot
export const SPIN_FRICTION = 0.9;          // top/back & side spin decay (exponential)
export const STOP_THRESHOLD = 0.5;         // velocity magnitude considered "stopped"
export const MAX_SHOT_SPEED = 517;         // units/sec at full power
export const SHOT_CLOCK_SECONDS = 30;
export const FIXED_DT = 1 / 240;           // physics fixed timestep
export const MAX_SUBSTEPS = 8;

// Pocket jaw geometry — the rounded ends of cushion rails framing the mouths.
// JAW_OFFSET: how far from the corner pocket center, along the cushion, the
// cushion ends and the jaw begins.
// JAW_RADIUS: radius of the jaw bumper itself.
// SIDE_JAW_SEP: half-separation between the two jaws around each side pocket.
export const JAW_OFFSET = POCKET_RADIUS * 1.45;
export const JAW_RADIUS = POCKET_RADIUS * 0.55;
// Increased from 1.55× to 2.2× so the effective side-pocket entry window is
// ~14.8 units wide (≈2.6× ball diameter) instead of the original 6.7 units
// which was so tight that only dead-center shots could score.
export const SIDE_JAW_SEP = POCKET_RADIUS * 2.2;

// Jaw bumpers — two per pocket. The jaw center sits at distance JAW_RADIUS
// in from the cushion line so its outer edge is flush with the rail face.
// Corner pockets have no jaw bumpers — the mouth intervals in TABLE.mouths
// already open the cushion walls correctly. Circular jaw bumpers at corners
// block nearly every approach angle (the entry window shrinks to < 1 ball
// radius) so they are omitted here. Only side pockets have jaws.
const _jaws: { pos: { x: number; y: number }; radius: number }[] = [
  // top side pocket
  { pos: { x: TABLE_WIDTH / 2 - SIDE_JAW_SEP, y: JAW_RADIUS }, radius: JAW_RADIUS },
  { pos: { x: TABLE_WIDTH / 2 + SIDE_JAW_SEP, y: JAW_RADIUS }, radius: JAW_RADIUS },
  // bottom side pocket
  { pos: { x: TABLE_WIDTH / 2 - SIDE_JAW_SEP, y: TABLE_HEIGHT - JAW_RADIUS }, radius: JAW_RADIUS },
  { pos: { x: TABLE_WIDTH / 2 + SIDE_JAW_SEP, y: TABLE_HEIGHT - JAW_RADIUS }, radius: JAW_RADIUS },
];

export const TABLE: TableSpec = {
  width: TABLE_WIDTH,
  height: TABLE_HEIGHT,
  cushionRestitution: CUSHION_RESTITUTION,
  pockets: [
    { pos: { x: 0, y: 0 }, radius: POCKET_RADIUS },
    { pos: { x: TABLE_WIDTH / 2, y: -1 }, radius: POCKET_RADIUS * 0.95 },
    { pos: { x: TABLE_WIDTH, y: 0 }, radius: POCKET_RADIUS },
    { pos: { x: 0, y: TABLE_HEIGHT }, radius: POCKET_RADIUS },
    { pos: { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT + 1 }, radius: POCKET_RADIUS * 0.95 },
    { pos: { x: TABLE_WIDTH, y: TABLE_HEIGHT }, radius: POCKET_RADIUS },
  ],
  jaws: _jaws,
  mouths: {
    top: [
      [-Infinity, JAW_OFFSET],
      [TABLE_WIDTH / 2 - SIDE_JAW_SEP, TABLE_WIDTH / 2 + SIDE_JAW_SEP],
      [TABLE_WIDTH - JAW_OFFSET, Infinity],
    ],
    bottom: [
      [-Infinity, JAW_OFFSET],
      [TABLE_WIDTH / 2 - SIDE_JAW_SEP, TABLE_WIDTH / 2 + SIDE_JAW_SEP],
      [TABLE_WIDTH - JAW_OFFSET, Infinity],
    ],
    left: [
      [-Infinity, JAW_OFFSET],
      [TABLE_HEIGHT - JAW_OFFSET, Infinity],
    ],
    right: [
      [-Infinity, JAW_OFFSET],
      [TABLE_HEIGHT - JAW_OFFSET, Infinity],
    ],
  },
};

export const HEAD_SPOT = { x: TABLE_WIDTH * 0.25, y: TABLE_HEIGHT / 2 };
export const FOOT_SPOT = { x: TABLE_WIDTH * 0.75, y: TABLE_HEIGHT / 2 };
