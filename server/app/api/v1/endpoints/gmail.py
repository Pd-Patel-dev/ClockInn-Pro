"""
Admin endpoints for managing Gmail API authentication.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from typing import Optional
import logging

from app.core.dependencies import get_current_admin
from app.models.user import User
from app.services.email_service import email_service
from app.core.config import settings
from app.core.error_handling import handle_endpoint_errors

logger = logging.getLogger(__name__)

router = APIRouter()


class GmailHealthResponse(BaseModel):
    status: str
    initialized: bool
    message: str
    needs_reauthorization: bool = False


class GmailOAuthUrlResponse(BaseModel):
    authorization_url: str
    message: str


class GmailTokenUpdateRequest(BaseModel):
    token_json: str


@router.get("/health", response_model=GmailHealthResponse)
@handle_endpoint_errors(operation_name="gmail_health_check")
async def check_gmail_health(
    current_user: User = Depends(get_current_admin),
):
    """
    Check Gmail API service health and token status.
    Admin only endpoint.
    """
    if not email_service.service:
        return GmailHealthResponse(
            status="error",
            initialized=False,
            message="Gmail API service not initialized. Re-authorization required.",
            needs_reauthorization=True,
        )
    
    # Try to refresh token to check if it's valid
    if email_service.creds:
        try:
            # Check if credentials are valid
            if not email_service.creds.valid:
                # Try to refresh
                if email_service.creds.expired and email_service.creds.refresh_token:
                    try:
                        from google.auth.transport.requests import Request
                        email_service.creds.refresh(Request())
                        return GmailHealthResponse(
                            status="healthy",
                            initialized=True,
                            message="Gmail API is operational. Token refreshed successfully.",
                            needs_reauthorization=False,
                        )
                    except Exception as e:
                        error_str = str(e).lower()
                        if 'invalid_grant' in error_str or 'token has been expired or revoked' in error_str:
                            return GmailHealthResponse(
                                status="error",
                                initialized=False,
                                message="Refresh token has expired or been revoked. Re-authorization required.",
                                needs_reauthorization=True,
                            )
                        return GmailHealthResponse(
                            status="error",
                            initialized=False,
                            message=f"Failed to refresh token: {str(e)}",
                            needs_reauthorization=True,
                        )
                else:
                    return GmailHealthResponse(
                        status="error",
                        initialized=False,
                        message="No refresh token available. Re-authorization required.",
                        needs_reauthorization=True,
                    )
            else:
                return GmailHealthResponse(
                    status="healthy",
                    initialized=True,
                    message="Gmail API is operational and token is valid.",
                    needs_reauthorization=False,
                )
        except Exception as e:
            return GmailHealthResponse(
                status="error",
                initialized=False,
                message=f"Error checking Gmail status: {str(e)}",
                needs_reauthorization=True,
            )
    
    return GmailHealthResponse(
        status="error",
        initialized=False,
        message="Gmail API credentials not found.",
        needs_reauthorization=True,
    )


@router.get("/oauth-url", response_model=GmailOAuthUrlResponse)
@handle_endpoint_errors(operation_name="get_gmail_oauth_url")
async def get_gmail_oauth_url(
    current_user: User = Depends(get_current_admin),
    redirect_uri: Optional[str] = Query(None, description="Optional redirect URI (defaults to production URL)"),
):
    """
    Generate OAuth 2.0 authorization URL for Gmail API.
    Admin can visit this URL to authorize the application.
    Admin only endpoint.
    """
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        import json
        
        # Get credentials data
        creds_data = None
        if settings.GMAIL_CREDENTIALS_JSON:
            try:
                creds_data = json.loads(settings.GMAIL_CREDENTIALS_JSON)
            except Exception as e:
                logger.error(f"Failed to parse GMAIL_CREDENTIALS_JSON: {e}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid GMAIL_CREDENTIALS_JSON. Please check your configuration.",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="GMAIL_CREDENTIALS_JSON not configured. Please set it in environment variables.",
            )
        
        # Create OAuth flow
        SCOPES = ['https://www.googleapis.com/auth/gmail.send']
        
        # For web-based OAuth, we need to use InstalledAppFlow with custom redirect
        # Note: This generates a URL that admin must visit in browser
        flow = InstalledAppFlow.from_client_config(creds_data, SCOPES)
        
        # Use default redirect URI or provided one
        if not redirect_uri:
            redirect_uri = "http://localhost:8080/"  # Default for development
            # In production, you might want to use your frontend URL + callback endpoint
        
        # Generate authorization URL
        auth_url, _ = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent',  # Force consent to get refresh token
        )
        
        return GmailOAuthUrlResponse(
            authorization_url=auth_url,
            message="Visit this URL in your browser to authorize Gmail API access. After authorization, you'll receive a code to update the token.",
        )
        
    except Exception as e:
        logger.error(f"Failed to generate OAuth URL: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate OAuth URL: {str(e)}",
        )


@router.post("/update-token")
@handle_endpoint_errors(operation_name="update_gmail_token")
async def update_gmail_token(
    request: GmailTokenUpdateRequest,
    current_user: User = Depends(get_current_admin),
):
    """
    Update Gmail API token from authorization code or token JSON.
    This endpoint accepts either:
    1. A complete token JSON (from OAuth callback or Google Playground)
    2. An authorization code (to be exchanged for tokens)
    
    Admin only endpoint.
    """
    try:
        import json
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from pathlib import Path
        
        token_json_str = request.token_json.strip()
        
        # Try to parse as JSON first
        try:
            token_data = json.loads(token_json_str)
            
            # Validate it's a valid token structure
            if 'refresh_token' not in token_data and 'token' not in token_data:
                # Might be authorization code, try to exchange
                # For now, assume it's a token JSON
                pass
            
            # Create credentials from token JSON
            SCOPES = ['https://www.googleapis.com/auth/gmail.send']
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
            
            # Reinitialize email service with new credentials
            email_service.creds = creds
            email_service.service = None  # Will be rebuilt on next use
            
            # Save token
            email_service._save_token(creds)
            
            # Rebuild service
            from googleapiclient.discovery import build
            email_service.service = build('gmail', 'v1', credentials=creds)
            
            logger.info("Gmail API token updated successfully by admin")
            
            return {
                "status": "success",
                "message": "Gmail API token updated successfully. Service reinitialized.",
            }
            
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid JSON format. Please provide valid token JSON from Google OAuth 2.0 Playground or OAuth callback.",
            )
        except Exception as e:
            logger.error(f"Failed to update Gmail token: {e}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to update token: {str(e)}. Please ensure the token JSON is valid.",
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error updating Gmail token: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unexpected error: {str(e)}",
        )


@router.post("/test-send")
@handle_endpoint_errors(operation_name="test_gmail_send")
async def test_gmail_send(
    test_email: str = Query(..., description="Email address to send test email to"),
    current_user: User = Depends(get_current_admin),
):
    """
    Send a test email to verify Gmail API is working.
    Admin only endpoint.
    """
    if not email_service.service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gmail API service not initialized. Please re-authorize first.",
        )
    
    try:
        # Try to refresh token first
        if not email_service._refresh_token_if_needed():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Failed to refresh Gmail token. Re-authorization may be required.",
            )
        
        # Send test email
        success = await email_service.send_verification_email(
            to_email=test_email,
            verification_pin="123456",  # Test PIN
        )
        
        if success:
            return {
                "status": "success",
                "message": f"Test email sent successfully to {test_email}",
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send test email. Check server logs for details.",
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending test email: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error sending test email: {str(e)}",
        )

