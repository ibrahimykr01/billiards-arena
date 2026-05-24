"use client";
import React from "react";
import { GameState, PlayerInfo, BallGroup } from "@billiards/shared";

interface Props {
  state: GameState;
  players: (PlayerInfo | null)[];
  mySeat: 0 | 1 | null;
}

const BALL_COLORS: Record<number, string> = {
  1: "#f5c518", 2: "#1659d9", 3: "#d61f1f", 4: "#5b2a8b", 5: "#e07b1c",
  6: "#0d6e3a", 7: "#7a1a1a", 8: "#0a0a0a",
  9: "#f5c518", 10: "#1659d9", 11: "#d61f1f", 12: "#5b2a8b",
  13: "#e07b1c", 14: "#0d6e3a", 15: "#7a1a1a",
};

const BallChip: React.FC<{ id: number }> = ({ id }) => {
  const isStripe = id > 8;
  const color = BALL_COLORS[id];
  return (
    <div className="relative w-5 h-5 rounded-full border border-black/40 overflow-hidden shrink-0"
         style={{ background: isStripe ? "#fafafa" : color, boxShadow: "inset 0 -2px 3px rgba(0,0,0,0.25), inset 0 1.5px 2px rgba(255,255,255,0.5)" }}>
      {isStripe && (
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-2.5"
             style={{ background: color }} />
      )}
      <div className="absolute inset-0 grid place-items-center">
        <div className="rounded-full bg-white border border-black/10 grid place-items-center"
             style={{ width: 9, height: 9 }}>
          <span className="font-bold text-[7px] text-black leading-none">{id}</span>
        </div>
      </div>
    </div>
  );
};

export const HUD: React.FC<Props> = ({ state, players, mySeat }) => {
  const remainingByGroup = (g: BallGroup) =>
    state.balls.filter(b => b.group === g && !b.pocketed).length;

  const pocketedFor = (seat: 0 | 1): number[] => {
    const grp = state.groups[seat];
    if (!grp) return [];
    return state.balls.filter(b => b.group === grp && b.pocketed).map(b => b.id).sort((a, b) => a - b);
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      {[0, 1].map(i => {
        const p = players[i];
        const active = state.turn === i && state.winner === null;
        const grp = state.groups[i];
        return (
          <div key={i}
               className={`glass rounded-xl p-3 transition ${active ? "ring-2 ring-cyan-400 shadow-glow" : ""}`}>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 grid place-items-center font-bold text-black">
                {(p?.name || "?")[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="font-semibold truncate">
                  {p?.name || "Bekleniyor..."} {mySeat === i && <span className="text-xs text-cyan-300">(sen)</span>}
                </div>
                <div className="text-xs text-white/50">Puan {p?.rating ?? "-"}</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[10px] uppercase text-white/50">Grup</div>
                <div className="text-sm font-semibold">
                  {grp ? `${grp === "solid" ? "DÜZ" : "ÇİZGİLİ"} (${remainingByGroup(grp)})` : "—"}
                </div>
              </div>
            </div>
            {/* Pocketed balls tray */}
            <div className="mt-2 min-h-[24px] flex items-center gap-1 flex-wrap">
              {pocketedFor(i as 0 | 1).map(id => <BallChip key={id} id={id} />)}
              {grp && pocketedFor(i as 0 | 1).length === 0 && (
                <span className="text-[10px] text-white/30 uppercase tracking-wider">Henüz top sokulmadı</span>
              )}
            </div>

            {active && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-white/60">Süre</span>
                <div className="flex-1 h-1.5 bg-white/10 rounded">
                  <div className="h-1.5 bg-cyan-400 rounded transition-all"
                       style={{ width: `${Math.max(0, Math.min(100, (state.shotClock / 30) * 100))}%` }} />
                </div>
                <span className="text-white/80 font-mono w-6 text-right">{Math.max(0, state.shotClock)}</span>
              </div>
            )}
          </div>
        );
      })}
      {state.message && (
        <div className="col-span-2 text-center text-sm text-cyan-200 glass rounded-xl py-2">{state.message}</div>
      )}
    </div>
  );
};

export default HUD;
