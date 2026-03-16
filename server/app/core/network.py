"""Network helpers for IP allowlist (e.g. kiosk office network restriction)."""
import ipaddress
from typing import List, Optional
from fastapi import Request


def get_client_ip(request: Request) -> Optional[str]:
    """
    Get the real client IP from the request.
    Checks common proxy headers so different networks (or proxies) report the correct client IP:
    - CF-Connecting-IP (Cloudflare)
    - X-Real-IP (nginx, many reverse proxies)
    - X-Forwarded-For (first value = original client when chain is client, proxy1, proxy2)
    - request.client.host (direct connection; may be same for all if behind one proxy)
    """
    # Cloudflare sends the connecting client IP here
    cf = request.headers.get("CF-Connecting-IP")
    if cf:
        return cf.strip()
    # nginx and many reverse proxies set this to the client IP
    real = request.headers.get("X-Real-IP")
    if real:
        return real.strip()
    # Standard: X-Forwarded-For can be "client, proxy1, proxy2" – first is original client
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client:
        return request.client.host
    return None


def is_ip_in_allowed_list(client_ip: Optional[str], allowed: List[str]) -> bool:
    """
    Return True if client_ip is in the allowed list.
    allowed can contain single IPs (e.g. "192.168.1.10") or CIDR networks (e.g. "192.168.1.0/24").
    """
    if not client_ip or not allowed:
        return False
    try:
        ip = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    for entry in allowed:
        entry = (entry or "").strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                network = ipaddress.ip_network(entry, strict=False)
                if ip in network:
                    return True
            else:
                if ip == ipaddress.ip_address(entry):
                    return True
        except ValueError:
            continue
    return False
