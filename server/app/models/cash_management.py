"""Cash management ledger: income (drops/marketplace) and expenses."""
from sqlalchemy import (
    Column,
    String,
    ForeignKey,
    DateTime,
    Date,
    Enum,
    Index,
    BigInteger,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from app.core.database import Base


class CashTransactionKind(str, enum.Enum):
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"


class CashTransactionSource(str, enum.Enum):
    DROP = "DROP"
    MARKETPLACE_SALE = "MARKETPLACE_SALE"
    MANUAL = "MANUAL"


class CashTransactionCategory(str, enum.Enum):
    OPERATIONS = "operations"
    MARKETPLACE = "marketplace"
    UTILITIES = "utilities"
    SUPPLIES = "supplies"
    OTHER = "other"
    DROP = "drop"
    MARKETPLACE_SALE = "marketplace_sale"


class CashTransaction(Base):
    __tablename__ = "cash_transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False, index=True)
    kind = Column(
        Enum(CashTransactionKind, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    source = Column(
        Enum(CashTransactionSource, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    category = Column(
        Enum(CashTransactionCategory, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    amount_cents = Column(BigInteger, nullable=False)
    occurred_on = Column(Date, nullable=False, index=True)
    note = Column(Text, nullable=True)
    cash_drawer_session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("cash_drawer_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    company = relationship("Company", backref="cash_transactions")
    creator = relationship("User", foreign_keys=[created_by])
    cash_drawer_session = relationship("CashDrawerSession", foreign_keys=[cash_drawer_session_id])

    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "cash_drawer_session_id",
            "source",
            name="uq_cash_txn_company_session_source",
        ),
        Index("idx_cash_transactions_company_occurred", "company_id", "occurred_on"),
        Index("idx_cash_transactions_company_kind", "company_id", "kind"),
        Index("idx_cash_transactions_company_category", "company_id", "category"),
    )
