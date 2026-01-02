from sqlalchemy import Column, String, ForeignKey, DateTime, Integer, Enum, Index, Date, Numeric, BigInteger, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from app.core.database import Base


class PayrollType(str, enum.Enum):
    WEEKLY = "WEEKLY"
    BIWEEKLY = "BIWEEKLY"


class PayrollStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    FINALIZED = "FINALIZED"
    VOID = "VOID"


class PayrollRun(Base):
    __tablename__ = "payroll_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    payroll_type = Column(Enum(PayrollType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    period_start_date = Column(Date, nullable=False)
    period_end_date = Column(Date, nullable=False)
    timezone = Column(String(50), nullable=False, default="America/Chicago")
    status = Column(Enum(PayrollStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=PayrollStatus.DRAFT)
    generated_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    generated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    
    # Totals
    total_regular_hours = Column(Numeric(10, 2), nullable=False, default=0)
    total_overtime_hours = Column(Numeric(10, 2), nullable=False, default=0)
    total_gross_pay_cents = Column(BigInteger, nullable=False, default=0)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company", backref="payroll_runs")
    generator = relationship("User", foreign_keys=[generated_by])
    line_items = relationship("PayrollLineItem", back_populates="payroll_run", cascade="all, delete-orphan")
    adjustments = relationship("PayrollAdjustment", back_populates="payroll_run", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("company_id", "payroll_type", "period_start_date", "period_end_date", name="uq_payroll_run_period"),
        Index("idx_payroll_runs_company_period", "company_id", "period_start_date", "period_end_date"),
    )


class PayrollLineItem(Base):
    __tablename__ = "payroll_line_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    payroll_run_id = Column(UUID(as_uuid=True), ForeignKey("payroll_runs.id"), nullable=False, index=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    
    # Time breakdown
    regular_minutes = Column(Integer, nullable=False, default=0)
    overtime_minutes = Column(Integer, nullable=False, default=0)
    total_minutes = Column(Integer, nullable=False, default=0)
    
    # Pay rate and multiplier
    pay_rate_cents = Column(Integer, nullable=False)
    overtime_multiplier = Column(Numeric(4, 2), nullable=False, default=1.5)
    
    # Pay calculations
    regular_pay_cents = Column(BigInteger, nullable=False, default=0)
    overtime_pay_cents = Column(BigInteger, nullable=False, default=0)
    total_pay_cents = Column(BigInteger, nullable=False, default=0)
    
    # Exceptions tracking
    exceptions_count = Column(Integer, nullable=False, default=0)
    details_json = Column(JSONB, nullable=True)  # Daily breakdown, time entry IDs, etc.
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    payroll_run = relationship("PayrollRun", back_populates="line_items")
    company = relationship("Company")
    employee = relationship("User", foreign_keys=[employee_id])

    __table_args__ = (
        UniqueConstraint("payroll_run_id", "employee_id", name="uq_payroll_line_item_employee"),
        Index("idx_payroll_line_items_payroll_run", "payroll_run_id"),
        Index("idx_payroll_line_items_employee", "employee_id"),
    )


class AdjustmentType(str, enum.Enum):
    BONUS = "BONUS"
    DEDUCTION = "DEDUCTION"
    REIMBURSEMENT = "REIMBURSEMENT"


class PayrollAdjustment(Base):
    __tablename__ = "payroll_adjustments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    payroll_run_id = Column(UUID(as_uuid=True), ForeignKey("payroll_runs.id"), nullable=False, index=True)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    type = Column(Enum(AdjustmentType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    amount_cents = Column(BigInteger, nullable=False)  # Positive for bonus/reimbursement, negative for deduction
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    payroll_run = relationship("PayrollRun", back_populates="adjustments")
    employee = relationship("User", foreign_keys=[employee_id])

    __table_args__ = (
        Index("idx_payroll_adjustments_payroll_run", "payroll_run_id"),
        Index("idx_payroll_adjustments_employee", "employee_id"),
    )

