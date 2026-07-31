"""Email template render, cache, and version management."""
from __future__ import annotations

import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from bs4 import BeautifulSoup
from jinja2 import Environment, BaseLoader, Undefined, meta
from jinja2.exceptions import TemplateError, TemplateSyntaxError
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.email_template import EmailTemplate, EmailTemplateVersion, EmailTemplateCategory
from app.services.email_template_factory import FACTORY_TEMPLATES, get_factory_by_key

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_CACHE_TTL = 60.0

_jinja_env = Environment(loader=BaseLoader(), autoescape=True, undefined=Undefined)


def invalidate_template_cache(key: Optional[str] = None) -> None:
    if key is None:
        _CACHE.clear()
    else:
        _CACHE.pop(key, None)


def sample_variables(schema: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for name, meta_info in (schema or {}).items():
        if isinstance(meta_info, dict) and "example" in meta_info:
            out[name] = meta_info["example"]
        else:
            out[name] = f"[{name}]"
    return out


def validate_jinja(source: str) -> Optional[str]:
    try:
        _jinja_env.parse(source)
        return None
    except TemplateSyntaxError as e:
        line = e.lineno or "?"
        return f"Jinja syntax error (line {line}): {e.message}"
    except TemplateError as e:
        return str(e)


def html_warnings(html: str) -> List[str]:
    warnings: List[str] = []
    try:
        soup = BeautifulSoup(html, "html.parser")
        if soup.find() is None and html.strip():
            warnings.append("HTML could not be parsed cleanly")
    except Exception as e:
        warnings.append(f"HTML parse warning: {e}")
    return warnings


def referenced_variables(*sources: str) -> set[str]:
    names: set[str] = set()
    for source in sources:
        try:
            ast = _jinja_env.parse(source or "")
            names |= meta.find_undeclared_variables(ast)
        except Exception:
            # fallback regex
            names |= set(re.findall(r"\{\{\s*([a-zA-Z_][\w]*)", source or ""))
    return names


def render_strings(
    subject: str,
    body_html: str,
    body_text: str,
    variables: Dict[str, Any],
    variables_schema: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, str], List[str]]:
    warnings: List[str] = []
    for err_src, label in ((subject, "subject"), (body_html, "body_html"), (body_text, "body_text")):
        err = validate_jinja(err_src or "")
        if err:
            raise ValueError(f"{label}: {err}")

    schema = variables_schema or {}
    schema_keys = set(schema.keys()) if schema else set(variables.keys())
    refs = referenced_variables(subject, body_html, body_text)
    provided_keys = set(variables.keys())

    # Variables in template but not in schema
    undefined_refs = refs - schema_keys if schema else set()
    for m in sorted(undefined_refs):
        warnings.append(f"Undefined variable referenced: {m}")

    # Required schema vars missing from provided data (and no sample/example filled)
    for name, meta_info in schema.items():
        if isinstance(meta_info, dict) and meta_info.get("required"):
            if name not in provided_keys or variables.get(name) in (None, ""):
                warnings.append(f"Missing required variable: {name}")

    unused = provided_keys - refs
    for u in sorted(unused):
        warnings.append(f"Unused variable: {u}")
    warnings.extend(html_warnings(body_html or ""))

    ctx = variables
    rendered = {
        "subject": _jinja_env.from_string(subject or "").render(**ctx),
        "body_html": _jinja_env.from_string(body_html or "").render(**ctx),
        "body_text": _jinja_env.from_string(body_text or "").render(**ctx),
    }
    return rendered, warnings


# Rate limit: user_id -> list of timestamps (unix)
_TEST_SEND_LOG: Dict[str, List[float]] = {}
_TEST_SEND_LIMIT = 10
_TEST_SEND_WINDOW = 3600.0


def check_test_send_rate_limit(user_id: uuid.UUID) -> None:
    now = time.time()
    key = str(user_id)
    stamps = [t for t in _TEST_SEND_LOG.get(key, []) if now - t < _TEST_SEND_WINDOW]
    if len(stamps) >= _TEST_SEND_LIMIT:
        raise PermissionError("Rate limit exceeded: max 10 test sends per hour")
    stamps.append(now)
    _TEST_SEND_LOG[key] = stamps


def reset_test_send_rate_limits() -> None:
    _TEST_SEND_LOG.clear()


def _version_content_dict(v: EmailTemplateVersion, publisher_name: Optional[str] = None) -> Dict[str, Any]:
    return {
        "id": v.id,
        "template_id": v.template_id,
        "version_number": v.version_number,
        "subject": v.subject,
        "body_html": v.body_html,
        "body_text": v.body_text,
        "from_name": v.from_name,
        "from_email": v.from_email,
        "reply_to": v.reply_to,
        "is_published": v.is_published,
        "is_draft": v.is_draft,
        "published_at": v.published_at,
        "published_by": v.published_by,
        "published_by_name": publisher_name,
        "created_at": v.created_at,
        "notes": v.notes,
    }


async def get_template_or_404(db: AsyncSession, template_id: uuid.UUID) -> EmailTemplate:
    result = await db.execute(
        select(EmailTemplate)
        .options(selectinload(EmailTemplate.versions), selectinload(EmailTemplate.updated_by_user))
        .where(EmailTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise LookupError("Template not found")
    return template


async def list_templates(
    db: AsyncSession,
    category: Optional[str] = None,
    q: Optional[str] = None,
) -> List[Dict[str, Any]]:
    stmt = select(EmailTemplate).options(
        selectinload(EmailTemplate.versions),
        selectinload(EmailTemplate.updated_by_user),
    )
    if category:
        stmt = stmt.where(EmailTemplate.category == EmailTemplateCategory(category))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            (EmailTemplate.name.ilike(like)) | (EmailTemplate.description.ilike(like))
        )
    stmt = stmt.order_by(EmailTemplate.name.asc())
    result = await db.execute(stmt)
    templates = result.scalars().all()
    items: List[Dict[str, Any]] = []
    for t in templates:
        published = next((v for v in t.versions if v.is_published), None)
        draft = next((v for v in t.versions if v.is_draft), None)
        updater = t.updated_by_user
        items.append(
            {
                "id": t.id,
                "key": t.key,
                "name": t.name,
                "description": t.description,
                "category": t.category,
                "is_enabled": t.is_enabled,
                "is_system": t.is_system,
                "has_draft": draft is not None,
                "subject": published.subject if published else None,
                "last_updated_at": t.updated_at,
                "updated_at": t.updated_at,
                "updated_by_name": updater.name if updater else None,
            }
        )
    return items


async def get_template_detail(db: AsyncSession, template_id: uuid.UUID) -> Dict[str, Any]:
    t = await get_template_or_404(db, template_id)
    versions_result = await db.execute(
        select(EmailTemplateVersion).where(EmailTemplateVersion.template_id == template_id)
    )
    versions = list(versions_result.scalars().all())
    published = next((v for v in versions if v.is_published), None)
    draft = next((v for v in versions if v.is_draft), None)
    updater = t.updated_by_user
    return {
        "id": t.id,
        "key": t.key,
        "name": t.name,
        "description": t.description,
        "category": t.category,
        "is_enabled": t.is_enabled,
        "is_system": t.is_system,
        "variables_schema": t.variables_schema or {},
        "published_version": _version_content_dict(published) if published else None,
        "draft_version": _version_content_dict(draft) if draft else None,
        "has_draft": draft is not None,
        "last_updated_at": t.updated_at,
        "updated_by_name": updater.name if updater else None,
    }


async def list_versions(
    db: AsyncSession,
    template_id: uuid.UUID,
    page: int = 1,
    page_size: int = 20,
) -> Dict[str, Any]:
    await get_template_or_404(db, template_id)
    page = max(1, page)
    page_size = min(100, max(1, page_size))
    count_q = await db.execute(
        select(func.count()).select_from(EmailTemplateVersion).where(
            EmailTemplateVersion.template_id == template_id
        )
    )
    total = int(count_q.scalar() or 0)
    result = await db.execute(
        select(EmailTemplateVersion)
        .options(selectinload(EmailTemplateVersion.published_by_user))
        .where(EmailTemplateVersion.template_id == template_id)
        .order_by(EmailTemplateVersion.version_number.desc(), EmailTemplateVersion.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    versions = result.scalars().all()
    items = []
    for v in versions:
        pub = v.published_by_user
        items.append(
            {
                "id": v.id,
                "version_number": v.version_number,
                "is_published": v.is_published,
                "is_draft": v.is_draft,
                "published_at": v.published_at,
                "published_by": v.published_by,
                "published_by_name": pub.name if pub else None,
                "created_at": v.created_at,
                "notes": v.notes,
                "subject": v.subject,
            }
        )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


async def get_version(
    db: AsyncSession, template_id: uuid.UUID, version_id: uuid.UUID
) -> Dict[str, Any]:
    await get_template_or_404(db, template_id)
    result = await db.execute(
        select(EmailTemplateVersion)
        .options(selectinload(EmailTemplateVersion.published_by_user))
        .where(
            EmailTemplateVersion.id == version_id,
            EmailTemplateVersion.template_id == template_id,
        )
    )
    v = result.scalar_one_or_none()
    if not v:
        raise LookupError("Version not found")
    pub = v.published_by_user
    return _version_content_dict(v, pub.name if pub else None)


async def save_draft(
    db: AsyncSession,
    template_id: uuid.UUID,
    payload: Dict[str, Any],
    user_id: uuid.UUID,
) -> Dict[str, Any]:
    t = await get_template_or_404(db, template_id)
    schema = t.variables_schema or {}
    samples = sample_variables(schema)
    # Validate Jinja by rendering with samples
    try:
        _, warnings = render_strings(
            payload["subject"],
            payload["body_html"],
            payload["body_text"],
            samples,
            variables_schema=schema,
        )
    except ValueError as e:
        raise ValueError(str(e)) from e

    draft = next((v for v in t.versions if v.is_draft), None)
    if draft is None:
        draft = EmailTemplateVersion(
            id=uuid.uuid4(),
            template_id=t.id,
            version_number=0,
            subject=payload["subject"],
            body_html=payload["body_html"],
            body_text=payload["body_text"],
            from_name=payload.get("from_name"),
            from_email=payload.get("from_email"),
            reply_to=payload.get("reply_to"),
            is_published=False,
            is_draft=True,
            notes=payload.get("notes"),
        )
        db.add(draft)
    else:
        draft.subject = payload["subject"]
        draft.body_html = payload["body_html"]
        draft.body_text = payload["body_text"]
        draft.from_name = payload.get("from_name")
        draft.from_email = payload.get("from_email")
        draft.reply_to = payload.get("reply_to")
        if payload.get("notes") is not None:
            draft.notes = payload.get("notes")

    t.updated_at = datetime.now(timezone.utc)
    t.updated_by = user_id
    await db.commit()
    await db.refresh(draft)
    # Clear cached relationship so subsequent loads see the new draft
    db.expire(t, ["versions"])
    _ = warnings
    return _version_content_dict(draft)


async def publish_draft(
    db: AsyncSession,
    template_id: uuid.UUID,
    user_id: uuid.UUID,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    t = await get_template_or_404(db, template_id)
    draft_result = await db.execute(
        select(EmailTemplateVersion).where(
            EmailTemplateVersion.template_id == template_id,
            EmailTemplateVersion.is_draft.is_(True),
        )
    )
    draft = draft_result.scalar_one_or_none()
    if not draft:
        raise ValueError("No draft to publish.")

    published_result = await db.execute(
        select(EmailTemplateVersion).where(
            EmailTemplateVersion.template_id == template_id,
            EmailTemplateVersion.is_published.is_(True),
        )
    )
    current_published = published_result.scalar_one_or_none()
    max_num_result = await db.execute(
        select(func.max(EmailTemplateVersion.version_number)).where(
            EmailTemplateVersion.template_id == template_id,
            EmailTemplateVersion.is_draft.is_(False),
        )
    )
    max_num = int(max_num_result.scalar() or 0)

    if current_published:
        current_published.is_published = False
        await db.flush()

    now = datetime.now(timezone.utc)
    draft.is_published = True
    draft.is_draft = False
    draft.published_at = now
    draft.published_by = user_id
    draft.version_number = max_num + 1
    if notes is not None:
        draft.notes = notes

    key = t.key
    t.updated_at = now
    t.updated_by = user_id
    await db.commit()
    await db.refresh(draft)
    invalidate_template_cache(key)
    db.expire(t, ["versions"])
    return _version_content_dict(draft)


async def discard_draft(db: AsyncSession, template_id: uuid.UUID) -> None:
    t = await get_template_or_404(db, template_id)
    draft_result = await db.execute(
        select(EmailTemplateVersion).where(
            EmailTemplateVersion.template_id == template_id,
            EmailTemplateVersion.is_draft.is_(True),
        )
    )
    draft = draft_result.scalar_one_or_none()
    if not draft:
        return
    await db.delete(draft)
    await db.commit()
    db.expire(t, ["versions"])


async def revert_to_version(
    db: AsyncSession,
    template_id: uuid.UUID,
    version_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Dict[str, Any]:
    t = await get_template_or_404(db, template_id)
    source = next((v for v in t.versions if v.id == version_id), None)
    if not source:
        raise LookupError("Version not found")

    existing_draft = next((v for v in t.versions if v.is_draft), None)
    if existing_draft:
        await db.delete(existing_draft)
        await db.flush()

    draft = EmailTemplateVersion(
        id=uuid.uuid4(),
        template_id=t.id,
        version_number=0,
        subject=source.subject,
        body_html=source.body_html,
        body_text=source.body_text,
        from_name=source.from_name,
        from_email=source.from_email,
        reply_to=source.reply_to,
        is_published=False,
        is_draft=True,
        notes=f"Restored from v{source.version_number}",
    )
    db.add(draft)
    t.updated_at = datetime.now(timezone.utc)
    t.updated_by = user_id
    await db.commit()
    await db.refresh(draft)
    db.expire(t, ["versions"])
    return _version_content_dict(draft)


async def reset_to_factory(
    db: AsyncSession,
    template_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Dict[str, Any]:
    t = await get_template_or_404(db, template_id)
    if not t.is_system:
        raise ValueError("Only system templates can be reset to factory defaults")
    factory = get_factory_by_key(t.key)
    if not factory:
        raise ValueError("Factory default not found for this template")

    existing_draft = next((v for v in t.versions if v.is_draft), None)
    if existing_draft:
        await db.delete(existing_draft)
        await db.flush()

    draft = EmailTemplateVersion(
        id=uuid.uuid4(),
        template_id=t.id,
        version_number=0,
        subject=factory["subject"],
        body_html=factory["body_html"],
        body_text=factory["body_text"],
        from_name=None,
        from_email=None,
        reply_to=None,
        is_published=False,
        is_draft=True,
        notes="Reset to factory default",
    )
    db.add(draft)
    t.variables_schema = factory.get("variables_schema") or {}
    t.updated_at = datetime.now(timezone.utc)
    t.updated_by = user_id
    await db.commit()
    await db.refresh(draft)
    db.expire(t, ["versions"])
    return _version_content_dict(draft)


async def patch_metadata(
    db: AsyncSession,
    template_id: uuid.UUID,
    user_id: uuid.UUID,
    patch: Dict[str, Any],
) -> Dict[str, Any]:
    t = await get_template_or_404(db, template_id)
    if "name" in patch and patch["name"] is not None:
        t.name = patch["name"]
    if "description" in patch:
        t.description = patch["description"]
    if "category" in patch and patch["category"] is not None:
        t.category = patch["category"] if isinstance(patch["category"], EmailTemplateCategory) else EmailTemplateCategory(patch["category"])
    if "is_enabled" in patch and patch["is_enabled"] is not None:
        t.is_enabled = patch["is_enabled"]
        invalidate_template_cache(t.key)
    t.updated_at = datetime.now(timezone.utc)
    t.updated_by = user_id
    await db.commit()
    db.expire(t, ["versions", "updated_by_user"])
    return await get_template_detail(db, template_id)


async def resolve_version_content(
    t: EmailTemplate,
    version: str,
) -> EmailTemplateVersion:
    if version == "draft":
        draft = next((v for v in t.versions if v.is_draft), None)
        if not draft:
            raise ValueError("No draft version available")
        return draft
    if version == "published":
        published = next((v for v in t.versions if v.is_published), None)
        if not published:
            raise ValueError("No published version available")
        return published
    try:
        vid = uuid.UUID(version)
    except ValueError as e:
        raise ValueError("Invalid version selector") from e
    found = next((v for v in t.versions if v.id == vid), None)
    if not found:
        raise LookupError("Version not found")
    return found


async def preview_template(
    db: AsyncSession,
    template_id: uuid.UUID,
    version: str,
    variables: Optional[Dict[str, Any]],
    fmt: str = "both",
) -> Dict[str, Any]:
    t = await get_template_or_404(db, template_id)
    content = await resolve_version_content(t, version)
    schema = t.variables_schema or {}
    samples = sample_variables(schema)
    provided = dict(variables or {})
    # Render with samples filling gaps so preview still works
    merged = {**samples, **provided}
    # Build warnings against *provided* keys for required/unused; use merged for render
    rendered, warnings = render_strings(
        content.subject,
        content.body_html,
        content.body_text,
        merged,
        variables_schema=None,  # compute custom warnings below
    )
    warnings = []
    refs = referenced_variables(content.subject, content.body_html, content.body_text)
    schema_keys = set(schema.keys())
    for m in sorted(refs - schema_keys):
        warnings.append(f"Undefined variable referenced: {m}")
    for name, meta_info in schema.items():
        if isinstance(meta_info, dict) and meta_info.get("required"):
            if name not in provided or provided.get(name) in (None, ""):
                warnings.append(f"Missing required variable: {name}")
    for u in sorted(set(provided.keys()) - refs):
        warnings.append(f"Unused variable: {u}")
    warnings.extend(html_warnings(content.body_html or ""))

    out: Dict[str, Any] = {"subject": rendered["subject"], "warnings": warnings}
    if fmt in ("html", "both"):
        out["body_html"] = rendered["body_html"]
    if fmt in ("text", "both"):
        out["body_text"] = rendered["body_text"]
    return out


async def get_published_content(db: AsyncSession, key: str) -> Optional[Dict[str, Any]]:
    now = time.time()
    cached = _CACHE.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    result = await db.execute(
        select(EmailTemplate)
        .options(selectinload(EmailTemplate.versions))
        .where(EmailTemplate.key == key)
    )
    template = result.scalar_one_or_none()
    if not template:
        factory = get_factory_by_key(key)
        if not factory:
            return None
        content = {
            "key": key,
            "is_enabled": True,
            "subject": factory["subject"],
            "body_html": factory["body_html"],
            "body_text": factory["body_text"],
            "from_name": None,
            "from_email": None,
            "reply_to": None,
            "variables_schema": factory.get("variables_schema") or {},
        }
        _CACHE[key] = (now, content)
        return content

    if not template.is_enabled:
        logger.warning("email template disabled key=%s — skip send", key)
        return {"key": key, "is_enabled": False}

    published = next((v for v in template.versions if v.is_published), None)
    if not published:
        factory = get_factory_by_key(key)
        if not factory:
            return None
        content = {
            "key": key,
            "is_enabled": True,
            "subject": factory["subject"],
            "body_html": factory["body_html"],
            "body_text": factory["body_text"],
            "from_name": None,
            "from_email": None,
            "reply_to": None,
            "variables_schema": template.variables_schema or {},
        }
    else:
        content = {
            "key": key,
            "is_enabled": True,
            "subject": published.subject,
            "body_html": published.body_html,
            "body_text": published.body_text,
            "from_name": published.from_name,
            "from_email": published.from_email,
            "reply_to": published.reply_to,
            "variables_schema": template.variables_schema or {},
        }
    _CACHE[key] = (now, content)
    return content


async def render_template(db: AsyncSession, key: str, variables: Dict[str, Any]) -> Dict[str, str]:
    """
    Return {subject, body_html, body_text} for a template key.
    Falls back to factory defaults when DB row is missing.
    """
    content = await get_published_content(db, key)
    if not content:
        raise KeyError(f"Unknown email template key: {key}")
    if not content.get("is_enabled", True):
        raise RuntimeError(f"Email template disabled: {key}")

    samples = sample_variables(content.get("variables_schema") or {})
    merged = {**samples, **(variables or {})}
    rendered, _warnings = render_strings(
        content["subject"],
        content["body_html"],
        content["body_text"],
        merged,
    )
    return rendered


async def seed_missing_templates(db: AsyncSession) -> int:
    """Insert any factory templates not already present. Returns count inserted."""
    existing = await db.execute(select(EmailTemplate.key))
    keys = {row[0] for row in existing.all()}
    added = 0
    now = datetime.now(timezone.utc)
    for ft in FACTORY_TEMPLATES:
        if ft["key"] in keys:
            continue
        tmpl = EmailTemplate(
            id=uuid.uuid4(),
            key=ft["key"],
            name=ft["name"],
            description=ft.get("description"),
            category=EmailTemplateCategory(ft["category"]),
            variables_schema=ft.get("variables_schema") or {},
            is_system=True,
            is_enabled=True,
        )
        db.add(tmpl)
        await db.flush()
        db.add(
            EmailTemplateVersion(
                id=uuid.uuid4(),
                template_id=tmpl.id,
                version_number=1,
                subject=ft["subject"],
                body_html=ft["body_html"],
                body_text=ft["body_text"],
                is_published=True,
                is_draft=False,
                published_at=now,
                notes="Factory default",
            )
        )
        added += 1
    if added:
        await db.commit()
        invalidate_template_cache()
    return added
