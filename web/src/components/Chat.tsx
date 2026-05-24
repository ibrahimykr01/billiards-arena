"use client";
import React, { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";

interface Msg { from: string; text: string; t: number; }

const QUICK = ["İyi oyundu!", "Güzel vuruş!", "Selam!", "Üzgünüm!", "Bir saniye...", "İyi şanslar!"];

export const Chat: React.FC<{
  socket: Socket | null;
  roomId: string;
  onActivateCheat?: () => void;
  onActivatePink?: () => void;
}> = ({ socket, roomId, onActivateCheat, onActivatePink }) => {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socket) return;
    const onHistory = (h: Msg[]) => setMsgs(h);
    const onMsg = (m: Msg) => setMsgs(prev => [...prev, m].slice(-100));
    socket.on("chat:history", onHistory);
    socket.on("chat:msg", onMsg);
    return () => { socket.off("chat:history", onHistory); socket.off("chat:msg", onMsg); };
  }, [socket]);

  useEffect(() => { listRef.current?.scrollTo({ top: 99999 }); }, [msgs.length]);

  const send = (t: string) => {
    if (!t || !socket) return;
    // Secret cheat trigger: exact uppercase "HACK" enables cheat mode locally
    // and is NOT broadcast to the chat.
    if (t === "HACK") {
      onActivateCheat?.();
      setMsgs(prev => [...prev, { from: "sistem", text: "Hile modu etkinleştirildi", t: Date.now() }].slice(-100));
      return;
    }
    // Secret pink trigger: broadcast which seat activated it so both players
    // see the effect. onActivatePink is kept as fallback for AI mode.
    if (t.trim().toLowerCase() === "kocamasigim") {
      socket.emit("pink:activate", { id: roomId });
      onActivatePink?.();
      setMsgs(prev => [...prev, { from: "sistem", text: "💗 Pembe mod aktif", t: Date.now() }].slice(-100));
      return;
    }
    socket.emit("chat:send", { id: roomId, text: t });
  };

  return (
    <div className="glass rounded-xl p-3 flex flex-col h-full max-h-[420px]">
      <div className="text-xs uppercase tracking-wider text-white/60 mb-2">Sohbet</div>
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-1 pr-1">
        {msgs.map((m, i) => (
          <div key={i} className="text-sm">
            <span className="text-cyan-300 font-semibold">{m.from}:</span>{" "}
            <span className="text-white/85">{m.text}</span>
          </div>
        ))}
        {msgs.length === 0 && <div className="text-white/30 text-xs">Nazik ol, iyi eğlenceler!</div>}
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        {QUICK.map(q => (
          <button key={q} onClick={() => send(q)}
                  className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10">
            {q}
          </button>
        ))}
      </div>
      <form onSubmit={e => { e.preventDefault(); send(text); setText(""); }} className="mt-2 flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)}
               placeholder="Mesaj yaz..."
               maxLength={240}
               className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm focus:outline-none focus:border-cyan-400" />
        <button type="submit" className="text-sm px-3 rounded bg-cyan-500/80 hover:bg-cyan-400 text-black font-semibold">Gönder</button>
      </form>
    </div>
  );
};

export default Chat;
