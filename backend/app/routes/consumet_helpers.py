"""
Shared helper functions for consumet route files.
Imported by consumet.py, consumet_anime_stream.py, and consumet_anime_debug.py.
"""


def _title_score(result_title: str, query: str) -> int:
    """Simple scoring — higher is better match."""
    r = result_title.lower().strip()
    q = query.lower().strip()
    if r == q:
        return 100
    if r.startswith(q) or q.startswith(r):
        return 80
    q_words = set(q.split())
    r_words = set(r.split())
    overlap = len(q_words & r_words)
    return overlap * 10


def _safe_error_body(response) -> str:
    """Extract a readable error string from a non-2xx httpx response."""
    try:
        body = response.json()
        return str(body.get("detail") or body.get("error") or body.get("message") or body)[:400]
    except Exception:
        return response.text[:400].strip()


def _build_sidecar_hint(attempt_errors: list[str]) -> str:
    """Turn the raw list of sidecar error strings into a human-readable fix hint."""
    combined = " ".join(attempt_errors).lower()

    if not attempt_errors:
        return "No attempt was made — the sidecar may be unreachable."

    if "connection refused" in combined or "connect call failed" in combined:
        return (
            "The consumet sidecar is NOT running. "
            "Open a terminal and run: cd consumet-local && node server.cjs"
        )

    if "aniwatch" in combined and ("outdated" in combined or "megacloud" in combined):
        return (
            "The aniwatch npm package is outdated. "
            "Fix: cd consumet-local && npm update aniwatch && node server.cjs"
        )

    if "encrypted" in combined and "no key" in combined:
        return (
            "MegaCloud is using encrypted sources and the current key is missing. "
            "Fix: cd consumet-local && npm update aniwatch && node server.cjs"
        )

    if "encrypted" in combined:
        return (
            "MegaCloud encryption detected. The aniwatch package may need updating. "
            "Fix: cd consumet-local && npm update aniwatch && node server.cjs"
        )

    if "invalid episode id" in combined:
        return (
            "The episode ID format was rejected by the sidecar. "
            "This is a bug — please report it with the _episode_id value."
        )

    if "502" in combined or "bad gateway" in combined:
        return (
            "The sidecar itself is returning errors. "
            "Try: cd consumet-local && npm update aniwatch && node server.cjs"
        )

    return (
        "The episode may not be available on HiAnime yet, or the sidecar needs a restart. "
        "Try: cd consumet-local && node server.cjs"
    )
