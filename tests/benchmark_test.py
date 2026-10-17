"""AgroNex Technical Benchmark & Automated Stress Test.

Evaluates perishable supply chain logistics performance:
- Spoilage reduction vs Baseline
- Demand fulfillment %
- Grounded Net Economic Profit (Revenue - Transport - Handling - COGS - Spoilage Penalties)
- Physical & Operational Constraints Satisfaction
- Heuristic vs Exact PuLP MILP Solver Comparison
- Edge-Case Stress Testing
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

# Ensure root directory is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.engine import build_plan, plan_distribution, apply_disruption, calculate_discount_recommendation
from backend.scenarios import REALISTIC_SCENARIOS


def load_dataset() -> dict:
    data_dir = Path(__file__).resolve().parent.parent / "backend" / "data"
    with open(data_dir / "inventory.json", encoding="utf-8") as f:
        inventory = json.load(f)
    with open(data_dir / "destinations.json", encoding="utf-8") as f:
        destinations = json.load(f)
    with open(data_dir / "transport.json", encoding="utf-8") as f:
        transport = json.load(f)
    return {"inventory": inventory, "destinations": destinations, "transport": transport}


def check_physical_constraints(plan: dict, inventory: list[dict], destinations: list[dict], transport: list[dict]) -> int:
    """Verifies that all physical constraints hold with 0 violations."""
    violations = 0
    batch_map = {b["batch_id"]: b for b in inventory}
    dest_map = {d["destination_id"]: d for d in destinations}
    route_map = {(r["origin_id"], r["destination_id"]): r for r in transport}

    dispatched_by_batch: dict[str, float] = {}
    dispatched_by_dest_comm: dict[tuple[str, str], float] = {}
    dispatched_by_route: dict[tuple[str, str], float] = {}

    for a in plan.get("allocations", []):
        b = batch_map[a["batch_id"]]
        d = dest_map[a["destination_id"]]
        r = route_map.get((b["origin_id"], d["destination_id"]))

        if not r:
            violations += 1
            continue

        # 1. Arrival feasibility
        arrival = a["arrival_time_hours"]
        if arrival > b["remaining_shelf_life_hours"] + 1e-4:
            violations += 1
        if arrival > d["delivery_window_hours"] + 1e-4:
            violations += 1

        # Accumulate
        b_id = a["batch_id"]
        dispatched_by_batch[b_id] = dispatched_by_batch.get(b_id, 0.0) + a["quantity_kg"]

        dest_comm = (a["destination_id"], a["commodity"])
        dispatched_by_dest_comm[dest_comm] = dispatched_by_dest_comm.get(dest_comm, 0.0) + a["quantity_kg"]

        route_key = (b["origin_id"], a["destination_id"])
        dispatched_by_route[route_key] = dispatched_by_route.get(route_key, 0.0) + a["quantity_kg"]

    # 2. Batch stock conservation
    for b_id, disp in dispatched_by_batch.items():
        if disp > batch_map[b_id]["quantity_kg"] + 1e-4:
            violations += 1

    # 3. Demand conservation
    for (d_id, comm), disp in dispatched_by_dest_comm.items():
        dem = dest_map[d_id]["demand_by_commodity"].get(comm, 0.0)
        if disp > dem + 1e-4:
            violations += 1

    # 4. Route capacity
    for (orig, dest_id), disp in dispatched_by_route.items():
        cap = route_map[(orig, dest_id)]["capacity_kg"]
        if disp > cap + 1e-4:
            violations += 1

    return violations


def run_benchmarks():
    print("=" * 115)
    print(" AgroNex: Technical Benchmark & Automated Stress Test")
    print("=" * 115)
    data = load_dataset()

    header = f"{'Scenario':<26} | {'Mode':<9} | {'Baseline (Rs)':<13} | {'AgroNex (Rs)':<15} | {'Profit Delta':<12} | {'Spoil Red':<10} | {'Fulfill %':<9} | {'Violations'}"
    print(header)
    print("-" * 115)

    results = []

    for scen_id, scen in REALISTIC_SCENARIOS.items():
        scen_name = scen["name"][:25]
        dests, routes = apply_disruption(data["destinations"], data["transport"], scen["disruption"])

        for mode in ["heuristic", "milp"]:
            res = build_plan(data["inventory"], dests, routes, solver_mode=mode)
            base_m = res["baseline"]["metrics"]
            opt_m = res["optimized"]["metrics"]
            imp = res["improvement_summary"]

            base_profit = base_m.get("net_profit", base_m["net_revenue"])
            opt_profit = opt_m.get("net_profit", opt_m["net_revenue"])
            profit_delta = imp.get("net_profit_change_amount", imp["net_revenue_change_amount"])
            spoil_delta = f"{imp['spoilage_reduction_kg']:+g} kg"
            fulfill_pct = f"{opt_m['demand_fulfillment_percent']:.1f}%"

            violations = check_physical_constraints(res["optimized"], data["inventory"], dests, routes)

            row = (
                f"{scen_name:<26} | {mode.upper():<9} | {base_profit:>13,.0f} | {opt_profit:>15,.0f} | "
                f"{profit_delta:>+12,.0f} | {spoil_delta:>10} | {fulfill_pct:>9} | {violations:>10}"
            )
            print(row)
            results.append({
                "scenario": scen_id,
                "mode": mode,
                "base_profit": base_profit,
                "opt_profit": opt_profit,
                "profit_delta": profit_delta,
                "violations": violations,
            })

    print("-" * 115)
    print()

    # Explicit Stress Tests
    print("=" * 115)
    print(" Running Explicit Edge-Case Stress Tests")
    print("=" * 115)

    # 1. Pre-expired batch quarantine
    test_inventory = [
        {
            "batch_id": "EXPIRED_TEST_01",
            "commodity": "Tomato",
            "quantity_kg": 250.0,
            "remaining_shelf_life_hours": 0.5,
            "origin_id": "CENTRAL",
            "selling_price_per_kg": 40.0,
            "handling_time_hours": 1.0,
            "handling_cost_per_kg": 1.5,
        }
    ]
    res_expired = plan_distribution(test_inventory, data["destinations"], data["transport"])
    quarantined = res_expired.get("quarantined_waste", [])
    assert len(quarantined) == 1, "Failed: Expired batch was not quarantined"
    assert quarantined[0]["status"] == "IMMEDIATE_COMPOST_WASTE", "Failed: Status is not IMMEDIATE_COMPOST_WASTE"
    assert res_expired["metrics"]["immediate_spoilage_kg"] == 250.0, "Failed: immediate_spoilage_kg mismatch"
    assert len(res_expired["allocations"]) == 0, "Failed: Expired batch was allocated to route"
    print(" [PASS] Stress Test 1: Pre-expired batch (shelf_life <= handling_time) -> Quarantined as IMMEDIATE_COMPOST_WASTE")

    # 2. Handling-buffer gated discount
    rec_unviable = calculate_discount_recommendation(
        {"batch_id": "B_UNVIABLE", "commodity": "Tomato", "remaining_shelf_life_hours": 0.5, "handling_time_hours": 1.0, "selling_price_per_kg": 50.0},
        100.0,
        "Test reason"
    )
    assert rec_unviable is not None
    assert rec_unviable["status"] == "UNVIABLE_FOR_DISCOUNT_COMPOST_ONLY"
    assert rec_unviable["type"] == "compost_diversion"
    assert rec_unviable["suggested_price_per_kg"] == 0.0
    assert rec_unviable["discount_percent"] == 0.0
    print(" [PASS] Stress Test 2: Handling-buffer gated discount -> Diverted to organic compost (0% discount, Rs 0 revenue)")

    # 3. Route Delay (+50%)
    routes_delayed = [dict(r, travel_time_hours=r["travel_time_hours"] * 1.5) for r in data["transport"]]
    plan_delayed = build_plan(data["inventory"], data["destinations"], routes_delayed, solver_mode="milp")
    viol_delayed = check_physical_constraints(plan_delayed["optimized"], data["inventory"], data["destinations"], routes_delayed)
    assert viol_delayed == 0, f"Failed: Severe delay created {viol_delayed} constraint violations"
    print(" [PASS] Stress Test 3: Route Delay (+50%) -> Strictly 0 constraint or shelf-life violations")

    # 4. Extreme Oversupply
    oversupply_inv = [dict(b, quantity_kg=b["quantity_kg"] * 10) for b in data["inventory"]]
    plan_oversupply = build_plan(oversupply_inv, data["destinations"], data["transport"], solver_mode="milp")
    viol_oversupply = check_physical_constraints(plan_oversupply["optimized"], oversupply_inv, data["destinations"], data["transport"])
    assert viol_oversupply == 0, f"Failed: Oversupply created {viol_oversupply} constraint violations"
    print(" [PASS] Stress Test 4: Extreme Oversupply -> Vehicle route and customer demand capacities strictly enforced")

    # 5. Solver Parity Check (MILP profit >= Heuristic profit on standard instances)
    for scen_id in REALISTIC_SCENARIOS:
        h_res = [r for r in results if r["scenario"] == scen_id and r["mode"] == "heuristic"][0]
        m_res = [r for r in results if r["scenario"] == scen_id and r["mode"] == "milp"][0]
        assert m_res["opt_profit"] >= h_res["opt_profit"] - 0.5, (
            f"Failed: MILP profit ({m_res['opt_profit']}) < Heuristic profit ({h_res['opt_profit']}) for {scen_id}"
        )
    print(" [PASS] Stress Test 5: Solver Parity -> Exact MILP global net profit >= Heuristic profit across all instances")

    print()
    print("=" * 115)
    print(" ALL BENCHMARKS & STRESS TESTS PASSED WITH 100% SUCCESS")
    print("=" * 115)


if __name__ == "__main__":
    run_benchmarks()
