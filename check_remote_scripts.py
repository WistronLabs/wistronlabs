#!/usr/bin/env python3
"""Disposable, read-only scripts comparison. Delete this file when finished.

  ./check_remote_scripts.py --list
  ./check_remote_scripts.py prod                 # TSS, FRK, FIELD_1
  ./check_remote_scripts.py TSS FRK --diff        # include unified text diffs
  ./check_remote_scripts.py dev --branch my-branch
  ./check_remote_scripts.py all                  # default; prod + current-branch dev

Hosts come from backend_locations.conf. Paths match prod_deploy.sh
(/home/falab) and dev_script_deploy.sh (/opt/dev_scripts/<branch>).
Requires local Python 3 + ssh and remote Python 3. Uses existing SSH keys/config.
Compares contents and symlink targets, not permissions or modification times.
Exit: 0 = identical, 1 = differences, 2 = connection/read/config errors.
"""
import argparse
import base64
import difflib
import json
from pathlib import Path
import shlex
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

# Run the same read-only walker locally and over SSH; no remote files are created.
WORKER = r'''
import base64, hashlib, json, os, stat, sys
request = json.loads(sys.argv[1])
root = request["root"]
result = {}
def visit(relative):
    path = os.path.join(root, relative)
    try:
        info = os.lstat(path)
        if stat.S_ISLNK(info.st_mode):
            result[relative] = {"kind": "link", "target": os.readlink(path)}
        elif stat.S_ISDIR(info.st_mode):
            for child in sorted(os.listdir(path)):
                visit(os.path.join(relative, child))
        elif stat.S_ISREG(info.st_mode):
            digest = hashlib.sha256()
            chunks = []
            with open(path, "rb") as source:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk: break
                    digest.update(chunk)
                    if request["diff"]: chunks.append(chunk)
            entry = {"kind": "file", "sha256": digest.hexdigest()}
            if request["diff"]:
                entry["data"] = base64.b64encode(b"".join(chunks)).decode("ascii")
            result[relative] = entry
        else:
            result[relative] = {"error": "Not a regular file, directory, or symlink"}
    except OSError as error:
        result[relative] = {"error": str(error)}
try:
    entries = sorted(os.listdir(root))
    for name in entries:
        # Production shares /home/falab with unrelated personal/server files.
        if request["scope"] is None or name in request["scope"] or (name.endswith(".sh") and (os.path.isfile(os.path.join(root, name)) or os.path.islink(os.path.join(root, name)))):
            visit(name)
    print(json.dumps({"files": result}))
except OSError as error:
    print(json.dumps({"error": str(error)}))
'''


def snapshot(root, scope, diff, host=None):
    request = json.dumps({"root": str(root), "scope": scope, "diff": diff})
    if host:
        command = ["ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                   "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=2",
                   host, "python3 -c " + shlex.quote(WORKER) + " " + shlex.quote(request)]
    else:
        command = [sys.executable, "-c", WORKER, request]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=90)
        if result.returncode:
            return {"error": result.stderr.strip() or f"Command exited {result.returncode}"}
        return json.loads(result.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        return {"error": str(error)}


def signature(entry):
    if entry is None: return None
    return (entry.get("kind"), entry.get("sha256"), entry.get("target"))


def show_diff(name, local, remote, destination):
    if (local and local["kind"] == "link") or (remote and remote["kind"] == "link"):
        print(f"    local:  {signature(local)}\n    remote: {signature(remote)}")
        return
    left = base64.b64decode(local["data"]) if local else b""
    right = base64.b64decode(remote["data"]) if remote else b""
    try:
        if b"\0" in left or b"\0" in right: raise ValueError()
        left, right = left.decode("utf-8"), right.decode("utf-8")
    except (UnicodeDecodeError, ValueError):
        print("    Binary/non-UTF-8 contents differ.")
        return
    for line in difflib.unified_diff(left.splitlines(keepends=True), right.splitlines(keepends=True),
                                     fromfile=f"local/scripts/{name}", tofile=f"{destination}/{name}"):
        print(line, end="" if line.endswith("\n") else "\n\\ No newline at end of file\n")


def compare(local, remote, destination, diff):
    if "error" in remote:
        print(f"  ERROR: {remote['error']}")
        return 2
    changes, errors, identical = 0, 0, 0
    counts = {"CHANGED": 0, "MISSING ON REMOTE": 0, "REMOTE ONLY": 0}
    for name in sorted(set(local) | set(remote["files"])):
        left, right = local.get(name), remote["files"].get(name)
        if (left and "error" in left) or (right and "error" in right):
            print(f"  ERROR {name!r}: local={(left or {}).get('error', 'OK')}; remote={(right or {}).get('error', 'OK')}")
            errors += 1
            continue
        if signature(left) == signature(right):
            identical += 1
            continue
        changes += 1
        status = "REMOTE ONLY" if left is None else "MISSING ON REMOTE" if right is None else "CHANGED"
        counts[status] += 1
        print(f"  {status:17} {name}")
        if diff and left is not None: show_diff(name, left, right, destination)
    print(f"  {identical} identical; {counts['CHANGED']} changed; "
          f"{counts['MISSING ON REMOTE']} missing on remote; {counts['REMOTE ONLY']} remote-only; {errors} read errors")
    return 2 if errors else 1 if changes else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("targets", nargs="*", help="all, prod, dev, or names from backend_locations.conf")
    parser.add_argument("--list", action="store_true", help="show resolved paths without SSH")
    parser.add_argument("--diff", action="store_true", help="diff local files (- local, + remote); remote-only files are listed by name")
    parser.add_argument("--branch", help="dev scripts branch directory (defaults to current Git branch)")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    local_root = root / "scripts"
    try:
        targets = []
        for line in (root / "backend_locations.conf").read_text().splitlines():
            if not line.strip() or line.lstrip().startswith("#"): continue
            fields = line.strip().split("|")
            if len(fields) < 7: raise ValueError(f"Invalid location config: {line}")
            targets.append((fields[0], fields[1], fields[6] == "1"))
        requested = args.targets or ["all"]
        known = {name for name, _, _ in targets}
        unknown = set(requested) - known - {"all", "prod", "dev"}
        if unknown: raise ValueError("Unknown targets: " + ", ".join(sorted(unknown)))
        selected = [(name, host, dev) for name, host, dev in targets
                    if name in requested or "all" in requested or ("dev" if dev else "prod") in requested]
        branch = args.branch
        if any(dev for _, _, dev in selected) and not branch:
            branch = subprocess.check_output(["git", "-C", str(root), "branch", "--show-current"], text=True, timeout=10).strip()
        if any(dev for _, _, dev in selected):
            if not branch or branch.startswith("/") or any(part in ("", ".", "..") for part in branch.split("/")):
                raise ValueError("Specify a valid dev branch with --branch (detached HEAD has no branch).")
        resolved = [(name, f"falab@{host}", f"/opt/dev_scripts/{branch}" if dev else "/home/falab", dev)
                    for name, host, dev in selected]
        if args.list:
            for name, host, directory, _ in resolved: print(f"{name:10} {host}:{directory}/")
            return 0
        if not local_root.is_dir(): raise ValueError(f"Local scripts directory not found: {local_root}")
        # Include every local top-level item (hidden items too), known deployed
        # subtrees, and remote root *.sh files to detect leftover scripts.
        scope = sorted({p.name for p in local_root.iterdir()} | {".lib", "config"})
        local = snapshot(local_root, None, args.diff)
        if "error" in local: raise ValueError(local["error"])
        print(f"Local: {local_root}\nComparing contents; includes .lib and config. No remote writes.", flush=True)
        print("Production scope: local top-level names + .lib/config + remote root *.sh; dev scope: entire script directory.", flush=True)
        def check(target):
            _, host, directory, dev = target
            return snapshot(directory, None if dev else scope, args.diff, host)
        code = 0
        with ThreadPoolExecutor(max_workers=4) as pool:
            for target, remote in zip(resolved, pool.map(check, resolved)):
                name, host, directory, _ = target
                destination = f"{host}:{directory}"
                print(f"\n== {name}: {destination}/ ==", flush=True)
                code = max(code, compare(local["files"], remote, destination, args.diff))
        return code
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
