"""Tests for Content-Security-Policy and Permissions-Policy helpers."""
from app.core.security_headers import (
    PERMISSIONS_POLICY,
    content_security_policy_for_path,
)


def test_csp_strict_for_api():
    csp = content_security_policy_for_path("/api/v1/health")
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "form-action 'none'" in csp


def test_csp_relaxed_for_docs():
    csp = content_security_policy_for_path("/docs")
    assert "cdn.jsdelivr.net" in csp
    assert "frame-ancestors 'none'" in csp


def test_csp_relaxed_for_redoc():
    csp = content_security_policy_for_path("/redoc")
    assert "cdn.jsdelivr.net" in csp


def test_permissions_policy_disables_common_features():
    assert "geolocation=()" in PERMISSIONS_POLICY
    assert "camera=()" in PERMISSIONS_POLICY
    assert "payment=()" in PERMISSIONS_POLICY
