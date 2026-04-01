import hashlib
import re
from pathlib import Path
from zipfile import ZipFile


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_checksum_manifest(content: str) -> dict[str, str]:
    checksums: dict[str, str] = {}
    for raw_line in (content or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = re.match(r"^([a-fA-F0-9]{64})\s+[* ]?(.+)$", line)
        if not match:
            continue
        checksums[match.group(2).strip()] = match.group(1).lower()
    return checksums


def safe_extract_zip(archive_path: Path, destination: Path) -> None:
    destination = destination.resolve()
    with ZipFile(archive_path) as archive:
        for member in archive.infolist():
            target = (destination / member.filename).resolve()
            if target != destination and destination not in target.parents:
                raise RuntimeError("Archive contains an unsafe path outside extraction root.")
        archive.extractall(destination)
