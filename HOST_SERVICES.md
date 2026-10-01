# Onsite host services

TSS and FRK run the website backend in Docker and these services on the host:

| Service | Existing site setup | Deployment behavior |
| --- | --- | --- |
| Web terminals | `wistron-terminals.service` | Install or update relay code and unit; restart only when changed |
| Printing | `cups.service` | Install/enable CUPS if missing; preserve drivers and queues |
| Station status | `station_status_json_gen.service` + `.timer` | Keep the existing 10-second timer and unit name; update the status script and machine keys |
| System-created hook | `host-runner.service` invoking `/opt/hooks/on-system-created.sh` | Update runner and hook code; keep site rclone configuration |

The status timer and host runner already existed on both servers before this
feature. TSS and FRK use the same hook script, but TSS has a newer host runner
that exposes stdout/stderr while a job is running. This repository uses that
version for both sites. The backend calls the hook through host runner on port
9000 when a system is created. The hook retrieves matching L11 logs using
rclone. TSS calls its remote `dell-mft:`; FRK calls the same configured
SFTP endpoint `dell:`. The installer sets `HOOK_RCLONE_REMOTE` for each site.

Host runner's token comes from the production backend's `WEBHOOK_TOKEN`.
The installer writes it to a root-only environment file; it does not print
the token. The status script uses the production backend's
`INTERNAL_API_KEY` and, if available, the development backend's separate
key. The existing `/home/falab/.config/wistron-station-status.env` remains
the status service's environment file.

## Production deployment

`prod_deploy.sh` prepares CUPS and the terminal socket before starting a
backend container. After a backend or scripts deployment it updates all four
host facilities. A frontend-only deployment does not touch them.

`host_services_deploy.sh` stages this checkout on the site over SSH and runs
the host installer as root. The installer:

1. Installs missing CUPS, terminal, rclone, Python, and Flask packages that
   can be obtained from the host's apt repositories. Node.js 20+ and ttyd
   writable support are checked; unsupported versions need manual setup.
2. Keeps the host's current terminal Node path, including the nvm versions
   already used on TSS and FRK. tmux sessions remain intact when the relay
   restarts.
3. Preserves all CUPS queues, drivers, and printer assignments. Set up
   physical queues separately using [PRINTING.md](PRINTING.md).
4. Keeps the existing `station_status_json_gen.timer` cadence. It points the
   service at the deployed status script and runs it once as a health check.
5. Installs the reviewed host runner and hook. It keeps service drop-ins,
   including TSS's `RCLONE_CONFIG=/etc/rclone/rclone.conf`. The runner
   restarts only if its code, unit, or token changed. The hook is installed
   at the actual plural path `/opt/hooks/on-system-created.sh`.

FRK's configured SFTP remote matched TSS's configured host and user, but a
read-only directory check timed out. Verify the remote can list the expected
L11 rack path before relying on log collection there.

FRK currently allows `falab` to run the installer with noninteractive
sudo. TSS does not; it allows passwordless Docker commands but requires a
password for general sudo. The default deployment checks sudo before
changing the site, so an automatic TSS deployment will stop at preflight
until that access is addressed.

For TSS today, use manual host-service mode for the website deploy:

```bash
HOST_SERVICES_MODE=manual /opt/homebrew/bin/bash ./prod_deploy.sh TSS
bash host_services_deploy.sh --prod TSS --stage-only
```

Then sign in to TSS and run with your sudo password:

```bash
sudo bash /home/falab/.cache/wistron-host-services/main/host_services/install.sh TSS
```

On a fresh host, stage and run the installer with `--prepare` before the
website deploy so the backend's CUPS and terminal mounts exist. The full
installer runs after the backend secrets are created. Do not put a sudo
password in the deployment scripts or grant passwordless root execution of
a script in `falab`'s writable home directory.

For FRK, after this branch is merged, a normal
`/opt/homebrew/bin/bash ./prod_deploy.sh FRK` runs the host installer
automatically. FRK's existing Brother queue `HLL2460DW` remains pointed to
192.168.1.10:9101. TSS and FRK printer port mappings differ; see
[PRINTING.md](PRINTING.md).

## Development

The normal development commands update the dev backend, branch-specific
station scripts, and local Vite frontend:

```bash
/opt/homebrew/bin/bash ./dev_backend_deploy.sh TSS
/opt/homebrew/bin/bash ./dev_script_deploy.sh TSS_DEV
/opt/homebrew/bin/bash ./dev_frontend_deploy.sh TSS
```

Use `FRK` and `FRK_DEV` for Franklin. These commands do not touch the
shared host terminal relay, CUPS, status timer, or host runner. To test a
changed host service explicitly, stage/apply this branch with
`bash host_services_deploy.sh --dev TSS` or `--dev FRK`. That updates
shared host code, so it may briefly reconnect website terminals or restart
host runner. TSS can use `--stage-only` followed by a manual sudo command.

To test just the status script against the development backend, deploy
development scripts and run on that site:

```bash
sudo -u falab bash -c 'set -a; source /home/falab/.config/wistron-station-status.env; set +a; SERVER_LOCATION=TSS STATION_DEV_API_BASE_URL=http://127.0.0.1:4100/api/v1 STATION_STATUS_TARGET=dev /opt/dev_scripts/feat-194/station_status_json_gen.sh'
```

Replace the site and branch as appropriate. This one-shot mode reads and
updates only development stations. The regular timer continues its existing
production flow.

## Checks

```bash
systemctl status wistron-terminals cups station_status_json_gen.timer host-runner --no-pager
systemctl list-timers station_status_json_gen.timer --no-pager
journalctl -u station_status_json_gen.service -n 50 --no-pager
journalctl -u host-runner.service -n 50 --no-pager
lpstat -r
lpstat -v
```

The one-shot status service can show `inactive` between runs. The timer
should be `active`, and the service's last result should be successful.
Docker/Compose, Tailscale/SSH, and PXE services such as DHCP, TFTP, and
Apache are separate site dependencies. The website deploy does not restart
PXE services.
