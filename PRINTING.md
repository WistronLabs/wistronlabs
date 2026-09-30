# Direct printing (feat-188)

The browser renders each label or pallet sheet as a PDF and opens an in-site preview. The preview offers **Print through server**, **System print dialog**, and **Save PDF**. Copies, orientation, and scaling start from the Admin > Printing defaults and can be changed for one job in the preview. The browser prepares a PDF at the configured media size with the selected rotation and scaling; that same PDF is displayed, downloaded, or submitted to the server. The system print dialog can still apply the computer's own printer settings. Server printing posts the prepared PDF to the authenticated backend on the same site. The backend sends it to a CUPS queue on the onsite server; it never sends printer traffic through the home HTTPS proxy.

Each site's backend stores its own printers and document profiles in `global_settings`. A TSS admin can configure TSS independently of FRK. Admins can add printers from installed CUPS queues and assign each document type to a printer. The default profiles send 2 × 1 inch System ID, RMA, L10 Pass, and Pending Parts labels to a Zebra queue and US Letter pallet sheets to a Brother queue. The Zebra and Brother drivers may differ by site.

## Onsite host setup

1. On each site's Linux server, identify the exact Zebra and Brother model and install working PPD/filter packages for those models. Use the Brother driver specific to that site. Confirm that the onsite server can reach its local `192.168.1.10` on TCP 9100 and 9101.
2. Run `scripts/setup_site_printers.sh` as root with `ZEBRA_PPD` and `BROTHER_PPD` set to readable paths. It creates `wistron_zebra` at `socket://192.168.1.10:9101` and `wistron_brother` at `socket://192.168.1.10:9100`. Install `cups`, `cups-client`, and `cups-filters` first if the host is not Debian/Ubuntu.
3. Check `lpstat -p` and `lpoptions -p wistron_zebra -l` / `lpoptions -p wistron_brother -l`. Send one test PDF to each queue and verify physical size, margins, orientation, and output. Admin > Printing loads each queue's supported sizes from CUPS and offers them in a dropdown. Select the driver's exact size name, which may differ from the initial `Custom.2x1in` or `Letter` profile value.
4. Deploy the backend image and Compose change together. The backend container needs the mounted host CUPS socket at `/run/cups/cups.sock`, a read-only mount of `/etc/cups/ppd`, and the `cups-client` package from its Dockerfile. The PPD mount lets the admin page list sizes when `lpoptions` inside the container cannot retrieve the queue's PPD over CUPS. In **Admin > Printing**, select the two installed queues and save each document profile. Print one label and one pallet sheet from the site preview.

For another printer or print server, install its driver on that site's host and run `sudo scripts/add_site_printer.sh QUEUE_NAME PRINT_SERVER_IP PORT DRIVER_PPD_OR_MODEL`. The last argument can be a readable PPD path or an installed CUPS model shown by `lpinfo -m`. The new queue then appears under **Admin > Printing**. Add it there and assign any document type to it. This also works for another Zebra; each physical printer has its own queue and driver settings.

The print API accepts authenticated PDFs up to 15 MB. It accepts only the configured CUPS queues, never a browser-supplied IP or socket address. One print click submits one job; a successful response means CUPS accepted the job, not that paper exited the printer. Server printing remains unavailable until the queues are installed and selected.

## TSS Zebra proof of concept

TSS runs Ubuntu 22.04 and reaches the print server at `192.168.1.10:9101`. No CUPS scheduler or queues are currently installed. Start with the Zebra only; the Brother port `9100` did not accept a connection during the initial check.

Install this queue on the onsite host `tss` (the host running the TSS dev backend), rather than on `leonserver`. The backend container mounts `tss`'s `/run/cups` socket, so a queue installed only on `leonserver` will not appear in TSS Admin > Printing. In the sample Zebra ZPL driver, `w144h72` is the exact 2 × 1 inch PageSize; its initial default may be a different size. Confirm the printer's actual DPI and media tracking before choosing queue defaults.

1. At the Zebra, load 2 × 1 inch labels, run SmartCal, and print its configuration report. Confirm that the printer uses ZPL and note its resolution (203 or 300 dpi). Zebra's configuration report and calibration instructions are in its ZD421 user guide.
2. On the TSS host, install the print stack: `sudo apt-get update && sudo apt-get install -y cups cups-client cups-filters`, then `sudo systemctl enable --now cups`. Confirm `test -S /run/cups/cups.sock`.
3. Check `lpinfo -m | grep -i 'Zebra ZPL'`. If `drv:///sample.drv/zebra.ppd` is listed, create a queue with `sudo lpadmin -p wistron_zebra -E -v socket://192.168.1.10:9101 -m drv:///sample.drv/zebra.ppd`. Otherwise install a suitable ZPL driver/PPD and use `-P /path/to/driver.ppd`. The repository's `scripts/add_site_printer.sh` supports either form.
4. Inspect `lpstat -v wistron_zebra`, `lpstat -p wistron_zebra`, and `lpoptions -p wistron_zebra -l`. Confirm the driver supports a 2 × 1 inch medium. In Admin > Printing, select its reported media name; for the sample Zebra driver, choose `w144h72` (2 × 1 inches).
5. Deploy the TSS dev backend and run the local frontend as described below. In Admin > Printing, select `wistron_zebra` for the Zebra entry, leave Brother unconfigured, and save. Generate one System ID label, save its PDF, check that its page is 2 × 1 inches, then click **Print through server** with one copy. Check `lpstat -o wistron_zebra` and the physical label. If CUPS accepts the job but no label exits, inspect `journalctl -u cups` and the printer state.

The ZD421's PDF Direct feature is optional. The proof of concept should use a CUPS driver that converts PDF to ZPL; a raw queue is insufficient unless PDF Direct is actually enabled on that unit.

## Test with a local frontend and onsite dev backend

The existing dev frontend script opens an SSH tunnel to the selected site's dev backend on port 4100, then starts Vite on `http://localhost:5173`. Vite proxies `/api/v1` through that tunnel. Printing follows `browser → Vite → SSH tunnel → onsite dev backend → host CUPS socket → site print server`. This tests the application and local print route; it bypasses the home HTTPS ingress.

1. Check the onsite host first: `test -S /run/cups/cups.sock`, `lpstat -e`, and `timeout 3 bash -c '</dev/tcp/192.168.1.10/9100'` (repeat for `9101`). Install the site-specific drivers and queues before trying a physical print.
2. Verify the remote dev backend's `env/site.env` has `FRONTEND_URL=http://localhost:5173`. The backend uses that value for CORS and passkey RP ID. The dev deploy script preserves remote runtime configuration and will not update an existing `env/site.env`.
3. From the repository root on a machine with Tailscale and SSH access, run `/opt/homebrew/bin/bash ./dev_backend_deploy.sh TSS` (or `FRK`). This uploads the current working tree, rebuilds the dev backend, and applies missing dev DB migrations.
4. Run `/opt/homebrew/bin/bash ./dev_frontend_deploy.sh TSS` (or `FRK`). Keep it running and open `http://localhost:5173`. This script opens the tunnel and rewrites `website_frontend/.env` for the selected dev backend. Running plain `npm run dev` with an old `.env` may connect to a different backend.
5. Sign in to the dev site. In **Admin > Printing**, choose the installed queues and save the profiles. Generate a system label or pallet sheet and verify the preview, Save PDF, and System print dialog. Send one job with **Print through server**, then check `lpstat -o` and the physical output. A 202 response only confirms CUPS accepted the job.

To test the home ingress itself, use the relevant public hostname and verify its DNS/NPM route separately. The SSH-tunneled dev workflow does not traverse the home proxy. A dev-backend test through home would need a dev hostname explicitly routed by home NPM to the onsite dev backend.
