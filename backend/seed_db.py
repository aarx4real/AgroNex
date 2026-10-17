"""Standalone CLI script to initialize and seed the AgroNex database via SQLAlchemy ORM.

Usage:
    python -m backend.seed_db
"""
import sys
from backend.database import engine, get_engine_dialect
from backend.db_service import init_db, seed_database_if_empty, get_database_telemetry, SessionLocal

def main():
    print(f"[AgroNex DB] Connected to: {get_engine_dialect().upper()}")
    print("[AgroNex DB] Initializing tables via SQLAlchemy Base.metadata.create_all()...")
    init_db()
    print("[AgroNex DB] Checking and seeding default verified records...")
    session = SessionLocal()
    try:
        seeded = seed_database_if_empty(session)
        if seeded:
            print("[AgroNex DB] Default dataset seeded successfully.")
        else:
            print("[AgroNex DB] Database already contains records.")
        telemetry = get_database_telemetry(session)
        print("[AgroNex DB] Live Table Statistics:")
        for table, count in telemetry["tables"].items():
            print(f"  - {table}: {count} rows")
    finally:
        session.close()

if __name__ == "__main__":
    main()
