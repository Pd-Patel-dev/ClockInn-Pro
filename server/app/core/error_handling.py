"""
Standardized error handling utilities for API endpoints.

Production safety: responses must never include stack traces, internal paths, or
raw exception messages. The generic handler returns a fixed message in production.
"""
from functools import wraps
from typing import Callable, Any
from uuid import UUID
import os
from fastapi import HTTPException, status
import logging

logger = logging.getLogger(__name__)


def _is_schema_error(e: Exception) -> bool:
    """True if the exception indicates missing table/column (migrations not run)."""
    msg = str(e).lower()
    if "does not exist" in msg or "relation" in msg or "undefined column" in msg:
        return True
    if "column" in msg and ("does not exist" in msg or "not found" in msg):
        return True
    # Unwrap SQLAlchemy ProgrammingError / asyncpg UndefinedColumnError
    cause = getattr(e, "orig", None) or getattr(e, "__cause__", None)
    if cause is not None:
        return _is_schema_error(cause)
    return False


def parse_uuid(uuid_string: str, entity_name: str = "ID") -> UUID:
    """
    Parse a UUID string and raise a standardized error if invalid.
    
    Args:
        uuid_string: String to parse as UUID
        entity_name: Name of the entity (for error message)
    
    Returns:
        Parsed UUID
    
    Raises:
        HTTPException: If UUID is invalid
    """
    try:
        return UUID(uuid_string)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {entity_name.lower()}: '{uuid_string}'. Must be a valid UUID.",
        )


def handle_endpoint_errors(
    operation_name: str = None,
    log_error: bool = True,
):
    """
    Decorator to standardize error handling across all endpoints.
    
    Catches unexpected exceptions, logs them, and returns appropriate HTTP responses.
    
    Args:
        operation_name: Name of the operation (for logging)
        log_error: Whether to log errors (default: True)
    
    Usage:
        @handle_endpoint_errors(operation_name="create_employee")
        async def create_employee_endpoint(...):
            ...
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            op_name = operation_name or func.__name__
            try:
                return await func(*args, **kwargs)
            except HTTPException:
                # Re-raise HTTPExceptions as-is (they're already properly formatted)
                raise
            except ValueError as e:
                # Handle value errors (e.g., invalid enum values, invalid dates)
                is_dev = os.getenv("ENVIRONMENT", "").lower() not in ["prod", "production"]
                if log_error:
                    logger.warning(f"Value error in {op_name}: {str(e)}")
                # In production, do not send str(e) to client (may contain paths or internal details)
                detail = f"Invalid input: {str(e)}" if is_dev else "Invalid input."
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=detail,
                )
            except Exception as e:
                # Catch all other unexpected exceptions. Never send stack traces or internal paths to client in production.
                error_detail = str(e)
                error_type = type(e).__name__
                error_lower = error_detail.lower()

                # Detect schema/relation/column errors (missing table or column = migrations not run)
                is_schema_error = _is_schema_error(e)
                if is_schema_error:
                    error_detail = f"Database schema issue. Ensure all migrations have been run. Original: {error_detail}"

                if log_error:
                    logger.error(
                        f"Unexpected error in {op_name}",
                        exc_info=True,
                        extra={
                            "operation": op_name,
                            "error": error_detail,
                            "error_type": error_type
                        }
                    )

                is_dev = os.getenv("ENVIRONMENT", "").lower() not in ["prod", "production"]

                if is_schema_error:
                    # 503 so client knows it's a server/config issue, not a bug; safe message in prod too
                    detail_msg = (
                        error_detail if is_dev
                        else "Service temporarily unavailable. Please ensure database migrations have been run."
                    )
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail=detail_msg,
                    )
                if is_dev:
                    detail_msg = f"Error in {op_name}: {error_type}: {error_detail}"
                else:
                    detail_msg = "An unexpected error occurred while processing your request. Please try again later."
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=detail_msg,
                )
        return wrapper
    return decorator

