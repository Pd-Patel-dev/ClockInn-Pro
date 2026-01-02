from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.core.database import get_db
from app.core.dependencies import get_current_admin
from app.core.error_handling import handle_endpoint_errors
from app.models.user import User
from app.schemas.report import ReportExportRequest
from app.services.export_service import generate_pdf_report, generate_excel_report

router = APIRouter()


@router.post("/export")
@handle_endpoint_errors(operation_name="export_report")
async def export_report(
    request: ReportExportRequest,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Export time entries report as PDF or Excel."""
    # If no employee_ids specified, get all employees in company
    if not request.employee_ids:
        from sqlalchemy import select
        from app.models.user import UserRole
        result = await db.execute(
            select(User).where(
                User.company_id == current_user.company_id,
                User.role == UserRole.EMPLOYEE,
            )
        )
        employees = result.scalars().all()
        employee_ids = [emp.id for emp in employees]
    else:
        employee_ids = request.employee_ids
    
    if not employee_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No employees found",
        )
    
    if request.format == "pdf":
        buffer = await generate_pdf_report(
            db,
            current_user.company_id,
            employee_ids,
            request.start_date,
            request.end_date,
        )
        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="report_{request.start_date}_{request.end_date}.pdf"'
            },
        )
    elif request.format == "xlsx":
        buffer = await generate_excel_report(
            db,
            current_user.company_id,
            employee_ids,
            request.start_date,
            request.end_date,
        )
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="report_{request.start_date}_{request.end_date}.xlsx"'
            },
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid format. Use 'pdf' or 'xlsx'",
        )

