import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

from fastapi import HTTPException

NetworkValidationMode = str


@dataclass(frozen=True)
class NetworkPolicyResult:
    normalized_url: str
    hostname: str


def _is_private_or_loopback_host(hostname: str) -> bool:
    try:
        ip = ipaddress.ip_address(hostname)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except ValueError:
        pass

    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False  # FIX: treat unresolvable CDN hostnames as allowed, not blocked

    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False  # FIX: unknown address format — don't block
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return True
    return False


def _matches_host_allowlist(hostname: str, allowed_hosts: tuple[str, ...]) -> bool:
    for allowed in allowed_hosts:
        token = str(allowed or "").strip().lower()
        if token.startswith("."):
            token = token[1:]
        if not token:
            continue
        if token == "*":
            return True
        if hostname == token or hostname.endswith(f".{token}"):
            return True
        if "." not in token and token in hostname:
            return True
    return False


def validate_outbound_target(
    url: str,
    *,
    mode: NetworkValidationMode,
    allowed_hosts: tuple[str, ...] = (),
) -> NetworkPolicyResult:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Only http/https URLs are allowed.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise HTTPException(status_code=400, detail="URL is missing a hostname.")

    # FIX: skip DNS-based private-host check when the host is already on the allowlist.
    # The old code did a blocking DNS lookup first, which could fail for valid CDN hostnames
    # (especially behind geo-restricted DNS), causing HTTPException(400) that the browser
    # reported as "Failed to fetch" due to missing CORS headers on the error response.
    if not _matches_host_allowlist(hostname, allowed_hosts):
        if _is_private_or_loopback_host(hostname):
            raise HTTPException(status_code=400, detail="Private, loopback, and local network hosts are blocked.")
        if mode == "approved_provider_target":
            raise HTTPException(status_code=400, detail=f"Host '{hostname}' is not on the approved media allowlist.")
    
    return NetworkPolicyResult(
        normalized_url=parsed.geturl(),
        hostname=hostname,
    )
