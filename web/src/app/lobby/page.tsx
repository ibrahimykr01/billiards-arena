"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getSocket } from "@/lib/socket";
import Link from "next/link";

function NamePrompt({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onDone(trimmed);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm grid place-items-center z-50 p-6">
      <div className="glass rounded-2xl p-8 w-full max-w-sm">
        <h2 className="text-2xl font-extrabold neon-text mb-1">Merhaba!</h2>
        <p className="text-white/60 text-sm mb-6">Oynamaya başlamak için bir isim gir.</p>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Adın"
          maxLength={20}
          className="w-full bg-black/40 border border-white/15 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-cyan-400"
        />
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="btn-neon rounded-lg w-full py-3 mt-4 font-bold text-base disabled:opacity-40"
        >
          Oyna →
        </button>
      </div>
    </div>
  );
}

export default function LobbyPage() {
  const { user, loginGuest } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);

  const getName = () => {
    if (user) return user.name;
    return typeof window !== "undefined" ? localStorage.getItem("ba_guest") : null;
  };

  const withName = (action: () => void) => {
    if (getName()) { action(); return; }
    pendingAction.current = action;
    setShowPrompt(true);
  };

  const handleNameDone = (name: string) => {
    loginGuest(name);
    setShowPrompt(false);
    pendingAction.current?.();
    pendingAction.current = null;
  };

  const getSocket_ = () => {
    const guest = typeof window !== "undefined" ? localStorage.getItem("ba_guest") : null;
    return getSocket(user ? (user as any).token ?? null : null, guest || undefined);
  };

  useEffect(() => {
    if (!getName()) return;
    const s = getSocket_();
    s.on("room:joined", ({ id }: { id: string }) => router.push(`/play/${id}`));
    s.on("matchmaking:waiting", () => setWaiting(true));
    s.on("error:msg", (m: string) => setErr(m));
    if (params.get("mm") === "1") {
      withName(() => s.emit("matchmaking:join"));
    }
    return () => {
      s.off("room:joined");
      s.off("matchmaking:waiting");
      s.off("error:msg");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const onCreate = () => withName(() => {
    getSocket_().emit("room:create", { mode: "casual", isPrivate: true });
  });

  const onJoin = () => {
    if (!code) return;
    withName(() => getSocket_().emit("room:join", { id: code.toUpperCase() }));
  };

  const onMatchmaking = () => withName(() => {
    getSocket_().emit("matchmaking:join");
    setWaiting(true);
  });

  return (
    <>
      {showPrompt && <NamePrompt onDone={handleNameDone} />}
      <main className="min-h-screen bg-grid p-6">
        <div className="max-w-4xl mx-auto">
          <header className="flex items-center mb-6">
            <Link href="/" className="text-white/70 hover:text-white">← Anasayfa</Link>
            <h1 className="ml-auto text-2xl font-extrabold neon-text">Lobi</h1>
            {getName() && (
              <span className="ml-4 text-white/50 text-sm">{getName()}</span>
            )}
          </header>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="glass rounded-2xl p-5">
              <h2 className="text-lg font-bold">Hızlı Maç</h2>
              <p className="text-white/60 text-sm mt-1">Sana benzer seviyede bir rakip bulalım.</p>
              <button onClick={onMatchmaking} disabled={waiting} className="btn-neon rounded-lg px-4 py-2 mt-4">
                {waiting ? "Aranıyor..." : "Maç Bul"}
              </button>
              {waiting && (
                <button onClick={() => { setWaiting(false); getSocket_().emit("matchmaking:cancel"); }}
                        className="ml-2 text-white/70 underline">İptal</button>
              )}
            </div>

            <div className="glass rounded-2xl p-5">
              <h2 className="text-lg font-bold">Özel Oda</h2>
              <p className="text-white/60 text-sm mt-1">6 karakterlik kodla arkadaşınla oyna.</p>
              <div className="mt-4 flex gap-2">
                <button onClick={onCreate} className="btn-neon rounded-lg px-4 py-2">Oluştur</button>
                <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6}
                       placeholder="KOD"
                       className="bg-black/30 border border-white/10 rounded px-3 py-2 uppercase tracking-widest" />
                <button onClick={onJoin} className="rounded-lg px-4 py-2 bg-white/10 hover:bg-white/20">Katıl</button>
              </div>
              {err && <div className="text-red-400 text-sm mt-2">{err}</div>}
            </div>

            <div className="glass rounded-2xl p-5 md:col-span-2">
              <h2 className="text-lg font-bold">Yapay Zekaya Karşı Oyna</h2>
              <p className="text-white/60 text-sm mt-1">4 farklı zorluk seviyesinde antrenman yap.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  { id: "easy", label: "Kolay" },
                  { id: "medium", label: "Orta" },
                  { id: "hard", label: "Zor" },
                  { id: "pro", label: "Profesyonel" },
                ].map(d => (
                  <button key={d.id}
                          onClick={() => withName(() => router.push(`/play/ai?difficulty=${d.id}`))}
                          className="rounded-lg px-4 py-2 bg-white/10 hover:bg-white/20">
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
