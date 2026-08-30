"""Convert a filled .xlsx workbook to PDF via LibreOffice (soffice)."""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

logger = logging.getLogger(__name__)


def _soffice_bin() -> str:
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found
    raise RuntimeError(
        "LibreOffice is required to convert Excel sheets to PDF. "
        "Install libreoffice-calc (Docker image includes it)."
    )


def convert_xlsx_to_pdf(xlsx_buffer: BytesIO) -> BytesIO:
    """
    Write the xlsx to a temp dir, convert with LibreOffice headless, return PDF bytes.
    """
    data = xlsx_buffer.getvalue() if hasattr(xlsx_buffer, "getvalue") else xlsx_buffer.read()
    soffice = _soffice_bin()

    with tempfile.TemporaryDirectory(prefix="hk_xlsx_") as tmp:
        tmp_path = Path(tmp)
        xlsx_path = tmp_path / "hk_sheet.xlsx"
        xlsx_path.write_bytes(data)

        # LibreOffice needs a writable user profile in containers
        profile = tmp_path / "lo_profile"
        profile.mkdir(parents=True, exist_ok=True)

        cmd = [
            soffice,
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            "--norestore",
            f"-env:UserInstallation=file://{profile.as_posix()}",
            "--convert-to",
            "pdf:calc_pdf_Export",
            "--outdir",
            str(tmp_path),
            str(xlsx_path),
        ]
        try:
            result = subprocess.run(
                cmd,
                check=False,
                capture_output=True,
                timeout=90,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Excel to PDF conversion timed out") from exc

        pdf_path = tmp_path / "hk_sheet.pdf"
        if result.returncode != 0 or not pdf_path.exists():
            # Retry without filter name (some LO builds differ)
            cmd2 = [
                soffice,
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                "--norestore",
                f"-env:UserInstallation=file://{profile.as_posix()}",
                "--convert-to",
                "pdf",
                "--outdir",
                str(tmp_path),
                str(xlsx_path),
            ]
            result2 = subprocess.run(
                cmd2,
                check=False,
                capture_output=True,
                timeout=90,
            )
            if result2.returncode != 0 or not pdf_path.exists():
                err = (result2.stderr or result.stderr or b"").decode("utf-8", errors="replace")
                logger.error("LibreOffice convert failed: %s", err)
                raise RuntimeError(f"Failed to convert Excel to PDF: {err[:500]}")

        return BytesIO(pdf_path.read_bytes())
