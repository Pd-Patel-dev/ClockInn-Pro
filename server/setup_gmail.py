#!/usr/bin/env python3
"""
Helper script to set up Gmail API credentials.
This will guide you through the OAuth flow to generate the token file.
"""
import json
import sys
from pathlib import Path
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials

SCOPES = ['https://www.googleapis.com/auth/gmail.send']

def main():
    server_dir = Path(__file__).parent
    creds_file = server_dir / 'gmail_credentials.json'
    token_file = server_dir / 'gmail_token.json'
    
    print("=" * 60)
    print("Gmail API Setup Script")
    print("=" * 60)
    print()
    
    # Check if credentials file exists
    if not creds_file.exists():
        print("❌ ERROR: gmail_credentials.json not found!")
        print()
        print("Please follow these steps:")
        print("1. Go to https://console.cloud.google.com/")
        print("2. Create a project (or select existing)")
        print("3. Enable 'Gmail API' in APIs & Services > Library")
        print("4. Go to APIs & Services > Credentials")
        print("5. Click 'Create Credentials' > 'OAuth client ID'")
        print("6. Choose 'Desktop app' as application type")
        print("7. Download the JSON file")
        print("8. Save it as 'gmail_credentials.json' in the server/ directory")
        print()
        print(f"Expected location: {creds_file}")
        sys.exit(1)
    
    print(f"✓ Found credentials file: {creds_file}")
    
    creds = None
    
    # Try loading existing token
    if token_file.exists():
        print(f"✓ Found existing token file: {token_file}")
        try:
            creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
            if creds.valid:
                print("✓ Token is valid!")
                print()
                print("You're all set! The email service should work now.")
                return
            elif creds.expired and creds.refresh_token:
                print("⚠ Token expired, attempting to refresh...")
                try:
                    creds.refresh(Request())
                    print("✓ Token refreshed successfully!")
                    # Save refreshed token
                    with open(token_file, 'w') as token:
                        token.write(creds.to_json())
                    print("✓ Saved refreshed token")
                    print()
                    print("You're all set! The email service should work now.")
                    return
                except Exception as e:
                    print(f"❌ Failed to refresh token: {e}")
                    print("Will generate a new token...")
            else:
                print("⚠ Token is invalid, will generate a new one...")
        except Exception as e:
            print(f"⚠ Error loading token: {e}")
            print("Will generate a new token...")
    
    # If we get here, we need to do OAuth flow
    print()
    print("Starting OAuth flow...")
    print("A browser window will open for you to sign in with your Gmail account.")
    print()
    print("⚠️  IMPORTANT: If you get a 'redirect_uri_mismatch' error:")
    print("   1. Go to Google Cloud Console > APIs & Services > Credentials")
    print("   2. Click on your OAuth 2.0 Client ID")
    print("   3. Under 'Authorized redirect URIs', add:")
    print("      - http://localhost:8080/")
    print("      - http://127.0.0.1:8080/")
    print("   4. Click 'Save' and try again")
    print()
    
    try:
        flow = InstalledAppFlow.from_client_secrets_file(
            str(creds_file), SCOPES
        )
        # Use port 8080 (common for OAuth) - make sure this is in your Google Cloud Console redirect URIs
        creds = flow.run_local_server(port=8000, prompt='consent')
        
        # Save the token
        with open(token_file, 'w') as token:
            token.write(creds.to_json())
        
        print()
        print("=" * 60)
        print("✓ SUCCESS!")
        print("=" * 60)
        print()
        print(f"Token saved to: {token_file}")
        print("The email service is now configured and ready to use!")
        print()
        print("You can now run your server and emails will be sent automatically.")
        
    except Exception as e:
        print()
        print("=" * 60)
        print("❌ ERROR during OAuth flow")
        print("=" * 60)
        print(f"Error: {e}")
        print()
        print("Common issues:")
        print("- Make sure you have internet connection")
        print("- Make sure the credentials file is valid")
        print("- Make sure you're using a Gmail account")
        print("- Try deleting gmail_token.json and running this script again")
        sys.exit(1)

if __name__ == '__main__':
    main()

