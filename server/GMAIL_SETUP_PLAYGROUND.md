# Gmail Setup Using Google OAuth 2.0 Playground

This is the **easiest method** - no redirect URI configuration needed!

## ⚠️ CRITICAL: Use Your Own OAuth Credentials

**IMPORTANT:** The OAuth Playground will **automatically revoke refresh tokens after 24 hours** if you use the default Playground credentials.

**You MUST use your own OAuth credentials** to get a long-lived refresh token that won't expire after 24 hours.

## Step 1: Get OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable "Gmail API" in APIs & Services > Library
4. Go to APIs & Services > Credentials
5. Click "Create Credentials" > "OAuth client ID"
6. Choose "Desktop app" as application type
7. Click "Create"
8. **Copy your Client ID and Client Secret** (you'll need these)

## Step 2: Use Google OAuth 2.0 Playground

1. Go to [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)

2. **⚠️ CRITICAL STEP:** Click the **⚙️ Settings** icon (top right)

3. **⚠️ MUST DO THIS:** Check "Use your own OAuth credentials"

   - **If you skip this step, your refresh token will expire in 24 hours!**

4. Enter your credentials:

   - **OAuth Client ID**: Paste your Client ID
   - **OAuth Client secret**: Paste your Client Secret
   - Click "Close"

5. In the left panel, find and select:

   - **Gmail API v1**
   - Check `https://www.googleapis.com/auth/gmail.send`

6. Click **"Authorize APIs"**

   - Sign in with your Gmail account
   - Grant permissions

7. Click **"Exchange authorization code for tokens"**
   - You'll see a **Refresh token** - **COPY THIS!**

## Step 3: Create Token File

Create a file `gmail_token.json` in your `server/` directory with this content:

```json
{
	"token": "ya29.xxxxx",
	"refresh_token": "YOUR_REFRESH_TOKEN_FROM_PLAYGROUND",
	"token_uri": "https://oauth2.googleapis.com/token",
	"client_id": "YOUR_CLIENT_ID",
	"client_secret": "YOUR_CLIENT_SECRET",
	"scopes": ["https://www.googleapis.com/auth/gmail.send"],
	"expiry": "2024-01-01T00:00:00Z"
}
```

**Replace:**

- `YOUR_REFRESH_TOKEN_FROM_PLAYGROUND` - The refresh token from Step 2
- `YOUR_CLIENT_ID` - Your OAuth Client ID
- `YOUR_CLIENT_SECRET` - Your OAuth Client Secret
- `ya29.xxxxx` - The access token from the Playground (optional, will be refreshed automatically)
- `expiry` - Can leave as is, will be refreshed automatically

## Step 4: Test

1. Restart your server
2. Check logs - you should see: `Gmail API service initialized successfully`
3. Register a new user - verification email should be sent!

## That's it! 🎉

No redirect URIs needed, no browser window popups, much simpler!

## ⚠️ Important Notes

- **Always use your own OAuth credentials** in the Playground settings
- Refresh tokens generated with default Playground credentials expire in 24 hours
- Refresh tokens generated with your own credentials last indefinitely (unless revoked or unused for 6 months)
- The system automatically refreshes access tokens, keeping your refresh token active

---

## Alternative: Environment Variables (For Production)

Instead of the file, you can set environment variables:

```env
GMAIL_TOKEN_JSON='{"refresh_token":"YOUR_REFRESH_TOKEN","client_id":"YOUR_CLIENT_ID","client_secret":"YOUR_CLIENT_SECRET","token_uri":"https://oauth2.googleapis.com/token","scopes":["https://www.googleapis.com/auth/gmail.send"]}'
GMAIL_SENDER_EMAIL=your-email@gmail.com
```

Just paste the JSON content from your `gmail_token.json` file.
