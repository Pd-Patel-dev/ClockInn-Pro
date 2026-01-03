"""
Tests for payroll report PDF generation.
"""
import pytest
from datetime import datetime, date
from app.pdf_templates.payroll_report import generate_payroll_report_pdf, sanitize_html


def test_sanitize_html():
    """Test HTML sanitization removes dangerous tags and escapes special characters."""
    # <b> tags are kept for ReportLab Paragraph
    assert "<b>Test</b>" in sanitize_html("<b>Test</b>")
    # & is escaped if not part of entity
    assert "&amp;" in sanitize_html("Price & Value")
    # Script tags are removed
    assert "<script>" not in sanitize_html("<script>alert('xss')</script>")
    assert sanitize_html(None) == ""
    assert sanitize_html("") == ""


def test_generate_payroll_report_pdf_returns_bytes():
    """Test that PDF generator returns bytes."""
    rows = [
        {
            'employee_name': 'John Doe',
            'regular_hours': 40.0,
            'ot_hours': 5.0,
            'rate': 25.0,
            'regular_pay': 1000.0,
            'ot_pay': 187.5,
            'total_pay': 1187.5,
            'exceptions': '-',
        },
        {
            'employee_name': 'Jane Smith',
            'regular_hours': 40.0,
            'ot_hours': 0.0,
            'rate': 30.0,
            'regular_pay': 1200.0,
            'ot_pay': 0.0,
            'total_pay': 1200.0,
            'exceptions': '2 exceptions',
        },
    ]
    
    pdf_bytes = generate_payroll_report_pdf(
        company_name="Test Company",
        payroll_type="WEEKLY",
        period_start=date(2025, 1, 1),
        period_end=date(2025, 1, 7),
        generated_at=datetime(2025, 1, 8, 10, 30),
        generated_by="Admin User",
        status="Finalized",
        rows=rows,
    )
    
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    # PDF files start with %PDF
    assert pdf_bytes[:4] == b'%PDF'


def test_generate_payroll_report_pdf_totals_correct():
    """Test that totals are computed correctly in the PDF."""
    rows = [
        {
            'employee_name': 'Employee 1',
            'regular_hours': 40.0,
            'ot_hours': 5.0,
            'rate': 20.0,
            'regular_pay': 800.0,
            'ot_pay': 150.0,
            'total_pay': 950.0,
            'exceptions': '-',
        },
        {
            'employee_name': 'Employee 2',
            'regular_hours': 40.0,
            'ot_hours': 0.0,
            'rate': 25.0,
            'regular_pay': 1000.0,
            'ot_pay': 0.0,
            'total_pay': 1000.0,
            'exceptions': '-',
        },
    ]
    
    pdf_bytes = generate_payroll_report_pdf(
        company_name="Test Company",
        payroll_type="BIWEEKLY",
        period_start=date(2025, 1, 1),
        period_end=date(2025, 1, 14),
        generated_at=datetime(2025, 1, 15, 12, 0),
        generated_by="Admin",
        status="Draft",
        rows=rows,
    )
    
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    
    # Verify PDF contains expected totals (as text in the PDF)
    pdf_text = pdf_bytes.decode('latin-1', errors='ignore')
    # Should contain total employee count (2)
    assert '2' in pdf_text or 'Total Employees' in pdf_text
    # Should contain total regular hours (80)
    assert '80.00' in pdf_text or '80,00' in pdf_text
    # Should contain total gross pay (1950)
    assert '1950.00' in pdf_text or '1,950.00' in pdf_text or '1950,00' in pdf_text


def test_generate_payroll_report_pdf_empty_rows():
    """Test PDF generation with empty employee list."""
    pdf_bytes = generate_payroll_report_pdf(
        company_name="Empty Company",
        payroll_type="WEEKLY",
        period_start=date(2025, 1, 1),
        period_end=date(2025, 1, 7),
        generated_at=datetime(2025, 1, 8, 10, 0),
        generated_by="Admin",
        status="Draft",
        rows=[],
    )
    
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    assert pdf_bytes[:4] == b'%PDF'

