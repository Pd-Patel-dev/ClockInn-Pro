# Gmail API Refresh Token Management for Production

## Overview

Gmail API refresh tokens can expire in several scenarios:

1. **Not used for 6 months** - Google automatically expires unused refresh tokens
2. **User revokes access** - User manually revokes access in Google Account settings
3. **Password changed** - User changes their Gmail password
4. **Maximum tokens exceeded** - Too many refresh tokens issued for the same account

## Current Implementation

### Automatic Token Refresh

The email service now automatically:

- ✅ Refreshes access tokens when they expire (hourly)
- ✅ Handles refresh token expiration gracefully
- ✅ Provides clear error messages when re-authorization is needed
- ✅ Retries email sending after token refresh

### Token Refresh Flow

1. **Before each email send**: Checks if access token is expired
2. **If expired**: Automatically refreshes using refresh token
3. **If refresh fails**: Detects if refresh token itself is expired
4. **Error handling**: Logs clear instructions for re-authorization

## Production Setup

### Option 1: Environment Variables (Recommended for Production)

1. **Get credentials and token** using Google OAuth 2.0 Playground (see `GMAIL_SETUP_PLAYGROUND.md`)

   - **⚠️ CRITICAL:** You MUST use your own OAuth credentials in Playground settings
   - Default Playground credentials will cause refresh tokens to expire in 24 hours
   - Your own credentials provide long-lived tokens (6 months or more)

2. **Set environment variables** in your production environment (Render, Vercel, etc.):

   ```bash
   GMAIL_CREDENTIALS_JSON='{"installed":{"client_id":"...","client_secret":"...","auth_uri":"...","token_uri":"..."}}'
   GMAIL_TOKEN_JSON='{"token":"...","refresh_token":"...","token_uri":"...","client_id":"...","client_secret":"..."}'
   GMAIL_SENDER_EMAIL="no-reply.clockinpro@gmail.com"
   ```

3. **Monitor logs** for refresh token expiration warnings

### Option 2: Manual Token Update

When refresh token expires, update `GMAIL_TOKEN_JSON` environment variable:

1. Generate new refresh token using Google OAuth 2.0 Playground
2. Create token JSON:
   ```json
   {
   	"token": null,
   	"refresh_token": "YOUR_NEW_REFRESH_TOKEN",
   	"token_uri": "https://oauth2.googleapis.com/token",
   	"client_id": "YOUR_CLIENT_ID",
   	"client_secret": "YOUR_CLIENT_SECRET",
   	"scopes": ["https://www.googleapis.com/auth/gmail.send"],
   	"universe_domain": "googleapis.com"
   }
   ```
3. Update `GMAIL_TOKEN_JSON` environment variable in production
4. Restart the server

## Preventing Refresh Token Expiration

### Strategy 1: Regular Usage (Recommended)

- **Send emails regularly** - Refresh tokens that are used stay active
- **Automatic refresh** - Our system refreshes access tokens hourly, which counts as "usage"
- **Keep refresh token active** - As long as emails are sent every 6 months, token won't expire

### Strategy 2: Periodic Refresh

- **Automated refresh** - The system automatically refreshes tokens when sending emails
- **No action needed** - As long as emails are sent regularly (at least once every 6 months)

### Strategy 3: Token Monitoring (Future)

- Monitor token expiration in logs
- Set up alerts for refresh token expiration warnings
- Proactively refresh before expiration

## Detecting Refresh Token Expiration

### Error Messages

When refresh token expires, you'll see:

```
ERROR: Gmail refresh token has expired or been revoked. Re-authorization required.
```

### Log Monitoring

Check your production logs for:

- `"Gmail refresh token has expired"`
- `"Failed to refresh Gmail token: invalid_grant"`
- `"Re-authorization required"`

### Health Check

You can add a health check endpoint that verifies Gmail API connectivity:

```python
@router.get("/health/gmail")
async def check_gmail_health():
    if email_service.service:
        return {"status": "healthy", "gmail_api": "connected"}
    return {"status": "degraded", "gmail_api": "not_connected"}
```

## Automated Re-Authorization (New!)

### Admin Dashboard Management

We've implemented an automated management system accessible via the admin settings page:

1. **Navigate to Settings → Email Service Tab** (admin only)
2. **Check Gmail Health Status**:

   - System automatically checks if token is valid
   - Shows warning if refresh token expired
   - Provides step-by-step re-authorization instructions

3. **Update Token Directly**:

   - Copy token JSON from Google OAuth 2.0 Playground
   - Paste into the "Update Gmail Token" form
   - Click "Update Token"
   - **No server restart needed!** Service reinitializes automatically

4. **Test Email Sending**:
   - Click "Send Test Email" button
   - Enter recipient email
   - Verify Gmail API is working

### API Endpoints (Admin Only)

- `GET /api/v1/admin/gmail/health` - Check Gmail service status
- `POST /api/v1/admin/gmail/update-token` - Update Gmail token
- `POST /api/v1/admin/gmail/test-send?test_email=...` - Send test email

### Manual Re-Authorization Process

If you prefer to update via environment variables:

1. **Use Google OAuth 2.0 Playground** (see `GMAIL_SETUP_PLAYGROUND.md`):

   - **⚠️ CRITICAL:** Use your own OAuth credentials in Playground settings (Settings icon → "Use your own OAuth credentials")
   - **If you skip this, refresh token will expire in 24 hours!**
   - Get new refresh token
   - Update `GMAIL_TOKEN_JSON` environment variable
   - Restart server

2. **Or use setup script** (development only):
   ```bash
   python server/setup_gmail.py
   ```

### Quick Token Update Script

You can create a helper script to update tokens:

```python
# server/update_gmail_token.py
import json
from app.services.email_service import EmailService

# This will prompt for new token and update it
# (For production, use environment variables instead)
```

## Best Practices

### 1. Monitor Email Sending

- Set up alerts for email sending failures
- Monitor refresh token expiration warnings
- Track email delivery rates

### 2. Regular Testing

- Test email sending monthly
- Verify token refresh is working
- Check logs for warnings

### 3. Backup Strategy

- Keep credentials secure (encrypted storage)
- Document re-authorization process
- Have admin access to update tokens quickly

### 4. Automation (Future Enhancement)

- Scheduled health checks
- Automatic token refresh monitoring
- Email alerts when token expires

## Troubleshooting

### Issue: "Gmail refresh token has expired"

**Solution**:

1. Generate new refresh token using Google OAuth 2.0 Playground
2. Update `GMAIL_TOKEN_JSON` environment variable
3. Restart server

### Issue: "Failed to refresh Gmail token"

**Solution**:

1. Check if refresh token is valid
2. Verify client ID and secret are correct
3. Ensure token hasn't been revoked in Google Account settings

### Issue: Emails not sending but no errors

**Solution**:

1. Check `email_service.service` is not None
2. Verify Gmail API is enabled in Google Cloud Console
3. Check API quotas haven't been exceeded

## Environment Variable Template

```bash
# Gmail API Configuration
GMAIL_CREDENTIALS_JSON='{"installed":{"client_id":"...","client_secret":"..."}}'
GMAIL_TOKEN_JSON='{"refresh_token":"...","client_id":"...","client_secret":"...","token_uri":"https://oauth2.googleapis.com/token","scopes":["https://www.googleapis.com/auth/gmail.send"],"universe_domain":"googleapis.com"}'
GMAIL_SENDER_EMAIL="no-reply.clockinpro@gmail.com"
```

## Notes

- **Access tokens expire every 3600 seconds (1 hour)** - Automatically refreshed
- **Refresh tokens expire after 6 months of non-use** - Our system prevents this by regularly refreshing
- **⚠️ CRITICAL:** Refresh tokens from OAuth Playground expire in **24 hours** if you use default Playground credentials
- **Solution:** Always use your own OAuth credentials in Playground settings for long-lived tokens
- **Token refresh is automatic** - No manual intervention needed unless refresh token itself expires
- **Production logging** - All token refresh events are logged for monitoring
