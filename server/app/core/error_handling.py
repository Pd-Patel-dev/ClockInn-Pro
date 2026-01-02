"""
Standardized error handling utilities for API endpoints.
"""
from functools import wraps
from typing import Callable, Any
from uuid import UUID
from fastapi import HTTPException, status
import logging

logger = logging.getLogger(__name__)


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
                if log_error:
                    logger.warning(f"Value error in {op_name}: {str(e)}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid input: {str(e)}",
                )
            except Exception as e:
                # Catch all other unexpected exceptions
                if log_error:
                    logger.error(
                        f"Unexpected error in {op_name}",
                        exc_info=True,
                        extra={"operation": op_name, "error": str(e)}
                    )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"An unexpected error occurred while processing your request. Please try again later.",
                )
        return wrapper
    return decorator

