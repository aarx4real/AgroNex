from __future__ import annotations

import json
import os
import re
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

try:
    from .engine import build_plan, apply_disruption, explain_plan, plan_distribution
    from .models import (
        DisruptionRequest,
        ExplainRequest,
        CsvUploadRequest,
        DataRefreshRequest,
        ScenarioSelectRequest,
        BatchInput,
    )
    from .validation import ValidationError
    from .data_layer import data_manager
    from .scenarios import list_scenarios, get_scenario
    from .database import SessionLocal, get_engine_dialect
    from .db_service import (
        get_database_telemetry,
        log_optimization_run,
        get_optimization_history,
        init_db,
        seed_database_if_empty,
    )
except ImportError:  # supports direct uvicorn execution
    from engine import build_plan, apply_disruption, explain_plan, plan_distribution
    from models import (
        DisruptionRequest,
        ExplainRequest,
        CsvUploadRequest,
        DataRefreshRequest,
        ScenarioSelectRequest,
        BatchInput,
    )
    from validation import ValidationError
    from data_layer import data_manager
    from scenarios import list_scenarios, get_scenario
    from database import SessionLocal, get_engine_dialect
    from db_service import (
        get_database_telemetry,
        log_optimization_run,
        get_optimization_history,
        init_db,
        seed_database_if_empty,
    )

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"

app = FastAPI(
    title="AgroNex API",
    version="1.2.0",
    description="Explainable, shelf-life-aware perishable produce distribution planning engine",
)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "AgroNex", "version": "1.2.0"}


@app.get("/api/initial-data")
def initial_data():
    dataset = data_manager.get_dataset()
    status_info = data_manager.get_status()
    # sample_data flag preserved for fallback/test compatibility
    is_sample = (status_info["overall_status"] in {"cached", "stale"}) and (data_manager.inventory_provider.source == "validated_snapshot")
    return {
        "inventory": dataset["inventory"],
        "destinations": dataset["destinations"],
        "transport": dataset["transport"],
        "sample_data": is_sample,
        "currency": "INR",
        "planning_horizon_hours": 24,
        "data_source_status": status_info,
    }


@app.get("/api/data/status")
def data_status():
    return data_manager.get_status()


@app.get("/api/db/status")
def db_status():
    """Returns connected database engine dialect, ORM version, and active table statistics."""
    session = SessionLocal()
    try:
        return get_database_telemetry(session)
    finally:
        session.close()


@app.get("/api/db/history")
def db_history(limit: int = 15):
    """Returns recent optimization execution runs audited in the database."""
    session = SessionLocal()
    try:
        return {"runs": get_optimization_history(session, limit=limit)}
    finally:
        session.close()


@app.post("/api/db/seed")
def db_seed():
    """Resets and re-seeds the connected database from initial verified records."""
    data_manager.reset_to_snapshot()
    session = SessionLocal()
    try:
        telemetry = get_database_telemetry(session)
        return {
            "status": "success",
            "message": "Database successfully re-seeded via SQLAlchemy ORM.",
            "telemetry": telemetry,
        }
    finally:
        session.close()


@app.post("/api/data/upload")
def upload_csv(request: CsvUploadRequest):
    try:
        if request.entity == "inventory":
            data_manager.inventory_provider.upload_csv(request.csv_content)
        elif request.entity == "destinations":
            data_manager.price_provider.upload_csv(request.csv_content)
        elif request.entity == "transport":
            data_manager.route_provider.upload_csv(request.csv_content)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported entity '{request.entity}'")

        dataset = data_manager.get_dataset()
        status_info = data_manager.get_status()
        return {
            "status": "success",
            "message": f"Successfully updated {request.entity} from uploaded CSV.",
            "data_source_status": status_info,
            "data": dataset,
        }
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"CSV Validation Error: {exc.message}") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to process CSV: {exc}") from exc


@app.post("/api/data/refresh-prices")
def refresh_prices(request: DataRefreshRequest = DataRefreshRequest()):
    dests = data_manager.price_provider.refresh_market_prices(simulate_failure=request.simulate_failure)
    return {
        "status": "stale" if data_manager.price_provider.status == "stale" else "refreshed",
        "provider_status": data_manager.price_provider.get_status_info(),
        "destinations": dests,
    }


@app.post("/api/data/refresh-routes")
def refresh_routes(request: DataRefreshRequest = DataRefreshRequest()):
    routes = data_manager.route_provider.refresh_traffic_conditions(simulate_failure=request.simulate_failure)
    return {
        "status": "stale" if data_manager.route_provider.status == "stale" else "refreshed",
        "provider_status": data_manager.route_provider.get_status_info(),
        "transport": routes,
    }


@app.post("/api/data/reset")
def reset_data():
    data_manager.reset_to_snapshot()
    return {
        "status": "reset",
        "message": "Reset to validated fallback snapshot.",
        "data_source_status": data_manager.get_status(),
        "data": data_manager.get_dataset(),
    }


@app.get("/api/data/template/{entity}")
def get_template(entity: str):
    try:
        csv_text = data_manager.generate_template_csv(entity)
        return PlainTextResponse(
            content=csv_text,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="agronex_{entity}_template.csv"'},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/scenarios")
def get_scenarios_list():
    return {"scenarios": list_scenarios()}


@app.post("/api/scenarios/run")
def run_named_scenario(request: ScenarioSelectRequest):
    try:
        scen = get_scenario(request.scenario_id)
        current = data_manager.get_dataset()
        destinations, transport = apply_disruption(
            current["destinations"], current["transport"], scen["disruption"]
        )
        plan = build_plan(current["inventory"], destinations, transport, solver_mode=request.solver_mode)
        plan["scenario"] = scen["disruption"]
        plan["scenario_id"] = scen["id"]
        plan["scenario_name"] = scen["name"]
        plan["scenario_label"] = scen["name"]
        plan["scenario_description"] = scen["description"]
        plan["scenario_assumptions"] = scen["assumptions"]
        return plan
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"Validation failed: {exc.message}") from exc


@app.post("/api/optimize")
@app.post("/api/plan")
def optimize(payload: dict | None = None):
    try:
        data = data_manager.get_dataset()
        solver_mode = "heuristic"
        if payload:
            solver_mode = payload.get("solver_mode", "heuristic")
            for key in ("inventory", "destinations", "transport"):
                if key in payload:
                    if not isinstance(payload[key], list):
                        raise HTTPException(status_code=422, detail=f"{key} must be a list")
                    data[key] = payload[key]
        plan = build_plan(data["inventory"], data["destinations"], data["transport"], solver_mode=solver_mode)
        # Audit log optimization run into connected database via SQLAlchemy ORM
        try:
            session = SessionLocal()
            try:
                log_optimization_run(session, plan.get("optimized", plan), solver_mode=solver_mode)
            finally:
                session.close()
        except Exception:
            pass  # Non-blocking telemetry
        return plan
    except HTTPException:
        raise
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid planning data: {exc.message}") from exc
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid planning data: {exc}") from exc


@app.post("/api/simulate")
def simulate(request: DisruptionRequest):
    try:
        data = data_manager.get_dataset()
        destinations, transport = apply_disruption(
            data["destinations"], data["transport"], request.model_dump()
        )
        result = build_plan(data["inventory"], destinations, transport, solver_mode=request.solver_mode)
        result["scenario"] = request.model_dump()
        result["scenario_label"] = "Disruption scenario"
        result["scenario_assumptions"] = [
            f"Demand adjusted by {request.demand_change_percent:+g}%",
            f"Transit delay of +{request.travel_delay_hours:g}h on all corridors",
            f"Transport capacity adjusted by {request.capacity_change_percent:+g}%",
            "Hard shelf-life and delivery window deadlines enforced strictly",
            f"Solver mode: {request.solver_mode.upper()}",
        ]
        return result
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"Simulation data validation error: {exc.message}") from exc


def _call_local_qwen(question: str, plan: dict) -> str | None:
    """Invokes local Ollama instance running Qwen (e.g. qwen3:8b) on NVIDIA GPU."""
    ollama_url = os.getenv("AGRONEX_OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
    ollama_model = os.getenv("AGRONEX_OLLAMA_MODEL", "qwen3:8b")

    metrics = plan.get("metrics", {})
    quarantined = plan.get("quarantined_waste", [])
    allocations = plan.get("allocations", [])

    summary_context = {
        "strategy": plan.get("strategy"),
        "solver_used": plan.get("solver_used", "HEURISTIC"),
        "delivered_kg": metrics.get("delivered_kg", 0),
        "spoiled_kg": metrics.get("spoiled_kg", 0),
        "immediate_spoilage_kg": metrics.get("immediate_spoilage_kg", 0),
        "net_revenue_inr": metrics.get("net_revenue", 0),
        "net_profit_inr": metrics.get("net_profit", 0),
        "procurement_cogs_inr": metrics.get("procurement_cost", 0),
        "spoilage_penalties_inr": metrics.get("spoilage_penalties", 0),
        "demand_fulfillment_percent": metrics.get("demand_fulfillment_percent", 0),
        "quarantined_batches_count": len(quarantined),
        "top_allocations": [
            {"batch": a.get("batch_id"), "commodity": a.get("commodity"), "dest": a.get("destination_id"), "kg": a.get("allocated_kg")}
            for a in allocations[:8]
        ],
        "quarantined_samples": [
            {"batch": q.get("batch_id"), "commodity": q.get("commodity"), "kg": q.get("quantity_kg"), "reason": q.get("reason")}
            for q in quarantined[:5]
        ],
    }

    system_prompt = (
        "You are the AgroNex AI Perishable Logistics Copilot, an elite operations expert in agricultural supply chains, "
        "cold-chain logistics, and post-harvest loss minimization. "
        "You have direct access to the live distribution plan computed by the AgroNex engine. "
        "Answer immediately, directly, and concisely. Do NOT output internal thinking, reasoning tokens, or <think> tags. "
        "Key concepts: "
        "- Produce with shelf life <= handling buffer (e.g. 0h) is immediately quarantined to compost/bio-gas (not delivered) to prevent food safety risks and transit rot. "
        "- Net Economic Profit = Delivered Revenue - Transport Costs - Handling Costs - Procurement COGS - Spoilage Penalties. "
        "- When relevant, cite the provided metrics numbers and batches. "
        "Keep your answer crisp, structured, and under 3 paragraphs."
    )

    payload = {
        "model": ollama_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"/no_think\nUser Question: {question}\n\n"
                    f"Operational Plan Data:\n{json.dumps(summary_context, indent=2)}"
                ),
            },
        ],
        "stream": False,
        "options": {
            "temperature": 0.2,
            "top_p": 0.9,
            "num_predict": 450,
        },
    }

    req = Request(
        ollama_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=35) as response:
            result = json.loads(response.read().decode("utf-8"))
        raw_text = result.get("message", {}).get("content", "")
        # Strip thinking tags from Qwen
        cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text).strip()
        return cleaned or None
    except Exception:
        return None


def _call_optional_ai(question: str, plan: dict) -> str | None:
    """Optional OpenAI Responses API call. Falls back cleanly when no key/network."""
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    payload = {
        "model": os.getenv("AGRONEX_AI_MODEL", os.getenv("FRESHROUTE_AI_MODEL", "gpt-4o-mini")),
        "instructions": (
            "You explain a perishable produce distribution plan for AgroNex. Use only the supplied plan data. "
            "Do not invent facts, metrics, market prices, or constraints. Clearly say when data is absent. "
            "Provide concise, operationally grounded answers explaining allocations, constraints, and discount suggestions."
        ),
        "input": "User question: " + question + "\nPlan data: " + json.dumps(plan, ensure_ascii=False)[:18000],
    }
    req = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=12) as response:
            result = json.loads(response.read().decode("utf-8"))
        chunks = []
        for item in result.get("output", []):
            for content in item.get("content", []):
                if content.get("type") == "output_text" and content.get("text"):
                    chunks.append(content["text"])
        return "\n".join(chunks).strip() or None
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return None


@app.get("/api/ai/status")
def ai_status():
    ollama_url = os.getenv("AGRONEX_OLLAMA_TAGS_URL", "http://127.0.0.1:11434/api/tags")
    ollama_model = os.getenv("AGRONEX_OLLAMA_MODEL", "qwen3:8b")
    ollama_online = False
    available_models = []

    try:
        req = Request(ollama_url, headers={"Content-Type": "application/json"})
        with urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for m in data.get("models", []):
                available_models.append(m.get("name", ""))
            ollama_online = True
    except Exception:
        ollama_online = False

    has_openai = bool(os.getenv("OPENAI_API_KEY", "").strip())
    provider = "Local Qwen LLM (Ollama)" if ollama_online else ("OpenAI API" if has_openai else "Deterministic Engine")

    return {
        "status": "online" if (ollama_online or has_openai) else "offline",
        "provider": provider,
        "local_ollama": ollama_online,
        "active_model": ollama_model if ollama_online else (os.getenv("AGRONEX_AI_MODEL", "gpt-4o-mini") if has_openai else "Rule-based"),
        "available_models": available_models,
        "acceleration": "Local NVIDIA RTX GPU (Zero-latency)" if ollama_online else "Cloud API / CPU",
    }


@app.post("/api/inventory/quick-add")
def quick_add_batch(batch: BatchInput):
    try:
        updated = data_manager.add_batch(batch.model_dump())
        return {
            "status": "success",
            "message": f"Successfully added batch {batch.batch_id} ({batch.commodity}).",
            "inventory": updated,
            "data_source_status": data_manager.get_status(),
        }
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"Validation failed: {exc.message}") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not add batch: {exc}") from exc


@app.delete("/api/inventory/{batch_id}")
def delete_batch(batch_id: str):
    try:
        updated = data_manager.delete_batch(batch_id)
        return {
            "status": "success",
            "message": f"Successfully removed batch {batch_id}.",
            "inventory": updated,
            "data_source_status": data_manager.get_status(),
        }
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not delete batch: {exc}") from exc


@app.post("/api/explain")
def explain(request: ExplainRequest):
    data = request.plan
    if not data:
        data_set = data_manager.get_dataset()
        result = build_plan(data_set["inventory"], data_set["destinations"], data_set["transport"])
        data = result["optimized"]

    # 1. Try Local Qwen LLM on GPU first
    local_answer = _call_local_qwen(request.question, data)
    if local_answer:
        return {
            "answer": local_answer,
            "question": request.question,
            "source": "verified plan data",
            "mode": f"Local Qwen LLM ({os.getenv('AGRONEX_OLLAMA_MODEL', 'qwen3:8b')})",
            "disclaimer": "Grounded locally on NVIDIA GPU against operational and shelf-life constraints.",
        }

    # 2. Try Optional OpenAI API
    ai_answer = _call_optional_ai(request.question, data)
    if ai_answer:
        return {
            "answer": ai_answer,
            "question": request.question,
            "source": "verified plan data",
            "mode": "AI-assisted (Cloud)",
            "disclaimer": "Grounding verified against operational constraints.",
        }

    # 3. Fallback to deterministic rule-based explain engine
    fallback = explain_plan(data, request.question)
    fallback["mode"] = "built-in explanation (AI API not configured or unavailable)"
    return fallback


# Serve the production React build when present. During development, Vite serves
# the React app on port 5173 and proxies /api requests to this FastAPI service.
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
