# Onsite host services

TSS and FRK each run three host-level facilities alongside the Docker backend:

| Facility | Unit | Managed by deploy? | Site-specific state |
| --- | --- | --- | --- |
| Website terminal relay | `wistron-terminals.service` | Code and unit updated after a production backend/scripts deploy | Existing `falab` tmux sessions are preserved |
| Printing | `cups.service` | CUPS installed/enabled if missing; existing queues are preserved | Printer drivers, queue names, IPs, ports, media defaults |
| Station status posting | `wistron-station-status.timer` and `.service` | Script, unit, and key refreshed after a production backend/scripts deploy | Production and optional development machine keys |

The backend Compose file mounts the host's `/run/cups`, `/etc/cups/ppd`, and
`/run/wistron-terminals`. Both production and development backends on the
same server see the same host CUPS queues and terminal relay.

Other host dependencies are already outside the website deployment: Docker
and its Compose stacks, Tailscale/SSH connectivity, and the PXE services
`isc-dhcp-server`, `tftpd-hpa`, and `apache2`. Check their health during
site maintenance. Do not automatically install or restart the PXE services
as part of a website deploy: their DHCP, boot, and web-root configuration is
site-specific and a restart can interrupt active testing.

## First bootstrap

The host must already have the site backend's
`/opt/docker/website_backend/env/secrets.env` with `INTERNAL_API_KEY`.
Install Node.js 20+ on the host if it is missing. The installer uses
`apt-get` for CUPS, jq, curl, tmux, and ttyd when needed, then validates that
ttyd supports writable terminals. On Ubuntu versions with an older ttyd,
install ttyd 1.7.4+ before continuing; see [TERMINALS.md](TERMINALS.md).

From this checkout, after production deployment, run:

```bash
bash host_services_deploy.sh --prod TSS
bash host_services_deploy.sh --prod FRK
```

The command stages the current revision over SSH and runs the installer with
`sudo -n` on the host. If `falab` cannot run this installer with
noninteractive sudo, stage the files, sign in to that host, and run
`sudo bash ~/.cache/wistron-host-services/main/host_services/install.sh TSS`
(or `FRK`). Configure narrowly scoped deployment sudo access before relying
on automatic deploys through a root-owned deployment entry point; do not
grant passwordless sudo for a script in `falab`'s writable home directory
and do not put sudo passwords in scripts.

The installer keeps CUPS queues and drivers intact. Install each physical
printer's driver and queue separately through [PRINTING.md](PRINTING.md).
TSS's print server uses Brother 9100 and Zebra 9101. FRK's uses Zebra 9100 and
Brother 9101. The current FRK Brother queue is `HLL2460DW` on 9101; there is
no need to rename it. The site Admin → Printing page selects the installed
queue and sets document defaults.

The station timer runs as `falab` every 30 seconds after the previous run
finishes. It reads a dedicated `root:falab`, mode 0640 environment file at
`/etc/wistronlabs/station-status.env`. The installer refreshes the keys from
production and development backend secret files without printing them.
Production updates use the local port 4000; a configured development backend
is mirrored on port 4100. If an older cron job already invokes
`station_status_json_gen.sh`, the installer leaves the timer disabled to
avoid duplicate writes. Remove only that legacy cron entry and rerun the
installer to migrate.

## Normal production deploy

`prod_deploy.sh` now prepares CUPS and the terminal socket before starting
a backend container, then refreshes all host services after backend or scripts
deployment on TSS/FRK. The `--only frontend` scope does not touch them.
Terminal clients briefly reconnect only when relay code or its unit changes;
the existing tmux sessions and test processes remain. A failed host setup
causes deploy to exit nonzero so the mismatch is visible.

## Development workflow

For a feature branch and site:

```bash
/opt/homebrew/bin/bash ./dev_backend_deploy.sh TSS
/opt/homebrew/bin/bash ./dev_script_deploy.sh TSS_DEV
/opt/homebrew/bin/bash ./dev_frontend_deploy.sh TSS
```

Use `FRK` and `FRK_DEV` for Franklin. The frontend command stays running
for the local Vite/SSH tunnel. These commands do not change the shared host
terminal relay or CUPS. To explicitly test relay or timer changes from the
feature branch:

```bash
bash host_services_deploy.sh --dev TSS
```

This uses the working tree and **does update the shared host relay**. Run it
when a short website terminal reconnect is acceptable. It does not modify
printer queues. To test a changed status script only against the development
backend, first deploy development scripts, then run on the onsite host:

```bash
sudo -u falab bash -c 'set -a; source /etc/wistronlabs/station-status.env; set +a; STATION_STATUS_TARGET=dev /opt/dev_scripts/feat-194/station_status_json_gen.sh'
```

Replace `feat-194` with the branch name. This one-shot mode reads the
development station list and posts only to the development backend.
The regular timer continues posting to production and mirroring dev.

## Checks and rollback

```bash
systemctl status wistron-terminals cups wistron-station-status.timer --no-pager
systemctl list-timers wistron-station-status.timer --no-pager
journalctl -u wistron-station-status.service -n 50 --no-pager
journalctl -u wistron-terminals.service -n 50 --no-pager
lpstat -r
lpstat -v
```

The status service may be inactive between runs; inspect its last exit and
journal. If the timer is disabled, inspect `crontab -u falab -l`,
`crontab -u root -l`, and `/etc/cron.d` for a legacy updater.
To roll back host code, run `host_services_deploy.sh` from the prior
revision (or reinstall that revision on the host). Queue configuration and
backend database state are not changed by the host installer.
