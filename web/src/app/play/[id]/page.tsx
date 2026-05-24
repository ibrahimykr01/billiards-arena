"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getSocket } from "@/lib/socket";
import { GameState, PlayerInfo, ShotInput } from "@billiards/shared";
import { createInitialState, planPerfectShot } from "@billiards/shared";
import PoolTable from "@/components/PoolTable";
import HUD from "@/components/HUD";
import Chat from "@/components/Chat";
import { motion, AnimatePresence } from "framer-motion";
import { playClack, playCushion, playPocket, playCueStrike } from "@/lib/audio";

export default function PlayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const { user, token } = useAuth();
  const [state, setState] = useState<GameState>(() => createInitialState());
  const [players, setPlayers] = useState<(PlayerInfo | null)[]>([null, null]);
  const [mySeat, setMySeat] = useState<0 | 1 | null>(null);
  const [roomId, setRoomId] = useState<string>("");
  const [winner, setWinner] = useState<{ winner: PlayerInfo | null; loser: PlayerInfo | null } | null>(null);
  const [connected, setConnected] = useState(false);
  const [cheat, setCheat] = useState(false);
  const [pinkMode, setPinkMode] = useState(false);
  const [pinkSeats, setPinkSeats] = useState<number[]>([]);
  const [autoMode, setAutoMode] = useState(false);
  const autoTimerRef = useRef<number | null>(null);
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const animRef = useRef<{
    start: number;
    frames: { t: number; balls: { id: number; x: number; y: number; pocketed: boolean }[] }[];
    sounds: { t: number; type: string; strength: number }[];
    soundIdx: number;
    finalState: GameState;
    duration: number;
  } | null>(null);
  const rafRef = useRef<number | null>(null);

  const tickAnimation = () => {
    const a = animRef.current;
    if (!a) return;
    const now = performance.now();
    const elapsed = (now - a.start) / 1000;

    // play sounds whose time we've passed
    while (a.soundIdx < a.sounds.length && a.sounds[a.soundIdx].t <= elapsed) {
      const s = a.sounds[a.soundIdx++];
      if (s.type === "ball") playClack(s.strength);
      else if (s.type === "cushion") playCushion(s.strength);
      else if (s.type === "pocket") playPocket();
    }

    if (elapsed >= a.duration || a.frames.length === 0) {
      // finished
      setState(a.finalState);
      animRef.current = null;
      rafRef.current = null;
      return;
    }

    // find current and next frame for interpolation
    let i = 0;
    while (i + 1 < a.frames.length && a.frames[i + 1].t <= elapsed) i++;
    const f0 = a.frames[i];
    const f1 = a.frames[Math.min(i + 1, a.frames.length - 1)];
    const span = Math.max(0.0001, f1.t - f0.t);
    const k = Math.max(0, Math.min(1, (elapsed - f0.t) / span));

    setState(prev => {
      const balls = prev.balls.map(b => {
        const p0 = f0.balls.find(x => x.id === b.id);
        const p1 = f1.balls.find(x => x.id === b.id);
        if (!p0 || !p1) return b;
        return {
          ...b,
          pos: { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k },
          pocketed: p1.pocketed,
        };
      });
      return { ...prev, balls, shotInProgress: true };
    });
    rafRef.current = requestAnimationFrame(tickAnimation);
  };

  const isAI = id === "ai";
  const difficulty = params.get("difficulty") || "medium";
  const tDifficulty = (d: string) =>
    ({ easy: "Kolay", medium: "Orta", hard: "Zor", pro: "Profesyonel" } as Record<string, string>)[d] || d;

  useEffect(() => {
    const guest = typeof window !== "undefined" ? localStorage.getItem("ba_guest") : null;
    if (!user && !guest) { router.replace("/lobby"); return; }
    const s = getSocket(token, guest || undefined);
    socketRef.current = s;
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));

    const onJoined = ({ id: rid, seat, snapshot }: any) => {
      setRoomId(rid);
      setMySeat(seat);
      setState(snapshot.state);
      setPlayers(snapshot.players);
    };
    const onState = ({ state: st }: any) => {
      // ignore canonical state during active animation; finalState already applied
      if (animRef.current) return;
      setState(st);
    };
    const onShot = (payload: any) => {
      // Cancel any running animation before starting a new one to prevent
      // two concurrent RAF loops from racing and corrupting state.
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      playCueStrike(payload.shot?.power ?? 0.6);
      animRef.current = {
        start: performance.now(),
        frames: payload.frames as { t: number; balls: { id: number; x: number; y: number; pocketed: boolean }[] }[],
        sounds: payload.sounds as { t: number; type: string; strength: number }[],
        soundIdx: 0,
        finalState: payload.finalState as GameState,
        duration: payload.duration as number,
      };
      setState(prev => ({ ...prev, shotInProgress: true }));
      tickAnimation();
    };
    const onPlayers = (p: any) => setPlayers(p);
    const onOver = (o: any) => setWinner(o);
    const onErr = (m: string) => alert(m);

    const onPinkSeat = ({ seat }: { seat: number }) => {
      setPinkSeats(prev => prev.includes(seat) ? prev : [...prev, seat]);
    };

    s.on("room:joined", onJoined);
    s.on("game:state", onState);
    s.on("game:shot", onShot);
    s.on("room:players", onPlayers);
    s.on("game:over", onOver);
    s.on("error:msg", onErr);
    s.on("pink:seat", onPinkSeat);

    if (isAI) {
      s.emit("ai:start", { difficulty });
    } else {
      // join existing room
      s.emit("room:join", { id });
    }

    return () => {
      s.off("room:joined", onJoined);
      s.off("game:state", onState);
      s.off("game:shot", onShot);
      s.off("room:players", onPlayers);
      s.off("game:over", onOver);
      s.off("error:msg", onErr);
      s.off("pink:seat", onPinkSeat);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      animRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onShoot = (shot: ShotInput) => socketRef.current?.emit("game:shoot", { id: roomId, shot });
  const onPlaceCue = (x: number, y: number) => socketRef.current?.emit("game:placeCue", { id: roomId, x, y });

  const onAutoShot = () => {
    if (mySeat === null || state.turn !== mySeat) return;
    if (state.shotInProgress || state.winner !== null || state.ballInHand) return;
    try {
      const shot = planPerfectShot(state, mySeat);
      onShoot(shot);
    } catch (e) {
      console.error("planPerfectShot failed", e);
    }
  };

  // Auto mode: when it's my turn and animation is idle, fire a perfect shot.
  useEffect(() => {
    if (!cheat || !autoMode) return;
    if (mySeat === null) return;
    if (state.turn !== mySeat) return;
    if (state.shotInProgress || state.winner !== null) return;
    if (state.ballInHand) return; // user must place cue manually for now
    if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current);
    autoTimerRef.current = window.setTimeout(() => {
      onAutoShot();
    }, 600);
    return () => {
      if (autoTimerRef.current) {
        window.clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheat, autoMode, state.turn, state.shotInProgress, state.winner, state.ballInHand, mySeat]);

  return (
    <main className="min-h-screen bg-grid p-3 md:p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex items-center mb-4 gap-3">
          <Link href="/lobby" className="text-white/70 hover:text-white text-sm">← Lobi</Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`}></span>
            <span className="text-white/70">{connected ? "Bağlı" : "Bağlanılıyor..."}</span>
            {roomId && <span className="font-mono px-2 py-0.5 bg-white/5 rounded border border-white/10">#{roomId}</span>}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <div>
            <HUD state={state} players={players} mySeat={mySeat} />
            <div className="mt-4">
              <PoolTable
                state={state}
                mySeat={mySeat}
                onShoot={onShoot}
                onPlaceCue={onPlaceCue}
                cheat={cheat}
                autoMode={autoMode}
                onAutoShot={onAutoShot}
                onToggleAuto={() => setAutoMode(v => !v)}
                pinkMode={pinkMode}
                pinkSeats={pinkSeats}
              />
            </div>
          </div>
          <aside className="space-y-3">
            <div className="glass rounded-xl p-3">
              <div className="text-xs uppercase tracking-wider text-white/60">Maç</div>
              <div className="text-sm mt-1">
                <div>Mod: <span className="font-semibold">{isAI ? `Yapay Zeka (${tDifficulty(difficulty)})` : "Çevrimiçi"}</span></div>
                {!isAI && roomId && <div>Paylaşılabilir kod: <span className="font-mono">{roomId}</span></div>}
              </div>
            </div>
            <Chat
              socket={socketRef.current}
              roomId={roomId}
              onActivateCheat={() => setCheat(true)}
              onActivatePink={() => setPinkMode(true)}
            />
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {winner && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="glass rounded-2xl p-8 max-w-md w-full text-center">
              <div className="text-sm uppercase tracking-widest text-white/60">Maç bitti</div>
              <div className="text-3xl font-extrabold neon-text mt-2">
                {(winner.winner?.name || "Kazanan") + " kazandı!"}
              </div>
              <div className="text-white/60 text-sm mt-2">{state.message}</div>
              <div className="flex gap-2 justify-center mt-6">
                <button onClick={() => location.reload()} className="btn-neon rounded-lg px-4 py-2">Revânş</button>
                <button onClick={() => router.push("/lobby")} className="rounded-lg px-4 py-2 bg-white/10">Lobi</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
