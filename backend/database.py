"""Database connection and session configuration for AgroNex using SQLAlchemy ORM.

Supports PostgreSQL, MySQL, and SQLite.
Defaults to PostgreSQL if DATABASE_URL is set, otherwise falls back gracefully
to SQLite for zero-config local development and testing.
"""
from __future__ import annotations

import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# Priority: environment variable -> fallback to local SQLite
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if not DATABASE_URL:
    db_path = Path(__file__).resolve().parent / "agronex.db"
    DATABASE_URL = f"sqlite:///{db_path}"

# SQLite requires check_same_thread=False for multithreaded FastAPI requests
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=os.getenv("AGRONEX_SQL_ECHO", "false").lower() == "true",
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a SQLAlchemy database session."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_engine_dialect() -> str:
    """Returns the dialect of the connected database (e.g. postgresql, sqlite, mysql)."""
    return engine.dialect.name
