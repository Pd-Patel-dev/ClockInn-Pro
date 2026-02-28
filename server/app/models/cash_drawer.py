from sqlalchemy import Column, String, ForeignKey, DateTime, Integer, Enum, Index, BigInteger, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from app.core.database import Base


class CashCountSource(str, enum.Enum):
    KIOSK = "kiosk"
    WEB = "web"


class CashDrawerStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    REVIEW_NEEDED = "REVIEW_NEEDED"


class CashDrawerSession(Base):
    __tablename__ = "cash_drawer_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    time_entry_id = Column(UUID(as_uuid=True), ForeignKey("time_entries.id"), nullable=False, unique=True, index=True)
    employee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    
    # Start cash
    start_cash_cents = Column(BigInteger, nullable=False)
    start_counted_at = Column(DateTime(timezone=True), nullable=False)
    start_count_source = Column(Enum(CashCountSource, values_callable=lambda x: [e.value for e in x]), nullable=False, default=CashCountSource.KIOSK)
    
    # End cash
    end_cash_cents = Column(BigInteger, nullable=True)
    end_counted_at = Column(DateTime(timezone=True), nullable=True)
    end_count_source = Column(Enum(CashCountSource, values_callable=lambda x: [e.value for e in x]), nullable=True, default=CashCountSource.KIOSK)
    
    # Cash collection details (for punch-out)
    collected_cash_cents = Column(BigInteger, nullable=True)  # Total cash collected from customers
    drop_amount_cents = Column(BigInteger, nullable=True)  # Cash dropped/removed from drawer during shift
    beverages_cash_cents = Column(BigInteger, nullable=True)  # Total beverage sales (all payment types)
    
    # Computed delta (end - start)
    delta_cents = Column(BigInteger, nullable=True)  # Computed in service layer
    
    # Status and review
    status = Column(Enum(CashDrawerStatus, values_callable=lambda x: [e.value for e in x]), nullable=False, default=CashDrawerStatus.OPEN)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    review_note = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company", backref="cash_drawer_sessions")
    time_entry = relationship("TimeEntry", backref="cash_drawer_session")
    employee = relationship("User", foreign_keys=[employee_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    audit_logs = relationship("CashDrawerAudit", back_populates="cash_drawer_session", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_cash_drawer_sessions_company_employee_date", "company_id", "employee_id", "start_counted_at"),
        Index("idx_cash_drawer_sessions_company_status", "company_id", "status"),
        Index("idx_cash_drawer_sessions_time_entry", "time_entry_id"),
    )


class CashDrawerAuditAction(str, enum.Enum):
    CREATE_START = "CREATE_START"
    SET_END = "SET_END"
    EDIT_START = "EDIT_START"
    EDIT_END = "EDIT_END"
    REVIEW = "REVIEW"
    VOID = "VOID"


class CashDrawerAudit(Base):
    __tablename__ = "cash_drawer_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    cash_drawer_session_id = Column(UUID(as_uuid=True), ForeignKey("cash_drawer_sessions.id"), nullable=False, index=True)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    action = Column(Enum(CashDrawerAuditAction, values_callable=lambda x: [e.value for e in x]), nullable=False)
    old_values_json = Column(JSONB, nullable=True)
    new_values_json = Column(JSONB, nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    company = relationship("Company")
    cash_drawer_session = relationship("CashDrawerSession", back_populates="audit_logs")
    actor = relationship("User", foreign_keys=[actor_user_id])

    __table_args__ = (
        Index("idx_cash_drawer_audit_session", "cash_drawer_session_id"),
        Index("idx_cash_drawer_audit_actor", "actor_user_id"),
        Index("idx_cash_drawer_audit_created", "created_at"),
    )
