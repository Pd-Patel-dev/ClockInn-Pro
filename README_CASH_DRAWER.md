# Cash Drawer Feature - Setup Instructions

## Database Migration

The cash drawer feature requires database migrations to be run. The migration will run automatically on server startup, but if you need to run it manually:

### Option 1: Automatic (Recommended)
The migration will run automatically when the API server starts. Just restart the API container:

```bash
docker-compose restart api
```

### Option 2: Manual Migration
If you need to run the migration manually while containers are running:

```bash
docker-compose exec api python run_migrations.py
```

Or if using Docker directly:

```bash
docker exec -it clockinn_api python run_migrations.py
```

## Enabling Cash Drawer

1. Go to Company Settings (as Admin)
2. Enable "Cash Drawer" feature
3. Configure:
   - `cash_drawer_enabled`: true
   - `cash_drawer_required_for_all`: true (or set specific roles)
   - `cash_drawer_variance_threshold_cents`: 2000 (default $20.00)

## Usage

### For Employees:
- When clocking in/out, after entering PIN, a dialog will appear asking for cash count
- Enter the cash amount in dollars (e.g., 100.50)
- Click "Continue" to complete the punch

### For Admins:
- View cash drawer sessions at `/admin/cash`
- Filter by date range, employee, or status
- Edit cash counts (with reason required)
- Review sessions that exceed variance threshold
- Export reports to PDF or Excel

## API Endpoints

- `GET /admin/cash-drawers` - List cash drawer sessions
- `GET /admin/cash-drawers/{id}` - Get session details
- `PUT /admin/cash-drawers/{id}` - Edit session
- `POST /admin/cash-drawers/{id}/review` - Review and approve
- `POST /admin/cash-drawers/export` - Export to PDF/Excel
