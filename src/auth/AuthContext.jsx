import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchCurrentUser, loginRequest, registerRequest } from "../api/auth.js";
import { TOKEN_KEY } from "../api/client.js";
import { normalizeUser } from "../lib/user.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => window.localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    if (!window.localStorage.getItem(TOKEN_KEY)) return null;
    try {
      return normalizeUser(JSON.parse(window.localStorage.getItem("lightflow-user")));
    } catch {
      return null;
    }
  });

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchCurrentUser,
    enabled: Boolean(token),
    retry: false,
  });

  useEffect(() => {
    if (meQuery.data) {
      const next = normalizeUser(meQuery.data);
      setUser(next);
      window.localStorage.setItem("lightflow-user", JSON.stringify(next));
    }
  }, [meQuery.data]);

  useEffect(() => {
    if (meQuery.error?.code === 401) {
      clearSession();
    }
  }, [meQuery.error]);

  function persistSession(tokenResp) {
    window.localStorage.setItem(TOKEN_KEY, tokenResp.token);
    const next = normalizeUser(tokenResp.user);
    window.localStorage.setItem("lightflow-user", JSON.stringify(next));
    setToken(tokenResp.token);
    setUser(next);
    queryClient.setQueryData(["auth", "me"], tokenResp.user);
  }

  function clearSession() {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem("lightflow-user");
    setToken(null);
    setUser(null);
    queryClient.removeQueries({ queryKey: ["auth", "me"] });
  }

  const loginMutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: persistSession,
  });

  const registerMutation = useMutation({
    mutationFn: registerRequest,
    onSuccess: persistSession,
  });

  const value = useMemo(() => ({
    user,
    token,
    loading: Boolean(token) && meQuery.isLoading && !user,
    login: (payload) => loginMutation.mutateAsync(payload),
    register: (payload) => registerMutation.mutateAsync(payload),
    logout: clearSession,
    updateUser: (next) => {
      const merged = normalizeUser({ ...user, ...next, creditBalance: next.credits ?? next.creditBalance ?? user?.creditBalance });
      setUser(merged);
      window.localStorage.setItem("lightflow-user", JSON.stringify(merged));
    },
  }), [user, token, meQuery.isLoading, loginMutation, registerMutation]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
