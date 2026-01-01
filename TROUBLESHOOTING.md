# Troubleshooting Guide

## 404 Errors

If you're seeing 404 errors, here's how to diagnose and fix them:

### 1. Check Browser Console
Open your browser's developer console (F12) and check:
- Which specific resource is returning 404
- The full URL that's failing
- Whether it's an API endpoint or a static asset

### 2. Common 404 Causes

#### API Endpoints
- **Symptom**: API calls returning 404
- **Check**: Verify the API is running: `docker-compose ps`
- **Verify**: Test endpoint directly: `curl http://localhost:8000/api/v1/health`
- **Solution**: Restart API: `docker-compose restart api`

#### Static Assets (favicon, images, etc.)
- **Symptom**: Browser requesting `/favicon.ico` or other assets
- **Solution**: These are harmless warnings and can be ignored, or add actual favicon to `client/public/favicon.ico`

#### Next.js Routes
- **Symptom**: Page routes returning 404
- **Check**: Verify route exists in `client/app/` directory
- **Solution**: Ensure all route files are properly named (e.g., `page.tsx`)

### 3. Debugging Steps

1. **Check API logs**:
   ```bash
   docker-compose logs api | Select-String "404"
   ```

2. **Check Frontend logs**:
   ```bash
   docker-compose logs web | Select-String "404"
   ```

3. **Test API directly**:
   ```bash
   # Health check
   curl http://localhost:8000/health
   
   # Test login endpoint
   curl -X POST http://localhost:8000/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@demo.com","password":"Admin123!"}'
   ```

4. **Check browser network tab**:
   - Open DevTools → Network tab
   - Look for failed requests (red)
   - Check the Request URL and Response

### 4. Common Fixes

#### API Not Responding
```bash
docker-compose restart api
docker-compose logs api
```

#### CORS Issues
- Check `CORS_ORIGINS` in `.env` matches your frontend URL
- Default: `http://localhost:3000`

#### Middleware Issues
- The middleware has been updated to be less restrictive
- If issues persist, temporarily disable middleware in `client/middleware.ts`

### 5. Verify All Services

```bash
# Check all containers are running
docker-compose ps

# Check API health
curl http://localhost:8000/health

# Check API docs
# Open: http://localhost:8000/docs
```

### 6. Reset Everything

If all else fails:
```bash
# Stop all services
docker-compose down

# Remove volumes (WARNING: deletes data)
docker-compose down -v

# Rebuild and start
docker-compose up -d --build

# Run migrations
docker-compose exec api alembic upgrade head

# Seed data
docker-compose exec api python -m scripts.seed_data
```

## Still Having Issues?

1. Check the specific 404 error in browser console
2. Verify which service is returning 404 (API or Frontend)
3. Check logs: `docker-compose logs api web`
4. Test API endpoints directly using curl or Postman

