"""Marketplace sales during an open Front Desk shift (cash + card).

Flow: tap items into a cart → finalize payment (cash or card) → sales update.
"""
from __future__ import annotations

from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.cash_drawer import CashDrawerSession, CashDrawerStatus
from app.models.company import Company
from app.models.time_entry import TimeEntry, TimeEntryStatus
from app.models.user import User, UserRole
from app.services.company_service import get_company_settings

PaymentMethod = Literal["cash", "card"]
VALID_PAYMENTS = frozenset({"cash", "card"})


def _row_payment(row: dict) -> PaymentMethod:
    """Legacy rows without payment are treated as cash."""
    raw = str(row.get("payment") or "cash").lower().strip()
    return "card" if raw == "card" else "cash"


def _sale_key(item_id: str, payment: PaymentMethod) -> str:
    return f"{item_id}::{payment}"


def normalize_sales(sales: list | None) -> list[dict]:
    """
    Normalize marketplace JSON rows.

    Shape: {id, label, price_cents, qty, payment: "cash"|"card", amount_cents?}
    amount_cents overrides qty*price for money totals (split payments).
    """
    if not sales:
        return []
    merged: dict[str, dict] = {}
    for row in sales:
        if not isinstance(row, dict):
            continue
        item_id = str(row.get("id") or "")
        if not item_id:
            continue
        try:
            qty = max(0, int(row.get("qty") or 0))
            price = max(0, int(row.get("price_cents") or 0))
        except (TypeError, ValueError):
            continue
        payment = _row_payment(row)
        label = str(row.get("label") or "Item")[:100]
        amount_override = None
        if row.get("amount_cents") is not None:
            try:
                amount_override = max(0, int(row.get("amount_cents")))
            except (TypeError, ValueError):
                amount_override = None
        key = _sale_key(item_id, payment)
        if key in merged:
            existing = merged[key]
            prior_qty = int(existing.get("qty") or 0)
            existing["qty"] = prior_qty + qty
            if price and not int(existing.get("price_cents") or 0):
                existing["price_cents"] = price
            if amount_override is not None:
                if existing.get("amount_cents") is None:
                    existing["amount_cents"] = prior_qty * int(
                        existing.get("price_cents") or 0
                    ) + amount_override
                else:
                    existing["amount_cents"] = int(existing["amount_cents"]) + amount_override
        else:
            entry: dict = {
                "id": item_id,
                "label": label,
                "price_cents": price,
                "qty": qty,
                "payment": payment,
            }
            if amount_override is not None:
                entry["amount_cents"] = amount_override
            merged[key] = entry
    return list(merged.values())


def marketplace_line_cents(row: dict) -> int:
    if row.get("amount_cents") is not None:
        try:
            return max(0, int(row.get("amount_cents")))
        except (TypeError, ValueError):
            pass
    try:
        qty = int(row.get("qty") or 0)
        price = int(row.get("price_cents") or 0)
    except (TypeError, ValueError):
        return 0
    if qty > 0 and price >= 0:
        return qty * price
    return 0


def marketplace_total_cents(sales: list[dict] | None) -> int:
    if not sales:
        return 0
    return sum(marketplace_line_cents(row) for row in sales)


def normalize_cart(cart: list | None) -> list[dict]:
    """Cart lines before payment: {id, label, price_cents, qty}."""
    if not cart:
        return []
    merged: dict[str, dict] = {}
    for row in cart:
        if not isinstance(row, dict):
            continue
        item_id = str(row.get("id") or "")
        if not item_id:
            continue
        try:
            qty = max(0, int(row.get("qty") or 0))
            price = max(0, int(row.get("price_cents") or 0))
        except (TypeError, ValueError):
            continue
        if qty <= 0:
            continue
        label = str(row.get("label") or "Item")[:100]
        if item_id in merged:
            merged[item_id]["qty"] = int(merged[item_id]["qty"]) + qty
        else:
            merged[item_id] = {
                "id": item_id,
                "label": label,
                "price_cents": price,
                "qty": qty,
            }
    return list(merged.values())


def cart_total_cents(cart: list[dict] | None) -> int:
    return marketplace_total_cents(cart)


def marketplace_cash_cents(sales: list[dict] | None) -> int:
    return marketplace_total_cents(
        [r for r in (sales or []) if _row_payment(r) == "cash"]
    )


def marketplace_card_cents(sales: list[dict] | None) -> int:
    return marketplace_total_cents(
        [r for r in (sales or []) if _row_payment(r) == "card"]
    )


def aggregate_sales_for_ui(sales: list[dict], catalog: list[dict]) -> list[dict]:
    """One row per catalog item with cash_qty / card_qty for the employee dashboard."""
    by_item: dict[str, dict] = {}
    for row in sales:
        item_id = str(row.get("id") or "")
        if not item_id:
            continue
        payment = _row_payment(row)
        qty = int(row.get("qty") or 0)
        bucket = by_item.get(item_id)
        if not bucket:
            bucket = {
                "id": item_id,
                "label": str(row.get("label") or "Item")[:100],
                "price_cents": int(row.get("price_cents") or 0),
                "cash_qty": 0,
                "card_qty": 0,
                "qty": 0,
            }
            by_item[item_id] = bucket
        if payment == "card":
            bucket["card_qty"] += qty
        else:
            bucket["cash_qty"] += qty
        bucket["qty"] = bucket["cash_qty"] + bucket["card_qty"]
        if qty > 0 and int(row.get("price_cents") or 0):
            bucket["price_cents"] = int(row.get("price_cents") or 0)

    merged: list[dict] = []
    seen: set[str] = set()
    for item in catalog:
        item_id = str(item.get("id") or "")
        if not item_id:
            continue
        seen.add(item_id)
        catalog_label = str(item.get("label") or "Item")[:100]
        catalog_price = int(item.get("price_cents") or 0)
        existing = by_item.get(item_id)
        if existing:
            qty = int(existing.get("qty") or 0)
            merged.append(
                {
                    "id": item_id,
                    "label": catalog_label,
                    "price_cents": int(existing.get("price_cents") or 0)
                    if qty > 0
                    else catalog_price,
                    "cash_qty": int(existing.get("cash_qty") or 0),
                    "card_qty": int(existing.get("card_qty") or 0),
                    "qty": qty,
                }
            )
        else:
            merged.append(
                {
                    "id": item_id,
                    "label": catalog_label,
                    "price_cents": catalog_price,
                    "cash_qty": 0,
                    "card_qty": 0,
                    "qty": 0,
                }
            )
    for item_id, row in by_item.items():
        if item_id not in seen:
            merged.append(row)
    return merged


def sold_lines(sales: list[dict] | None) -> list[dict]:
    """Flatten sold lines (qty > 0) for admin/detail views, including payment."""
    out = []
    for row in normalize_sales(sales):
        if int(row.get("qty") or 0) <= 0:
            continue
        out.append(row)
    return out


async def _get_open_frontdesk_session(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
) -> tuple[CashDrawerSession, TimeEntry]:
    result = await db.execute(
        select(TimeEntry)
        .where(
            and_(
                TimeEntry.company_id == company_id,
                TimeEntry.employee_id == employee_id,
                TimeEntry.status == TimeEntryStatus.OPEN,
                TimeEntry.clock_out_at.is_(None),
            )
        )
        .order_by(TimeEntry.clock_in_at.desc())
        .limit(1)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must be clocked in to record marketplace sales.",
        )

    result = await db.execute(
        select(CashDrawerSession).where(
            and_(
                CashDrawerSession.time_entry_id == entry.id,
                CashDrawerSession.company_id == company_id,
            )
        )
    )
    session = result.scalar_one_or_none()
    if not session or session.status != CashDrawerStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No open cash drawer session for this shift.",
        )
    return session, entry


async def _get_last_closed_shift_summary(
    db: AsyncSession,
    company_id: UUID,
    employee_id: UUID,
) -> dict[str, Any] | None:
    """Most recent closed cash drawer shift for the company (previous FD on the drawer)."""
    result = await db.execute(
        select(CashDrawerSession, TimeEntry, User.name)
        .outerjoin(TimeEntry, TimeEntry.id == CashDrawerSession.time_entry_id)
        .outerjoin(User, User.id == CashDrawerSession.employee_id)
        .where(
            and_(
                CashDrawerSession.company_id == company_id,
                CashDrawerSession.end_cash_cents.isnot(None),
                CashDrawerSession.status.in_(
                    [CashDrawerStatus.CLOSED, CashDrawerStatus.REVIEW_NEEDED]
                ),
            )
        )
        .order_by(
            CashDrawerSession.end_counted_at.desc().nullslast(),
            CashDrawerSession.created_at.desc(),
        )
        .limit(1)
    )
    row = result.one_or_none()
    if not row:
        return None
    session, entry, employee_name = row
    sales = normalize_sales(getattr(session, "marketplace_sales_json", None))
    total = (
        int(session.beverages_cash_cents)
        if session.beverages_cash_cents is not None
        else marketplace_total_cents(sales)
    )
    cash_cents = marketplace_cash_cents(sales)
    card_cents = marketplace_card_cents(sales)
    if total > cash_cents + card_cents:
        cash_cents = total - card_cents
    return {
        "employee_name": employee_name or "Front Desk",
        "is_own_shift": str(session.employee_id) == str(employee_id),
        "start_cash_cents": int(session.start_cash_cents or 0),
        "end_cash_cents": int(session.end_cash_cents or 0)
        if session.end_cash_cents is not None
        else None,
        "collected_cash_cents": int(session.collected_cash_cents)
        if session.collected_cash_cents is not None
        else None,
        "drop_amount_cents": int(session.drop_amount_cents)
        if session.drop_amount_cents is not None
        else None,
        "marketplace_sales_cents": total,
        "marketplace_cash_cents": cash_cents,
        "marketplace_card_cents": card_cents,
        "units_sold": sum(int(r.get("qty") or 0) for r in sales),
        "marketplace_sales": sold_lines(sales),
        "delta_cents": int(session.delta_cents) if session.delta_cents is not None else None,
        "clock_in_at": entry.clock_in_at.isoformat() if entry and entry.clock_in_at else None,
        "clock_out_at": entry.clock_out_at.isoformat()
        if entry and entry.clock_out_at
        else None,
        "ended_at": session.end_counted_at.isoformat() if session.end_counted_at else None,
    }


def _state_payload(
    *,
    catalog: list,
    sales_raw: list[dict],
    cart_raw: list[dict] | None = None,
    start_cash_cents: Optional[int],
    last_shift: Optional[dict],
    active_drawer: Optional[dict],
    clocked_in: bool,
    marketplace_enabled: bool = True,
) -> dict[str, Any]:
    ui_sales = aggregate_sales_for_ui(sales_raw, catalog)
    cash_cents = marketplace_cash_cents(sales_raw)
    card_cents = marketplace_card_cents(sales_raw)
    total = marketplace_total_cents(sales_raw)
    cart = normalize_cart(cart_raw)
    catalog_items = []
    for item in catalog:
        item_id = str(item.get("id") or "")
        if not item_id:
            continue
        catalog_items.append(
            {
                "id": item_id,
                "label": str(item.get("label") or "Item")[:100],
                "price_cents": int(item.get("price_cents") or 0),
            }
        )
    return {
        "marketplace_enabled": marketplace_enabled,
        "items": catalog_items or catalog,
        "sales": ui_sales,
        "cart": cart,
        "cart_total_cents": cart_total_cents(cart),
        "cart_units": sum(int(r.get("qty") or 0) for r in cart),
        "total_cents": total,
        "cash_cents": cash_cents,
        "card_cents": card_cents,
        "units_sold": sum(int(r.get("qty") or 0) for r in ui_sales),
        "start_cash_cents": start_cash_cents,
        "last_shift": last_shift,
        "active_drawer": active_drawer,
        "clocked_in": clocked_in,
    }


async def get_marketplace_state(
    db: AsyncSession,
    user: User,
) -> dict[str, Any]:
    if user.role != UserRole.FRONTDESK:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Marketplace sales are only available for Front Desk.",
        )

    company = (
        await db.execute(select(Company).where(Company.id == user.company_id))
    ).scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    settings = get_company_settings(company)
    marketplace_enabled = bool(settings.get("marketplace_enabled"))
    catalog = settings.get("marketplace_items") or [] if marketplace_enabled else []
    last_shift = await _get_last_closed_shift_summary(db, user.company_id, user.id)

    from app.services.cash_drawer_service import get_open_company_cash_drawer

    open_company_drawer = await get_open_company_cash_drawer(db, user.company_id)
    active_drawer = None
    if open_company_drawer:
        active_drawer = {
            "employee_id": str(open_company_drawer["employee_id"]),
            "employee_name": open_company_drawer["employee_name"],
            "is_mine": str(open_company_drawer["employee_id"]) == str(user.id),
        }

    try:
        session, _entry = await _get_open_frontdesk_session(db, user.company_id, user.id)
        sales = normalize_sales(getattr(session, "marketplace_sales_json", None))
        cart = normalize_cart(getattr(session, "marketplace_cart_json", None))
    except HTTPException as e:
        if e.status_code == 400:
            return _state_payload(
                catalog=catalog,
                sales_raw=[],
                cart_raw=[],
                start_cash_cents=None,
                last_shift=last_shift,
                active_drawer=active_drawer,
                clocked_in=False,
                marketplace_enabled=marketplace_enabled,
            )
        raise

    label_by_id = {
        str(i.get("id")): str(i.get("label") or "Item")[:100]
        for i in catalog
        if i.get("id")
    }
    changed = False
    for row in sales:
        new_label = label_by_id.get(row["id"])
        if new_label and row.get("label") != new_label:
            row["label"] = new_label
            changed = True
    for row in cart:
        new_label = label_by_id.get(row["id"])
        if new_label and row.get("label") != new_label:
            row["label"] = new_label
            changed = True
    if changed:
        session.marketplace_sales_json = normalize_sales(sales)
        session.marketplace_cart_json = normalize_cart(cart)
        flag_modified(session, "marketplace_sales_json")
        flag_modified(session, "marketplace_cart_json")
        await db.commit()

    return _state_payload(
        catalog=catalog,
        sales_raw=sales,
        cart_raw=cart,
        start_cash_cents=int(session.start_cash_cents or 0),
        last_shift=last_shift,
        active_drawer=active_drawer,
        clocked_in=True,
        marketplace_enabled=marketplace_enabled,
    )


async def update_marketplace_cart(
    db: AsyncSession,
    user: User,
    item_id: str,
    qty: Optional[int] = None,
    delta: Optional[int] = None,
) -> dict[str, Any]:
    """Add/remove items on the current unpaid cart (not sales until finalize)."""
    if user.role != UserRole.FRONTDESK:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Marketplace sales are only available for Front Desk.",
        )
    if qty is None and delta is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide qty or delta.",
        )

    company = (
        await db.execute(select(Company).where(Company.id == user.company_id))
    ).scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    settings = get_company_settings(company)
    if not settings.get("marketplace_enabled"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Marketplace is disabled. Enable it in Settings → Marketplace.",
        )
    catalog = {
        str(i.get("id")): i for i in (settings.get("marketplace_items") or []) if i.get("id")
    }
    catalog_item = catalog.get(item_id)
    if not catalog_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Marketplace item not found.",
        )

    session, _entry = await _get_open_frontdesk_session(db, user.company_id, user.id)
    cart = normalize_cart(getattr(session, "marketplace_cart_json", None))
    by_id = {r["id"]: r for r in cart}

    row = by_id.get(item_id)
    if row is None:
        row = {
            "id": item_id,
            "label": str(catalog_item.get("label") or "Item")[:100],
            "price_cents": int(catalog_item.get("price_cents") or 0),
            "qty": 0,
        }
        cart.append(row)
        by_id[item_id] = row
    else:
        row["label"] = str(catalog_item.get("label") or row.get("label") or "Item")[:100]

    if qty is not None:
        row["qty"] = max(0, int(qty))
    else:
        row["qty"] = max(0, int(row.get("qty") or 0) + int(delta or 0))

    session.marketplace_cart_json = normalize_cart(list(by_id.values()))
    flag_modified(session, "marketplace_cart_json")
    await db.commit()
    return await get_marketplace_state(db, user)


async def clear_marketplace_cart(db: AsyncSession, user: User) -> dict[str, Any]:
    if user.role != UserRole.FRONTDESK:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Marketplace sales are only available for Front Desk.",
        )
    session, _entry = await _get_open_frontdesk_session(db, user.company_id, user.id)
    session.marketplace_cart_json = []
    flag_modified(session, "marketplace_cart_json")
    await db.commit()
    return await get_marketplace_state(db, user)


def _add_sale_amount(
    sales_by_key: dict[str, dict],
    *,
    item_id: str,
    label: str,
    price_cents: int,
    payment: PaymentMethod,
    qty: int,
    amount_cents: int,
) -> None:
    if amount_cents <= 0 and qty <= 0:
        return
    key = _sale_key(item_id, payment)
    row = sales_by_key.get(key)
    if row is None:
        row = {
            "id": item_id,
            "label": label,
            "price_cents": price_cents,
            "qty": 0,
            "payment": payment,
            "amount_cents": 0,
        }
        sales_by_key[key] = row
    row["qty"] = int(row.get("qty") or 0) + max(0, qty)
    row["label"] = label
    if price_cents and not int(row.get("price_cents") or 0):
        row["price_cents"] = price_cents
    # Once amount_cents is used, keep money exact
    prev = row.get("amount_cents")
    if prev is None and int(row.get("qty") or 0) > qty:
        # Had prior qty*price accounting; convert then add
        prior_qty = int(row.get("qty") or 0) - max(0, qty)
        prior_amt = prior_qty * int(row.get("price_cents") or 0)
        row["amount_cents"] = prior_amt + amount_cents
    else:
        row["amount_cents"] = int(prev or 0) + amount_cents


def allocate_cart_payment_split(
    cart: list[dict],
    cash_cents: int,
    card_cents: int,
) -> list[tuple[dict, PaymentMethod, int, int]]:
    """
    Split each cart line across cash/card by value.

    Returns list of (line, payment, qty, amount_cents).
    Qtys are split proportionally; amounts are exact and sum to cash+card.
    """
    due = cart_total_cents(cart)
    if due <= 0:
        return []
    cash_cents = max(0, int(cash_cents))
    card_cents = max(0, int(card_cents))
    out: list[tuple[dict, PaymentMethod, int, int]] = []
    allocated_cash = 0
    lines = [ln for ln in cart if int(ln.get("qty") or 0) > 0]
    for i, line in enumerate(lines):
        qty = int(line.get("qty") or 0)
        price = int(line.get("price_cents") or 0)
        line_total = qty * price
        if i == len(lines) - 1:
            line_cash = cash_cents - allocated_cash
        else:
            line_cash = (line_total * cash_cents) // due
        line_cash = max(0, min(line_total, line_cash))
        line_card = line_total - line_cash
        allocated_cash += line_cash

        if line_total <= 0 or qty <= 0:
            continue
        if line_cash == line_total:
            out.append((line, "cash", qty, line_cash))
        elif line_card == line_total:
            out.append((line, "card", qty, line_card))
        else:
            # Split qty by value share; put remainder qty on the larger amount side
            cash_qty = int(round(qty * (line_cash / line_total))) if line_total else 0
            cash_qty = max(0, min(qty, cash_qty))
            if cash_qty == 0 and line_cash > 0:
                cash_qty = 1 if qty > 1 else 0
            if cash_qty == qty and line_card > 0:
                cash_qty = qty - 1
            card_qty = qty - cash_qty
            if line_cash > 0:
                out.append((line, "cash", max(cash_qty, 1 if line_cash and not cash_qty else cash_qty), line_cash))
            if line_card > 0:
                out.append((line, "card", max(card_qty, 1 if line_card and not card_qty else card_qty), line_card))
    return out


async def finalize_marketplace_cart(
    db: AsyncSession,
    user: User,
    payment: Optional[str] = None,
    amount_cents: Optional[int] = None,
    cash_cents: Optional[int] = None,
    card_cents: Optional[int] = None,
) -> dict[str, Any]:
    """
    Charge the current cart and move lines into shift sales.

    Preferred: cash_cents + card_cents == cart total (supports split tender).
    Legacy: payment=cash|card with optional amount_cents == cart total.
    """
    if user.role != UserRole.FRONTDESK:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Marketplace sales are only available for Front Desk.",
        )

    session, _entry = await _get_open_frontdesk_session(db, user.company_id, user.id)
    cart = normalize_cart(getattr(session, "marketplace_cart_json", None))
    if not cart:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cart is empty. Add items before taking payment.",
        )

    due = cart_total_cents(cart)
    if due <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cart total must be greater than zero.",
        )

    # Resolve tender: prefer explicit cash/card split
    if cash_cents is not None or card_cents is not None:
        pay_cash = int(cash_cents or 0)
        pay_card = int(card_cents or 0)
    elif payment is not None:
        pay = "card" if str(payment).lower().strip() == "card" else "cash"
        tendered = int(amount_cents) if amount_cents is not None else due
        if tendered != due:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Amount must match cart total "
                    f"(${due / 100:.2f}). Guest amount was ${tendered / 100:.2f}."
                ),
            )
        pay_cash = due if pay == "cash" else 0
        pay_card = due if pay == "card" else 0
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide cash_cents/card_cents or payment.",
        )

    if pay_cash < 0 or pay_card < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment amounts cannot be negative.",
        )
    if pay_cash + pay_card != due:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cash + card must equal cart total ${due / 100:.2f} "
                f"(got ${pay_cash / 100:.2f} + ${pay_card / 100:.2f})."
            ),
        )

    sales = normalize_sales(getattr(session, "marketplace_sales_json", None))
    sales_by_key = {_sale_key(s["id"], _row_payment(s)): dict(s) for s in sales}

    for line, pay_method, qty, amt in allocate_cart_payment_split(cart, pay_cash, pay_card):
        _add_sale_amount(
            sales_by_key,
            item_id=str(line["id"]),
            label=str(line.get("label") or "Item")[:100],
            price_cents=int(line.get("price_cents") or 0),
            payment=pay_method,
            qty=qty,
            amount_cents=amt,
        )

    session.marketplace_sales_json = normalize_sales(list(sales_by_key.values()))
    session.marketplace_cart_json = []
    session.beverages_cash_cents = marketplace_total_cents(session.marketplace_sales_json)
    flag_modified(session, "marketplace_sales_json")
    flag_modified(session, "marketplace_cart_json")
    await db.commit()
    return await get_marketplace_state(db, user)


async def update_marketplace_qty(
    db: AsyncSession,
    user: User,
    item_id: str,
    qty: Optional[int] = None,
    delta: Optional[int] = None,
    payment: str = "cash",
) -> dict[str, Any]:
    """Deprecated alias: qty updates go to the cart; payment is chosen at finalize."""
    return await update_marketplace_cart(db, user, item_id=item_id, qty=qty, delta=delta)
