"""
Reusable query builder functions to reduce code duplication across services.
"""
from typing import Optional, List, Tuple, TypeVar, Generic
from uuid import UUID
from datetime import date, datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import DeclarativeBase

# Type variable for SQLAlchemy models
ModelType = TypeVar('ModelType', bound=DeclarativeBase)


async def get_paginated_results(
    db: AsyncSession,
    query,
    skip: int = 0,
    limit: int = 100,
    order_by=None,
) -> Tuple[List, int]:
    """
    Execute a paginated query and return results with total count.
    
    Args:
        db: Database session
        query: SQLAlchemy select query
        skip: Number of records to skip
        limit: Maximum number of records to return
        order_by: Column(s) to order by (optional)
    
    Returns:
        Tuple of (results_list, total_count)
    """
    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0
    
    # Apply ordering if provided
    if order_by is not None:
        if isinstance(order_by, (list, tuple)):
            query = query.order_by(*order_by)
        else:
            query = query.order_by(order_by)
    
    # Apply pagination
    result = await db.execute(query.offset(skip).limit(limit))
    items = result.scalars().all()
    
    return list(items), total


def filter_by_company(
    query,
    model: type[ModelType],
    company_id: UUID,
) -> type:
    """
    Add company_id filter to a query.
    
    Args:
        query: SQLAlchemy select query
        model: SQLAlchemy model class
        company_id: Company UUID to filter by
    
    Returns:
        Modified query
    """
    return query.where(model.company_id == company_id)


def filter_by_employee(
    query,
    model: type[ModelType],
    employee_id: UUID,
) -> type:
    """
    Add employee_id filter to a query.
    
    Args:
        query: SQLAlchemy select query
        model: SQLAlchemy model class
        employee_id: Employee UUID to filter by
    
    Returns:
        Modified query
    """
    return query.where(model.employee_id == employee_id)


def filter_by_status(
    query,
    model: type[ModelType],
    status: any,
    status_column_name: str = "status",
) -> type:
    """
    Add status filter to a query.
    
    Args:
        query: SQLAlchemy select query
        model: SQLAlchemy model class
        status: Status value to filter by
        status_column_name: Name of the status column (default: "status")
    
    Returns:
        Modified query
    """
    status_column = getattr(model, status_column_name)
    return query.where(status_column == status)


def filter_by_date_range(
    query,
    model: type[ModelType],
    date_column_name: str,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
) -> type:
    """
    Add date range filter to a query.
    
    Args:
        query: SQLAlchemy select query
        model: SQLAlchemy model class
        date_column_name: Name of the date/datetime column to filter on
        from_date: Start date (inclusive)
        to_date: End date (inclusive)
    
    Returns:
        Modified query
    """
    date_column = getattr(model, date_column_name)
    
    if from_date:
        # For date columns, use date directly; for datetime, combine with min time
        if hasattr(date_column.type, 'python_type') and date_column.type.python_type == datetime:
            query = query.where(date_column >= datetime.combine(from_date, datetime.min.time()))
        else:
            query = query.where(date_column >= from_date)
    
    if to_date:
        # For date columns, use date directly; for datetime, combine with max time
        if hasattr(date_column.type, 'python_type') and date_column.type.python_type == datetime:
            query = query.where(date_column <= datetime.combine(to_date, datetime.max.time()))
        else:
            query = query.where(date_column <= to_date)
    
    return query


def build_company_filtered_query(
    model: type[ModelType],
    company_id: UUID,
    additional_filters: Optional[dict] = None,
) -> type:
    """
    Build a base query filtered by company_id with optional additional filters.
    
    Args:
        model: SQLAlchemy model class
        company_id: Company UUID to filter by
        additional_filters: Dict of {column_name: value} for additional filters
    
    Returns:
        SQLAlchemy select query
    """
    query = select(model).where(model.company_id == company_id)
    
    if additional_filters:
        conditions = []
        for column_name, value in additional_filters.items():
            if value is not None:
                column = getattr(model, column_name)
                conditions.append(column == value)
        
        if conditions:
            query = query.where(and_(*conditions))
    
    return query


def build_employee_company_filtered_query(
    model: type[ModelType],
    employee_id: UUID,
    company_id: UUID,
    additional_filters: Optional[dict] = None,
) -> type:
    """
    Build a base query filtered by both employee_id and company_id.
    
    Args:
        model: SQLAlchemy model class
        employee_id: Employee UUID to filter by
        company_id: Company UUID to filter by
        additional_filters: Dict of {column_name: value} for additional filters
    
    Returns:
        SQLAlchemy select query
    """
    query = select(model).where(
        and_(
            model.employee_id == employee_id,
            model.company_id == company_id,
        )
    )
    
    if additional_filters:
        conditions = []
        for column_name, value in additional_filters.items():
            if value is not None:
                column = getattr(model, column_name)
                conditions.append(column == value)
        
        if conditions:
            query = query.where(and_(*conditions))
    
    return query

