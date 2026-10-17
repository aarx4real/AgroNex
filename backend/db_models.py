"""SQLAlchemy ORM models for AgroNex.

Maps entities directly to connected relational database tables:
- `inventory_batches`: Perishable crop batches, shelf life, acquisition COGS, handling fees.
- `destinations`: Demand centers, markets, dynamic mandi prices, and delivery windows.
- `transport_routes`: Logistics corridors, transit durations, capacity limits, and shipping rates.
- `optimization_runs`: Audit trail of executed distribution optimization plans and financial P&L.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Column,
    String,
    Float,
    Integer,
    Text,
    DateTime,
    Boolean,
)

from .database import Base


def _utc_now():
    return datetime.now(timezone.utc)


class InventoryBatchModel(Base):
    __tablename__ = "inventory_batches"

    batch_id = Column(String(64), primary_key=True, index=True)
    commodity = Column(String(100), nullable=False, index=True)
    quantity_kg = Column(Float, nullable=False)
    remaining_shelf_life_hours = Column(Float, nullable=False)
    selling_price_per_kg = Column(Float, nullable=False)
    unit_cost_per_kg = Column(Float, default=0.0, nullable=False)
    origin_id = Column(String(64), default="CENTRAL", nullable=False, index=True)
    handling_time_hours = Column(Float, default=0.0, nullable=False)
    handling_cost_per_kg = Column(Float, default=0.0, nullable=False)
    harvest_date = Column(String(50), nullable=True)
    spoilage_threshold = Column(Float, default=0.0, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utc_now, nullable=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "batch_id": self.batch_id,
            "commodity": self.commodity,
            "quantity_kg": float(self.quantity_kg),
            "remaining_shelf_life_hours": float(self.remaining_shelf_life_hours),
            "selling_price_per_kg": float(self.selling_price_per_kg),
            "unit_cost_per_kg": float(self.unit_cost_per_kg or 0.0),
            "origin_id": self.origin_id,
            "handling_time_hours": float(self.handling_time_hours or 0.0),
            "handling_cost_per_kg": float(self.handling_cost_per_kg or 0.0),
            "harvest_date": self.harvest_date,
            "spoilage_threshold": float(self.spoilage_threshold or 0.0),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> InventoryBatchModel:
        return cls(
            batch_id=str(data["batch_id"]).strip(),
            commodity=str(data["commodity"]).strip(),
            quantity_kg=float(data["quantity_kg"]),
            remaining_shelf_life_hours=float(data["remaining_shelf_life_hours"]),
            selling_price_per_kg=float(data["selling_price_per_kg"]),
            unit_cost_per_kg=float(data.get("unit_cost_per_kg") or 0.0),
            origin_id=str(data.get("origin_id", "CENTRAL")).strip(),
            handling_time_hours=float(data.get("handling_time_hours") or 0.0),
            handling_cost_per_kg=float(data.get("handling_cost_per_kg") or 0.0),
            harvest_date=data.get("harvest_date"),
            spoilage_threshold=float(data.get("spoilage_threshold") or 0.0),
        )


class DestinationModel(Base):
    __tablename__ = "destinations"

    destination_id = Column(String(64), primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    delivery_window_hours = Column(Float, nullable=False)
    demand_by_commodity_json = Column(Text, nullable=False, default="{}")
    price_by_commodity_json = Column(Text, nullable=False, default="{}")
    updated_at = Column(DateTime(timezone=True), default=_utc_now, onupdate=_utc_now, nullable=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "destination_id": self.destination_id,
            "name": self.name,
            "delivery_window_hours": float(self.delivery_window_hours),
            "demand_by_commodity": json.loads(self.demand_by_commodity_json or "{}"),
            "price_by_commodity": json.loads(self.price_by_commodity_json or "{}"),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DestinationModel:
        demand = data.get("demand_by_commodity", {})
        price = data.get("price_by_commodity", {})
        return cls(
            destination_id=str(data["destination_id"]).strip(),
            name=str(data.get("name", data["destination_id"])).strip(),
            delivery_window_hours=float(data.get("delivery_window_hours", 24.0)),
            demand_by_commodity_json=json.dumps(demand),
            price_by_commodity_json=json.dumps(price),
        )


class TransportRouteModel(Base):
    __tablename__ = "transport_routes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    origin_id = Column(String(64), nullable=False, index=True)
    destination_id = Column(String(64), nullable=False, index=True)
    travel_time_hours = Column(Float, nullable=False)
    transport_cost = Column(Float, nullable=False)
    capacity_kg = Column(Float, nullable=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "origin_id": self.origin_id,
            "destination_id": self.destination_id,
            "travel_time_hours": float(self.travel_time_hours),
            "transport_cost": float(self.transport_cost),
            "capacity_kg": float(self.capacity_kg),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TransportRouteModel:
        return cls(
            origin_id=str(data["origin_id"]).strip(),
            destination_id=str(data["destination_id"]).strip(),
            travel_time_hours=float(data["travel_time_hours"]),
            transport_cost=float(data["transport_cost"]),
            capacity_kg=float(data["capacity_kg"]),
        )


class OptimizationRunModel(Base):
    __tablename__ = "optimization_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), default=_utc_now, nullable=False, index=True)
    solver_mode = Column(String(32), default="heuristic", nullable=False)
    delivered_kg = Column(Float, default=0.0, nullable=False)
    spoiled_kg = Column(Float, default=0.0, nullable=False)
    net_revenue_inr = Column(Float, default=0.0, nullable=False)
    net_profit_inr = Column(Float, default=0.0, nullable=False)
    procurement_cogs_inr = Column(Float, default=0.0, nullable=False)
    transport_cost_inr = Column(Float, default=0.0, nullable=False)
    handling_cost_inr = Column(Float, default=0.0, nullable=False)
    spoilage_penalties_inr = Column(Float, default=0.0, nullable=False)
    demand_fulfillment_percent = Column(Float, default=0.0, nullable=False)
    allocations_count = Column(Integer, default=0, nullable=False)
    quarantined_count = Column(Integer, default=0, nullable=False)
    summary_json = Column(Text, default="{}", nullable=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "solver_mode": self.solver_mode,
            "delivered_kg": float(self.delivered_kg),
            "spoiled_kg": float(self.spoiled_kg),
            "net_revenue_inr": float(self.net_revenue_inr),
            "net_profit_inr": float(self.net_profit_inr),
            "procurement_cogs_inr": float(self.procurement_cogs_inr),
            "transport_cost_inr": float(self.transport_cost_inr),
            "handling_cost_inr": float(self.handling_cost_inr),
            "spoilage_penalties_inr": float(self.spoilage_penalties_inr),
            "demand_fulfillment_percent": float(self.demand_fulfillment_percent),
            "allocations_count": self.allocations_count,
            "quarantined_count": self.quarantined_count,
            "summary": json.loads(self.summary_json or "{}"),
        }
