# feat-183: public access and local account management

This records the local `feat-183` implementation and the live changes still needed. The code has **not** been deployed to TSS, FRK, or the home server.
No credentials, invitation codes, IP addresses, or live infrastructure settings belong in this file.

## Agreed topology and intent

- TSS and FRK production servers, and the home server, already run Tailscale.
- Employee browsers cannot use Tailscale but can reach the home public IP.
- The home server runs Docker and Nginx Proxy Manager (NPM) directly; there is no VM or spare ingress machine.
- UniFi forwards public HTTPS to home NPM. Cloudflare hosts DNS; existing `gioweo.com` records are DNS-only and a home script updates the changing home IP.
- Expose the TSS and FRK frontend and backend hostnames over HTTPS through home NPM and the existing tailnet. Keep SSH off the public route.
- Existing home and work traffic would share the NPM container and home host. Docker networks and narrow tailnet grants can reduce access but cannot provide complete host isolation.
- Work authorization for this route has been confirmed by the user; do not re-ask.
- The user wants the entire website, including `/l10_logs/`, protected by login. The only public application paths should be those needed to sign in, redeem an invitation, and complete account recovery.

## Account behavior implemented on this branch

- Current email/password accounts remain local to each backend database.
- Add a distinct super-admin role for invitations and password resets; ordinary admin keeps existing site-management rights.
- A super admin creates an invitation for a required recipient name and email, with a random, one-use code tied to that email. Redeeming the code creates an approved user who chooses a password. New users have no terminal access.
- The Admin page should list invitations with recipient, creator, creation time, expiry, time remaining, and status: active, redeemed, expired, or revoked. Retain historical metadata for audit; reveal a code only when created, never in the list. Store only its hash.
- Invite expiry recommendation: 7 days with explicit revocation and regeneration, rather than a global revolving code.
- Users can change passwords while logged in. A super admin can generate a strong temporary password for a forgotten-password reset. Recommendation: 48-hour expiry; temporary login can only set a new password; reset invalidates existing sessions. Store a password hash, not plaintext.
- The previous emailed reset-token route should be removed or replaced. Its current JWT is not purpose-separated from login JWTs.
- Passkeys are mandatory for every interactive user. New users set a compliant password and enroll a passkey during invite redemption. Existing users are directed to a limited migration flow after a correct old-password login: enter a one-use, account-bound enrollment code issued by a super admin; choose a new compliant password; register and verify a passkey. That limited session grants no site data, files, general API operations, or terminal access. Full sessions require the new password and verified passkey. Invalidate all pre-migration access and refresh sessions at cutover.
- Apply one server-side password policy to invitations, migration, ordinary password changes, and temporary-password resets. The implementation uses a 15-character minimum, accepts up to 256 characters and password managers, and uses zxcvbn to reject common or guessable choices. It does not query an external breach corpus. There are no arbitrary character mixes or periodic rotations. All legacy users must choose a new password during migration.
- For subsequent passkey additions, require the existing passkey. Support multiple passkeys per account and an audited super-admin recovery flow for lost devices.
- Codes and temporary passwords expire after 7 days and 48 hours respectively. The first super admin is promoted with `node src/scripts/bootstrapSuperAdmin.js person@example.com` inside each backend container after migration 0019; it prints a one-use enrollment code. Run it separately at TSS and FRK. Do not copy that code into this repository.
- All old access/refresh tokens lack a required token type and are rejected. Existing accounts also default to `must_change_password=true`, so their next password login only opens enrollment. An enrollment code, new password, and verified passkey are required before full login.
- Migration 0019 clears all existing terminal grants. An admin must deliberately regrant terminal access after each user completes enrollment.
- Access cookies are short lived and refresh sessions rotate in the database. Password changes, temporary resets, recovery, and disabling an account increment `session_version` to invalidate earlier sessions. Terminal permission is explicit even for admins.
- New passwords use versioned scrypt hashes; legacy bcrypt hashes are accepted only for the limited migration login and are replaced when the user enrolls. This avoids bcrypt's long-password truncation behavior.
- The new backend route `GET /api/v1/auth/check` returns HTTP 204 for a valid session and HTTP 401 otherwise. Use it in the NPM authorization rule for static `/l10_logs/`.
- There is no self-service second-passkey enrollment UI yet. Lost passkeys require a super-admin recovery code. The recovery flow still requires the user's password; if that is also lost, reset the password first, have the user change it, then issue the recovery code.

## Source-review findings before public exposure

These are code observations; live NPM, UniFi, DNS, and host firewall settings were not inspected.
Findings 1–4 and 6 are addressed in this branch's application routes; finding 2 remains open for static files served directly by onsite Nginx/NPM until the live proxy rule is changed. Finding 7 needs live host configuration and a frontend security-header review.

1. **Critical: unauthenticated writes.** `website_backend/src/routes/stations.js` permits POST, PATCH, and DELETE without authentication. `website_backend/src/routes/systemTags.js` permits tag detachment/deletion without authentication.
2. **High: data and files are public through the backend.** Many system, pallet, station, history, photo, and log GET routes have no authentication. `GET /api/v1/systems/batch-export-unit-data` lists export jobs and `GET /api/v1/systems/batch-export-unit-data/:job_id/download` downloads archives without authentication. Review whether NPM also serves `/l10_logs/` directly from `/var/www/html`.
3. **High: open registration and weak reset boundaries.** Anyone can call `POST /api/v1/auth/register` and immediately log in. Password-reset JWTs share the signing secret and `userId` shape with access and refresh JWTs; reset tokens are not one-use. Password reset and password change do not revoke other sessions.
4. **High: stale session permissions.** JWT validation checks the signature but not a current account-approved/disabled state. `/auth/refresh` does not query account state. Add server-side session/version checks so suspensions and resets take effect; preserve immediate terminal permission checks.
5. **High impact of terminal compromise.** Website terminal permission reaches a full `falab` shell. Apply MFA or equivalent stronger login to terminal-capable accounts, narrow super-admin powers, and audit terminal grants.
6. **Medium: migration metadata routes.** Any authenticated user can add/delete migration records through `website_backend/src/routes/migrations.js`; reserve for a deploy-only credential or a tightly scoped role.
7. **Medium: security controls and host binding.** The Express entry point has no global request throttling or general security-header policy. The Compose app port binds the host by default (`${APP_HOST_PORT}:3000`), so verify site firewalls/NPM are the only intended entry point. CORS allowlists do not replace authentication.
8. **Compatibility: station scripts need service authentication.** `scripts/boot.sh`, `scripts/check_station.sh`, `scripts/station_status_json_gen.sh`, and parts of `scripts/l10_test.sh` call currently public API GETs; `station_status_json_gen.sh` PATCHes stations without authentication. Before enforcing login everywhere, migrate these calls to a narrowly scoped machine credential or a private server-only path. The deployment script applies SQL migrations over SSH directly, so removing the public migrations API should not break that deployment path.

## Live rollout sequence

1. Back up each database. Ensure `INTERNAL_API_KEY` is a unique strong secret per site in the backend container and station runtime environment. Deploy migration 0019 and this branch together. The production deploy script currently insists on a clean `main` branch, so review/merge this branch before using it. Test the application with the new `npm ci --omit=dev` Docker build.
2. Bootstrap one super admin per site and issue enrollment codes for existing users. Announce that everyone must change their password and enroll a passkey. Verify invitation, enrollment, recovery, reset, logout, refresh, disabled account, and terminal permission behavior on a staging or controlled site before public DNS cutover.
3. On the home UniFi router, keep only inbound TCP 80/443 to home NPM for these sites. Do not add port 22 or backend/terminal host port forwards. Remove the old onsite router HTTPS/backend forwards so the server public IP cannot bypass home ingress. Bind Docker backend ports to loopback or the needed tailnet interface and use host firewall rules to reject other sources.
4. In Cloudflare, create DNS-only records for `tss.wistronlabs.com`, `frk.wistronlabs.com`, `backend.tss.wistronlabs.com`, and `backend.frk.wistronlabs.com` pointing to the home public IP. Extend the existing home IP updater to these four records; verify it cannot accidentally edit unrelated records. Configure four home NPM hosts with valid public certificates and upstreams to the respective tailnet addresses. The web origin and backend must keep their exact hostnames for passkey origin/RP ID and cookies. Allow WebSocket upgrade for terminal backend routes. Validate Docker-to-tailnet reachability before changing DNS.
5. Protect static `/l10_logs/` on both frontend NPM hosts with an authorization subrequest to the matching backend `/api/v1/auth/check`, forwarding the browser's `Cookie` header. Serve the files only after a 204 result; 401/403 must not expose a directory listing or file. If NPM cannot express this safely, serve logs through the authenticated backend instead. Remove any direct onsite public static route and test nested paths, guessed file URLs, and directory indexes without a session.
6. Restrict home-to-work tailnet traffic to the exact web/backend ports and work-server sources; restrict work-to-home traffic as much as the tailnet policy permits. Keep the work proxy container on a separate Docker network and deny its lateral access to home LAN/services with UniFi and host firewall rules. Because the current work ingress shares the home Docker host and NPM, this is risk reduction, not complete isolation. Complete isolation requires a dedicated ingress host or equivalent separate trust boundary.
7. From a network outside both home and work, verify all four hostnames, trusted HTTPS, anonymous API and log denial, logged-in files/exports, WebSockets, invitation expiry, account disable, no public SSH, and rollback to the previous DNS/routing if health checks fail.

The following is the intended Nginx shape for each frontend host, subject to the live NPM template and the actual work-server web ports. Replace both upstreams with that site's tailnet address and test the generated Nginx config before enabling it. The `/_auth_l10` location must stay internal. The site-specific `Host` header must match the backend hostname.

```nginx
location = /_auth_l10 {
    internal;
    proxy_pass http://SITE_TAILNET_IP:4000/api/v1/auth/check;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Host backend.tss.wistronlabs.com;
    proxy_set_header Cookie $http_cookie;
}
location ^~ /l10_logs/ {
    auth_request /_auth_l10;
    proxy_pass http://SITE_TAILNET_IP:80;
}
```

For FRK, use `backend.frk.wistronlabs.com` in the `Host` header. Tailnet traffic is encrypted by Tailscale even if the upstream application port is HTTP; retain or replace the current self-signed onsite HTTPS only after checking the actual listener and certificate behavior. Do not let a public onsite route bypass this check.

## Local verification and remaining limits

- Frontend production build passes. Terminal integration tests pass with local socket access. Migration and password policy tests pass. Shell syntax checks pass.
- Frontend and backend production dependency audits report zero known advisories after lockfile updates and removal of the unused legacy mailer.
- Repository-wide frontend lint still has pre-existing errors across unrelated files; the new account section has no lint error.
- This branch has not had an end-to-end browser/WebAuthn test against a live HTTPS origin or a live database. The live NPM, UniFi, Cloudflare, tailnet ACLs, and site firewalls have not been inspected or changed. Do not switch public DNS until the four ingress paths and `/l10_logs/` gate are confirmed.

## Handoff to home-server work

Open this repository on the home server (or copy this file there) and start a new Codex chat in that workspace. Ask it to inspect the live NPM, Tailscale policy, UniFi, Docker, and DNS configuration against this file before changing any live settings. Do not put secrets or live invite codes in the chat or repository.
