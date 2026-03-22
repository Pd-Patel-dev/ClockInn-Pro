"""Unit tests for global IP rate limiting (app.middleware.rate_limit)."""

import pytest

from app.middleware import rate_limit as rl


@pytest.fixture(autouse=True)
def clear_rate_limit_windows():
    rl._global_window.clear()
    rl._strict_window.clear()
    yield
    rl._global_window.clear()
    rl._strict_window.clear()


def test_health_paths_exempt():
    assert rl.check_rate_limit("1.1.1.1", "/api/v1/health/live") == (True, "")
    assert rl.check_rate_limit("1.1.1.1", "/api/v1/health/ready") == (True, "")
    assert rl.check_rate_limit("1.1.1.1", "/api/v1/health") == (True, "")


def test_test_error_path_not_exempt(monkeypatch):
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_PER_MINUTE", 2)
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_AUTH_KIOSK_PER_MINUTE", 100)
    ip, path = "9.9.9.9", "/api/v1/health/test-error"
    assert rl.check_rate_limit(ip, path)[0]
    assert rl.check_rate_limit(ip, path)[0]
    assert not rl.check_rate_limit(ip, path)[0]


def test_global_limit_non_auth_path(monkeypatch):
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_PER_MINUTE", 5)
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_AUTH_KIOSK_PER_MINUTE", 100)
    ip, path = "2.2.2.2", "/api/v1/time/entries"
    for _ in range(5):
        ok, _ = rl.check_rate_limit(ip, path)
        assert ok
    ok, reason = rl.check_rate_limit(ip, path)
    assert not ok
    assert reason == "global"


def test_stricter_limit_auth_path(monkeypatch):
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_PER_MINUTE", 100)
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_AUTH_KIOSK_PER_MINUTE", 4)
    ip, path = "3.3.3.3", "/api/v1/auth/login"
    for _ in range(4):
        assert rl.check_rate_limit(ip, path)[0]
    ok, reason = rl.check_rate_limit(ip, path)
    assert not ok
    assert reason == "strict"


def test_kiosk_uses_strict_bucket(monkeypatch):
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_PER_MINUTE", 100)
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_AUTH_KIOSK_PER_MINUTE", 3)
    ip = "4.4.4.4"
    path = "/api/v1/kiosk/foo/check-pin"
    for _ in range(3):
        assert rl.check_rate_limit(ip, path)[0]
    assert not rl.check_rate_limit(ip, path)[0]


def test_disabled_allows_all(monkeypatch):
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_ENABLED", False)
    monkeypatch.setattr(rl.settings, "RATE_LIMIT_PER_MINUTE", 1)
    ip, path = "5.5.5.5", "/api/v1/auth/login"
    for _ in range(20):
        assert rl.check_rate_limit(ip, path)[0]
