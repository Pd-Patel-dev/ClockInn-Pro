"""
Security header values: Content-Security-Policy (path-aware) and Permissions-Policy.

CSP: JSON API responses get a minimal policy (default-src 'none'). /docs and /redoc need
a broader policy so FastAPI's Swagger UI and ReDoc (cdn.jsdelivr.net) keep working.

Note: The Next.js app should define its own CSP via headers or meta; these apply to the API origin.
"""

from __future__ import annotations


# Disable powerful features the API HTML (e.g. Swagger) does not need.
PERMISSIONS_POLICY = (
    "accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), "
    "bluetooth=(), camera=(), display-capture=(), document-domain=(), "
    "encrypted-media=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), "
    "magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), "
    "publickey-credentials-get=(), screen-wake-lock=(), serial=(), "
    "sync-xhr=(), usb=(), web-share=(), xr-spatial-tracking=()"
)


def content_security_policy_for_path(path: str) -> str:
    """
    CSP for this response. Swagger/Redoc need inline scripts and jsDelivr; API JSON is locked down.
    """
    p = (path or "/").split("?", 1)[0]

    if p.startswith("/docs") or p.startswith("/redoc"):
        # FastAPI default UIs load from cdn.jsdelivr.net; inline bootstrapping is common.
        return (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "img-src 'self' data: blob: https://fastapi.tiangolo.com https://cdn.jsdelivr.net; "
            "font-src 'self' https://cdn.jsdelivr.net data:; "
            "connect-src 'self'; "
            "worker-src 'self' blob:; "
            "frame-ancestors 'none'; "
            "base-uri 'self'"
        )

    # JSON, errors, redirects: no scripts, no embedding (frame-ancestors complements X-Frame-Options).
    return (
        "default-src 'none'; "
        "frame-ancestors 'none'; "
        "base-uri 'none'; "
        "form-action 'none'"
    )
