# Environment Variables Reference

Complete list of all environment variables needed for ClockIn Pro.

---

## 🔧 Backend Environment Variables (Render)

### Required Variables

```env
# Database Connection
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# JWT Authentication
SECRET_KEY=<generate-with-openssl-rand-hex-32>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30

# CORS Configuration
FRONTEND_URL=https://your-frontend.vercel.app
CORS_ORIGINS=https://your-frontend.vercel.app

# Server
PORT=8000
```

### Optional Variables (Gmail API)

```env
# Gmail API Credentials (single-line JSON)
GMAIL_CREDENTIALS_JSON={"installed":{"client_id":"...","client_secret":"...",...}}
GMAIL_TOKEN_JSON={"token":"...","refresh_token":"...",...}
GMAIL_SENDER_EMAIL=no-reply.clockinpro@gmail.com
```

---

## 🎨 Frontend Environment Variables (Vercel)

### Required Variables

```env
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
```

---

## 📝 Detailed Descriptions

### `DATABASE_URL`
- **Type:** String (Connection URI)
- **Required:** Yes
- **Format:** PostgreSQL connection string
- **Production:** Use Supabase connection pooler URL
- **Example:** `postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres`

### `SECRET_KEY`
- **Type:** String (Hex)
- **Required:** Yes
- **Length:** 32+ characters
- **Generate:** `openssl rand -hex 32`
- **Purpose:** JWT token signing
- **Security:** Must be kept secret!

### `ALGORITHM`
- **Type:** String
- **Required:** Yes
- **Default:** `HS256`
- **Purpose:** JWT algorithm

### `ACCESS_TOKEN_EXPIRE_MINUTES`
- **Type:** Integer
- **Required:** No
- **Default:** `15`
- **Purpose:** Access token expiration time

### `REFRESH_TOKEN_EXPIRE_DAYS`
- **Type:** Integer
- **Required:** No
- **Default:** `30`
- **Purpose:** Refresh token expiration time

### `FRONTEND_URL`
- **Type:** String (URL)
- **Required:** Yes
- **Format:** Full URL with protocol
- **Example:** `https://your-app.vercel.app`
- **Purpose:** Used for redirects and links

### `CORS_ORIGINS`
- **Type:** String or JSON Array
- **Required:** Yes
- **Format:** Single URL or comma-separated list
- **Example:** `https://your-app.vercel.app` or `["https://app1.com","https://app2.com"]`
- **Purpose:** Allowed CORS origins

### `PORT`
- **Type:** Integer
- **Required:** No
- **Default:** `8000`
- **Purpose:** Server port

### `GMAIL_CREDENTIALS_JSON`
- **Type:** String (JSON)
- **Required:** No
- **Format:** Single-line JSON string
- **Purpose:** Gmail API OAuth credentials
- **How to create:**
  1. Create JSON file locally
  2. Convert to single line: `jq -c . gmail_credentials.json`
  3. Paste into environment variable

### `GMAIL_TOKEN_JSON`
- **Type:** String (JSON)
- **Required:** No (but required if using Gmail API)
- **Format:** Single-line JSON string
- **Purpose:** Gmail API OAuth token
- **Contains:** `refresh_token`, `access_token`, etc.

### `GMAIL_SENDER_EMAIL`
- **Type:** String (Email)
- **Required:** No
- **Default:** `no-reply.clockinpro@gmail.com`
- **Purpose:** Email address for sending verification emails

### `NEXT_PUBLIC_API_URL`
- **Type:** String (URL)
- **Required:** Yes (Frontend)
- **Format:** Full URL with protocol
- **Example:** `https://your-backend.onrender.com`
- **Purpose:** Frontend API endpoint

---

## 🔐 How to Generate Values

### Generate SECRET_KEY

**Linux/Mac:**
```bash
openssl rand -hex 32
```

**Windows (PowerShell):**
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

**Python:**
```python
import secrets
print(secrets.token_hex(32))
```

### Convert JSON to Single Line

**Linux/Mac:**
```bash
cat gmail_credentials.json | jq -c
```

**Windows (PowerShell):**
```powershell
Get-Content gmail_credentials.json | ConvertFrom-Json | ConvertTo-Json -Compress
```

**Online:**
- Use any JSON minifier tool
- Remove all newlines and spaces

---

## 🧪 Testing Locally

Create `.env` file in `server/` directory:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/clockinn
SECRET_KEY=your-local-secret-key
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
PORT=8000
```

Create `.env.local` file in `client/` directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## ⚠️ Security Notes

1. **Never commit `.env` files to Git**
2. **Never expose SECRET_KEY in logs or frontend**
3. **Use strong, random SECRET_KEY in production**
4. **Keep DATABASE_URL secret**
5. **Gmail credentials should only be in environment variables**
6. **Use HTTPS in production**
7. **Review CORS_ORIGINS regularly**

---

## 📋 Quick Checklist

- [ ] `DATABASE_URL` configured (pooler URL for production)
- [ ] `SECRET_KEY` generated and set
- [ ] `FRONTEND_URL` matches actual frontend URL
- [ ] `CORS_ORIGINS` matches frontend URL
- [ ] `NEXT_PUBLIC_API_URL` matches backend URL
- [ ] Gmail API variables set (if using email)
- [ ] All variables set in Render
- [ ] All variables set in Vercel
- [ ] No sensitive data in code

---

## 🔄 Updating Variables

### Render (Backend)
1. Go to Dashboard → Your Service → Environment
2. Click "Add Environment Variable"
3. Or edit existing variable
4. Save (triggers redeploy)

### Vercel (Frontend)
1. Go to Dashboard → Your Project → Settings → Environment Variables
2. Add or edit variable
3. Select environment (Production/Preview/Development)
4. Save
5. Redeploy if needed

---

## 🆘 Troubleshooting

### Variable Not Working?
- Check spelling (case-sensitive)
- Check value format (no extra spaces)
- Verify variable is set for correct environment
- Restart service after adding variable

### JSON Variables?
- Must be single-line
- No newlines or formatting
- Use `jq -c` or minifier tool
- Escape quotes if needed

### CORS Errors?
- Check `CORS_ORIGINS` includes frontend URL
- Check `FRONTEND_URL` is correct
- Verify protocol (http vs https)
- No trailing slashes in URLs

