import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, unwrap } from "../api/client";
import type { Role, User } from "../types";

type AuthContextValue = {
  user: User | null;
  profile: unknown;
  loading: boolean;
  login: (email: string, password: string, role?: Role) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const token = localStorage.getItem("medichain_access_token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const me = await unwrap<{ user: User; profile: unknown }>(api.get("/auth/me"));
      setUser(me.user);
      setProfile(me.profile);
    } catch {
      localStorage.removeItem("medichain_access_token");
      localStorage.removeItem("medichain_refresh_token");
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(email: string, password: string, role?: Role) {
    const result = await unwrap<{ user: User; accessToken: string; refreshToken: string }>(api.post("/auth/login", { email, password, role }));
    localStorage.setItem("medichain_access_token", result.accessToken);
    localStorage.setItem("medichain_refresh_token", result.refreshToken);
    setUser(result.user);
    await refresh();
  }

  function logout() {
    localStorage.removeItem("medichain_access_token");
    localStorage.removeItem("medichain_refresh_token");
    setUser(null);
    setProfile(null);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo(() => ({ user, profile, loading, login, logout, refresh }), [user, profile, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
