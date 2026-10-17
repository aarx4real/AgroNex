# AgroNex — Intelligent Perishable Produce Distribution

**AgroNex** is an intelligent decision-support platform for agricultural logistics and perishable produce distribution. It recommends which crop batches to dispatch first, evaluates route feasibility based on transit times and handling constraints, flags unsold short-life batches for proactive discounting, and minimizes food loss through shelf-life-aware optimization.

> **Data honesty:** included inventory, demand, prices, routes, and all resulting metrics are synthetic demo data. Results are modeled estimates, not measured real-world gains or a validated production logistics plan.

## Included

- **React + TypeScript + Vite** frontend with responsive operations dashboard, inventory table/search/filter, distribution plan, scenario lab, and plan-grounded copilot.
- **FastAPI + Pydantic** backend with interactive API docs at `/docs`.
- **Explainable planner** accounting for commodity demand, batch stock, destination price, route travel time/cost, handling time/cost, route capacity, delivery windows, and estimated remaining shelf life.
- **Documented baseline** (earliest-expiry-first, feasible destinations ranked by shortest travel time) compared to a net-value-aware heuristic.
- **Discount watch** for unsold batches with limited remaining shelf life. Suggestions are not counted as sales revenue.
- **Scenario simulation** for demand changes, transport delays, and capacity changes; baseline and optimized results use the same changed inputs.
- **Optional AI explanations** via `OPENAI_API_KEY`. Without a key or if the call fails, a deterministic explanation is used. The API key stays on the backend.
- **Tests** for the planner's stock/capacity/demand/shelf-life constraints, accounting, scenarios, and API responses.
- **AgroNex logo asset** in `frontend/public/agronex-mark.png`.

## 🏛️ System Architecture

AgroNex is organized into three clean layers: a reactive frontend, an asynchronous FastAPI service layer with linear programming optimization, and a relational persistence layer managed via SQLAlchemy ORM.

```text
[ Client / Frontend ]
React 18 + TypeScript + Vite + React Router v7 + Recharts
  ├── Client-side routing (/overview, /inventory, /plan, /scenarios, /copilot, /database)
  ├── Real-time UI state management & dynamic reactive charting
  └── Live Database telemetry & audit inspection controls

          ▲
          │ REST API / JSON (HTTP)
          ▼

[ Application / API Server ]
FastAPI (Python) + Pydantic + PuLP (MILP Solver)
  ├── Strict input validation & data contracts (Pydantic v2)
  ├── Core business logic: Perishable produce shelf-life optimization & MoFPI economics
  ├── Optimization engine & scenario disruption simulation
  └── Dependency Injection & SQLAlchemy ORM session lifecycle management

          ▲
          │ SQLAlchemy 2.x ORM / Connection Pool
          ▼

[ Database & Persistence Layer ]
PostgreSQL (Production via Docker Compose) / SQLite (Zero-config embedded fallback)
  ├── Managed via SQLAlchemy ORM (Session / Declarative Base)
  ├── Tables: `inventory_batches`, `destinations`, `transport_routes`, `optimization_runs`
  ├── Automatic schema creation (`Base.metadata.create_all`) & auto-seeding
  └── Full execution audit trail logging each dispatch plan to DB
```

### Architecture Breakdown

| Layer | Technologies | Role & Key Responsibilities |
|---|---|---|
| **Frontend** | React 18, TypeScript, React Router v7, Recharts | Interactive operations interface with client-side routing, inventory management, dynamic scenario modeling, and database telemetry monitoring. |
| **Backend API** | Python, FastAPI, Pydantic | RESTful API managing solver pipelines, inventory mutations, and scenario simulations with strict input validation. |
| **Optimization Engine** | PuLP (Mixed-Integer Linear Programming) | Shelf-life-aware allocation model minimizing food loss and transportation overhead under MoFPI economic constraints. |
| **Database Layer** | PostgreSQL / SQLite, SQLAlchemy 2.x ORM | Relational models (`InventoryBatchModel`, `DestinationModel`, `TransportRouteModel`, `OptimizationRunModel`), persistent transactions, and execution history. |

## Core Capabilities & Features

| Capability / Feature | Module & Implementation |
|---|---|
| Inventory batches with commodity, quantity, remaining shelf life | `backend/db_models.py`, `backend/data/inventory.json`, Inventory view |
| Connected Relational Database & ORM | `backend/database.py`, `backend/db_models.py`, `backend/db_service.py` |
| Allocation based on demand, prices, travel time/cost, capacity | `backend/engine.py` |
| Prioritize perishable stock and reject infeasible arrival | Planner orders short-life stock first and checks arrival + handling against shelf life and delivery window |
| Explainable discount recommendations | `discount_recommendations` from the engine, Distribution plan view |
| Baseline comparison: spoilage, fulfillment, net revenue | `/api/optimize`, Overview and Distribution plan |
| Reproducible inputs and documented assumptions | JSON datasets, SQLite/PostgreSQL DB, README, tests |
| Disruption replanning & simulation | `/api/simulate`, Scenario lab |

## Run in VS Code on Windows

Requirements: **Python 3.10+** and **Node.js 20+** (npm included).

1. Extract the ZIP and open the **`AgroNex` folder** in VS Code.
2. Open **Terminal → New Terminal**. Create a Python virtual environment and install backend dependencies:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
   ```

3. Start FastAPI in this terminal:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
   ```

4. Open a **second** VS Code terminal and install/build the React app:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

5. Open **http://127.0.0.1:5173**. Keep both terminals running while developing. FastAPI docs: **http://127.0.0.1:8000/docs**.

### Single-server preview (optional)

Build React from `frontend` with `npm run build`, then run FastAPI. The API serves `frontend/dist` at **http://127.0.0.1:8000** if the build folder exists.

## Run tests

From the project root after installing backend requirements:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

## API Endpoints

- `GET /api/health` — Service health & version
- `GET /api/initial-data` — Initial inventory, destinations, transport, and data source status
- `POST /api/optimize` — Baseline vs. optimized plans (auto-logged to connected database audit table)
- `POST /api/simulate` — Disruption scenario replan
- `POST /api/inventory/quick-add` — Add new crop batch (persisted directly to database via ORM)
- `DELETE /api/inventory/{batch_id}` — Delete batch from connected database
- `GET /api/db/status` — Connected database telemetry, active ORM dialect, and live table counts
- `GET /api/db/history` — Audit trail of executed optimization runs stored in DB
- `POST /api/db/seed` — Reset and re-seed database tables via SQLAlchemy ORM
- `POST /api/explain` — Operational explanation grounded in live plan
- `GET /docs` — Interactive OpenAPI / Swagger UI docs

## Model and evaluation notes

- Planning horizon defaults to 24 hours.
- Arrival is modeled as route travel time + batch handling time; it must not exceed either remaining shelf life or destination delivery window.
- Each destination's route capacity is shared across allocations during the planning horizon; stock and remaining demand are decremented after every allocation.
- Transport cost is allocated in proportion to quantity against the route's original capacity; handling cost is per kg.
- Net value = gross sales value − allocated transport cost − handling cost. Discount suggestions are not treated as sales, and no hypothetical discounted demand is assumed.
- Unallocated stock whose remaining shelf life is within the planning horizon is modeled as spoilage; other unallocated stock is not automatically called spoiled.
- The optimizer is a deterministic heuristic, not a proof of global optimality. Compare it against the included baseline on multiple scenarios and inspect all assumptions before claiming performance gains.
- Live price feeds, real distributor integrations, and actual IoT shelf-life sensing are out of scope for the current local build.

## Repository hygiene

No secrets or API keys are committed. To use optional OpenAI explanations, set `OPENAI_API_KEY` in the **backend terminal environment** before starting the API. Optional model setting: `AGRONEX_AI_MODEL` (default `gpt-4o-mini`; legacy `FRESHROUTE_AI_MODEL` is also accepted). API usage may incur charges. If unset, the built-in explanation works without an external AI service.
