#!/usr/bin/env python3
"""
Helper script to create gmail_token.json from Google OAuth 2.0 Playground.

After getting your refresh token from the Playground, use this script to create the token file.
"""
import json
import sys
from pathlib import Path
from datetime import datetime, timedelta

def main():
    server_dir = Path(__file__).parent
    token_file = server_dir / 'gmail_token.json'
    
    print("=" * 60)
    print("Gmail Token File Creator (From OAuth 2.0 Playground)")
    print("=" * 60)
    print()
    print("Follow these steps:")
    print("1. Go to https://developers.google.com/oauthplayground/")
    print("2. ⚠️ CRITICAL: Click Settings icon and check 'Use your own OAuth credentials'")
    print("   (If you skip this, refresh token will expire in 24 hours!)")
    print("3. Enter your Client ID and Client Secret from Google Cloud Console")
    print("4. Select Gmail API > gmail.send scope")
    print("5. Authorize and exchange for tokens")
    print("6. Copy the Refresh Token")
    print()
    
    # Get inputs
    client_id = input("Enter your OAuth Client ID: ").strip()
    if not client_id:
        print("❌ Client ID is required!")
        sys.exit(1)
    
    client_secret = input("Enter your OAuth Client Secret: ").strip()
    if not client_secret:
        print("❌ Client Secret is required!")
        sys.exit(1)
    
    refresh_token = input("Enter your Refresh Token: ").strip()
    if not refresh_token:
        print("❌ Refresh Token is required!")
        sys.exit(1)
    
    # Create token structure
    token_data = {
        "token": None,  # Will be generated on first use
        "refresh_token": refresh_token,
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": client_id,
        "client_secret": client_secret,
        "scopes": ["https://www.googleapis.com/auth/gmail.send"],
        "expiry": (datetime.utcnow() + timedelta(hours=1)).isoformat() + "Z"
    }
    
    # Save to file
    try:
        with open(token_file, 'w') as f:
            json.dump(token_data, f, indent=2)
        
        print()
        print("=" * 60)
        print("✓ SUCCESS!")
        print("=" * 60)
        print()
        print(f"Token file created: {token_file}")
        print()
        print("The email service will automatically refresh the token when needed.")
        print("You can now run your server and emails will work!")
        
    except Exception as e:
        print()
        print("=" * 60)
        print("❌ ERROR")
        print("=" * 60)
        print(f"Failed to create token file: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()

