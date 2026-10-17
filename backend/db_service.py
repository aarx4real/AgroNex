"""Database Service layer for AgroNex using SQLAlchemy ORM.

Implements all CRUD operations, database lifecycle initialization, automatic seeding,
and optimization run logging against the connected database (PostgreSQL, MySQL, or SQLite).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select, delete, func
from sqlalchemy.orm import Session

from .database import engine, Base, SessionLocal, get_engine_dialect, DATABASE_URL
from .db_models import (
    InventoryBatchModel,
    DestinationModel,
    TransportRouteModel,
    OptimizationRunModel,
)

DATA_DIR = Path(__file__).resolve().parent / "data"


def init_db():
    """Creates all database tables defined in SQLAlchemy models if they do not exist."""
    Base.metadata.create_all(bind=engine)


def seed_database_if_empty(session: Session | None = None) -> bool:
    """Seeds the database tables from snapshot JSON files if they contain no records."""
    close_session = False
    if session is None:
        session = SessionLocal()
        close_session = True

    try:
        inventory_count = session.query(func.count(InventoryBatchModel.batch_id)).scalar() or 0
        if inventory_count > 0:
            return False  # Already populated

        # 1. Seed Inventory
        inv_path = DATA_DIR / "inventory.json"
        if inv_path.exists():
            with inv_path.open("r", encoding="utf-8") as f:
                inv_data = json.load(f)
                for item in inv_data:
                    session.add(InventoryBatchModel.from_dict(item))

        # 2. Seed Destinations
        dest_path = DATA_DIR / "destinations.json"
        if dest_path.exists():
            with dest_path.open("r", encoding="utf-8") as f:
                dest_data = json.load(f)
                for item in dest_data:
                    session.add(DestinationModel.from_dict(item))

        # 3. Seed Transport Routes
        trans_path = DATA_DIR / "transport.json"
        if trans_path.exists():
            with trans_path.open("r", encoding="utf-8") as f:
                trans_data = json.load(f)
                for item in trans_data:
                    session.add(TransportRouteModel.from_dict(item))

        session.commit()
        return True
    except Exception as exc:
        session.rollback()
        raise exc
    finally:
        if close_session:
            session.close()


# ==============================================================================
# INVENTORY ORM CRUD
# ==============================================================================

def get_inventory_batches(session: Session) -> list[dict[str, Any]]:
    """Fetches all inventory batches from the database via SQLAlchemy ORM."""
    stmt = select(InventoryBatchModel).order_by(InventoryBatchModel.remaining_shelf_life_hours.asc())
    records = session.execute(stmt).scalars().all()
    return [r.to_dict() for r in records]


def add_inventory_batch(session: Session, batch_data: dict[str, Any]) -> dict[str, Any]:
    """Inserts or updates an inventory batch in the connected database using ORM."""
    batch_id = str(batch_data["batch_id"]).strip()
    existing = session.get(InventoryBatchModel, batch_id)

    if existing:
        existing.commodity = str(batch_data["commodity"]).strip()
        existing.quantity_kg = float(batch_data["quantity_kg"])
        existing.remaining_shelf_life_hours = float(batch_data["remaining_shelf_life_hours"])
        existing.selling_price_per_kg = float(batch_data["selling_price_per_kg"])
        existing.unit_cost_per_kg = float(batch_data.get("unit_cost_per_kg") or 0.0)
        existing.origin_id = str(batch_data.get("origin_id", "CENTRAL")).strip()
        existing.handling_time_hours = float(batch_data.get("handling_time_hours") or 0.0)
        existing.handling_cost_per_kg = float(batch_data.get("handling_cost_per_kg") or 0.0)
        existing.harvest_date = batch_data.get("harvest_date")
        existing.spoilage_threshold = float(batch_data.get("spoilage_threshold") or 0.0)
        session.commit()
        session.refresh(existing)
        return existing.to_dict()
    else:
        new_batch = InventoryBatchModel.from_dict(batch_data)
        session.add(new_batch)
        session.commit()
        session.refresh(new_batch)
        return new_batch.to_dict()


def delete_inventory_batch(session: Session, batch_id: str) -> bool:
    """Deletes an inventory batch from the database by ID."""
    batch = session.get(InventoryBatchModel, batch_id)
    if not batch:
        return False
    session.delete(batch)
    session.commit()
    return True


def replace_inventory_batches(session: Session, batches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replaces all inventory batches with a validated list (used in CSV uploads / resets)."""
    session.execute(delete(InventoryBatchModel))
    for b in batches:
        session.add(InventoryBatchModel.from_dict(b))
    session.commit()
    return get_inventory_batches(session)


# ==============================================================================
# DESTINATIONS ORM CRUD
# ==============================================================================

def get_destinations(session: Session) -> list[dict[str, Any]]:
    """Fetches all destinations from the database."""
    stmt = select(DestinationModel).order_by(DestinationModel.destination_id.asc())
    records = session.execute(stmt).scalars().all()
    return [r.to_dict() for r in records]


def replace_destinations(session: Session, destinations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replaces all destinations with updated values (e.g. after price refresh or CSV upload)."""
    session.execute(delete(DestinationModel))
    for d in destinations:
        session.add(DestinationModel.from_dict(d))
    session.commit()
    return get_destinations(session)


# ==============================================================================
# TRANSPORT ROUTES ORM CRUD
# ==============================================================================

def get_transport_routes(session: Session) -> list[dict[str, Any]]:
    """Fetches all transport corridors from the database."""
    stmt = select(TransportRouteModel).order_by(TransportRouteModel.origin_id, TransportRouteModel.destination_id)
    records = session.execute(stmt).scalars().all()
    return [r.to_dict() for r in records]


def replace_transport_routes(session: Session, routes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Replaces all transport routes in the database."""
    session.execute(delete(TransportRouteModel))
    for r in routes:
        session.add(TransportRouteModel.from_dict(r))
    session.commit()
    return get_transport_routes(session)


# ==============================================================================
# AUDITING & OPTIMIZATION LOGGING
# ==============================================================================

def log_optimization_run(session: Session, plan: dict[str, Any], solver_mode: str = "heuristic") -> dict[str, Any]:
    """Persists an optimization plan execution result into the database for full auditability."""
    try:
        metrics = plan.get("metrics", {})
        allocations = plan.get("allocations", [])
        quarantined = plan.get("quarantined_waste", [])

        summary = {
            "strategy": plan.get("strategy", "optimized"),
            "solver_used": plan.get("solver_used", solver_mode.upper()),
            "warnings_count": len(plan.get("warnings", [])),
            "discounts_count": len(plan.get("discount_recommendations", [])),
        }

        record = OptimizationRunModel(
            solver_mode=str(solver_mode),
            delivered_kg=float(metrics.get("delivered_kg", 0.0)),
            spoiled_kg=float(metrics.get("spoiled_kg", 0.0)),
            net_revenue_inr=float(metrics.get("net_revenue", 0.0)),
            net_profit_inr=float(metrics.get("net_profit", 0.0)),
            procurement_cogs_inr=float(metrics.get("procurement_cost", 0.0)),
            transport_cost_inr=float(metrics.get("transport_cost", 0.0)),
            handling_cost_inr=float(metrics.get("handling_cost", 0.0)),
            spoilage_penalties_inr=float(metrics.get("spoilage_penalties", 0.0)),
            demand_fulfillment_percent=float(metrics.get("demand_fulfillment_percent", 0.0)),
            allocations_count=len(allocations),
            quarantined_count=len(quarantined),
            summary_json=json.dumps(summary),
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record.to_dict()
    except Exception as exc:
        session.rollback()
        # Non-fatal error for logging
        return {"error": str(exc)}


def get_optimization_history(session: Session, limit: int = 15) -> list[dict[str, Any]]:
    """Returns the most recent optimization runs logged in the database."""
    stmt = select(OptimizationRunModel).order_by(OptimizationRunModel.id.desc()).limit(limit)
    records = session.execute(stmt).scalars().all()
    return [r.to_dict() for r in records]


# ==============================================================================
# TELEMETRY & HEALTH
# ==============================================================================

def get_database_telemetry(session: Session) -> dict[str, Any]:
    """Returns database telemetry, active ORM status, and table row counts."""
    inv_count = session.query(func.count(InventoryBatchModel.batch_id)).scalar() or 0
    dest_count = session.query(func.count(DestinationModel.destination_id)).scalar() or 0
    trans_count = session.query(func.count(TransportRouteModel.id)).scalar() or 0
    runs_count = session.query(func.count(OptimizationRunModel.id)).scalar() or 0

    dialect = get_engine_dialect()
    is_postgres = dialect == "postgresql"

    # Redact sensitive credentials in DATABASE_URL if present
    redacted_url = DATABASE_URL
    if "@" in redacted_url:
        prefix, host_part = redacted_url.split("@", 1)
        scheme = prefix.split("://")[0]
        redacted_url = f"{scheme}://***:***@{host_part}"

    return {
        "status": "connected",
        "orm": "SQLAlchemy 2.x",
        "dialect": dialect,
        "is_production_db": is_postgres,
        "database_url": redacted_url,
        "tables": {
            "inventory_batches": inv_count,
            "destinations": dest_count,
            "transport_routes": trans_count,
            "optimization_runs": runs_count,
        },
    }
