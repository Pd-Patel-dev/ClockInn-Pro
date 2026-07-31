"""
Factory-default email templates (seed + reset-to-factory source).

Keys must stay stable — application code looks templates up by key.
"""
from __future__ import annotations

from typing import Any, Dict, List

FACTORY_TEMPLATES: List[Dict[str, Any]] = [
    {
        "key": "verify_email",
        "name": "Email Verification",
        "description": "Sent when a user must verify their email with a 6-digit PIN.",
        "category": "TRANSACTIONAL",
        "subject": "Verify your email  —  ClockIn Pro",
        "body_html": """<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#0f172a">
<p>Your 6-digit verification code is:</p>
<p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{ verification_pin }}</p>
<p>This code expires in 15 minutes.</p>
<p style="color:#64748b;font-size:14px">For security reasons, email verification is required every 30 days.</p>
<p style="color:#64748b;font-size:14px">If you didn't request this code, please ignore this email.</p>
</body></html>""",
        "body_text": """Your 6-digit verification code is:

{{ verification_pin }}

This code expires in 15 minutes.

For security reasons, email verification is required every 30 days.

If you didn't request this code, please ignore this email.
""",
        "variables_schema": {
            "verification_pin": {"type": "string", "example": "123456", "required": True},
        },
    },
    {
        "key": "verification_reminder",
        "name": "Verification Reminder",
        "description": "Reminder that email verification will expire soon.",
        "category": "NOTIFICATION",
        "subject": "Email Verification Expiring Soon  —  ClockIn Pro",
        "body_html": """<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#0f172a">
<p>Your email verification expires in 3 days.</p>
<p>Please verify your email to continue using ClockIn Pro without interruption.</p>
<p>You can verify your email by logging in to your account.</p>
</body></html>""",
        "body_text": """Your email verification expires in 3 days.

Please verify your email to continue using ClockIn Pro without interruption.

You can verify your email by logging in to your account.

If you have any questions, please contact support.
""",
        "variables_schema": {},
    },
    {
        "key": "password_setup",
        "name": "Password Setup Invite",
        "description": "First-time invite: sent when an admin/developer creates a user who must set their password.",
        "category": "TRANSACTIONAL",
        "subject": "Set Up Your Password  —  ClockIn Pro",
        "body_html": """<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#0f172a">
<p>Hello {{ employee_name }},</p>
<p>Welcome to ClockIn Pro! Your account has been created.</p>
<p>To get started, please set your password by clicking the link below:</p>
<p><a href="{{ setup_link }}">{{ setup_link }}</a></p>
<p>This link will expire in 48 hours and can only be used once.</p>
<p style="color:#64748b;font-size:14px">If you didn't expect this email, please ignore it.</p>
<p>ClockIn Pro</p>
</body></html>""",
        "body_text": """Hello {{ employee_name }},

Welcome to ClockIn Pro! Your account has been created.

To get started, please set your password by clicking the link below:

{{ setup_link }}

This link will expire in 48 hours and can only be used once.

If you didn't expect this email, please ignore it.

ClockIn Pro""",
        "variables_schema": {
            "employee_name": {"type": "string", "example": "Jane Doe", "required": True},
            "setup_link": {
                "type": "string",
                "example": "https://app.example.com/set-password?token=abc",
                "required": True,
            },
        },
    },
    {
        "key": "password_reset",
        "name": "Password Reset",
        "description": "Admin/developer initiated password reset: emails a secure link to choose a new password.",
        "category": "TRANSACTIONAL",
        "subject": "Reset Your Password  —  ClockIn Pro",
        "body_html": """<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#0f172a">
<p>Hello {{ employee_name }},</p>
<p>A password reset was requested for your ClockIn Pro account.</p>
<p>Click the link below to choose a new password:</p>
<p><a href="{{ reset_link }}">{{ reset_link }}</a></p>
<p>This link will expire in 48 hours and can only be used once.</p>
<p style="color:#64748b;font-size:14px">If you did not request this, contact your administrator. You can ignore this email and your password will stay the same until the link is used.</p>
<p>ClockIn Pro</p>
</body></html>""",
        "body_text": """Hello {{ employee_name }},

A password reset was requested for your ClockIn Pro account.

Click the link below to choose a new password:

{{ reset_link }}

This link will expire in 48 hours and can only be used once.

If you did not request this, contact your administrator. You can ignore this email and your password will stay the same until the link is used.

ClockIn Pro""",
        "variables_schema": {
            "employee_name": {"type": "string", "example": "Jane Doe", "required": True},
            "reset_link": {
                "type": "string",
                "example": "https://app.example.com/set-password?token=abc",
                "required": True,
            },
        },
    },
    {
        "key": "password_reset_otp",
        "name": "Password Reset OTP",
        "description": "Forgot-password self-service flow: 6-digit OTP to reset password.",
        "category": "TRANSACTIONAL",
        "subject": "Reset Your Password  —  ClockIn Pro",
        "body_html": """<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#0f172a">
<p>You requested to reset your password.</p>
<p>Your 6-digit verification code is:</p>
<p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{ otp }}</p>
<p>This code expires soon. If you did not request a reset, ignore this email.</p>
</body></html>""",
        "body_text": """You requested to reset your password.

Your 6-digit verification code is:

{{ otp }}

This code expires soon. If you did not request a reset, ignore this email.
""",
        "variables_schema": {
            "otp": {"type": "string", "example": "654321", "required": True},
        },
    },
    {
        "key": "leave_request_notification",
        "name": "Leave Request (Admin)",
        "description": "Notifies admins when an employee submits a leave request.",
        "category": "NOTIFICATION",
        "subject": "New Leave Request from {{ employee_name }}  —  ClockIn Pro",
        "body_html": """<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#0f172a">
<p><strong>{{ employee_name }}</strong> submitted a leave request.</p>
<p>Type: {{ leave_type }}<br/>From: {{ start_date }}<br/>To: {{ end_date }}</p>
{% if notes %}<p>Notes: {{ notes }}</p>{% endif %}
</body></html>""",
        "body_text": """{{ employee_name }} submitted a leave request.

Type: {{ leave_type }}
From: {{ start_date }}
To: {{ end_date }}
{% if notes %}Notes: {{ notes }}{% endif %}
""",
        "variables_schema": {
            "employee_name": {"type": "string", "example": "John Smith", "required": True},
            "leave_type": {"type": "string", "example": "Vacation", "required": True},
            "start_date": {"type": "string", "example": "2026-08-01", "required": True},
            "end_date": {"type": "string", "example": "2026-08-05", "required": True},
            "notes": {"type": "string", "example": "Family trip", "required": False},
        },
    },
    {
        "key": "leave_request_response",
        "name": "Leave Request Response",
        "description": "Notifies an employee when their leave request is approved or denied.",
        "category": "NOTIFICATION",
        "subject": "Leave Request {{ status_text }}  —  ClockIn Pro",
        "body_html": """<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#0f172a">
<p>Your leave request has been <strong>{{ status_text }}</strong>.</p>
<p>From: {{ start_date }}<br/>To: {{ end_date }}</p>
{% if reviewer_notes %}<p>Notes: {{ reviewer_notes }}</p>{% endif %}
</body></html>""",
        "body_text": """Your leave request has been {{ status_text }}.

From: {{ start_date }}
To: {{ end_date }}
{% if reviewer_notes %}Notes: {{ reviewer_notes }}{% endif %}
""",
        "variables_schema": {
            "status_text": {"type": "string", "example": "Approved", "required": True},
            "start_date": {"type": "string", "example": "2026-08-01", "required": True},
            "end_date": {"type": "string", "example": "2026-08-05", "required": True},
            "reviewer_notes": {"type": "string", "example": "Enjoy your time off", "required": False},
        },
    },
    {
        "key": "welcome",
        "name": "Welcome",
        "description": "Generic welcome email (optional / future use).",
        "category": "TRANSACTIONAL",
        "subject": "Welcome to ClockInn Pro, {{ user_name }}",
        "body_html": """<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#0f172a">
<p>Welcome, {{ user_name }}!</p>
<p>Your account at <strong>{{ company_name }}</strong> is ready.</p>
</body></html>""",
        "body_text": """Welcome, {{ user_name }}!

Your account at {{ company_name }} is ready.
""",
        "variables_schema": {
            "user_name": {"type": "string", "example": "John Smith", "required": True},
            "company_name": {"type": "string", "example": "Acme Hotel", "required": True},
        },
    },
]


def get_factory_by_key(key: str) -> Dict[str, Any] | None:
    for t in FACTORY_TEMPLATES:
        if t["key"] == key:
            return t
    return None
