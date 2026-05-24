export type BallGroup = "solid" | "stripe" | "cue" | "eight";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Ball {
  id: number;            // 0 = cue, 1-7 solids, 8 = eight, 9-15 stripes
  group: BallGroup;
  pos: Vec2;
  vel: Vec2;
  spin: number;          // simplified scalar english (top/back); side spin in `side`
  side: number;          // side english scalar
  pocketed: boolean;
  radius: number;
}

export interface TableSpec {
  width: number;        // playfield width (between cushions)
  height: number;       // playfield height
  cushionRestitution: number;
  pockets: { pos: Vec2; radius: number }[];
  // Circular bumpers that form the pocket "jaws" — the curved tips of the
  // cushion rails on either side of each pocket mouth. Balls deflect off
  // these like rounded cushion ends instead of bouncing off a flat wall.
  jaws: { pos: Vec2; radius: number }[];
  // Pocket mouth zones along each cushion. While a ball's center is inside
  // a mouth (along the cushion axis), the flat wall reflection is disabled
  // so the ball can travel into the pocket without bouncing off the rail.
  // Each entry is the interval along the cushion's axis.
  mouths: {
    top: [number, number][];     // x intervals along y=0 cushion
    bottom: [number, number][];  // x intervals along y=H cushion
    left: [number, number][];    // y intervals along x=0 cushion
    right: [number, number][];   // y intervals along x=W cushion
  };
}

export interface ShotInput {
  power: number;        // 0..1
  angle: number;        // radians, direction cue ball will travel
  spinX: number;        // -1..1 side english (left/right)
  spinY: number;        // -1..1 vertical english (back/top)
}

export interface GameState {
  balls: Ball[];
  turn: 0 | 1;                       // player index
  groups: [BallGroup | null, BallGroup | null]; // assigned groups per player
  ballInHand: boolean;
  shotInProgress: boolean;
  winner: 0 | 1 | null;
  foul: boolean;
  message: string;
  shotClock: number;                 // seconds remaining
  frame: number;                     // tick counter
}

export interface PlayerInfo {
  id: string;
  name: string;
  rating: number;
  avatar?: string;
}

export interface RoomSnapshot {
  id: string;
  state: GameState;
  players: (PlayerInfo | null)[];
  spectators: number;
}
