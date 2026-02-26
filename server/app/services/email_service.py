"""
Email service for sending verification emails via Gmail API.
"""
import base64
import json
import logging
from email.mime.text import MIMEText
from typing import Optional
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
    
    def _create_message(self, to: str, subject: str, body: str) -> dict:
        """Create a message for an email."""
        message = MIMEText(body)
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
            subject = "Verify your email — ClockIn Pro"
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
            subject = "Email Verification Expiring Soon — ClockIn Pro"
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
            subject = f"New Leave Request from {employee_name} — ClockIn Pro"
            
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
            subject = f"Leave Request {status_text} — ClockIn Pro"
            
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
            subject = "Set Up Your Password — ClockIn Pro"
            
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
            subject = "Reset Your Password — ClockIn Pro"
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
                    msg = self._create_message(to_email, "Reset Your Password — ClockIn Pro",
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


# Global email service instance
email_service = EmailService()

