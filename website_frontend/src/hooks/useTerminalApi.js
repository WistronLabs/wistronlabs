import { useCallback, useContext, useRef } from "react";
import { AuthContext } from "../context/AuthContext";

export default function useTerminalApi() {
  const auth = useContext(AuthContext);
  const current = useRef(auth);
  current.current = auth;
  return useCallback(async (path, method = "GET") => {
    const send = (token) =>
      fetch(`${import.meta.env.VITE_BACKEND_URL}/terminals${path}`, {
        method,
        credentials: "include",
        keepalive: method === "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    let response = await send(current.current.token);
    if (response.status === 401)
      response = await send(await current.current.refreshToken(true));
    if (response.status === 204) return null;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Terminal request failed");
    // Connect responses contain a public backend URL. In local dev, keep the
    // iframe and its WebSocket on Vite's same-origin /api proxy as well.
    if (
      import.meta.env.DEV &&
      import.meta.env.VITE_BACKEND_URL.startsWith("/") &&
      data?.url
    ) {
      const view = new URL(data.url);
      data.url = view.pathname + view.search;
    }
    return data;
  }, []);
}
