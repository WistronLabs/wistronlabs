#!/usr/bin/env bash
set -euo pipefail

# Run on each onsite Linux server after installing the printer-specific drivers.
# Example:
#   sudo SITE=FRK ZEBRA_PPD=/path/to/zd421.ppd BROTHER_PPD=/path/to/brother.ppd ./scripts/setup_site_printers.sh

PRINT_SERVER_IP="${PRINT_SERVER_IP:-192.168.1.10}"
: "${SITE:?Set SITE to TSS or FRK}"
: "${ZEBRA_PPD:?Set ZEBRA_PPD to the installed ZD421 PPD path}"
: "${BROTHER_PPD:?Set BROTHER_PPD to the local Brother PPD path}"

case "$SITE" in
  TSS) brother_port=9100; zebra_port=9101 ;;
  FRK) brother_port=9101; zebra_port=9100 ;;
  *) echo "SITE must be TSS or FRK." >&2; exit 2 ;;
esac

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi
for driver in "$ZEBRA_PPD" "$BROTHER_PPD"; do
  if [[ ! -r "$driver" ]]; then
    echo "Printer driver is not readable: $driver" >&2
    exit 1
  fi
done

"$(dirname "$0")/add_site_printer.sh" wistron_brother "$PRINT_SERVER_IP" "$brother_port" "$BROTHER_PPD"
"$(dirname "$0")/add_site_printer.sh" wistron_zebra "$PRINT_SERVER_IP" "$zebra_port" "$ZEBRA_PPD"
lpstat -p wistron_brother -p wistron_zebra

echo "Queues installed. Select wistron_brother and wistron_zebra in the site's Admin > Printing tab."
