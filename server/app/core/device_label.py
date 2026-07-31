"""Parse User-Agent into a short device label for session lists."""
from __future__ import annotations

from typing import Optional


def device_label_from_ua(user_agent: Optional[str]) -> str:
    if not user_agent:
        return "Unknown device"
    ua = user_agent.lower()

    browser = "Browser"
    if "edg/" in ua or "edge/" in ua:
        browser = "Edge"
    elif "chrome/" in ua and "chromium" not in ua:
        browser = "Chrome"
    elif "firefox/" in ua:
        browser = "Firefox"
    elif "safari/" in ua and "chrome" not in ua:
        browser = "Safari"
    elif "opera" in ua or "opr/" in ua:
        browser = "Opera"

    os_name = "Unknown OS"
    if "iphone" in ua or "ipad" in ua:
        os_name = "iOS"
    elif "android" in ua:
        os_name = "Android"
    elif "mac os" in ua or "macintosh" in ua:
        os_name = "macOS"
    elif "windows" in ua:
        os_name = "Windows"
    elif "linux" in ua:
        os_name = "Linux"

    return f"{browser} on {os_name}"
