"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AUTH_CHANGED_EVENT,
  fetchMe,
  loginRequest,
  logoutLocally,
  readAuthToken,
  readCachedUser,
  writeAuthToken,
  writeCachedUser,
  type AuthUser,
} from "@/lib/auth/auth-client";

type AuthContextValue = {
  user: AuthUser | null;
  status: "loading" | "authenticated" | "anonymous";
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  refresh: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const hasBootstrapped = useRef(false);

  const setUser = useCallback((next: AuthUser | null) => {
    setUserState(next);
    writeCachedUser(next);
    setStatus(next ? "authenticated" : "anonymous");
  }, []);

  const refresh = useCallback(async () => {
    const token = readAuthToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await fetchMe();
      if (me) {
        setUser(me);
      } else {
        // Token is no longer valid (expired, server-side mismatch, etc.).
        logoutLocally();
        setUser(null);
      }
    } catch {
      // Network blip — keep cached user so the app stays usable offline.
    }
  }, [setUser]);

  // Initial bootstrap: hydrate from cache instantly, then verify with server.
  useEffect(() => {
    if (hasBootstrapped.current) return;
    hasBootstrapped.current = true;

    const cached = readCachedUser();
    if (cached) {
      setUserState(cached);
      setStatus("authenticated");
    } else {
      setStatus(readAuthToken() ? "loading" : "anonymous");
    }

    void refresh();
  }, [refresh]);

  // Keep multiple tabs in sync when login/logout happens.
  useEffect(() => {
    function onChanged() {
      const cached = readCachedUser();
      setUserState(cached);
      setStatus(cached ? "authenticated" : "anonymous");
    }
    window.addEventListener(AUTH_CHANGED_EVENT, onChanged);
    window.addEventListener("storage", onChanged);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onChanged);
      window.removeEventListener("storage", onChanged);
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { token, user: authedUser } = await loginRequest(email, password);
      writeAuthToken(token);
      setUser(authedUser);
      return authedUser;
    },
    [setUser]
  );

  const logout = useCallback(() => {
    logoutLocally();
    setUser(null);
  }, [setUser]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout, refresh, setUser }),
    [user, status, login, logout, refresh, setUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return ctx;
}
