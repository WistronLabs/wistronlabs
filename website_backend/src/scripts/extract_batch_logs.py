"""Read ZIP/TAR logs without extractall; reject links, unsafe paths and oversized payloads."""
import json
import re
import stat
import sys
import tarfile
import zipfile
from pathlib import Path, PurePosixPath


def unpack(source, destination, max_bytes, max_files, max_systems, selected_tags=(), inspect_only=False):
    archive = zipfile.ZipFile(source) if zipfile.is_zipfile(source) else tarfile.open(source, "r:*")
    is_zip = isinstance(archive, zipfile.ZipFile)
    with archive:
        files = []
        total = 0
        # Stream TAR headers; enforce the entry limit before retaining metadata.
        for count, entry in enumerate(archive.infolist() if is_zip else archive, 1):
            if count > max_files * 3:
                raise ValueError("Archive contains too many entries.")
            name = entry.filename if is_zip else entry.name
            if name in (".", "./", "") and (entry.is_dir() if is_zip else entry.isdir()):
                continue
            name = name.removeprefix("./")
            parts = PurePosixPath(name).parts
            if not parts or name.startswith("/") or "\\" in name or ".." in parts or any(":" in p for p in parts):
                raise ValueError("Archive contains an unsafe path.")
            if is_zip:
                mode = entry.external_attr >> 16
                if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                    raise ValueError("Archive links and special files are not supported.")
                is_dir = entry.is_dir()
                size = entry.file_size
            else:
                if not (entry.isfile() or entry.isdir()):
                    raise ValueError("Archive links and special files are not supported.")
                is_dir = entry.isdir()
                size = entry.size
            if is_dir or any(p == "__MACOSX" or p == ".DS_Store" or p.startswith("._") for p in parts):
                continue
            total += size
            if total > max_bytes or len(files) >= max_files:
                raise ValueError("Archive exceeds the expanded size or file-count limit.")
            files.append((entry, parts))
        if not files:
            raise ValueError("Archive contains no log files.")
        roots = {parts[0] for _, parts in files}
        selected = {tag.upper() for tag in selected_tags}
        root_matches = selected.intersection(p[0].upper() for _, p in files if len(p) >= 2)
        can_wrap = len(roots) == 1 and all(len(p) >= 3 for _, p in files)
        wrapped_matches = selected.intersection(p[1].upper() for _, p in files) if can_wrap else set()
        if root_matches and wrapped_matches:
            raise ValueError("Archive layout is ambiguous: known service tags appear at two folder levels. Place service-tag folders directly at the archive root.")
        # Selected tags distinguish a wrapper from a unit's own nested log folders.
        # With no matches, retain root layout so selected missing folders are reported.
        strip = bool(wrapped_matches)
        systems = set()
        output_paths = set()
        copied = 0
        for entry, original in files:
            parts = original[1:] if strip else original
            if len(parts) < 2 or not re.fullmatch(r"[A-Za-z0-9_-]+", parts[0]):
                raise ValueError("Use SERVICE_TAG/log-files, optionally inside one enclosing folder.")
            tag = parts[0].upper()
            systems.add(tag)
            if len(systems) > max_systems:
                raise ValueError("Archive exceeds the system-count limit.")
            target = Path(destination, tag, *parts[1:])
            key = str(target).casefold()
            if key in output_paths:
                raise ValueError("Archive contains duplicate file paths.")
            output_paths.add(key)
            if inspect_only:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            reader = archive.open(entry) if is_zip else archive.extractfile(entry)
            with reader, target.open("xb") as output:
                while True:
                    block = reader.read(1024 * 1024)
                    if not block:
                        break
                    copied += len(block)
                    if copied > max_bytes:
                        raise ValueError("Archive exceeds the expanded size limit.")
                    output.write(block)

        return sorted(systems)


if __name__ == "__main__":
    try:
        hints = json.loads(Path(sys.argv[6][1:]).read_text()) if sys.argv[6].startswith("@") else json.loads(sys.argv[6])
        tags = unpack(sys.argv[1], sys.argv[2], *map(int, sys.argv[3:6]), selected_tags=hints, inspect_only="--inspect" in sys.argv[7:])
        print(json.dumps(tags))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
