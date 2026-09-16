# Station web terminals

## Behavior

- Stations → **Terminals**, or **Open Terminal** on a station row.
- Shared typing into the existing `falab` tmux session `stn_<station number>`.
- Create the session if missing. Opening a terminal never starts a test automatically.
- One strip of terminal views. Each view has its own Single, Side by side, Stacked, or Four panels layout. Stacked and four-panel views have double height; dividers resize only the current view.
- **+** creates an empty view. Add stations in its empty panels. Drag terminal headers to move into empty panels or swap occupied ones; hover another view tab to reveal it, or drop onto **+** to create a one-panel view. Hidden views disconnect; tmux continues running.
- Views, panel assignments, selection, and divider sizes are saved per website user/location in that browser. Existing saved groups become views without losing their assignments. Pop-out windows have separate saved layouts.
- Closing a view disconnects its panels and removes the view. Closing a terminal removes only that panel; a view disappears when its last terminal is closed or moved away. Neither action stops tmux.
- Use the pencil beside a view tab (or double-click its title) to rename that view. **Reset to default** restores its automatic title, such as “4 stations.” View names are saved with the layout and survive panel moves and layout changes. Individual stations retain their station numbers.
- Empty panels use the existing react-select component: searchable by station number or service tag, numerically sorted, with a 240px scrollable menu.
- Layout and station selection use the same styled react-select control; Layout has search disabled.
- In Single layout, the top fullscreen button expands the terminal itself and the panel offers **Open in new tab** directly. Split layouts retain each terminal’s **View** menu and a separate workspace fullscreen button.
- Individual-terminal fullscreen shows only **Close full screen** in its header; closing a terminal and other actions are available after exiting fullscreen.
- Expanding a layout adds empty panels. Shrinking it preserves overflow terminals in new one-panel views directly beside the current tab.
- Visible saved panels reconnect when entering Terminals. Closing panels, leaving the workspace, or logging out detaches the browser; tmux jobs keep running.
- Connected-user names identify browser users only; ordinary SSH/tmux clients are not included.
- Admins inherit access. Admin → Users → **Terminal Access** grants access to other users. Click **Save Users**.
- Website logout disconnects that user's browser terminal connections on that backend, including other devices. Permission removal is enforced within about 10 seconds.
- A panel renews its connection lease every 5 seconds. A lease expires after 90 seconds without renewal, including when a browser sleeps. Click **Reconnect** after returning if needed.
- Backend restarts invalidate web connections; host ttyd restarts detach web clients. Neither intentionally stops tmux jobs. A host reboot does not preserve running tmux jobs.
- Terminals have full `falab` shell privileges, including its available keys, files, processes and sudo policy. A station URL is not shell isolation. All authorized users can type concurrently.

## Network layout

```text
Browser over Tailscale
  → router's existing HTTPS forwarding (443)
  → Nginx Proxy Manager on the testing server
  → backend.<location>.wistronlabs.com (existing backend port)
  → authenticated terminal HTTP/WebSocket gateway in backend container
  → /run/wistron-terminals/control.sock (private host Unix socket)
  → one ttyd process/socket per station
  → falab's existing tmux server
```

**No new router ports, station TCP ports, domains, or SSH forwarding rules are needed.** The frontend still uses its current proxy destination. Do not point NPM directly at ttyd; the backend checks website access before forwarding HTTP or WebSocket traffic.

One host service supports both the production and development backends on a location's server. Both attach to the same live station sessions. Only enable terminals on a development backend whose authorized users should operate those live sessions.

## 1. Ubuntu 24.04 host setup (repeat on TSS and FRK)

Use a checkout containing `terminal_host/` and `website_backend/src/services/terminalProxy.js`. The installer reads these files; it does not need the database or website running.

If the repository is only on your development computer, copy the installer files from its root:

```bash
rsync -av --relative terminal_host/ website_backend/src/services/terminalProxy.js falab@tss.wistronlabs.com:/tmp/wistron-terminal-install/
```

Repeat with `falab@frk.wistronlabs.com` for FRK. On the destination server, run the installer from `/tmp/wistron-terminal-install` in place of the repository root below.

Install dependencies:

```bash
sudo apt-get update
sudo apt-get install -y tmux ttyd
node --version
ttyd --version
```

The host service requires Node.js 20 or newer and ttyd 1.7.4 or newer (`-W` writable support). The backend container's Node installation does not install Node on the host. If Node is missing or too old, install a supported Node.js release on the host before continuing. For example, NodeSource's Node 22 packages:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/wistron-node-setup.sh
sudo -E bash /tmp/wistron-node-setup.sh
sudo apt-get install -y nodejs
```

If the packaged ttyd is too old, use a current upstream release matching the host architecture. The installer uses ttyd from sudo’s PATH. Passing `--node "$(command -v node)"` supplies falab’s Node executable explicitly, including installations managed by nvm. Keep that Node version installed: the systemd unit stores its absolute path.

From the repository root:

```bash
sudo bash terminal_host/install.sh --node "$(command -v node)"
sudo systemctl status wistron-terminals --no-pager
sudo journalctl -u wistron-terminals -n 50 --no-pager
```

The installer copies the host service and relay into `/opt/wistron-terminals`, installs a systemd unit, and starts it as `falab`. It does not store a Linux password. Its working directory is `/home/falab`, matching deployment of your station scripts. Existing regular terminal users can continue attaching normally.

`/run/wistron-terminals` has mode 0700 and is preserved across service restarts so Docker bind mounts remain valid. The supplied backend container runs as root and can reach that directory; switching the container to a non-root user would require explicit socket directory permissions.

The service uses the default tmux socket for `falab`, matching `join_station.sh`. If a location uses a custom tmux socket, adapt both before enabling the service there.

## 2. Backend setup

Apply migration **0018-terminal-access.sql** through the existing migration/deployment workflow. Deploy the backend and frontend changes normally; migration 0018 must run before the updated auth routes are used.

The updated `website_backend/docker-compose.yml` mounts:

```yaml
- "/run/wistron-terminals:/run/wistron-terminals:ro"
```

Add these settings to the backend's existing `env/site.env` (not a new Compose override):

**TSS production:**

```dotenv
TERMINAL_HOST_SOCKET=/run/wistron-terminals/control.sock
TERMINAL_PUBLIC_ORIGIN=https://backend.tss.wistronlabs.com
FRONTEND_URL=https://tss.wistronlabs.com
```

**FRK production:**

```dotenv
TERMINAL_HOST_SOCKET=/run/wistron-terminals/control.sock
TERMINAL_PUBLIC_ORIGIN=https://backend.frk.wistronlabs.com
FRONTEND_URL=https://frk.wistronlabs.com
```

`TERMINAL_PUBLIC_ORIGIN` is just the browser-facing backend origin, with **no `/api/v1` suffix**. For the development backend, use its actual existing HTTPS backend hostname and frontend URL, not the production hostname. For the local Vite frontend, set `FRONTEND_URL=http://localhost:5173`. Vite proxies `/api/v1` (including terminal frames and WebSockets) to the configured development backend. Localhost cookies are adapted only by the dev proxy; production cookies remain Secure. Use the same hostname and port as `FRONTEND_URL`. Restart Vite after updating its configuration and sign in again so the browser receives cookies through the local proxy.

Recreate the app container so it picks up both the mount and environment settings. Run in the appropriate backend directory, using its existing Compose project name:

```bash
# Production, matching the supplied TSS container names:
sudo docker compose -p website_backend up -d --build app

# Development, in its separate backend directory:
sudo docker compose -p website_backend_dev up -d --build app
```

These commands assume migrations have already been applied by the normal deployment workflow. They do not apply migrations themselves. FRK should use the Compose project name configured for that location.

If the host service is restarted, the browser may need **Reconnect**. If you manually delete/recreate `/run/wistron-terminals`, recreate the backend container too, because its mount can point at the old directory.

Terminals stay disabled when the terminal environment settings are absent. Other website functions remain available without installing ttyd.

## 3. Nginx Proxy Manager

On each server, edit the existing **backend** Proxy Host:

- TSS production: `backend.tss.wistronlabs.com` → existing server destination, **4000**.
- TSS development: its existing backend hostname → existing destination, **4100**.
- FRK: keep that site's existing backend destination and port.
- Turn **Websockets Support** on.
- Keep the existing HTTPS certificate and HTTPS access.
- Keep `/api/v1/terminals/...` paths intact; do not rewrite them or add a separate terminal upstream.

In the Proxy Host's **Advanced** configuration, add these directives if they are not already configured:

```nginx
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

Keep any existing advanced directives; do not duplicate conflicting settings. NPM's Websockets Support supplies the Upgrade/Connection handling. If you have custom locations covering `/api` or `/api/v1`, make sure those locations also forward WebSocket upgrades to the backend.

The frontend Proxy Host needs no new terminal route because it embeds the terminal through the backend hostname. A custom CSP on the frontend must permit frames from its backend hostname. The backend supplies a `frame-ancestors` policy permitting the configured `FRONTEND_URL` and itself. Remove a conflicting `X-Frame-Options: DENY` or `SAMEORIGIN` on the backend terminal responses if your existing proxy injects one.

## 4. Verify on the actual location

1. Sign in as an admin and open Stations → Terminals → a station.
2. Confirm the session is `stn_<number>` and the shell runs as `falab` (`tmux display-message -p '#S'` and `whoami`).
3. Open the same station from another authorized browser and from a regular terminal. Confirm both see the same output and can type.
4. Split two stations, resize, refresh, and confirm the layout restores.
5. Close a browser panel and verify its tmux session/test stays running.
6. Remove a non-admin user's Terminal Access and save. Verify their active browser terminal disconnects within about 10 seconds.
7. Log out and verify pop-out browser terminals disconnect. Existing ordinary SSH sessions remain unaffected.
8. Verify a user without Terminal Access cannot open the terminal, including by copying its URL.

A sudo prompt behaves as in a normal shared terminal. The website does not store or automatically enter the sudo password.

## Troubleshooting

- **Terminal service is not configured:** check `TERMINAL_HOST_SOCKET`, HTTPS `TERMINAL_PUBLIC_ORIGIN`, and `FRONTEND_URL` in the running backend container.
- **Terminal host unavailable:** check `systemctl status wistron-terminals`, host journal, and the container's Unix socket mount. Ensure ttyd supports `-W` and `falab` can run tmux.
- **Connecting / disconnected with a working HTML frame:** inspect browser Network for the terminal `/ws` request. It should upgrade to **101**. Check NPM Websockets Support, forwarded paths, cookies and origin settings.
- **Frame refused:** check frontend `frame-src`, backend `frame-ancestors` and proxy-injected X-Frame-Options.
- **Unexpected session:** the service uses `falab`'s default tmux socket. Confirm that regular users are not using a custom `tmux -L` or `-S` socket.
- **Terminal size differs across viewers:** tmux uses the largest attached viewport. Smaller panels may display only part of that shared terminal; maximize the panel when needed. Website splits and tmux's own BIOS/test splits are separate.
- **Browser resumes after sleep:** use Reconnect. Expired leases do not silently regain access.

## Development verification

```bash
npm run test:terminals --prefix website_backend
npm run test:terminals --prefix website_frontend
npm run build --prefix website_frontend
```

The gateway tests exercise authenticated HTTP and WebSocket relays over an actual Unix socket, including logout and permission revocation. The host tests use substitute tmux/ttyd executables to verify session/process lifecycle. A live Ubuntu/ttyd/NPM smoke test is still required after setup.

References: [ttyd reverse proxy](https://github.com/tsl0922/ttyd/wiki/Nginx-reverse-proxy), [ttyd client options](https://github.com/tsl0922/ttyd/wiki/Client-Options), [NodeSource installation](https://github.com/nodesource/distributions).

## Local development cookie fix

If an older dev build shows **Terminal access expired** inside the iframe, update the dev backend and restart the frontend:

```bash
/opt/homebrew/bin/bash ./dev_backend_deploy.sh TSS_DEV
/opt/homebrew/bin/bash ./dev_frontend_deploy.sh TSS_DEV
```

Keep the remote dev backend's `FRONTEND_URL=http://localhost:5173` and `TERMINAL_PUBLIC_ORIGIN=https://devbackend.tss.wistronlabs.com`. Sign out and back in at `http://localhost:5173`. Network requests and the terminal iframe should now use `http://localhost:5173/api/v1/...`; Vite forwards them to the dev backend over HTTPS. No third-party cookie exception is needed. The backend still checks WebSocket Origin against its configured backend or frontend origin. Host-service reinstallation and NPM changes are not needed for this fix.

### Terminal scrolling

Click a terminal to control it (blue outline). While active, scrolling stays in
the terminal. Click the terminal header or anywhere outside the terminal content to release control and scroll the page.
Inactive terminals continue displaying output. Escape remains available to shell
programs.

The host enables tmux mouse mode for each `stn_N` session so the wheel can browse
tmux history. This also affects regular SSH clients attached to that session.
After updating `terminal_host/server.cjs`, reinstall/restart the host service
using the installation steps above and reconnect browser terminals.

The frontend focuses terminal frames with `preventScroll` and does not lock page
overflow. The backend proxy adds scroll containment CSS inside the terminal HTML
(including compressed ttyd responses), following the [iframe scrolling guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overscroll-behavior).
Deploy both frontend and backend for this fix; no new host-service reinstall is
needed if station mouse support is already installed. Existing browser frames
need to be reopened to load the updated HTML.
