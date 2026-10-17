"""Test suite for AgroNex SQLAlchemy ORM Database Tier.

Verifies:
- Relational schema creation and table initialization
- ORM mapping for inventory_batches, destinations, transport_routes, optimization_runs
- CRUD operations through the ORM session
- API database status, telemetry, and audit history endpoints
"""
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal, get_engine_dialect
from backend.db_service import (
    get_inventory_batches,
    add_inventory_batch,
    delete_inventory_batch,
    get_destinations,
    get_transport_routes,
    get_optimization_history,
    get_database_telemetry,
)

client = TestClient(app)


def test_database_status_endpoint():
    """Validates that the database status endpoint reports an active ORM connection and table counts."""
    response = client.get("/api/db/status")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "connected"
    assert "SQLAlchemy" in data["orm"]
    assert "tables" in data
    assert data["tables"]["inventory_batches"] >= 5
    assert data["tables"]["destinations"] >= 3
    assert data["tables"]["transport_routes"] >= 3


def test_database_orm_crud_operations():
    """Validates direct ORM operations (create, read, delete) using SQLAlchemy Session."""
    session = SessionLocal()
    try:
        test_batch = {
            "batch_id": "TEST-ORM-001",
            "commodity": "Alphonso Mango",
            "quantity_kg": 500.0,
            "remaining_shelf_life_hours": 36.0,
            "selling_price_per_kg": 150.0,
            "unit_cost_per_kg": 85.0,
            "origin_id": "CENTRAL",
            "handling_time_hours": 1.5,
            "handling_cost_per_kg": 2.5,
            "harvest_date": "2026-10-17",
        }

        # 1. Insert through ORM
        added = add_inventory_batch(session, test_batch)
        assert added["batch_id"] == "TEST-ORM-001"
        assert added["commodity"] == "Alphonso Mango"

        # 2. Fetch list through ORM
        all_batches = get_inventory_batches(session)
        batch_ids = [b["batch_id"] for b in all_batches]
        assert "TEST-ORM-001" in batch_ids

        # 3. Delete through ORM
        deleted = delete_inventory_batch(session, "TEST-ORM-001")
        assert deleted is True

        # Verify deletion
        refreshed_batches = get_inventory_batches(session)
        assert "TEST-ORM-001" not in [b["batch_id"] for b in refreshed_batches]
    finally:
        session.close()


def test_optimization_run_logging_in_database():
    """Validates that running /api/optimize logs an audit record to the database."""
    # Execute an optimization plan
    plan_resp = client.post("/api/optimize", json={"solver_mode": "heuristic"})
    assert plan_resp.status_code == 200

    # Retrieve audit history from database
    hist_resp = client.get("/api/db/history?limit=5")
    assert hist_resp.status_code == 200
    runs = hist_resp.json().get("runs", [])
    assert len(runs) >= 1
    latest_run = runs[0]
    assert "delivered_kg" in latest_run
    assert "net_profit_inr" in latest_run
    assert latest_run["solver_mode"] == "heuristic"


def test_database_seed_endpoint():
    """Validates that the database re-seed endpoint resets tables to snapshot and returns valid telemetry."""
    response = client.post("/api/db/seed")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "telemetry" in data
    assert data["telemetry"]["tables"]["inventory_batches"] >= 5
