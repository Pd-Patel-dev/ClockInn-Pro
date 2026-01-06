from fastapi import APIRouter
from app.api.v1.endpoints import auth, users, time, leave, reports, payroll, company, health, shifts, kiosk, gmail, admin

api_router = APIRouter()

api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(time.router, prefix="/time", tags=["time"])
api_router.include_router(leave.router, prefix="/leave", tags=["leave"])
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
api_router.include_router(gmail.router, prefix="/admin/gmail", tags=["gmail-admin"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(shifts.router, prefix="", tags=["shifts"])
api_router.include_router(payroll.router, prefix="", tags=["payroll"])
api_router.include_router(company.router, prefix="", tags=["company"])
api_router.include_router(kiosk.router, prefix="/kiosk", tags=["kiosk"])

