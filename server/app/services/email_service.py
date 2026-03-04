"""
Email service for sending verification emails via Gmail API.
"""
import base64
import json
import logging
from datetime import date, timedelta
from email.mime.text import MIMEText
from typing import Optional, List, Any, Dict
import html as html_module
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import os
from pathlib import Path
from app.core.config import settings

logger = logging.getLogger(__name__)

# Gmail API scopes
SCOPES = ['https://www.googleapis.com/auth/gmail.send']


def _shift_duration_minutes(s: Any) -> float:
    """Compute shift duration in minutes (end - start - break). Handles overnight (end <= start)."""
    start_str = s.get("start_time") or "00:00"
    end_str = s.get("end_time") or "00:00"
    break_m = int(s.get("break_minutes") or 0)
    try:
        parts_s = start_str.split(":")
        parts_e = end_str.split(":")
        start_m = int(parts_s[0]) * 60 + int(parts_s[1]) if len(parts_s) >= 2 else 0
        end_m = int(parts_e[0]) * 60 + int(parts_e[1]) if len(parts_e) >= 2 else 0
        if end_m <= start_m:
            end_m += 24 * 60  # overnight
        return max(0, (end_m - start_m) - break_m)
    except (ValueError, IndexError):
        return 0.0


def _format_hours(minutes: float) -> str:
    """Format minutes as hours e.g. 7.5 or 8.0."""
    if minutes <= 0:
        return "0"
    h = minutes / 60
    return f"{h:.1f}" if h != int(h) else str(int(h))


def _escape(s: Optional[str]) -> str:
    """Escape for HTML content."""
    if not s:
        return ""
    return html_module.escape(str(s).strip())


def _start_time_hour(s: Any) -> int:
    """Get start time hour (0-23) from shift dict. Returns 12 if unparseable."""
    start_str = s.get("start_time") or "00:00"
    try:
        parts = start_str.split(":")
        return int(parts[0]) if len(parts) >= 1 else 12
    except (ValueError, IndexError):
        return 12


def _get_schedule_motivation(
    shifts: List[Any],
    total_minutes: float,
    week_start_date: Optional[date],
) -> tuple:
    """Return (greeting, motivation_line) — each is one sentence; together they form two sentences. Written in full, descriptive language."""
    total_hrs = total_minutes / 60.0 if total_minutes else 0
    if not shifts:
        return "Hello!", "Here is your schedule. We are glad to have you on the team."

    earliest_hour = min(_start_time_hour(s) for s in shifts)

    # Sentence 1: time-based (one sentence)
    if earliest_hour < 6:
        time_sentence = "Rise and shine. Your early start sets the tone for a great day and shows real dedication."
    elif earliest_hour < 10:
        time_sentence = "Good morning. A solid start at this hour makes a real difference for the rest of the day."
    elif earliest_hour < 14:
        time_sentence = "Your afternoon shift is a chance to bring your best energy when the day is in full swing."
    elif earliest_hour < 18:
        time_sentence = "Evening shifts keep everything running when it matters most. Thank you for being there."
    elif earliest_hour < 22:
        time_sentence = "Thank you for holding the evening. Your flexibility and commitment do not go unnoticed."
    else:
        time_sentence = "Night shift team members like you keep operations going around the clock. We appreciate you."

    # Sentence 2: hours-based (one sentence)
    if week_start_date is not None:
        if total_hrs >= 38:
            hours_sentence = f"With {_format_hours(total_minutes)} hours scheduled this week, you are a cornerstone of the team. Thank you for your dedication."
        elif total_hrs >= 25:
            hours_sentence = f"Your {_format_hours(total_minutes)} hours this week make a real impact. We appreciate your contribution."
        elif total_hrs >= 15:
            hours_sentence = f"A balanced {_format_hours(total_minutes)} hours this week allows you to stay sharp and well rested while still making a difference."
        else:
            hours_sentence = f"Your {_format_hours(total_minutes)} hours this week help keep everything running smoothly. Every hour counts."
    else:
        if total_hrs >= 10:
            hours_sentence = f"At {_format_hours(total_minutes)} hours, remember to take breaks and finish strong. We value your stamina."
        elif total_hrs >= 6:
            hours_sentence = f"This {_format_hours(total_minutes)}-hour shift makes a real difference. Thank you for your commitment."
        elif total_hrs >= 3:
            hours_sentence = f"A focused {_format_hours(total_minutes)}-hour shift. Quality over quantity, and every hour counts."
        else:
            hours_sentence = f"Thank you for your {_format_hours(total_minutes)} hours today. Your time and effort are valued."

    greeting = time_sentence
    motivation_line = hours_sentence
    return greeting, motivation_line


# Inline styles for email (compatible with major clients)
_STYLE = {
    "wrapper": "margin:0; padding:0; background-color:#f1f5f9; font-family:'Segoe UI',Roboto,sans-serif;",
    "container": "max-width:560px; margin:0 auto; padding:24px 16px;",
    "card": "background:#ffffff; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.08); overflow:hidden; margin-bottom:20px;",
    "header_bg": "background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%); color:#ffffff; padding:20px 24px;",
    "header_title": "margin:0; font-size:18px; font-weight:600; letter-spacing:0.02em;",
    "header_sub": "margin:6px 0 0 0; font-size:13px; opacity:0.9;",
    "body_pad": "padding:24px;",
    "greeting": "color:#1e293b; font-size:15px; line-height:1.5; margin:0 0 20px 0;",
    "table": "width:100%; border-collapse:collapse; font-size:14px;",
    "th": "text-align:left; padding:10px 12px; background:#f8fafc; color:#475569; font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:0.04em; border-bottom:1px solid #e2e8f0;",
    "td": "padding:10px 12px; border-bottom:1px solid #f1f5f9; color:#334155; vertical-align:top;",
    "td_time": "font-weight:500; color:#1e293b;",
    "td_muted": "color:#64748b; font-size:13px;",
    "day_row": "background:#fafbfc;",
    "day_name": "font-weight:600; color:#1e293b; padding:12px 12px 8px 12px; font-size:14px; border-bottom:1px solid #e2e8f0;",
    "shift_line": "padding:4px 12px 8px 12px; font-size:13px; color:#475569; border-bottom:1px solid #f1f5f9;",
    "hours_badge": "display:inline-block; background:#e0f2fe; color:#0369a1; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:600; margin-left:8px;",
    "total_row": "background:#f0f9ff; padding:14px 24px; font-weight:600; color:#0c4a6e; font-size:15px; border-top:2px solid #bae6fd;",
    "footer": "padding:20px 24px; border-top:1px solid #e2e8f0; color:#64748b; font-size:12px; line-height:1.5;",
    "link": "color:#2563eb; text-decoration:none;",
    "motivation": "color:#475569; font-size:14px; line-height:1.6; margin:0 0 20px 0; padding:14px 16px; background:#f8fafc; border-left:4px solid #2563eb; border-radius:0 6px 6px 0; font-style:italic;",
}


def _build_schedule_email_html(
    employee_name: str,
    week_start_date: Optional[date],
    shifts: List[Any],
) -> str:
    """Build HTML body for week schedule or single/multi shift list."""
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    total_minutes = sum(_shift_duration_minutes(s) for s in shifts)
    greeting, motivation_line = _get_schedule_motivation(shifts, total_minutes, week_start_date)

    if week_start_date is not None:
        shifts_by_date, total_minutes = _build_week_schedule_data(week_start_date, shifts)
        week_title = week_start_date.strftime("%b %d, %Y")
        header_title = "Your Week Schedule"
        header_sub = f"Week of {week_title}"
        day_blocks = []
        for i in range(7):
            day_date = week_start_date + timedelta(days=i)
            day_key = day_date.isoformat()
            day_label = f"{day_names[i]}, {day_date.strftime('%b %d, %Y')}"
            day_shifts = shifts_by_date.get(day_key, [])
            day_minutes = sum(_shift_duration_minutes(s) for s in day_shifts)
            shifts_html = []
            if not day_shifts:
                shifts_html.append(f'<div style="{_STYLE["shift_line"]}">No shifts scheduled</div>')
            else:
                for s in sorted(day_shifts, key=lambda x: (x.get("start_time", ""), x.get("end_time", ""))):
                    start_str = s.get("start_time", "")
                    end_str = s.get("end_time", "")
                    break_m = s.get("break_minutes") or 0
                    job_role = _escape(s.get("job_role"))
                    notes = _escape(s.get("notes"))
                    line = f"{start_str} – {end_str}"
                    if break_m:
                        line += f" <span style=\"{_STYLE['td_muted']}\">({break_m} min break)</span>"
                    if job_role:
                        line += f" <span style=\"{_STYLE['td_muted']}\"> —  {job_role}</span>"
                    shifts_html.append(f'<div style="{_STYLE["shift_line"]}">• {line}</div>')
                    if notes:
                        shifts_html.append(f'<div style="{_STYLE["shift_line"]}; padding-left:24px; font-style:italic;">Note: {notes}</div>')
            hours_badge = f'<span style="{_STYLE["hours_badge"]}">{_format_hours(day_minutes)} hrs</span>'
            day_blocks.append(
                f'<div style="{_STYLE["day_row"]}">'
                f'<div style="{_STYLE["day_name"]}">{day_label} {hours_badge}</div>'
                + "".join(shifts_html) +
                "</div>"
            )
        schedule_html = "".join(day_blocks)
        total_html = f'<div style="{_STYLE["total_row"]}">Total hours this week: {_format_hours(total_minutes)}</div>'
    else:
        by_date, total_minutes = _build_single_schedule_data(shifts)
        header_title = "Your Schedule"
        header_sub = "Updated shifts"
        shifts_flat = []
        for d in sorted(by_date.keys()):
            for s in sorted(by_date[d], key=lambda x: (x.get("start_time", ""), x.get("end_time", ""))):
                shifts_flat.append((d, s))
        rows = []
        for d, s in shifts_flat:
            start_str = s.get("start_time", "")
            end_str = s.get("end_time", "")
            break_m = s.get("break_minutes") or 0
            job_role = _escape(s.get("job_role"))
            notes = _escape(s.get("notes"))
            line = f"{start_str} – {end_str}"
            if break_m:
                line += f" ({break_m} min break)"
            if job_role:
                line += f"  —  {job_role}"
            rows.append(f'<div style="{_STYLE["shift_line"]}"><strong>{d}</strong> · {line}</div>')
            if notes:
                rows.append(f'<div style="{_STYLE["shift_line"]}; padding-left:24px; font-style:italic;">Note: {notes}</div>')
        schedule_html = "".join(rows)
        summary = []
        if len(by_date) > 1:
            for d in sorted(by_date.keys()):
                day_m = sum(_shift_duration_minutes(x) for x in by_date[d])
                summary.append(f'<div style="{_STYLE["shift_line"]}">{d}: <span style="{_STYLE["hours_badge"]}">{_format_hours(day_m)} hrs</span></div>')
        summary.append(f'<div style="{_STYLE["total_row"]}">Total hours: {_format_hours(total_minutes)}</div>')
        total_html = "".join(summary)

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="{_STYLE["wrapper"]}">
  <div style="{_STYLE["container"]}">
    <div style="{_STYLE["card"]}">
      <div style="{_STYLE["header_bg"]}">
        <p style="{_STYLE["header_title"]}">ClockIn Pro</p>
        <p style="{_STYLE["header_sub"]}">{header_title}</p>
      </div>
      <div style="{_STYLE["body_pad"]}">
        <p style="{_STYLE["greeting"]}">Hello {_escape(employee_name)},</p>
        <p style="{_STYLE["motivation"]}">{_escape(greeting)} {_escape(motivation_line)}</p>
        <p style="{_STYLE["greeting"]}">{header_sub}</p>
        {schedule_html}
        {total_html}
      </div>
      <div style="{_STYLE["footer"]}">
        View your full schedule in the ClockIn Pro dashboard.<br>
        Questions? Contact your manager.
      </div>
    </div>
  </div>
</body>
</html>"""
    return html


def _build_week_schedule_data(
    week_start_date: date,
    shifts: List[Any],
) -> tuple:
    """Group shifts by date and compute total minutes for the week."""
    shifts_by_date: Dict[str, List[Any]] = {}
    total_minutes = 0.0
    for s in shifts:
        d = s.get("date", "")
        if d not in shifts_by_date:
            shifts_by_date[d] = []
        shifts_by_date[d].append(s)
        total_minutes += _shift_duration_minutes(s)
    return shifts_by_date, total_minutes


def _build_single_schedule_data(shifts: List[Any]) -> tuple:
    """Group shifts by date and compute total minutes."""
    by_date: Dict[str, List[Any]] = {}
    total_minutes = 0.0
    for s in shifts:
        d = s.get("date", "")
        if d not in by_date:
            by_date[d] = []
        by_date[d].append(s)
        total_minutes += _shift_duration_minutes(s)
    return by_date, total_minutes


class EmailService:
    """Service for sending emails via Gmail API."""
    
    def __init__(self):
        self.service = None
        self.creds = None
        self._initialize_service()
    
    def _refresh_token_if_needed(self):
        """
        Refresh Gmail API access token if it's expired or about to expire.
        This handles both access token expiration (hourly) and refresh token expiration (6 months).
        """
        if not self.creds:
            return False
        
        try:
            # Check if token is expired or expiring soon (within 5 minutes)
            if not self.creds.valid or (self.creds.expired and self.creds.refresh_token):
                try:
                    # Try to refresh the access token using the refresh token
                    self.creds.refresh(Request())
                    
                    # Save refreshed token
                    self._save_token(self.creds)
                    
                    # Rebuild service with new credentials
                    self.service = build('gmail', 'v1', credentials=self.creds)
                    logger.info("Gmail API token refreshed successfully")
                    return True
                except Exception as refresh_error:
                    error_str = str(refresh_error).lower()
                    # Check if refresh token itself has expired or been revoked
                    if 'invalid_grant' in error_str or 'token has been expired or revoked' in error_str:
                        logger.error("Gmail refresh token has expired or been revoked. Re-authorization required.")
                        logger.error("To fix this, you need to re-authorize the Gmail API:")
                        logger.error("1. Run: python server/setup_gmail.py (for development)")
                        logger.error("2. Or update GMAIL_TOKEN_JSON environment variable with a new token")
                        logger.error("3. For production, use Google OAuth 2.0 Playground to get a new refresh token")
                        self.service = None
                        self.creds = None
                        return False
                    else:
                        logger.error(f"Failed to refresh Gmail token: {refresh_error}")
                        return False
            return True
        except Exception as e:
            logger.error(f"Error checking/refreshing Gmail token: {e}")
            return False
    
    def _save_token(self, creds: Credentials):
        """
        Save refreshed token to both file (if available) and log instructions for env var update.
        In production, the token needs to be manually updated in GMAIL_TOKEN_JSON env var.
        """
        try:
            token_json = creds.to_json()
            
            # Try to save to file (development)
            if not settings.GMAIL_TOKEN_JSON:
                token_file = Path(__file__).parent.parent.parent / 'gmail_token.json'
                if token_file.parent.exists():
                    with open(token_file, 'w') as token:
                        token.write(token_json)
                    logger.info(f"Gmail token saved to {token_file}")
            
            # In production (env vars), log instructions
            if settings.GMAIL_TOKEN_JSON:
                logger.warning("⚠️  Gmail token refreshed. You should update GMAIL_TOKEN_JSON env var with:")
                logger.warning(f"   New token JSON: {token_json[:100]}...")
                logger.warning("   This is required for the token to persist across server restarts.")
        except Exception as e:
            logger.error(f"Failed to save Gmail token: {e}")
    
    def _initialize_service(self):
        """Initialize Gmail API service."""
        try:
            creds = None
            
            # Try loading from environment variables first (production)
            if settings.GMAIL_TOKEN_JSON:
                try:
                    token_data = json.loads(settings.GMAIL_TOKEN_JSON)
                    creds = Credentials.from_authorized_user_info(token_data, SCOPES)
                except Exception as e:
                    logger.warning(f"Failed to load token from env: {e}")
            
            # If no token from env, try file-based approach (development)
            if not creds:
                token_file = Path(__file__).parent.parent.parent / 'gmail_token.json'
                if token_file.exists():
                    creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
            
            # If there are no (valid) credentials available, try to get new ones
            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    # Try to refresh expired token
                    try:
                        creds.refresh(Request())
                        # Save refreshed token if using file-based approach
                        if not settings.GMAIL_TOKEN_JSON:
                            token_file = Path(__file__).parent.parent.parent / 'gmail_token.json'
                            if token_file.parent.exists():
                                with open(token_file, 'w') as token:
                                    token.write(creds.to_json())
                    except Exception as e:
                        logger.error(f"Failed to refresh token: {e}")
                        creds = None
                
                # If still no valid creds, try to initialize from credentials
                if not creds:
                    creds_data = None
                    
                    # Try environment variable first
                    if settings.GMAIL_CREDENTIALS_JSON:
                        try:
                            creds_data = json.loads(settings.GMAIL_CREDENTIALS_JSON)
                        except Exception as e:
                            logger.warning(f"Failed to parse GMAIL_CREDENTIALS_JSON: {e}")
                    
                    # Fall back to file
                    if not creds_data:
                        creds_file = Path(__file__).parent.parent.parent / 'gmail_credentials.json'
                        if creds_file.exists():
                            with open(creds_file, 'r') as f:
                                creds_data = json.load(f)
                    
                    if creds_data:
                        # For production (env vars), we need a service account or pre-authorized token
                        # For development, use OAuth flow
                        if settings.GMAIL_CREDENTIALS_JSON:
                            # In production with env vars, token should be provided via GMAIL_TOKEN_JSON
                            logger.warning("GMAIL_CREDENTIALS_JSON provided but no valid token. Set GMAIL_TOKEN_JSON.")
                        else:
                            # Development: use OAuth flow
                            flow = InstalledAppFlow.from_client_secrets_file(
                                str(creds_file), SCOPES)
                            # Use port 8080 - must be added to Google Cloud Console redirect URIs
                            creds = flow.run_local_server(port=8080, prompt='consent')
                            # Save token
                            token_file = Path(__file__).parent.parent.parent / 'gmail_token.json'
                            if token_file.parent.exists():
                                with open(token_file, 'w') as token:
                                    token.write(creds.to_json())
                    else:
                        logger.warning("Gmail credentials not found. Email sending will be disabled.")
                        logger.warning("Set GMAIL_CREDENTIALS_JSON and GMAIL_TOKEN_JSON env vars, or place gmail_credentials.json in server root.")
                        return
            
            if creds:
                self.creds = creds
                self.service = build('gmail', 'v1', credentials=creds)
                logger.info("Gmail API service initialized successfully")
                
                # Try to refresh token immediately if needed
                self._refresh_token_if_needed()
            else:
                logger.warning("Gmail API service not initialized - no valid credentials")
            
        except Exception as e:
            logger.error(f"Failed to initialize Gmail API service: {e}")
            self.service = None
    
    def _create_message(self, to: str, subject: str, body: str, subtype: str = "plain") -> dict:
        """Create a message for an email. subtype: 'plain' or 'html'."""
        message = MIMEText(body, subtype, "utf-8")
        message['to'] = to
        message['from'] = settings.GMAIL_SENDER_EMAIL
        message['subject'] = subject
        
        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')
        return {'raw': raw_message}
    
    async def send_verification_email(self, to_email: str, verification_pin: str) -> bool:
        """
        Send email verification PIN via Gmail API.
        
        Args:
            to_email: Recipient email address
            verification_pin: 6-digit verification PIN
            
        Returns:
            True if email sent successfully, False otherwise
        """
        # Refresh token before sending (handles hourly expiration)
        if not self._refresh_token_if_needed():
            logger.error("Gmail service not initialized or token refresh failed. Cannot send email.")
            return False
        
        if not self.service:
            logger.error("Gmail service not initialized. Cannot send email.")
            return False
        
        try:
            subject = "Verify your email  —  ClockIn Pro"
            body = f"""Your 6-digit verification code is:

{verification_pin}

This code expires in 15 minutes.

For security reasons, email verification is required every 30 days.

If you didn't request this code, please ignore this email.
"""
            
            message = self._create_message(to_email, subject, body)
            
            # Send message
            result = self.service.users().messages().send(
                userId='me',
                body=message
            ).execute()
            
            logger.info(f"Verification email sent to {to_email}. Message ID: {result.get('id')}")
            return True
            
        except HttpError as error:
            # Handle specific Gmail API errors
            error_details = error.error_details if hasattr(error, 'error_details') else str(error)
            
            # Check if it's an authentication error (401)
            if error.resp.status == 401:
                logger.error("Gmail API authentication failed. Token may have expired.")
                # Try to refresh token once more
                if self._refresh_token_if_needed():
                    # Retry sending email once
                    try:
                        result = self.service.users().messages().send(
                            userId='me',
                            body=message
                        ).execute()
                        logger.info(f"Verification email sent to {to_email} after token refresh. Message ID: {result.get('id')}")
                        return True
                    except Exception as retry_error:
                        logger.error(f"Failed to send email after token refresh: {retry_error}")
                        return False
                else:
                    logger.error("Gmail refresh token has expired. Re-authorization required.")
                    return False
            
            logger.error(f"Gmail API error while sending email: {error_details}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending email: {e}")
            return False
    
    async def send_verification_reminder(self, to_email: str) -> bool:
        """
        Send reminder email that verification expires soon.
        
        Args:
            to_email: Recipient email address
            
        Returns:
            True if email sent successfully, False otherwise
        """
        # Refresh token before sending (handles hourly expiration)
        if not self._refresh_token_if_needed():
            logger.error("Gmail service not initialized or token refresh failed. Cannot send email.")
            return False
        
        if not self.service:
            logger.error("Gmail service not initialized. Cannot send email.")
            return False
        
        try:
            subject = "Email Verification Expiring Soon  —  ClockIn Pro"
            body = f"""Your email verification expires in 3 days.

Please verify your email to continue using ClockIn Pro without interruption.

You can verify your email by logging in to your account.

If you have any questions, please contact support.
"""
            
            message = self._create_message(to_email, subject, body)
            
            # Send message
            result = self.service.users().messages().send(
                userId='me',
                body=message
            ).execute()
            
            logger.info(f"Verification reminder sent to {to_email}. Message ID: {result.get('id')}")
            return True
            
        except HttpError as error:
            # Handle specific Gmail API errors
            error_details = error.error_details if hasattr(error, 'error_details') else str(error)
            
            # Check if it's an authentication error (401)
            if error.resp.status == 401:
                logger.error("Gmail API authentication failed. Token may have expired.")
                # Try to refresh token once more
                if self._refresh_token_if_needed():
                    # Retry sending email once
                    try:
                        result = self.service.users().messages().send(
                            userId='me',
                            body=message
                        ).execute()
                        logger.info(f"Verification reminder sent to {to_email} after token refresh. Message ID: {result.get('id')}")
                        return True
                    except Exception as retry_error:
                        logger.error(f"Failed to send reminder after token refresh: {retry_error}")
                        return False
                else:
                    logger.error("Gmail refresh token has expired. Re-authorization required.")
                    return False
            
            logger.error(f"Gmail API error while sending reminder: {error_details}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending reminder: {e}")
            return False
    
    async def send_leave_request_notification(
        self,
        admin_email: str,
        employee_name: str,
        leave_type: str,
        start_date: str,
        end_date: str,
        reason: Optional[str] = None,
    ) -> bool:
        """
        Send notification to admin when a new leave request is submitted.
        
        Args:
            admin_email: Admin email address
            employee_name: Name of employee who submitted the request
            leave_type: Type of leave (vacation, sick, personal, other)
            start_date: Start date of leave
            end_date: End date of leave
            reason: Optional reason for leave
            
        Returns:
            True if email sent successfully, False otherwise
        """
        # Refresh token before sending
        if not self._refresh_token_if_needed():
            logger.error("Gmail service not initialized or token refresh failed. Cannot send email.")
            return False
        
        if not self.service:
            logger.error("Gmail service not initialized. Cannot send email.")
            return False
        
        try:
            subject = f"New Leave Request from {employee_name}  —  ClockIn Pro"
            
            reason_text = f"\nReason: {reason}" if reason else ""
            
            body = f"""A new leave request has been submitted and requires your review.

Employee: {employee_name}
Leave Type: {leave_type.title()}
Start Date: {start_date}
End Date: {end_date}{reason_text}

Please review and respond to this leave request in your admin dashboard.

ClockIn Pro"""
            
            message = self._create_message(admin_email, subject, body)
            
            result = self.service.users().messages().send(
                userId='me',
                body=message
            ).execute()
            
            logger.info(f"Leave request notification sent to {admin_email}. Message ID: {result.get('id')}")
            return True
            
        except HttpError as error:
            error_details = error.error_details if hasattr(error, 'error_details') else str(error)
            
            if error.resp.status == 401:
                logger.error("Gmail API authentication failed. Token may have expired.")
                if self._refresh_token_if_needed():
                    try:
                        result = self.service.users().messages().send(
                            userId='me',
                            body=message
                        ).execute()
                        logger.info(f"Leave request notification sent to {admin_email} after token refresh. Message ID: {result.get('id')}")
                        return True
                    except Exception as retry_error:
                        logger.error(f"Failed to send leave notification after token refresh: {retry_error}")
                        return False
                else:
                    logger.error("Gmail refresh token has expired. Re-authorization required.")
                    return False
            
            logger.error(f"Gmail API error while sending leave notification: {error_details}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending leave notification: {e}")
            return False
    
    async def send_leave_request_response(
        self,
        employee_email: str,
        employee_name: str,
        status: str,
        leave_type: str,
        start_date: str,
        end_date: str,
        reason: Optional[str] = None,
        reviewer_name: Optional[str] = None,
        review_comment: Optional[str] = None,
    ) -> bool:
        """
        Send notification to employee when their leave request is approved/rejected.
        
        Args:
            employee_email: Employee email address
            employee_name: Name of employee
            status: Status of request (approved/rejected)
            leave_type: Type of leave (vacation, sick, personal, other)
            start_date: Start date of leave
            end_date: End date of leave
            reason: Optional original reason submitted by employee
            reviewer_name: Optional name of reviewer
            review_comment: Optional comment from reviewer
            
        Returns:
            True if email sent successfully, False otherwise
        """
        # Refresh token before sending
        if not self._refresh_token_if_needed():
            logger.error("Gmail service not initialized or token refresh failed. Cannot send email.")
            return False
        
        if not self.service:
            logger.error("Gmail service not initialized. Cannot send email.")
            return False
        
        try:
            status_text = "Approved" if status.lower() == "approved" else "Rejected"
            subject = f"Leave Request {status_text}  —  ClockIn Pro"
            
            reason_text = f"\n- Reason: {reason}" if reason else ""
            reviewer_text = f"\n- Reviewed by: {reviewer_name}" if reviewer_name else ""
            comment_text = f"\n\nReview Comment:\n{review_comment}" if review_comment else ""
            
            body = f"""Your leave request has been {status_text.lower()}.

Leave Details:
- Type: {leave_type.title()}
- Start Date: {start_date}
- End Date: {end_date}{reason_text}{reviewer_text}{comment_text}

You can view all your leave requests in your dashboard.

ClockIn Pro"""
            
            message = self._create_message(employee_email, subject, body)
            
            result = self.service.users().messages().send(
                userId='me',
                body=message
            ).execute()
            
            logger.info(f"Leave request response sent to {employee_email}. Message ID: {result.get('id')}")
            return True
            
        except HttpError as error:
            error_details = error.error_details if hasattr(error, 'error_details') else str(error)
            
            if error.resp.status == 401:
                logger.error("Gmail API authentication failed. Token may have expired.")
                if self._refresh_token_if_needed():
                    try:
                        result = self.service.users().messages().send(
                            userId='me',
                            body=message
                        ).execute()
                        logger.info(f"Leave request response sent to {employee_email} after token refresh. Message ID: {result.get('id')}")
                        return True
                    except Exception as retry_error:
                        logger.error(f"Failed to send leave response after token refresh: {retry_error}")
                        return False
                else:
                    logger.error("Gmail refresh token has expired. Re-authorization required.")
                    return False
            
            logger.error(f"Gmail API error while sending leave response: {error_details}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending leave response: {e}")
            return False

    async def send_password_setup_email(self, to_email: str, employee_name: str, setup_link: str) -> bool:
        """
        Send password setup email to new employee.
        
        Args:
            to_email: Employee email address
            employee_name: Name of employee
            setup_link: URL link to set password
            
        Returns:
            True if email sent successfully, False otherwise
        """
        # Refresh token before sending
        if not self._refresh_token_if_needed():
            logger.error("Gmail service not initialized or token refresh failed. Cannot send email.")
            return False
        
        if not self.service:
            logger.error("Gmail service not initialized. Cannot send email.")
            return False
        
        try:
            subject = "Set Up Your Password  —  ClockIn Pro"
            
            body = f"""Hello {employee_name},

Welcome to ClockIn Pro! Your account has been created.

To get started, please set your password by clicking the link below:

{setup_link}

This link will expire in 7 days.

If you didn't expect this email, please ignore it.

ClockIn Pro"""
            
            message = self._create_message(to_email, subject, body)
            
            result = self.service.users().messages().send(
                userId='me',
                body=message
            ).execute()
            
            logger.info(f"Password setup email sent to {to_email}. Message ID: {result.get('id')}")
            return True
            
        except HttpError as error:
            error_details = error.error_details if hasattr(error, 'error_details') else str(error)
            
            if error.resp.status == 401:
                logger.error("Gmail API authentication failed. Token may have expired.")
                if self._refresh_token_if_needed():
                    try:
                        result = self.service.users().messages().send(
                            userId='me',
                            body=message
                        ).execute()
                        logger.info(f"Password setup email sent to {to_email} after token refresh. Message ID: {result.get('id')}")
                        return True
                    except Exception as retry_error:
                        logger.error(f"Failed to send password setup email after token refresh: {retry_error}")
                        return False
                else:
                    logger.error("Gmail refresh token has expired. Re-authorization required.")
                    return False
            
            logger.error(f"Gmail API error while sending password setup email: {error_details}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending password setup email: {e}")
            return False

    async def send_password_reset_otp(self, to_email: str, otp: str) -> bool:
        """
        Send 6-digit OTP for password reset (forgot password flow).

        Args:
            to_email: Recipient email address
            otp: 6-digit OTP code

        Returns:
            True if email sent successfully, False otherwise
        """
        if not self._refresh_token_if_needed():
            logger.error("Gmail service not initialized or token refresh failed. Cannot send email.")
            return False

        if not self.service:
            logger.error("Gmail service not initialized. Cannot send email.")
            return False

        try:
            subject = "Reset Your Password  —  ClockIn Pro"
            body = f"""You requested to reset your password.

Your 6-digit verification code is:

{otp}

This code expires in 15 minutes.

If you didn't request a password reset, please ignore this email and your password will remain unchanged.

ClockIn Pro"""
            message = self._create_message(to_email, subject, body)
            result = self.service.users().messages().send(
                userId='me',
                body=message
            ).execute()
            logger.info(f"Password reset OTP email sent to {to_email}. Message ID: {result.get('id')}")
            return True
        except HttpError as error:
            if error.resp.status == 401 and self._refresh_token_if_needed():
                try:
                    msg = self._create_message(to_email, "Reset Your Password  —  ClockIn Pro",
                        f"Your 6-digit code: {otp}. Expires in 15 minutes.")
                    result = self.service.users().messages().send(userId='me', body=msg).execute()
                    logger.info(f"Password reset OTP sent to {to_email} after token refresh.")
                    return True
                except Exception:
                    return False
            logger.error(f"Gmail API error sending password reset OTP: {error}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending password reset OTP: {e}")
            return False

    async def send_schedule_notification(
        self,
        employee_email: str,
        employee_name: str,
        shifts: List[Any],
        week_start_date: Optional[date] = None,
    ) -> bool:
        """
        Send schedule details to an employee when shifts are created.

        Args:
            employee_email: Employee email address
            employee_name: Name of employee
            shifts: List of shift dicts with keys: date (str), start_time (str), end_time (str),
                    break_minutes (int), notes (optional str), job_role (optional str)
            week_start_date: If set, format as a full week schedule (Mon–Sun) with this Monday's date.

        Returns:
            True if email sent successfully, False otherwise
        """
        if not shifts:
            return True

        logger.info("Sending schedule notification to %s (%d shift(s))", employee_email, len(shifts))

        if not self._refresh_token_if_needed():
            logger.error("Schedule email NOT sent to %s: Gmail not initialized or token refresh failed. Set GMAIL_CREDENTIALS_JSON and GMAIL_TOKEN_JSON.", employee_email)
            return False

        if not self.service:
            logger.error("Schedule email NOT sent to %s: Gmail service not initialized. Configure Gmail API (see server logs at startup).", employee_email)
            return False

        try:
            if week_start_date is not None:
                subject = "Your Week Schedule  —  ClockIn Pro"
            else:
                subject = "Your Schedule  —  ClockIn Pro"
            body = _build_schedule_email_html(
                employee_name=employee_name or "Employee",
                week_start_date=week_start_date,
                shifts=shifts,
            )
            message = self._create_message(employee_email, subject, body, subtype="html")

            result = self.service.users().messages().send(
                userId='me',
                body=message
            ).execute()

            logger.info(f"Schedule notification sent to {employee_email}. Message ID: {result.get('id')}")
            return True

        except HttpError as error:
            error_details = error.error_details if hasattr(error, 'error_details') else str(error)
            if error.resp.status == 401 and self._refresh_token_if_needed():
                try:
                    result = self.service.users().messages().send(userId='me', body=message).execute()
                    logger.info(f"Schedule notification sent to {employee_email} after token refresh.")
                    return True
                except Exception as retry_error:
                    logger.error(f"Failed to send schedule notification after token refresh: {retry_error}")
                    return False
            logger.error(f"Gmail API error while sending schedule notification: {error_details}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending schedule notification: {e}")
            return False


# Global email service instance
email_service = EmailService()

