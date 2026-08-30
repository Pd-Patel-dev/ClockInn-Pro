"""Housekeeping assignment sheet Excel (HK template)."""
from __future__ import annotations

import math
import re
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font
from openpyxl.worksheet.worksheet import Worksheet

TEMPLATE_PATH = Path(__file__).resolve().parent / "hk_assignment_sheet.xlsx"

DATA_START_ROW = 5
DATA_END_ROW = 28
ROWS_PER_BLOCK = DATA_END_ROW - DATA_START_ROW + 1  # 24 rows per page
# Two side-by-side blocks (A–C and D–F) on one page
SLOTS_PER_PAGE = ROWS_PER_BLOCK * 2  # 48 room slots / page
# Excel row height is in points; values match the px heights requested for print layout
HEADER_ROW_HEIGHT = 40
COL_HEADER_ROW = 4
COL_HEADER_ROW_HEIGHT = 55
COL_HEADER_FONT_SIZE = 10
DATA_ROW_HEIGHT = 35
DATA_FONT_SIZE = 18


def _sort_rooms(numbers: Iterable[str]) -> List[str]:
    def key(n: str):
        m = re.search(r"(\d+)", n or "")
        return (int(m.group(1)) if m else 10**9, n or "")

    return sorted((n for n in numbers if n), key=key)


def _center_sheet_on_page(ws: Worksheet) -> None:
    """Center the printed table horizontally and vertically on the page."""
    ws.print_area = f"A1:F{DATA_END_ROW}"
    ws.print_options.horizontalCentered = True
    ws.print_options.verticalCentered = True
    ws.page_margins.left = 0.5
    ws.page_margins.right = 0.5
    ws.page_margins.top = 0.5
    ws.page_margins.bottom = 0.5
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def _slot_coord(index: int, left_col: str, right_col: str) -> Tuple[str, int]:
    """Map 0-based index within one page → (column, row). Left block first, then right."""
    if index < ROWS_PER_BLOCK:
        return left_col, DATA_START_ROW + index
    return right_col, DATA_START_ROW + (index - ROWS_PER_BLOCK)


def _fill_sheet(
    ws: Worksheet,
    *,
    day_label: str,
    date_label: str,
    name_label: str,
    page_items: Sequence[Tuple[str, str]],
    page_number: int,
    total_pages: int,
) -> None:
    title = "HK Sheet" if total_pages == 1 else f"HK Sheet {page_number}"
    ws.title = title

    header_text = f"Date: {day_label}, {date_label}"
    name_text = f"Name: {name_label}"
    if total_pages > 1:
        name_text = f"{name_text}  ({page_number}/{total_pages})"

    ws["A1"] = header_text
    ws["D1"] = name_text
    header_align = Alignment(horizontal="left", vertical="center", indent=1)
    ws["A1"].alignment = header_align
    ws["D1"].alignment = header_align
    ws.row_dimensions[1].height = HEADER_ROW_HEIGHT
    ws.row_dimensions[COL_HEADER_ROW].height = COL_HEADER_ROW_HEIGHT

    for col in range(1, 7):
        cell = ws.cell(COL_HEADER_ROW, col)
        cell.font = Font(
            name=cell.font.name or "Calibri",
            size=COL_HEADER_FONT_SIZE,
            bold=True,
        )
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for r in range(DATA_START_ROW, DATA_END_ROW + 1):
        ws.row_dimensions[r].height = DATA_ROW_HEIGHT
        for col in range(1, 7):
            cell = ws.cell(r, col)
            cell.font = Font(
                name=cell.font.name or "Calibri",
                size=DATA_FONT_SIZE,
                bold=cell.font.bold,
            )

    for idx, (kind, room) in enumerate(page_items):
        if idx >= SLOTS_PER_PAGE:
            break
        if kind == "checkout":
            col, row = _slot_coord(idx, "A", "D")
        else:
            col, row = _slot_coord(idx, "B", "E")
        cell = ws[f"{col}{row}"]
        cell.value = room
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.font = Font(name="Calibri", size=DATA_FONT_SIZE, bold=True)

    _center_sheet_on_page(ws)


def generate_hk_assignment_excel(
    *,
    housekeeper_name: str,
    created_at: datetime,
    items: Sequence[dict],
) -> BytesIO:
    """
    Fill the HK paper template (HK 4):
      - Date (includes day of week) | Name in header
      - All Check out (departing) rooms first, then Stay over
      - Left block A–C, then right block D–F (24 rows / page)
      - Additional pages when more than 48 rooms (24 rows × 2 blocks)
    """
    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Missing HK Excel template: {TEMPLATE_PATH}")

    checkout = _sort_rooms(
        str(i.get("room_number") or "")
        for i in items
        if (i.get("occupancy_status") or "").lower() == "departing"
    )
    stayover = _sort_rooms(
        str(i.get("room_number") or "")
        for i in items
        if (i.get("occupancy_status") or "").lower() == "stayover"
    )
    other = _sort_rooms(
        str(i.get("room_number") or "")
        for i in items
        if (i.get("occupancy_status") or "").lower() not in ("departing", "stayover")
    )
    checkout = checkout + other

    ordered: List[Tuple[str, str]] = [("checkout", r) for r in checkout] + [
        ("stayover", r) for r in stayover
    ]

    total_pages = max(1, math.ceil(len(ordered) / SLOTS_PER_PAGE)) if ordered else 1

    wb = load_workbook(TEMPLATE_PATH)
    # Copy blank template sheets before filling so each page starts clean
    for page_idx in range(1, total_pages):
        wb.copy_worksheet(wb.worksheets[0])

    day_label = created_at.strftime("%A")
    date_label = created_at.strftime("%m/%d/%Y")
    name_label = (housekeeper_name or "").strip() or "—"

    for page_idx, ws in enumerate(wb.worksheets):
        start = page_idx * SLOTS_PER_PAGE
        page_items = ordered[start : start + SLOTS_PER_PAGE]
        _fill_sheet(
            ws,
            day_label=day_label,
            date_label=date_label,
            name_label=name_label,
            page_items=page_items,
            page_number=page_idx + 1,
            total_pages=total_pages,
        )

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
