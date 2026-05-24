"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

interface LbItem { id: string; name: string; rating: number; wins: number; losses: number; }

export default function ProfilePage() {
  const { user, token, logout } = useAuth();
  const [lb, setLb] = useState<LbItem[]>([]);

  useEffect(() => {
    api<{ items: LbItem[] }>("/api/users/leaderboard").then(d => setLb(d.items)).catch(() => {});
  }, []);

  if (!user) {
    return <main className="min-h-screen grid place-items-center"><Link href="/login" className="btn-neon px-4 py-2 rounded-lg">Giriş Yap</Link></main>;
  }

  return (
    <main className="min-h-screen bg-grid p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center mb-6">
          <Link href="/" className="text-white/70 hover:text-white">← Anasayfa</Link>
          <button onClick={logout} className="ml-auto text-white/70 hover:text-white text-sm">Çıkış</button>
        </header>

        <div className="glass rounded-2xl p-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 grid place-items-center text-2xl font-bold text-black">
            {user.name[0]?.toUpperCase()}
          </div>
          <div>
            <div className="text-2xl font-extrabold">{user.name}</div>
            <div className="text-white/60 text-sm">Seviye {user.level ?? 1} · {user.xp ?? 0} XP · {user.coins ?? 0} 🪙</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xs uppercase text-white/50">Puan</div>
            <div className="text-3xl font-extrabold neon-text">{user.rating}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-3">
          <Stat label="Galibiyet" value={user.wins ?? 0} />
          <Stat label="Mağlubiyet" value={user.losses ?? 0} />
          <Stat label="Galibiyet Oranı" value={`${winrate(user.wins ?? 0, user.losses ?? 0)}%`} />
        </div>

        <h2 className="mt-8 mb-3 text-lg font-bold">Lider Tablosu</h2>
        <div className="glass rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase">
              <tr><th className="text-left p-3">#</th><th className="text-left p-3">Oyuncu</th><th className="text-right p-3">Puan</th><th className="text-right p-3">G/M</th></tr>
            </thead>
            <tbody>
              {lb.map((u, i) => (
                <tr key={u.id} className="border-t border-white/5">
                  <td className="p-3 text-white/50">{i + 1}</td>
                  <td className="p-3 font-semibold">{u.name}</td>
                  <td className="p-3 text-right text-cyan-300 font-mono">{u.rating}</td>
                  <td className="p-3 text-right text-white/70">{u.wins}/{u.losses}</td>
                </tr>
              ))}
              {lb.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-white/40">Henüz veri yok</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="text-xs uppercase tracking-wider text-white/50">{label}</div>
      <div className="text-2xl font-extrabold mt-1">{value}</div>
    </div>
  );
}
function winrate(w: number, l: number) {
  const t = w + l; if (!t) return 0;
  return Math.round((w / t) * 100);
}
