import React, { createContext, useContext, useState } from "react";
import { api, setAuthToken } from "../services/api";
import { AuthUser } from "../types";
import { stopTracking } from "../services/locationTracker";

interface AuthContextValue {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  async function login(email: string, password: string) {
    const { token, user: loggedInUser } = await api.login(email, password);
    setAuthToken(token);
    setUser(loggedInUser);
  }

  async function logout() {
    await stopTracking();
    setAuthToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
