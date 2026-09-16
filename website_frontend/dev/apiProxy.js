// Local-only cookie adaptation. The remote backend keeps Secure/HttpOnly cookies.
export function localCookie(cookie) {
  return cookie
    .replace(/;\s*Secure\b/gi, "")
    .replace(/;\s*Domain=[^;]*/gi, "")
    .replace(/;\s*SameSite=[^;]*/gi, "; SameSite=Lax");
}

export function createDevApiProxy(backendUrl) {
  const target = new URL(backendUrl).origin;
  return {
    "^/api/v1(?:/|$)": {
      target,
      changeOrigin: true,
      ws: true,
      // Preserve Origin: the backend validates it against FRONTEND_URL.
      configure(proxy) {
        proxy.on("proxyRes", (response, request) => {
          const hostname = new URL(`http://${request.headers.host}`).hostname;
          if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return;
          const cookies = response.headers["set-cookie"];
          if (cookies)
            response.headers["set-cookie"] = cookies.map(localCookie);
          // The frame is now served by this Vite origin, not the remote backend.
          if (request.url.startsWith("/api/v1/terminals/views/")) {
            response.headers["content-security-policy"] =
              "frame-ancestors 'self'";
            delete response.headers["x-frame-options"];
          }
        });
      },
    },
  };
}
