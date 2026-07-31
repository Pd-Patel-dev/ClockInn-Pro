"""
Developer endpoints for email template management.
All routes require DEVELOPER role.
"""
import logging
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_developer
from app.core.error_handling import handle_endpoint_errors
from app.models.user import User
from app.schemas.email_template import (
    DraftPayload,
    PreviewRequest,
    PreviewResponse,
    PublishPayload,
    SendTestRequest,
    SendTestResponse,
    TemplateDetailOut,
    TemplateListItemOut,
    TemplateMetadataPatch,
    PaginatedVersionsOut,
    VersionContentOut,
)
from app.services import email_template_service as ets
from app.services.email_service import email_service

logger = logging.getLogger(__name__)

router = APIRouter()


def _http_from_exc(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal error")


@router.get("", response_model=List[TemplateListItemOut])
@handle_endpoint_errors(operation_name="list_email_templates")
async def list_email_templates(
    category: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    items = await ets.list_templates(db, category=category, q=q)
    return items


@router.get("/{template_id}", response_model=TemplateDetailOut)
@handle_endpoint_errors(operation_name="get_email_template")
async def get_email_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    try:
        return await ets.get_template_detail(db, template_id)
    except LookupError as e:
        raise _http_from_exc(e) from e


@router.get("/{template_id}/versions", response_model=PaginatedVersionsOut)
@handle_endpoint_errors(operation_name="list_email_template_versions")
async def list_email_template_versions(
    template_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    try:
        return await ets.list_versions(db, template_id, page=page, page_size=page_size)
    except LookupError as e:
        raise _http_from_exc(e) from e


@router.get("/{template_id}/versions/{version_id}", response_model=VersionContentOut)
@handle_endpoint_errors(operation_name="get_email_template_version")
async def get_email_template_version(
    template_id: uuid.UUID,
    version_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    try:
        return await ets.get_version(db, template_id, version_id)
    except LookupError as e:
        raise _http_from_exc(e) from e


@router.put("/{template_id}/draft", response_model=VersionContentOut)
@handle_endpoint_errors(operation_name="save_email_template_draft")
async def save_email_template_draft(
    template_id: uuid.UUID,
    body: DraftPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    try:
        return await ets.save_draft(
            db,
            template_id,
            body.model_dump(),
            current_user.id,
        )
    except (LookupError, ValueError) as e:
        raise _http_from_exc(e) from e


@router.post("/{template_id}/publish", response_model=VersionContentOut)
@handle_endpoint_errors(operation_name="publish_email_template")
async def publish_email_template(
    template_id: uuid.UUID,
    body: Optional[PublishPayload] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    notes = body.notes if body else None
    try:
        return await ets.publish_draft(db, template_id, current_user.id, notes=notes)
    except (LookupError, ValueError) as e:
        raise _http_from_exc(e) from e


@router.post("/{template_id}/revert/{version_id}", response_model=VersionContentOut)
@handle_endpoint_errors(operation_name="revert_email_template")
async def revert_email_template(
    template_id: uuid.UUID,
    version_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    try:
        return await ets.revert_to_version(db, template_id, version_id, current_user.id)
    except (LookupError, ValueError) as e:
        raise _http_from_exc(e) from e


@router.delete("/{template_id}/draft", status_code=status.HTTP_204_NO_CONTENT)
@handle_endpoint_errors(operation_name="discard_email_template_draft")
async def discard_email_template_draft(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    try:
        await ets.discard_draft(db, template_id)
    except LookupError as e:
        raise _http_from_exc(e) from e
    return None


@router.post("/{template_id}/preview", response_model=PreviewResponse)
@handle_endpoint_errors(operation_name="preview_email_template")
async def preview_email_template(
    template_id: uuid.UUID,
    body: PreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    try:
        return await ets.preview_template(
            db,
            template_id,
            version=body.version,
            variables=body.variables,
            fmt=body.format,
        )
    except (LookupError, ValueError) as e:
        raise _http_from_exc(e) from e


@router.post("/{template_id}/send-test", response_model=SendTestResponse)
@handle_endpoint_errors(operation_name="send_test_email_template")
async def send_test_email_template(
    template_id: uuid.UUID,
    body: SendTestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    try:
        ets.check_test_send_rate_limit(current_user.id)
        preview = await ets.preview_template(
            db,
            template_id,
            version=body.version,
            variables=body.variables or {},
            fmt="both",
        )
    except (LookupError, ValueError, PermissionError) as e:
        raise _http_from_exc(e) from e

    subject = f"[TEST] {preview['subject']}"
    footer = (
        f'<p style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;'
        f'color:#64748b;font-size:12px">This is a test email sent from the ClockInn-Pro '
        f"template editor by {current_user.email}.</p>"
    )
    body_html = (preview.get("body_html") or "") + footer
    body_text = (preview.get("body_text") or "") + (
        f"\n\n---\nThis is a test email sent from the ClockInn-Pro template editor by {current_user.email}."
    )

    ok = await email_service.send_raw_email(
        to_email=str(body.to_email),
        subject=subject,
        body_html=body_html,
        body_text=body_text,
    )
    status_str = "sent" if ok else "failed"
    logger.info(
        "email_delivery template_id=%s to=%s status=%s kind=test by=%s subject=%s",
        template_id,
        body.to_email,
        status_str,
        current_user.email,
        subject,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to send test email. Check Gmail configuration.",
        )
    return SendTestResponse(
        status=status_str,
        subject=subject,
        message=f"Test email sent to {body.to_email}",
    )


@router.post("/{template_id}/reset-to-factory", response_model=VersionContentOut)
@handle_endpoint_errors(operation_name="reset_email_template_factory")
async def reset_email_template_factory(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    try:
        return await ets.reset_to_factory(db, template_id, current_user.id)
    except (LookupError, ValueError) as e:
        raise _http_from_exc(e) from e


@router.patch("/{template_id}", response_model=TemplateDetailOut)
@handle_endpoint_errors(operation_name="patch_email_template")
async def patch_email_template(
    template_id: uuid.UUID,
    body: TemplateMetadataPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    try:
        return await ets.patch_metadata(
            db,
            template_id,
            current_user.id,
            body.model_dump(exclude_unset=True),
        )
    except (LookupError, ValueError) as e:
        raise _http_from_exc(e) from e


@router.delete("/{template_id}")
@handle_endpoint_errors(operation_name="delete_email_template")
async def delete_email_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_developer),
):
    """System templates cannot be deleted."""
    try:
        t = await ets.get_template_or_404(db, template_id)
    except LookupError as e:
        raise _http_from_exc(e) from e
    if t.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a system template",
        )
    await db.delete(t)
    await db.commit()
    ets.invalidate_template_cache(t.key)
    return {"ok": True}
