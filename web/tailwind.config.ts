import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#070914",
        panel: "#0d1226",
        accent: "#22d3ee",
        accent2: "#a855f7",
        warn: "#f59e0b",
        danger: "#ef4444",
      },
      boxShadow: {
        glow: "0 0 30px rgba(34,211,238,0.35)",
        glow2: "0 0 30px rgba(168,85,247,0.35)",
      },
      fontFamily: {
        display: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
