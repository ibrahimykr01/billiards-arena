"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <main className="min-h-screen bg-grid relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.07),transparent_60%)]" />
      <header className="relative max-w-6xl mx-auto px-6 py-5 flex items-center">
        <div className="text-xl font-extrabold tracking-tight">
          <span className="neon-text">BILLIARDS ARENA</span>
        </div>
        <nav className="ml-auto flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="text-white/80">{user.name}</span>
              <span className="text-white/40">·</span>
              <span className="text-white/60">★ {user.rating}</span>
              <button onClick={logout} className="text-white/60 hover:text-white">Çıkış</button>
            </>
          ) : (
            <button onClick={() => router.push("/lobby")} className="btn-neon rounded-lg px-3 py-1.5">
              Oyna
            </button>
          )}
        </nav>
      </header>

      <section className="relative max-w-6xl mx-auto px-6 pt-12 pb-20">
        <motion.h1
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
          className="text-5xl md:text-7xl font-extrabold leading-tight">
          Profesyonel 8 Top Bilardo. <span className="neon-text">Canlı.</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6 }}
          className="mt-4 text-white/70 max-w-2xl">
          Gerçekçi fizik, sunucu otoriteli çok oyunculu mod, dereceli sıralama ve yapay zeka rakipler.
          Tarayıcınızda oynayın — masaüstü veya mobil.
        </motion.p>

        <div className="mt-10 grid md:grid-cols-3 gap-4">
          <Card title="Hızlı Maç" desc="Sana uygun bir rakibi hızlıca bul." cta="Hemen Oyna"
                onClick={() => router.push("/lobby?mm=1")} />
          <Card title="Yapay Zekaya Karşı Oyna" desc="4 farklı zorluk seviyesinde antrenman yap." cta="Antrenman"
                onClick={() => router.push("/play/ai")} />
          <Card title="Özel Oda" desc="Kod ile oda oluştur veya katıl." cta="Lobiye Git"
                onClick={() => router.push("/lobby")} />
        </div>

        <div className="grid md:grid-cols-4 gap-3 mt-12 text-sm">
          {[
            ["Gerçekçi", "Momentum, sürtünme, efe/dönüş, bant fiziği"],
            ["Çok Oyunculu", "Sunucu otoriteli, düşük gecikmeli Socket.IO"],
            ["YZ Rakipler", "Kolay → Profesyonel, insansı hata payı"],
            ["Dereceli", "Puan, lider tablosu, maç geçmişi"],
          ].map(([t, d]) => (
            <div key={t} className="glass rounded-xl p-3">
              <div className="font-semibold">{t}</div>
              <div className="text-white/60 text-xs mt-1">{d}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Card({ title, desc, cta, onClick }: { title: string; desc: string; cta: string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="text-left glass rounded-2xl p-5 hover:shadow-glow transition">
      <div className="text-lg font-bold">{title}</div>
      <div className="text-white/60 text-sm mt-1">{desc}</div>
      <div className="mt-4 inline-block btn-neon rounded-lg px-3 py-1.5 text-sm">{cta} →</div>
    </motion.button>
  );
}
