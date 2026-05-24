"use client";

let ctx: AudioContext | null = null;
function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return ctx;
}

// Generate procedural click/clack sounds — no external assets required.
export function playClack(strength = 1) {
  const c = getCtx(); if (!c) return;
  const s = Math.max(0.05, Math.min(1, strength));
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(420 + 600 * s, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(180, c.currentTime + 0.08);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.4 * s, c.currentTime + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.18);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.2);

  // tiny noise burst for authenticity
  const buf = c.createBuffer(1, 1024, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 80);
  const src = c.createBufferSource(); src.buffer = buf;
  const ng = c.createGain(); ng.gain.value = 0.15 * s;
  src.connect(ng); ng.connect(c.destination); src.start();
}

export function playCushion(strength = 1) {
  const c = getCtx(); if (!c) return;
  const s = Math.max(0.05, Math.min(1, strength));
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(120 + 80 * s, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(70, c.currentTime + 0.12);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.3 * s, c.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.25);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.3);
}

export function playPocket() {
  const c = getCtx(); if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(60, c.currentTime);
  o.frequency.linearRampToValueAtTime(35, c.currentTime + 0.4);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.5);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.55);
}

export function playCueStrike(power: number) {
  const c = getCtx(); if (!c) return;
  const s = Math.max(0.1, Math.min(1, power));
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "square";
  o.frequency.setValueAtTime(620 + 300 * s, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(220, c.currentTime + 0.06);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.35 * s, c.currentTime + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.15);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.18);
}

export function playUI(kind: "hover" | "click" = "click") {
  const c = getCtx(); if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = kind === "hover" ? 880 : 1320;
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.08, c.currentTime + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.08);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.1);
}
