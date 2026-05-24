"use client";
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "./api";

export interface UserDto {
  id: string;
  name: string;
  email?: string;
  rating: number;
  coins?: number;
  xp?: number;
  level?: number;
  wins?: number;
  losses?: number;
  avatar?: string;
  bio?: string;
}

interface AuthContextValue {
  user: UserDto | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
  loginGuest: (name: string) => void;
}

const Ctx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("ba_token") : null;
    const guest = typeof window !== "undefined" ? localStorage.getItem("ba_guest") : null;
    if (t) {
      setToken(t);
      api<{ user: UserDto }>("/api/auth/me", { token: t })
        .then(d => setUser(d.user))
        .catch(() => { localStorage.removeItem("ba_token"); setToken(null); })
        .finally(() => setLoading(false));
    } else if (guest) {
      setUser({ id: "guest", name: guest, rating: 1000 });
      setLoading(false);
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const d = await api<{ token: string; user: UserDto }>("/api/auth/login", {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    localStorage.setItem("ba_token", d.token);
    localStorage.removeItem("ba_guest");
    setToken(d.token); setUser(d.user);
  }, []);

  const register = useCallback(async (email: string, name: string, password: string) => {
    const d = await api<{ token: string; user: UserDto }>("/api/auth/register", {
      method: "POST", body: JSON.stringify({ email, name, password }),
    });
    localStorage.setItem("ba_token", d.token);
    localStorage.removeItem("ba_guest");
    setToken(d.token); setUser(d.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("ba_token");
    localStorage.removeItem("ba_guest");
    setToken(null); setUser(null);
  }, []);

  const loginGuest = useCallback((name: string) => {
    localStorage.setItem("ba_guest", name);
    localStorage.removeItem("ba_token");
    setToken(null);
    setUser({ id: "guest", name, rating: 1000 });
  }, []);

  return <Ctx.Provider value={{ user, token, loading, login, register, logout, loginGuest }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
