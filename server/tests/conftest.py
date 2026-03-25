import os
import pytest
import asyncio
from httpx import AsyncClient
from sqlalchemy.engine.url import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.main import app
from app.core.database import Base, get_db
from app.core.config import settings


def _async_test_database_url() -> str:
    """
    Same DB user/password/host as DATABASE_URL; only the database name changes to clockinn_test.
    (Naive .replace('clockinn', 'clockinn_test') breaks URLs by renaming the user to clockinn_test.)

    Override with env TEST_DATABASE_URL (full URL, postgresql:// or postgresql+asyncpg://).
    Optional TEST_DATABASE_NAME (default clockinn_test) if not using TEST_DATABASE_URL.
    """
    explicit = os.environ.get("TEST_DATABASE_URL", "").strip()
    if explicit:
        url = explicit
    else:
        name = os.environ.get("TEST_DATABASE_NAME", "clockinn_test").strip() or "clockinn_test"
        u = make_url(settings.DATABASE_URL)
        u = u.set(database=name)
        url = u.render_as_string(hide_password=False)

    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    raise ValueError("TEST_DATABASE_URL / DATABASE_URL must start with postgresql:// or postgresql+asyncpg://")


TEST_DATABASE_URL = _async_test_database_url()


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
async def engine():
    """Create test database engine."""
    engine = create_async_engine(
        TEST_DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"),
        echo=False,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db(engine):
    """Create a test database session."""
    async_session_maker = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    async with async_session_maker() as session:
        yield session
        await session.rollback()


@pytest.fixture
async def client(db: AsyncSession):
    """Create a test client."""
    async def override_get_db():
        yield db
    
    app.dependency_overrides[get_db] = override_get_db
    
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac
    
    app.dependency_overrides.clear()

