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
                error_detail = str(e)
                error_type = type(e).__name__
                
                # Check for common database errors and provide more helpful messages
                if "does not exist" in error_detail.lower() or "relation" in error_detail.lower():
                    error_detail = f"Database schema issue detected. Please ensure all migrations have been run. Original error: {error_detail}"
                elif "column" in error_detail.lower() and ("does not exist" in error_detail.lower() or "not found" in error_detail.lower()):
                    error_detail = f"Database column missing. Please ensure all migrations have been run. Original error: {error_detail}"
                
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
                
                # In development, return more detailed error messages
                import os
                is_dev = os.getenv("ENVIRONMENT", "").lower() not in ["prod", "production"]
                
                if is_dev:
                    detail_msg = f"Error in {op_name}: {error_type}: {error_detail}"
                else:
                    detail_msg = f"An unexpected error occurred while processing your request. Please try again later."
                
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=detail_msg,
                )
        return wrapper
    return decorator

