import { createContext, useState, useEffect, useRef, useCallback } from "react";
import { jwtDecode } from "jwt-decode";
import { useNavigate } from "react-router-dom";
import useToast from "../hooks/useToast";
import { refreshAccessToken } from "../api/authApi";
import { logoutUser } from "../api/authApi";

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const { showToast, Toast } = useToast();
  const refreshPromiseRef = useRef(null);

  const [token, setToken] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState(null);

  const login = useCallback((newToken) => {
    setToken(newToken);
  }, []);

  const clearAuthState = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const logout = useCallback(
    (redirectToAuth = true) => {
      const previousToken = token;
      if (previousToken)
        fetch(`${import.meta.env.VITE_BACKEND_URL}/terminals/disconnect`, {
          method: "POST",
          keepalive: true,
          headers: { Authorization: `Bearer ${previousToken}` },
        }).catch(() => {});
      clearAuthState();
      logoutUser().catch(() => {});
      if (redirectToAuth) navigate("/auth");
    },
    [clearAuthState, navigate, token],
  );

  useEffect(() => {
    refreshAccessToken()
      .then((res) => login(res.data.token))
      .catch(() => {})
      .finally(() => setInitializing(false));
  }, [login]);

  const refreshToken = useCallback(
    async (silent = false) => {
      if (refreshPromiseRef.current) return refreshPromiseRef.current;

      refreshPromiseRef.current = (async () => {
        try {
          const res = await refreshAccessToken();
          const nextToken = res.data.token;
          login(nextToken);
          return nextToken;
        } catch (err) {
          if (!silent) {
            showToast(
              "Your session expired. Please log in again.",
              "error",
              5000,
              "bottom-right",
            );
          }
          // Silent refresh failures should not force navigation away from public pages.
          logout(!silent);
          throw err;
        } finally {
          refreshPromiseRef.current = null;
        }
      })();

      return refreshPromiseRef.current;
    },
    [login, logout, showToast],
  );

  useEffect(() => {
    if (token) {
      try {
        const decoded = jwtDecode(token);
        const isExpired = Date.now() >= decoded.exp * 1000;
        if (isExpired) {
          refreshToken(true).catch(() => {});
          return;
        }
        setUser({
          id: decoded.userId,
          username: decoded.username,
          exp: decoded.exp,
        });

        console.log(
          "✅ Token loaded. Current time:",
          new Date(Date.now()).toLocaleString(),
        );
        console.log(
          "🕒 Token expiry:",
          new Date(decoded.exp * 1000).toLocaleString(),
        );
      } catch (err) {
        console.error("Invalid token:", err);
        logout(false);
      }
    } else {
      setUser(null);
    }
  }, [token, logout, refreshToken]);

  // Auto-refresh check
  useEffect(() => {
    const interval = setInterval(() => {
      if (token && user) {
        console.log("⏳ Current time:", new Date(Date.now()).toLocaleString());
        console.log(
          "🕒 Token expiry:",
          new Date(user.exp * 1000).toLocaleString(),
        );

        if (Date.now() >= user.exp * 1000 - 5 * 60 * 1000) {
          // 5 minutes before expiry

          console.log("🔄 Token is close to expiry, refreshing…");
          refreshToken(true);
        }
      }
    }, 60_000);

    return () => clearInterval(interval);
  }, [token, user, refreshToken]);

  return (
    <AuthContext.Provider value={{ token, login, logout, user, refreshToken, initializing }}>
      {children}
      <Toast />
    </AuthContext.Provider>
  );
}
