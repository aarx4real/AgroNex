import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Bell, Boxes,
  Check, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, CircleHelp, Clock3, CloudFog, CloudRain, Cpu, Database, Download, EyeOff, FileUp, Info, Leaf, MapPin,
  Menu, Package, Play, Plus, RefreshCw, Route, Search, Send, Settings, ShieldCheck, Sliders, Sparkles,
  Sprout, Sun, Trash2, TrendingUp, Truck, Upload, User, Warehouse, X, Zap
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AtmosphereCanvas, WeatherMode } from './components/AtmosphereCanvas';

type Batch = {
  batch_id: string;
  commodity: string;
  quantity_kg: number;
  remaining_shelf_life_hours: number;
  selling_price_per_kg: number;
  origin_id: string;
  handling_time_hours: number;
  handling_cost_per_kg: number;
  unit_cost_per_kg?: number;
  harvest_date?: string;
  spoilage_threshold?: number;
  temperature_celsius?: number;
};

type Destination = {
  destination_id: string;
  name: string;
  demand_by_commodity: Record<string, number>;
  price_by_commodity: Record<string, number>;
  delivery_window_hours: number;
};

type RouteData = {
  origin_id: string;
  destination_id: string;
  travel_time_hours: number;
  transport_cost: number;
  capacity_kg: number;
};

type DiscountRecommendation = {
  batch_id: string;
  commodity: string;
  quantity_kg: number;
  remaining_shelf_life_hours: number;
  original_price_per_kg: number;
  suggested_price_per_kg: number;
  discount_percent: number;
  urgency_tier: string;
  potential_discounted_revenue: number;
  type: string;
  is_confirmed_sale: boolean;
  status: string;
  action?: string;
  reason: string;
};

type QuarantinedWaste = {
  batch_id: string;
  commodity: string;
  quantity_kg: number;
  status: string;
  remaining_shelf_life_hours?: number;
  handling_time_hours?: number;
  action?: string;
  reason: string;
};

type PlanMetrics = {
  initial_stock_kg: number;
  stock_used_kg: number;
  delivered_kg: number;
  unallocated_kg: number;
  expired_stock_kg: number;
  spoiled_kg: number;
  immediate_spoilage_kg?: number;
  fresh_surplus_kg: number;
  initial_demand_kg: number;
  unmet_demand_kg: number;
  initial_capacity_kg: number;
  unused_capacity_kg: number;
  demand_fulfillment_percent: number;
  spoilage_rate_percent: number;
  capacity_utilization_percent: number;
  gross_revenue: number;
  transport_cost: number;
  handling_cost: number;
  procurement_cost: number;
  spoilage_penalties: number;
  discount_cost?: number;
  net_revenue: number;
  net_profit: number;
  potential_discount_revenue: number;
  constraint_violations: number;
};

type Plan = {
  strategy: string;
  strategy_description?: string;
  allocations: any[];
  discount_recommendations: DiscountRecommendation[];
  quarantined_waste?: QuarantinedWaste[];
  immediate_spoilage_kg?: number;
  metrics: PlanMetrics;
  assumptions: string[];
  solver_used?: string;
};

type ImprovementSummary = {
  spoilage_reduction_kg: number;
  spoilage_reduction_percent: number;
  demand_fulfillment_change_kg: number;
  demand_fulfillment_change_percent: number;
  fulfillment_change_percentage_points: number;
  delivered_change_kg: number;
  net_revenue_change_amount: number;
  net_revenue_change_percent: number;
  net_profit_change_amount?: number;
  net_profit_change_percent?: number;
  transport_cost_change_amount: number;
  transport_cost_change_percent: number;
  handling_cost_change_amount: number;
  handling_cost_change_percent: number;
  procurement_cost_change_amount?: number;
  spoilage_penalties_change_amount?: number;
  spoilage_penalties_change_percent?: number;
  unmet_demand_reduction_kg: number;
  unused_capacity_reduction_kg: number;
};

type PlanResponse = {
  baseline: Plan;
  optimized: Plan;
  improvement_summary: ImprovementSummary;
  quarantined_waste?: QuarantinedWaste[];
  immediate_spoilage_kg?: number;
  solver_mode?: string;
  solver_used?: string;
  scenario?: any;
  scenario_id?: string;
  scenario_name?: string;
  scenario_description?: string;
  scenario_assumptions?: string[];
};

type DataSourceStatus = {
  overall_status: 'live' | 'uploaded' | 'cached' | 'stale';
  last_updated: string;
  organization: string;
  workspace: string;
  providers: {
    inventory: { name: string; status: string; source: string; last_updated: string };
    prices: { name: string; status: string; source: string; last_updated: string };
    routes: { name: string; status: string; source: string; last_updated: string };
  };
};

type ScenarioItem = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  disruption: { demand_change_percent: number; travel_delay_hours: number; capacity_change_percent: number };
  assumptions: string[];
};

type Data = {
  inventory: Batch[];
  destinations: Destination[];
  transport: RouteData[];
  data_source_status?: DataSourceStatus;
  currency: string;
};

const API = (import.meta as any).env?.VITE_API_BASE_URL || '';
const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
const fmt = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n || 0);

function formatTimeAgo(isoString?: string) {
  if (!isoString) return 'Just now';
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h ago`;
  } catch {
    return 'Recent';
  }
}

function App() {
  const [data, setData] = useState<Data | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [dataStatus, setDataStatus] = useState<DataSourceStatus | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Database Telemetry & Audit History State
  const [dbTelemetry, setDbTelemetry] = useState<any>(null);
  const [dbHistory, setDbHistory] = useState<any[]>([]);

  // Bidirectional Client Routing Maps
  const ROUTE_PAGE_MAP: Record<string, string> = useMemo(() => ({
    '/': 'Overview',
    '/overview': 'Overview',
    '/inventory': 'Inventory',
    '/plan': 'Distribution plan',
    '/scenarios': 'Scenario lab',
    '/copilot': 'AI copilot',
    '/database': 'Database & Audit',
    '/audit': 'Database & Audit',
  }), []);

  const PAGE_ROUTE_MAP: Record<string, string> = useMemo(() => ({
    'Overview': '/',
    'Inventory': '/inventory',
    'Distribution plan': '/plan',
    'Scenario lab': '/scenarios',
    'AI copilot': '/copilot',
    'Database & Audit': '/database',
  }), []);

  const [page, setPage] = useState<string>(() => {
    return ROUTE_PAGE_MAP[window.location.pathname.toLowerCase()] || 'Overview';
  });

  // Sync state with browser location on URL changes
  useEffect(() => {
    const matched = ROUTE_PAGE_MAP[location.pathname.toLowerCase()];
    if (matched && matched !== page) {
      setPage(matched);
    }
  }, [location.pathname, ROUTE_PAGE_MAP]);

  const handleNavClick = (label: string) => {
    setPage(label);
    setMobileNav(false);
    const targetRoute = PAGE_ROUTE_MAP[label] || '/';
    if (location.pathname !== targetRoute) {
      navigate(targetRoute);
    }
  };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All batches');
  const [demand, setDemand] = useState(0);
  const [delay, setDelay] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const [scenario, setScenario] = useState<PlanResponse | null>(null);
  const [scenariosList, setScenariosList] = useState<ScenarioItem[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('corridor_bottleneck');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState('');
  const [solverMode, setSolverMode] = useState<'heuristic' | 'milp'>('heuristic');
  const [quarantineExpanded, setQuarantineExpanded] = useState<boolean>(true);

  // Atmospheric Environmental Mode ('storm' | 'mist' | 'sun' | 'cyber' | 'off')
  const [weatherMode, setWeatherMode] = useState<WeatherMode>(() => {
    return (localStorage.getItem('agronex_weather_mode') as WeatherMode) || 'storm';
  });

  const handleWeatherChange = (mode: WeatherMode) => {
    setWeatherMode(mode);
    localStorage.setItem('agronex_weather_mode', mode);
    notify(`Atmospheric FX: ${mode.toUpperCase()} environment active`);
  };

  // Subtle interactive 3D perspective parallax for cinematic background
  const [mouseParallax, setMouseParallax] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let frameId: number;
    const handleMove = (e: MouseEvent) => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const xOffset = ((e.clientX / window.innerWidth) - 0.5) * 14;
        const yOffset = ((e.clientY / window.innerHeight) - 0.5) * 14;
        setMouseParallax({ x: xOffset, y: yOffset });
      });
    };
    window.addEventListener('mousemove', handleMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMove);
      cancelAnimationFrame(frameId);
    };
  }, []);

  // Profile, Notifications & Workspace state
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationsRead, setNotificationsRead] = useState(false);
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState('Central Distribution Center (CDC-North)');
  const [showAddBatchModal, setShowAddBatchModal] = useState(false);
  const [showGuideBanner, setShowGuideBanner] = useState(true);

  // Local AI Qwen & Chat state
  const [aiStatus, setAiStatus] = useState<any>(null);
  const [chatHistory, setChatHistory] = useState<Array<{ sender: 'user' | 'assistant'; text: string; mode?: string }>>([
    {
      sender: 'assistant',
      text: 'Hello! I am your AgroNex AI Logistics Copilot running locally via Qwen on your NVIDIA GPU. I analyze real-time inventory, shelf-life constraints, transport corridors, and P&L economics. How can I assist your dispatch decisions today?',
      mode: 'Local Qwen LLM'
    }
  ]);

  // Quick Add Batch Form State
  const [newBatch, setNewBatch] = useState({
    commodity: 'Tomatoes',
    quantity_kg: 500,
    remaining_shelf_life_hours: 24,
    selling_price_per_kg: 45,
    unit_cost_per_kg: 28,
    handling_time_hours: 1.0,
    origin_id: 'CENTRAL',
  });
  const [addingBatch, setAddingBatch] = useState(false);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadEntity, setUploadEntity] = useState<'inventory' | 'destinations' | 'transport'>('inventory');
  const [uploadCsvText, setUploadCsvText] = useState('');
  const [uploading, setUploading] = useState(false);

  const notify = (s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(''), 3000);
  };

  const request = async (path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : undefined);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Request failed (${res.status})`);
    }
    return res.json();
  };

  const fetchDbData = async () => {
    try {
      const [statRes, histRes] = await Promise.all([
        fetch(`${API}/api/db/status`).then(r => r.json()).catch(() => null),
        fetch(`${API}/api/db/history?limit=15`).then(r => r.json()).catch(() => ({ runs: [] })),
      ]);
      if (statRes) setDbTelemetry(statRes);
      if (histRes?.runs) setDbHistory(histRes.runs);
    } catch (err) {
      console.warn('Could not fetch DB telemetry:', err);
    }
  };

  const handleSeedDatabase = async () => {
    try {
      const res = await fetch(`${API}/api/db/seed`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to seed database');
      notify('Database re-seeded via SQLAlchemy ORM');
      await refresh();
      await fetchDbData();
    } catch (err: any) {
      notify(`Database Seed Error: ${err.message}`);
    }
  };

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const [d, p, scens, ai, dbStat, dbHist] = await Promise.all([
        request('/api/initial-data'),
        request('/api/optimize', { solver_mode: solverMode }),
        request('/api/scenarios').catch(() => ({ scenarios: [] })),
        request('/api/ai/status').catch(() => null),
        fetch(`${API}/api/db/status`).then(r => r.json()).catch(() => null),
        fetch(`${API}/api/db/history?limit=15`).then(r => r.json()).catch(() => ({ runs: [] })),
      ]);
      setData(d);
      setDataStatus(d.data_source_status || null);
      setPlan(p);
      setScenariosList(scens.scenarios || []);
      setAiStatus(ai);
      if (dbStat) setDbTelemetry(dbStat);
      if (dbHist?.runs) setDbHistory(dbHist.runs);
    } catch (e: any) {
      setError(`${e.message}. Ensure the FastAPI server is running.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const inventory = data?.inventory || [];
  const metrics = plan?.optimized.metrics;
  const base = plan?.baseline.metrics;
  const m = metrics || ({} as any);

  const filtered = useMemo(() => inventory.filter(b =>
    `${b.batch_id} ${b.commodity} ${b.origin_id}`.toLowerCase().includes(query.toLowerCase()) &&
    (filter === 'All batches' || (filter === 'At risk' && b.remaining_shelf_life_hours <= 12) || (filter === 'Fresh' && b.remaining_shelf_life_hours > 24))
  ), [inventory, query, filter]);

  const chartData = useMemo(() => {
    if (!plan) return [];
    const b = plan.baseline.metrics;
    const o = plan.optimized.metrics;
    return [
      { label: 'Delivered', baseline: b.delivered_kg, optimized: o.delivered_kg },
      { label: 'Spoilage', baseline: b.spoiled_kg, optimized: o.spoiled_kg },
      { label: 'Unmet Demand', baseline: b.unmet_demand_kg, optimized: o.unmet_demand_kg },
      { label: 'Unused Capacity', baseline: b.unused_capacity_kg, optimized: o.unused_capacity_kg },
    ];
  }, [plan]);

  const nav = [
    { label: 'Overview', icon: BarChart3 },
    { label: 'Inventory', icon: Boxes },
    { label: 'Distribution plan', icon: Route },
    { label: 'Scenario lab', icon: Activity },
    { label: 'AI copilot', icon: Sparkles },
    { label: 'Database & Audit', icon: Database },
  ];

  const runOptimize = async (overrideMode?: 'heuristic' | 'milp') => {
    const mode = overrideMode || solverMode;
    try {
      const p = await request('/api/optimize', { solver_mode: mode });
      setPlan(p);
      notify(`Plan calculated using ${mode === 'milp' ? 'Exact MILP Solver' : 'Heuristic Engine'}`);
      await fetchDbData();
    } catch (e: any) {
      notify(e.message);
    }
  };

  const handleSolverModeChange = (mode: 'heuristic' | 'milp') => {
    setSolverMode(mode);
    runOptimize(mode);
  };

  const handleRefreshPrices = async () => {
    try {
      const res = await request('/api/data/refresh-prices', { simulate_failure: false });
      notify(`Market prices updated (${res.status.toUpperCase()})`);
      const statusRes = await request('/api/data/status');
      setDataStatus(statusRes);
      runOptimize();
    } catch (e: any) {
      notify(`Price refresh error: ${e.message}`);
    }
  };

  const handleRefreshRoutes = async () => {
    try {
      const res = await request('/api/data/refresh-routes', { simulate_failure: false });
      notify(`Route & traffic conditions updated (${res.status.toUpperCase()})`);
      const statusRes = await request('/api/data/status');
      setDataStatus(statusRes);
      runOptimize();
    } catch (e: any) {
      notify(`Route refresh error: ${e.message}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setUploadCsvText(String(ev.target?.result || ''));
    };
    reader.readAsText(file);
  };

  const submitCsvUpload = async () => {
    if (!uploadCsvText.trim()) {
      notify('Please enter or select CSV content first');
      return;
    }
    setUploading(true);
    try {
      const res = await request('/api/data/upload', {
        entity: uploadEntity,
        csv_content: uploadCsvText,
      });
      setData(res.data);
      setDataStatus(res.data_source_status);
      setShowUploadModal(false);
      setUploadCsvText('');
      notify(`Successfully imported ${uploadEntity} CSV`);
      runOptimize();
    } catch (e: any) {
      notify(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const runScenarioSimulation = async () => {
    try {
      const res = await request('/api/simulate', {
        demand_change_percent: demand,
        travel_delay_hours: delay,
        capacity_change_percent: capacity,
        solver_mode: solverMode,
      });
      setScenario(res);
      notify(`Custom scenario simulated with ${solverMode.toUpperCase()} solver`);
    } catch (e: any) {
      notify(e.message);
    }
  };

  const runPresetScenario = async (scenId: string) => {
    setSelectedScenarioId(scenId);
    try {
      const res = await request('/api/scenarios/run', { scenario_id: scenId, solver_mode: solverMode });
      setScenario(res);
      if (res.scenario) {
        setDemand(res.scenario.demand_change_percent || 0);
        setDelay(res.scenario.travel_delay_hours || 0);
        setCapacity(res.scenario.capacity_change_percent || 0);
      }
      notify(`Executed scenario: ${res.scenario_name || scenId} (${solverMode.toUpperCase()})`);
    } catch (e: any) {
      notify(e.message);
    }
  };

  const handleQuickAddBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingBatch(true);
    try {
      const payload = {
        batch_id: `BATCH-${Date.now().toString().slice(-4)}`,
        commodity: newBatch.commodity,
        quantity_kg: Number(newBatch.quantity_kg),
        remaining_shelf_life_hours: Number(newBatch.remaining_shelf_life_hours),
        selling_price_per_kg: Number(newBatch.selling_price_per_kg),
        unit_cost_per_kg: Number(newBatch.unit_cost_per_kg),
        handling_time_hours: Number(newBatch.handling_time_hours),
        origin_id: newBatch.origin_id || 'CENTRAL',
      };
      const res = await request('/api/inventory/quick-add', payload);
      if (data) {
        setData({ ...data, inventory: res.inventory });
      }
      setShowAddBatchModal(false);
      notify(`Added batch ${payload.batch_id} (${payload.commodity})`);
      runOptimize();
    } catch (err: any) {
      notify(`Failed to add batch: ${err.message}`);
    } finally {
      setAddingBatch(false);
    }
  };

  const handleDeleteBatch = async (batchId: string) => {
    if (!window.confirm(`Delete produce batch ${batchId}?`)) return;
    try {
      const res = await fetch(`${API}/api/inventory/${batchId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      const resData = await res.json();
      if (data) {
        setData({ ...data, inventory: resData.inventory });
      }
      notify(`Batch ${batchId} deleted`);
      runOptimize();
    } catch (err: any) {
      notify(`Delete error: ${err.message}`);
    }
  };

  const handleResetDatabase = async () => {
    try {
      await request('/api/data/reset');
      notify('Database reset to validated demo snapshot');
      refresh();
      setShowProfileModal(false);
    } catch (err: any) {
      notify(`Reset error: ${err.message}`);
    }
  };

  const notifications = useMemo(() => {
    const list: Array<{ id: string; type: 'critical' | 'warning' | 'info'; title: string; desc: string; time: string }> = [];
    const quarantined = plan?.quarantined_waste || plan?.optimized?.quarantined_waste || [];
    const immediateKg = plan?.immediate_spoilage_kg || plan?.optimized?.immediate_spoilage_kg || 0;
    if (quarantined.length > 0) {
      list.push({
        id: 'quarantine',
        type: 'critical',
        title: 'Immediate Waste Quarantine Active',
        desc: `${quarantined.length} batches (${fmt(immediateKg)} kg) diverted to bio-waste/compost due to shelf life <= dock handling buffer.`,
        time: 'Active'
      });
    }
    const lowShelf = inventory.filter(b => b.remaining_shelf_life_hours <= 12 && b.remaining_shelf_life_hours > 1);
    if (lowShelf.length > 0) {
      list.push({
        id: 'low-shelf',
        type: 'warning',
        title: 'High Spoilage Risk Batches',
        desc: `${lowShelf.length} produce batches have ≤ 12h shelf life remaining and require prioritized corridor dispatch.`,
        time: 'High priority'
      });
    }
    list.push({
      id: 'ai-status',
      type: 'info',
      title: aiStatus?.local_ollama ? `Local Qwen (${aiStatus.active_model}) Active` : 'AI Copilot Ready',
      desc: aiStatus?.local_ollama
        ? 'Accelerated on local NVIDIA RTX GPU for zero-latency operations assistance.'
        : 'Rule-based explainability active.',
      time: 'Live'
    });
    list.push({
      id: 'solver-mode',
      type: 'info',
      title: solverMode === 'milp' ? 'Exact MILP Solver Active' : 'Heuristic Optimization Active',
      desc: solverMode === 'milp'
        ? 'PuLP / CBC branch-and-cut optimization active for mathematically provable maximum profit.'
        : 'Fast greedy heuristic active for real-time sub-second dispatching.',
      time: 'Engine'
    });
    return list;
  }, [plan, inventory, aiStatus, solverMode]);

  const ask = async (q = question) => {
    if (!q.trim()) return;
    const queryText = q.trim();
    setChatHistory(prev => [...prev, { sender: 'user', text: queryText }]);
    setQuestion('');
    setAsking(true);
    setAnswer('');
    try {
      const r = await request('/api/explain', { question: queryText, plan: plan?.optimized });
      const ansText = r.answer;
      setAnswer(ansText);
      setChatHistory(prev => [
        ...prev,
        { sender: 'assistant', text: ansText, mode: r.mode || 'Local Qwen LLM' }
      ]);
    } catch (e: any) {
      setAnswer(e.message);
      setChatHistory(prev => [
        ...prev,
        { sender: 'assistant', text: `Error: ${e.message}`, mode: 'Error' }
      ]);
    } finally {
      setAsking(false);
    }
  };

  const exportCsv = () => {
    const head = ['batch_id', 'commodity', 'quantity_kg', 'remaining_shelf_life_hours', 'selling_price_per_kg', 'origin_id', 'handling_cost_per_kg', 'handling_time_hours'];
    const rows = [head, ...inventory.map(b => head.map(k => (b as any)[k] ?? ''))];
    const csvContent = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv' }));
    a.download = 'agronex-inventory.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    notify('Inventory CSV exported');
  };

  const overallStatus = dataStatus?.overall_status || 'cached';
  const statusLabel =
    overallStatus === 'live' ? 'LIVE FEED' :
    overallStatus === 'uploaded' ? 'UPLOADED DATA' :
    overallStatus === 'stale' ? 'STALE / SNAPSHOT' : 'VALIDATED SNAPSHOT';

  const pageTitle =
    page === 'Distribution plan' ? 'Distribution intelligence' :
    page === 'Scenario lab' ? 'Scenario simulator' :
    page === 'AI copilot' ? 'AgroNex copilot' :
    page === 'Database & Audit' ? 'Database & Execution Audit' : page;

  return (
    <div className="app-shell">
      {/* Cinematic Living Background Scenery Layers with 3D Mouse Parallax */}
      <div
        className="cinematic-bg-container"
        aria-hidden="true"
        style={{
          transform: `translate3d(${-mouseParallax.x}px, ${-mouseParallax.y}px, 0)`,
        }}
      >
        <div className={`bg-layer bg-storm ${weatherMode === 'storm' ? 'active' : ''}`} />
        <div className={`bg-layer bg-mist ${weatherMode === 'mist' ? 'active' : ''}`} />
        <div className={`bg-layer bg-sun ${weatherMode === 'sun' ? 'active' : ''}`} />
        <div className={`bg-layer bg-cyber ${weatherMode === 'cyber' ? 'active' : ''}`} />
        <div className="bg-aurora-sweep" />
        <div className="bg-overlay-tint" />
        <div className="cyber-grid-overlay" />
      </div>

      {/* 60FPS Interactive Atmospheric Particle Canvas */}
      <AtmosphereCanvas mode={weatherMode} />

      {/* Sidebar */}
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand">
          <img src="/agronex-mark.png" alt="AgroNex Logo" />
          <div>
            <strong>Agro<span>Nex</span></strong>
            <small>FRESH SUPPLY. SMARTER ROUTES.</small>
          </div>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>
            <X size={17} />
          </button>
        </div>

        <div className="workspace-wrapper">
          <div className="workspace" onClick={() => setShowWorkspaceDropdown(!showWorkspaceDropdown)}>
            <div className="workspace-icon">
              <Sprout size={18} />
            </div>
            <div>
              <b>{activeWorkspace.split('(')[0].trim()}</b>
              <small>{activeWorkspace.includes('(') ? activeWorkspace.split('(')[1].replace(')', '') : 'Active Operations Workspace'}</small>
            </div>
            <ChevronDown size={15} style={{ transform: showWorkspaceDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </div>
          {showWorkspaceDropdown && (
            <div className="workspace-dropdown">
              {[
                { name: 'Central Distribution Center (CDC-North)', desc: 'Main Hub · 24h Cold Chain Network' },
                { name: 'Western Agri-Logistics Hub (CDC-West)', desc: 'Nashik / Pune Perishable Terminal' },
                { name: 'Southern Cold-Chain Terminal (CDC-South)', desc: 'Bengaluru Regional Fresh Hub' },
              ].map(ws => (
                <button
                  key={ws.name}
                  type="button"
                  className={`workspace-item ${activeWorkspace === ws.name ? 'active' : ''}`}
                  onClick={() => {
                    setActiveWorkspace(ws.name);
                    setShowWorkspaceDropdown(false);
                    notify(`Switched workspace to ${ws.name}`);
                    runOptimize();
                  }}
                >
                  <div>
                    <div>{ws.name.split('(')[0]}</div>
                    <small style={{ fontSize: '9px', opacity: 0.75 }}>{ws.desc}</small>
                  </div>
                  {activeWorkspace === ws.name && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(n => (
            <button
              key={n.label}
              className={`nav-link ${page === n.label ? 'selected' : ''}`}
              onClick={() => handleNavClick(n.label)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.label === 'Scenario lab' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">
              <CircleHelp size={17} />
            </div>
            <b>Constraint-grounded planning</b>
            <p>Every dispatch assigns produce while verifying shelf life, route capacity, and delivery windows.</p>
            <button onClick={() => setPage('AI copilot')}>
              Ask AgroNex <ArrowRight size={14} />
            </button>
          </div>

          <div className="profile" onClick={() => setShowProfileModal(true)} title="Click to view Operations & Node Settings">
            <div className="avatar">AN</div>
            <div>
              <b>AgroNex Operations</b>
              <small>Distribution Control Hub</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <main className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setMobileNav(true)}>
            <Menu />
          </button>
          <div className="crumb">
            Workspace <span>/</span> <b>{page}</b>
          </div>

          <div className="top-actions">
            {/* Atmospheric Environment FX Engine Selector */}
            <div className="atmosphere-mode-selector" title="Atmospheric Environment FX Engine">
              <button
                type="button"
                className={`atmo-btn ${weatherMode === 'storm' ? 'active' : ''}`}
                onClick={() => handleWeatherChange('storm')}
                title="Electric Thunderstorm & Atmospheric Rain"
              >
                <CloudRain size={13} />
                <span>Storm</span>
              </button>
              <button
                type="button"
                className={`atmo-btn ${weatherMode === 'mist' ? 'active' : ''}`}
                onClick={() => handleWeatherChange('mist')}
                title="Morning Valley Mist & Bioluminescent Spores"
              >
                <CloudFog size={13} />
                <span>Mist</span>
              </button>
              <button
                type="button"
                className={`atmo-btn ${weatherMode === 'sun' ? 'active' : ''}`}
                onClick={() => handleWeatherChange('sun')}
                title="Golden Hour God Rays & Solar Dust"
              >
                <Sun size={13} />
                <span>Sun Rays</span>
              </button>
              <button
                type="button"
                className={`atmo-btn ${weatherMode === 'cyber' ? 'active' : ''}`}
                onClick={() => handleWeatherChange('cyber')}
                title="Quantum Data Stream & Cyber Matrix"
              >
                <Cpu size={13} />
                <span>Cyber</span>
              </button>
              <button
                type="button"
                className={`atmo-btn atmo-btn-off ${weatherMode === 'off' ? 'active' : ''}`}
                onClick={() => handleWeatherChange('off')}
                title="Disable Atmospheric Canvas FX"
              >
                <EyeOff size={13} />
              </button>
            </div>

            {/* Solver Mode Segmented Toggle */}
            <div className="solver-mode-toggle" title="Switch Optimization Solver Engine">
              <button
                type="button"
                className={`solver-toggle-btn ${solverMode === 'heuristic' ? 'active' : ''}`}
                onClick={() => handleSolverModeChange('heuristic')}
              >
                Heuristic Engine
              </button>
              <button
                type="button"
                className={`solver-toggle-btn ${solverMode === 'milp' ? 'active' : ''}`}
                onClick={() => handleSolverModeChange('milp')}
              >
                <Sparkles size={12} /> Exact MILP
              </button>
            </div>

            {plan?.optimized?.solver_used && (
              <span className="solver-tag" title="Solver executed for current plan">
                {plan.optimized.solver_used}
              </span>
            )}

            {/* Live Data Provider Badge */}
            <div className={`live-pill status-${overallStatus}`} title={`Data Source: ${statusLabel}`}>
              <span /> {statusLabel}
            </div>

            {/* Connected Database Tier Status Badge */}
            <div
              className="live-pill status-live"
              style={{ cursor: 'pointer', background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.35)', color: '#34d399' }}
              title={`Database Tier: ${dbTelemetry?.dialect ? dbTelemetry.dialect.toUpperCase() : 'SQLAlchemy ORM'} | Stored batches: ${dbTelemetry?.tables?.inventory_batches ?? 6} | Click to view Database & Audit`}
              onClick={() => handleNavClick('Database & Audit')}
            >
              <Database size={13} style={{ marginRight: 4 }} />
              <span>DB: {dbTelemetry?.dialect ? dbTelemetry.dialect.toUpperCase() : 'ORM CONNECTED'}</span>
            </div>

            {/* Last Updated Timestamp */}
            <div className="last-updated-text" title={`Last synced: ${dataStatus?.last_updated || 'Active'}`}>
              <Clock3 size={13} /> {formatTimeAgo(dataStatus?.last_updated)}
            </div>

            {/* Quick Action: Upload Data */}
            <button
              className="action-pill-btn"
              title="Upload CSV data"
              onClick={() => setShowUploadModal(true)}
            >
              <Upload size={14} /> Upload Data
            </button>

            {/* Quick Action: Refresh Market Prices */}
            <button
              className="action-pill-btn"
              title="Refresh live mandi / wholesale prices"
              onClick={handleRefreshPrices}
            >
              <TrendingUp size={14} /> Prices
            </button>

            {/* Quick Action: Refresh Routes */}
            <button
              className="action-pill-btn"
              title="Refresh traffic & corridor transit times"
              onClick={handleRefreshRoutes}
            >
              <Truck size={14} /> Routes
            </button>

            {/* Master Reload */}
            <button className="icon-button" title="Full data & plan reload" onClick={refresh}>
              <RefreshCw size={16} />
            </button>

            {/* Operational Alerts & Notifications */}
            <div className="notifications-wrapper">
              <button
                className="icon-button notification"
                title="Operational Notifications"
                onClick={() => {
                  setShowNotifications(!showNotifications);
                  setNotificationsRead(true);
                }}
              >
                <Bell size={16} />
                {!notificationsRead && notifications.some(n => n.type === 'critical') && <i />}
              </button>

              {showNotifications && (
                <div className="notifications-dropdown">
                  <div className="notifications-head">
                    <h4><Bell size={14} color="#1e6440" /> Operational Alerts ({notifications.length})</h4>
                    <button type="button" onClick={() => setNotificationsRead(true)}>Mark all read</button>
                  </div>
                  <div className="notifications-list">
                    {notifications.map(n => (
                      <div key={n.id} className={`notification-item ${n.type}`}>
                        <div className={`notification-icon ${n.type}`}>
                          {n.type === 'critical' ? <AlertTriangle size={14} /> : n.type === 'warning' ? <Clock3 size={14} /> : <CheckCircle2 size={14} />}
                        </div>
                        <div className="notification-content">
                          <b>{n.title}</b>
                          <p>{n.desc}</p>
                          <small>{n.time}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Operations Profile Trigger */}
            <div
              className="user-mini"
              title="Click to view Operations & Node Settings"
              onClick={() => setShowProfileModal(true)}
            >
              AN
            </div>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" />
                <span>PERISHABLE SUPPLY CHAIN INTELLIGENCE</span>
                <span className="hud-telemetry-badge" title="Orbital & Atmospheric Telemetry Sync">
                  <Activity size={10} /> SYS.ONLINE // {weatherMode.toUpperCase()}
                </span>
              </div>
              <h1>{pageTitle}<span className="heading-period">.</span></h1>
              <p>
                {page === 'Overview' ? 'One clear view of freshness, demand, route capacities, and optimal dispatch.' :
                 page === 'Inventory' ? 'Know what is in stock, what is at risk, and what requires urgent clearance.' :
                 page === 'Distribution plan' ? 'A feasibility-first plan that balances shelf life, demand, route capacity, and net margin.' :
                 page === 'Scenario lab' ? 'Stress-test the distribution network against disruptions before the real world does.' :
                 'Understand the numbers, constraints, and cost trade-offs behind every recommendation.'}
              </p>
            </div>
            <div className="heading-actions">
              <button className="btn btn-light" onClick={() => setShowUploadModal(true)}>
                <Upload size={16} /> Upload Data
              </button>
              <button className="btn btn-light" onClick={exportCsv}>
                <Download size={16} /> Export CSV
              </button>
              <button className="btn btn-primary" onClick={() => runOptimize()} disabled={loading}>
                <Sparkles size={16} /> Recalculate plan
              </button>
            </div>
          </div>

          {error && (
            <div className="error-banner">
              <b>Backend notification:</b>
              <span>{error}</span>
              <button onClick={refresh}>Retry</button>
            </div>
          )}

          {loading && !data ? (
            <div className="loading-card">
              <div className="spinner" /> Loading AgroNex planning data…
            </div>
          ) : (
            <>
              {/* PAGE 1: OVERVIEW */}
              {page === 'Overview' && (
                <>
                  <div className="welcome-strip">
                    <div className="welcome-mark">
                      <Leaf size={23} />
                    </div>
                    <div>
                      <b>Good decisions keep produce moving.</b>
                      <p>
                        AgroNex compares a transparent baseline heuristic with a shelf-life-aware plan
                        using the same network, transit times, and cost assumptions.
                      </p>
                    </div>
                    <div className="strip-note">
                      <ShieldCheck size={16} /> Constraint-first planning
                    </div>
                  </div>

                  {/* Beginner-Friendly Guide Banner */}
                  {showGuideBanner && (
                    <div className="beginner-guide">
                      <div className="beginner-guide-head">
                        <div>
                          <h3><Sparkles size={16} color="#a7f3d0" /> How AgroNex Optimizes Perishable Supply Chains</h3>
                          <p>A quick 4-step walkthrough for dispatch operators and logistics planners.</p>
                        </div>
                        <button type="button" onClick={() => setShowGuideBanner(false)}>Dismiss Guide</button>
                      </div>
                      <div className="guide-steps-grid">
                        <div className="guide-step-card">
                          <div className="guide-step-num">1</div>
                          <b>Input Fresh Inventory</b>
                          <p>Track produce with weight, remaining shelf life, and farmer cost. Expired produce (&le;1h) is quarantined instantly.</p>
                        </div>
                        <div className="guide-step-card">
                          <div className="guide-step-num">2</div>
                          <b>Choose Optimization Solver</b>
                          <p>Use the fast <strong>Heuristic</strong> engine for instant routing, or the <strong>Exact MILP</strong> solver for mathematical profit maximization.</p>
                        </div>
                        <div className="guide-step-card">
                          <div className="guide-step-num">3</div>
                          <b>Inspect MoFPI P&L Economics</b>
                          <p>Review real Net Economic Profit after accounting for freight transport, dock handling, farmer COGS, and disposal penalties.</p>
                        </div>
                        <div className="guide-step-card">
                          <div className="guide-step-num">4</div>
                          <b>Consult Local Qwen Copilot</b>
                          <p>Chat directly with your on-device Qwen model on RTX GPU to explain route trade-offs, discount clearances, and bottlenecks.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="section-title">
                    <div>
                      <h2>Network at a glance</h2>
                      <p>Active 24-hour planning window · INR financial cost model · Verified constraints</p>
                    </div>
                    <span className="updated">
                      <span /> PLAN READY
                    </span>
                  </div>

                  {/* 4 Primary KPIs */}
                  <div className="kpi-grid">
                    <Metric
                      icon={Package}
                      label="Available inventory"
                      value={`${fmt(m.initial_stock_kg)} kg`}
                      foot={`${inventory.length} tracked batches`}
                      tone="green"
                    />
                    <Metric
                      icon={Truck}
                      label="Planned dispatch"
                      value={`${fmt(m.delivered_kg)} kg`}
                      foot={`${fmt(m.demand_fulfillment_percent)}% demand fulfillment`}
                      tone="blue"
                    />
                    <Metric
                      icon={Clock3}
                      label="At-risk expired stock"
                      value={`${fmt(m.spoiled_kg)} kg`}
                      foot={`${fmt(m.spoilage_rate_percent)}% of starting stock`}
                      tone="amber"
                    />
                    <Metric
                      icon={BarChart3}
                      label="Estimated net value"
                      value={money(m.net_revenue)}
                      foot={`Gross: ${money(m.gross_revenue)}`}
                      tone="violet"
                    />
                  </div>

                  {/* MoFPI Economic Objective P&L Cards */}
                  <PnlCards m={m} />

                  {/* Charts & Freshness Watch */}
                  <div className="dashboard-grid">
                    <section className="panel comparison-panel">
                      <div className="panel-heading">
                        <div>
                          <h3>Plan impact comparison</h3>
                          <p>Baseline (nearest feasible) vs. AgroNex (scarcity-aware optimizer)</p>
                        </div>
                        <span className="legend-label">
                          <i />Optimized <i className="legend-gray" />Baseline
                        </span>
                      </div>
                      <div className="chart-wrap">
                        {chartData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                              <defs>
                                <linearGradient id="greenFill" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#2c8b5b" stopOpacity={0.25} />
                                  <stop offset="95%" stopColor="#2c8b5b" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e9eee8" />
                              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#829087', fontSize: 11 }} />
                              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#829087', fontSize: 11 }} />
                              <Tooltip contentStyle={{ border: '1px solid #e2e9e1', borderRadius: 12, fontSize: 12 }} />
                              <Area type="monotone" dataKey="optimized" name="AgroNex plan (kg)" stroke="#287b50" strokeWidth={2.5} fill="url(#greenFill)" />
                              <Area type="monotone" dataKey="baseline" name="Baseline (kg)" stroke="#aab5ad" strokeWidth={2} strokeDasharray="5 4" fill="transparent" />
                            </AreaChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="empty-chart">Run the planner to compare outcomes.</div>
                        )}
                      </div>
                      <div className="comparison-foot">
                        <div>
                          <span>Net value change</span>
                          <b className={Number(plan?.improvement_summary?.net_revenue_change_amount || 0) >= 0 ? 'positive' : 'negative'}>
                            {Number(plan?.improvement_summary?.net_revenue_change_amount || 0) >= 0 ? '+' : ''}
                            {money(plan?.improvement_summary?.net_revenue_change_amount || 0)}
                            <small style={{ display: 'inline', marginLeft: 4, fontWeight: 'normal', color: '#68826f' }}>
                              ({fmt(plan?.improvement_summary?.net_revenue_change_percent || 0)}%)
                            </small>
                          </b>
                        </div>
                        <div>
                          <span>Fulfillment change</span>
                          <b>
                            {Number(plan?.improvement_summary?.fulfillment_change_percentage_points || 0) >= 0 ? '+' : ''}
                            {fmt(plan?.improvement_summary?.fulfillment_change_percentage_points || 0)} pp
                            <small style={{ display: 'inline', marginLeft: 4, fontWeight: 'normal', color: '#68826f' }}>
                              ({fmt(plan?.improvement_summary?.demand_fulfillment_change_kg || 0)} kg)
                            </small>
                          </b>
                        </div>
                        <div>
                          <span>Spoilage reduction</span>
                          <b className={Number(plan?.improvement_summary?.spoilage_reduction_kg || 0) >= 0 ? 'positive' : 'negative'}>
                            {fmt(plan?.improvement_summary?.spoilage_reduction_kg || 0)} kg
                            <small style={{ display: 'inline', marginLeft: 4, fontWeight: 'normal', color: '#68826f' }}>
                              ({fmt(plan?.improvement_summary?.spoilage_reduction_percent || 0)}%)
                            </small>
                          </b>
                        </div>
                      </div>
                    </section>

                    <section className="panel risk-panel">
                      <div className="panel-heading">
                        <div>
                          <h3>Freshness watch</h3>
                          <p>Short-life batches expiring within 24h window</p>
                        </div>
                        <span className="round-icon amber">
                          <Clock3 size={17} />
                        </span>
                      </div>
                      <div className="risk-list">
                        {[...inventory]
                          .sort((a, b) => a.remaining_shelf_life_hours - b.remaining_shelf_life_hours)
                          .slice(0, 4)
                          .map(b => (
                            <div className="risk-row" key={b.batch_id}>
                              <div className={`produce-icon ${b.remaining_shelf_life_hours <= 12 ? 'risk' : 'fresh'}`}>
                                <Leaf size={17} />
                              </div>
                              <div className="risk-name">
                                <b>{b.commodity}</b>
                                <small>{b.batch_id} · {fmt(b.quantity_kg)} kg · {b.origin_id}</small>
                              </div>
                              <div className="risk-time">
                                <b className={b.remaining_shelf_life_hours <= 12 ? 'warning-text' : ''}>
                                  {fmt(b.remaining_shelf_life_hours)}h
                                </b>
                                <small>remaining</small>
                              </div>
                            </div>
                          ))}
                      </div>
                      <button className="text-link" onClick={() => setPage('Inventory')}>
                        View all inventory <ArrowRight size={15} />
                      </button>
                    </section>
                  </div>

                  {/* Dispatches & AgroNex Insight */}
                  <div className="bottom-grid">
                    <section className="panel allocation-panel">
                      <div className="panel-heading">
                        <div>
                          <h3>Recommended dispatches</h3>
                          <p>Feasible allocations prioritized by route scarcity and net value</p>
                        </div>
                        <button className="subtle-button" onClick={() => setPage('Distribution plan')}>
                          Full plan <ArrowRight size={14} />
                        </button>
                      </div>
                      <AllocationTable plan={plan?.optimized} />
                    </section>

                    <section className="insight-card">
                      <div className="insight-top">
                        <span className="insight-spark">
                          <Sparkles size={17} />
                        </span>
                        <span>AGRONEX INTELLIGENCE</span>
                      </div>
                      <h3>Make every delivery count.</h3>
                      <p>
                        {plan?.optimized.discount_recommendations?.length
                          ? `${plan.optimized.discount_recommendations.length} batch(es) remain unsold after feasible allocations. Review urgency-based markdown suggestions (<6h: 30%, 6-12h: 20%, 12-24h: 10%) before produce spoils.`
                          : 'The plan has verified shelf life, destination demand, receiving windows, and route capacities before assigning produce.'}
                      </p>
                      <button onClick={() => setPage('AI copilot')}>
                        Explore the reasoning <ArrowRight size={15} />
                      </button>
                      <div className="insight-art">
                        <div /><div /><div />
                        <Leaf size={55} />
                      </div>
                    </section>
                  </div>
                </>
              )}

              {/* PAGE 2: INVENTORY */}
              {page === 'Inventory' && (
                <section className="panel inventory-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Inventory batches</h3>
                      <p>{inventory.length} tracked batches · verified shelf life & handling costs</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary" onClick={() => setShowAddBatchModal(true)}>
                        <Plus size={15} /> Add Produce Batch
                      </button>
                      <button className="btn btn-light" onClick={() => setShowUploadModal(true)}>
                        <Upload size={15} /> Upload CSV
                      </button>
                      <button className="btn btn-light" onClick={exportCsv}>
                        <Download size={15} /> Export CSV
                      </button>
                    </div>
                  </div>

                  <div className="table-tools">
                    <div className="search-box">
                      <Search size={16} />
                      <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search batch code, commodity, or origin…"
                      />
                    </div>
                    <select value={filter} onChange={e => setFilter(e.target.value)}>
                      <option>All batches</option>
                      <option>At risk (&le;12h)</option>
                      <option>Fresh (&gt;24h)</option>
                    </select>
                  </div>

                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Batch ID</th>
                          <th>Commodity</th>
                          <th>Quantity</th>
                          <th>Remaining shelf life</th>
                          <th>Selling price</th>
                          <th>Origin</th>
                          <th>Handling cost / time</th>
                          <th>Freshness status</th>
                          <th style={{ width: 45, textAlign: 'center' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(b => (
                          <tr key={b.batch_id}>
                            <td>
                              <b className="batch-code">{b.batch_id}</b>
                            </td>
                            <td>
                              <div className="commodity-cell">
                                <span className="mini-leaf">
                                  <Leaf size={14} />
                                </span>
                                {b.commodity}
                              </div>
                            </td>
                            <td>{fmt(b.quantity_kg)} kg</td>
                            <td>
                              <div className="shelf-cell">
                                <div className="shelf-track">
                                  <i
                                    style={{
                                      width: `${Math.min(100, (b.remaining_shelf_life_hours / 48) * 100)}%`,
                                      background: b.remaining_shelf_life_hours <= 6 ? '#dc2626' : b.remaining_shelf_life_hours <= 12 ? '#d97706' : '#22c55e',
                                    }}
                                  />
                                </div>
                                <b>{fmt(b.remaining_shelf_life_hours)}h</b>
                              </div>
                            </td>
                            <td>{money(b.selling_price_per_kg)}/kg</td>
                            <td>{b.origin_id}</td>
                            <td>{money(b.handling_cost_per_kg)}/kg ({b.handling_time_hours}h)</td>
                            <td>
                              <span className={`status-tag ${b.remaining_shelf_life_hours <= 6 ? 'status-risk' : b.remaining_shelf_life_hours <= 12 ? 'status-watch' : 'status-ok'}`}>
                                {b.remaining_shelf_life_hours <= 6 ? 'Critical (<6h)' : b.remaining_shelf_life_hours <= 12 ? 'At Risk (<12h)' : 'Healthy'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="action-icon-danger"
                                title={`Delete ${b.batch_id}`}
                                onClick={() => handleDeleteBatch(b.batch_id)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && <div className="empty-chart">No batches match your filters.</div>}
                  </div>
                  <div className="table-note">
                    <ShieldCheck size={15} /> All inventory inputs are validated for positive weights, positive shelf life, and non-negative pricing.
                  </div>

                  {/* Immediate Waste / Compost Quarantine Section */}
                  <QuarantinedWasteTable
                    waste={plan?.quarantined_waste || plan?.optimized?.quarantined_waste || []}
                    immediateSpoilageKg={plan?.immediate_spoilage_kg || plan?.optimized?.immediate_spoilage_kg || 0}
                    expanded={quarantineExpanded}
                    onToggle={() => setQuarantineExpanded(!quarantineExpanded)}
                  />
                </section>
              )}

              {/* PAGE 3: DISTRIBUTION PLAN */}
              {page === 'Distribution plan' && (
                <>
                  {/* Detailed 4-Metric Grid */}
                  <div className="plan-summary-grid">
                    <Metric
                      icon={Truck}
                      label="Stock used"
                      value={`${fmt(m.stock_used_kg ?? m.delivered_kg)} kg`}
                      foot={`${fmt(m.demand_fulfillment_percent)}% demand fulfilled`}
                      tone="green"
                    />
                    <Metric
                      icon={MapPin}
                      label="Unmet demand"
                      value={`${fmt(m.unmet_demand_kg)} kg`}
                      foot={`Total requested: ${fmt(m.initial_demand_kg)} kg`}
                      tone="amber"
                    />
                    <Metric
                      icon={Warehouse}
                      label="Unused route capacity"
                      value={`${fmt(m.unused_capacity_kg)} kg`}
                      foot={`${fmt(m.capacity_utilization_percent)}% fleet utilized`}
                      tone="blue"
                    />
                    <Metric
                      icon={Clock3}
                      label="Expired / spoiled stock"
                      value={`${fmt(m.expired_stock_kg ?? m.spoiled_kg)} kg`}
                      foot={`Fresh surplus: ${fmt(m.fresh_surplus_kg)} kg`}
                      tone="violet"
                    />
                  </div>

                  {/* MoFPI Economic Objective P&L Cards */}
                  <PnlCards m={m} />

                  {/* Allocation Table */}
                  <section className="panel allocation-panel">
                    <div className="panel-heading">
                      <div>
                        <h3>Explainable allocation plan</h3>
                        <p>Route-scarcity reservation prioritizes fragile produce; full arrival time and feasibility audit included</p>
                      </div>
                      <button className="btn btn-primary" onClick={() => runOptimize()}>
                        <RefreshCw size={15} /> Recalculate
                      </button>
                    </div>
                    <AllocationTable plan={plan?.optimized} detailed />
                  </section>

                  {/* Quarantined Waste (Organic Compost & Biogas Diversion) */}
                  <QuarantinedWasteTable
                    waste={plan?.quarantined_waste || plan?.optimized?.quarantined_waste || []}
                    immediateSpoilageKg={plan?.immediate_spoilage_kg || plan?.optimized?.immediate_spoilage_kg || 0}
                    expanded={quarantineExpanded}
                    onToggle={() => setQuarantineExpanded(!quarantineExpanded)}
                  />

                  {/* Financial Breakdown & Discount Watch */}
                  <div className="two-panels">
                    {/* Financial Cost Components */}
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h3>Financial cost breakdown</h3>
                          <p>Explicit accounting of gross revenue and logistics deductions</p>
                        </div>
                      </div>
                      <div className="metric-compare">
                        <div>
                          <span>Gross Sales Realization</span>
                          <b>{money(m.gross_revenue)}</b>
                          <small>Sum of (delivered quantity &times; destination market price)</small>
                        </div>
                        <div>
                          <span>Transport Freight Cost</span>
                          <b style={{ color: '#c2410c' }}>-{money(m.transport_cost)}</b>
                          <small>Allocated proportionally across dispatched corridor weights</small>
                        </div>
                        <div>
                          <span>Handling & Sorting Cost</span>
                          <b style={{ color: '#c2410c' }}>-{money(m.handling_cost)}</b>
                          <small>Variable terminal handling cost per kilogram</small>
                        </div>
                        <div style={{ background: '#f5faf3', borderRadius: 8, padding: '10px 12px' }}>
                          <span style={{ fontWeight: 700, color: '#1b4d2e' }}>Net Operating Realization</span>
                          <b style={{ fontSize: 15, color: '#1b4d2e' }}>{money(m.net_revenue)}</b>
                          <small>Gross revenue minus transport freight and handling</small>
                        </div>
                      </div>
                    </section>

                    {/* Urgency-Tiered Discount Engine */}
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h3>Urgency-tiered discount engine</h3>
                          <p>
                            Clearance markdowns applied <em>only</em> when normal allocation cannot sell stock.
                            <br />
                            <small style={{ color: '#7e8f82' }}>&lt;6h: 30% · 6–12h: 20% · 12–24h: 10% · Recommendations, not confirmed sales</small>
                          </p>
                        </div>
                      </div>

                      {(plan?.optimized.discount_recommendations || []).length ? (
                        plan!.optimized.discount_recommendations.map((d: DiscountRecommendation) => (
                          <div className="discount-row" key={d.batch_id} style={{ alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, paddingRight: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                <b>{d.commodity} ({d.batch_id})</b>
                                <span className={`urgency-badge ${d.remaining_shelf_life_hours < 6 ? 'critical' : d.remaining_shelf_life_hours <= 12 ? 'high' : 'moderate'}`}>
                                  {d.urgency_tier} ({d.discount_percent}%)
                                </span>
                                <span className="recom-tag">RECOMMENDED ONLY</span>
                              </div>
                              <small style={{ color: '#687b6d', lineHeight: 1.5 }}>{d.reason}</small>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <strong style={{ fontSize: 13, color: '#b45309', display: 'block' }}>
                                {money(d.suggested_price_per_kg)}/kg
                              </strong>
                              <small style={{ textDecoration: 'line-through', color: '#9ca3af' }}>
                                {money(d.original_price_per_kg)}/kg
                              </small>
                              <small style={{ display: 'block', color: '#059669', marginTop: 2 }}>
                                Pot. rec: {money(d.potential_discounted_revenue)}
                              </small>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="empty-chart">
                          No unsold batches require discount clearance under current demand and capacity conditions.
                        </div>
                      )}
                    </section>
                  </div>

                  {/* Planning Assumptions */}
                  <div className="assumption-box">
                    <ShieldCheck size={18} />
                    <div>
                      <b>Verified operational assumptions</b>
                      <p>
                        {plan?.optimized.assumptions?.join(' · ')}. Baseline uses pure nearest-feasible greed without economic optimization.
                        Optimized plan protects scarce transit corridors for short-life produce.
                      </p>
                    </div>
                  </div>
                </>
              )}

              {/* PAGE 4: SCENARIO LAB */}
              {page === 'Scenario lab' && (
                <>
                  <div className="welcome-strip">
                    <div className="welcome-mark">
                      <Activity size={22} />
                    </div>
                    <div>
                      <b>Plan for the unexpected with realistic scenario stress-tests.</b>
                      <p>
                        Evaluate network resilience under realistic logistics disruptions (bottlenecks, transit delays, capacity crunches, demand surges).
                        Both baseline and optimized plans rerun on identical changed inputs with visible assumptions.
                      </p>
                    </div>
                  </div>

                  {/* Preset Realistic Scenarios */}
                  <div style={{ marginBottom: 12 }}>
                    <h3 style={{ font: '800 13px Manrope', margin: '0 0 8px', color: '#213a29' }}>
                      Realistic operational scenarios
                    </h3>
                    <div className="scenario-selector-grid">
                      {scenariosList.map(sc => (
                        <div
                          key={sc.id}
                          className={`scenario-card ${selectedScenarioId === sc.id ? 'active' : ''}`}
                          onClick={() => runPresetScenario(sc.id)}
                        >
                          <div className="scenario-card-head">
                            <span className="scenario-tagline">{sc.tagline}</span>
                            {selectedScenarioId === sc.id && <Check size={14} color="#20643d" />}
                          </div>
                          <h4>{sc.name}</h4>
                          <p>{sc.description}</p>
                          <div style={{ fontSize: 9, color: '#5b7462', fontWeight: 600 }}>
                            Demand: {sc.disruption.demand_change_percent > 0 ? `+${sc.disruption.demand_change_percent}` : sc.disruption.demand_change_percent}% · Delay: +{sc.disruption.travel_delay_hours}h · Capacity: {sc.disruption.capacity_change_percent > 0 ? `+${sc.disruption.capacity_change_percent}` : sc.disruption.capacity_change_percent}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="scenario-layout">
                    {/* Disruption Controls */}
                    <section className="panel scenario-controls">
                      <div className="panel-heading">
                        <div>
                          <h3>Custom disruption controls</h3>
                          <p>Directly adjust parameters to test sensitivity</p>
                        </div>
                      </div>

                      <Slider
                        label="Destination demand"
                        value={demand}
                        min={-50}
                        max={100}
                        suffix="%"
                        onChange={setDemand}
                        note="Demand changes stress-test network capacity and revenue capture."
                      />
                      <Slider
                        label="Transit corridor delay"
                        value={delay}
                        min={0}
                        max={12}
                        step={0.5}
                        suffix=" h"
                        onChange={setDelay}
                        note="Arrival time must strictly satisfy shelf life and receiving windows."
                      />
                      <Slider
                        label="Transport capacity"
                        value={capacity}
                        min={-75}
                        max={50}
                        suffix="%"
                        onChange={setCapacity}
                        note="Capacity shortages highlight the value of route scarcity reservation."
                      />

                      <div className="scenario-actions">
                        <button
                          className="btn btn-light"
                          onClick={() => { setDemand(0); setDelay(0); setCapacity(0); setScenario(null); }}
                        >
                          Reset
                        </button>
                        <button className="btn btn-primary" onClick={runScenarioSimulation}>
                          <Play size={15} /> Run simulation
                        </button>
                      </div>
                    </section>

                    {/* Scenario Results */}
                    <section className="panel scenario-results">
                      <div className="panel-heading">
                        <div>
                          <h3>Scenario outcomes & impact</h3>
                          <p>{scenario ? (scenario.scenario_name || 'Custom disruption scenario') : 'Select a preset or adjust sliders and simulate'}</p>
                        </div>
                        <span className={`status-tag ${scenario ? 'status-ok' : 'status-watch'}`}>
                          {scenario ? 'SIMULATED' : 'NOT RUN'}
                        </span>
                      </div>

                      {scenario ? (
                        <>
                          <div className="scenario-kpis">
                            <div>
                              <span>Net captured value</span>
                              <b>{money(scenario.optimized.metrics.net_revenue)}</b>
                              <small className={Number(scenario.improvement_summary.net_revenue_change_amount) >= 0 ? 'positive' : 'negative'}>
                                {Number(scenario.improvement_summary.net_revenue_change_amount) >= 0 ? '+' : ''}
                                {money(scenario.improvement_summary.net_revenue_change_amount)} vs baseline ({fmt(scenario.improvement_summary.net_revenue_change_percent)}%)
                              </small>
                            </div>

                            <div>
                              <span>Demand fulfilled</span>
                              <b>{fmt(scenario.optimized.metrics.demand_fulfillment_percent)}%</b>
                              <small>
                                {fmt(scenario.optimized.metrics.delivered_kg)} kg delivered ({fmt(scenario.improvement_summary.demand_fulfillment_change_kg)} kg vs baseline)
                              </small>
                            </div>

                            <div>
                              <span>Modeled spoilage</span>
                              <b style={{ color: scenario.optimized.metrics.spoiled_kg > 0 ? '#b45309' : '#059669' }}>
                                {fmt(scenario.optimized.metrics.spoiled_kg)} kg
                              </b>
                              <small className="positive">
                                Spoilage reduced by {fmt(scenario.improvement_summary.spoilage_reduction_kg)} kg ({fmt(scenario.improvement_summary.spoilage_reduction_percent)}%)
                              </small>
                            </div>

                            <div>
                              <span>Unused fleet capacity</span>
                              <b>{fmt(scenario.optimized.metrics.unused_capacity_kg)} kg</b>
                              <small>
                                {fmt(scenario.optimized.metrics.capacity_utilization_percent)}% fleet utilization ({scenario.optimized.metrics.constraint_violations} violations)
                              </small>
                            </div>
                          </div>

                          {/* Cost Breakdown */}
                          <div className="cost-breakdown-grid">
                            <div className="cost-breakdown-item">
                              <span>Transport freight cost</span>
                              <b>{money(scenario.optimized.metrics.transport_cost)}</b>
                            </div>
                            <div className="cost-breakdown-item">
                              <span>Handling cost</span>
                              <b>{money(scenario.optimized.metrics.handling_cost)}</b>
                            </div>
                            <div className="cost-breakdown-item">
                              <span>Unmet demand</span>
                              <b>{fmt(scenario.optimized.metrics.unmet_demand_kg)} kg</b>
                            </div>
                          </div>

                          {/* Scenario Economic P&L Cards */}
                          <div style={{ marginTop: 14 }}>
                            <PnlCards m={scenario.optimized.metrics} />
                          </div>

                          {/* Scenario Quarantined Waste */}
                          <QuarantinedWasteTable
                            waste={scenario.quarantined_waste || scenario.optimized?.quarantined_waste || []}
                            immediateSpoilageKg={scenario.immediate_spoilage_kg || scenario.optimized?.immediate_spoilage_kg || 0}
                            expanded={quarantineExpanded}
                            onToggle={() => setQuarantineExpanded(!quarantineExpanded)}
                          />

                          {/* Assumptions */}
                          <div className="assumption-box" style={{ marginTop: 12 }}>
                            <Activity size={18} />
                            <div>
                              <b>Scenario assumptions & conditions</b>
                              <p>
                                {scenario.scenario_assumptions ? scenario.scenario_assumptions.join(' · ') : `Demand ${demand > 0 ? '+' : ''}${demand}%, delay +${delay}h, capacity ${capacity > 0 ? '+' : ''}${capacity}%. Strict shelf life limits applied.`}
                              </p>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="scenario-empty">
                          <Activity size={32} />
                          <b>Awaiting scenario execution</b>
                          <p>Click any realistic scenario above or adjust the sliders to benchmark the optimizer against the baseline.</p>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}

              {/* PAGE 5: AI COPILOT */}
              {page === 'AI copilot' && (
                <div className="copilot-layout">
                  <section className="panel copilot-main">
                    <div className="copilot-header">
                      <div className="copilot-logo">
                        <img src="/agronex-mark.png" alt="AgroNex Logo" />
                      </div>
                      <div>
                        <h3>AgroNex AI Logistics Copilot</h3>
                        <p>Powered by Local Qwen LLM on NVIDIA GPU · Grounded in live mathematical plan</p>
                      </div>
                      <span className="status-tag status-ok">
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', display: 'inline-block', marginRight: 4 }} />
                        {aiStatus?.local_ollama ? 'LOCAL QWEN ACTIVE' : 'ONLINE'}
                      </span>
                    </div>

                    {/* Model & Hardware Status Card */}
                    <div className="copilot-model-card" style={{ marginTop: 16 }}>
                      <div className="copilot-model-info">
                        <div className="copilot-model-icon">
                          <Cpu size={17} />
                        </div>
                        <div>
                          <b>Model: {aiStatus?.active_model || 'qwen3:8b'} ({aiStatus?.provider || 'Local Ollama'})</b>
                          <small>Context: Grounded with real-time P&L, {inventory.length} produce batches, and route dispatches</small>
                        </div>
                      </div>
                      <span className="copilot-gpu-pill">
                        <Sparkles size={11} /> {aiStatus?.acceleration || 'Local NVIDIA RTX GPU'}
                      </span>
                    </div>

                    {/* Suggested Question Pills */}
                    <div className="suggested-questions">
                      {[
                        'Why is produce with 0h shelf life quarantined for compost?',
                        'How does the Exact MILP solver compare to the heuristic engine?',
                        'Explain the MoFPI Net Economic Profit calculation in detail.',
                        'Which destinations have unmet demand and what are the corridor bottlenecks?',
                      ].map(q => (
                        <button key={q} type="button" onClick={() => ask(q)} disabled={asking}>
                          <span>{q}</span>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>

                    {/* Conversation History */}
                    <div className="chat-messages-container">
                      {chatHistory.map((msg, idx) => (
                        <div key={idx} className={`chat-bubble ${msg.sender}`}>
                          {msg.sender === 'assistant' && (
                            <div className="chat-bubble-source">
                              <Sparkles size={11} /> {msg.mode || 'AgroNex Copilot'}
                            </div>
                          )}
                          <div>{msg.text}</div>
                        </div>
                      ))}
                      {asking && (
                        <div className="chat-bubble assistant" style={{ fontStyle: 'italic', color: '#68826f' }}>
                          <span className="spinner" style={{ width: 14, height: 14, display: 'inline-block', marginRight: 8, verticalAlign: 'middle' }} />
                          Local Qwen model is analyzing operational constraints on GPU…
                        </div>
                      )}
                    </div>

                    {/* Chat Input */}
                    <form
                      className="chat-input"
                      onSubmit={e => {
                        e.preventDefault();
                        ask();
                      }}
                    >
                      <input
                        value={question}
                        onChange={e => setQuestion(e.target.value)}
                        placeholder="Ask local Qwen about batch allocations, spoilage penalties, or route feasibility…"
                        disabled={asking}
                      />
                      <button className="send-button" disabled={asking || !question.trim()}>
                        <Send size={16} />
                      </button>
                    </form>

                    <div className="copilot-disclaimer">
                      {asking ? 'Inference running locally on RTX GPU…' : 'Deterministic explanation grounded in real operational constraints.'}
                    </div>
                  </section>

                  <section className="copilot-side">
                    <div className="panel">
                      <div className="panel-heading">
                        <div>
                          <h3>Hard constraints enforced</h3>
                          <p>Every dispatch satisfies these physical rules</p>
                        </div>
                      </div>
                      {[
                        ['Remaining shelf life', 'Produce must arrive before expiration time allowance'],
                        ['Delivery receiving window', 'Transit + handling must not exceed destination window'],
                        ['Destination demand', 'Dispatches capped strictly by destination requirement'],
                        ['Vehicle route capacity', 'Allocations never exceed available transport payload'],
                        ['Economic net value', 'Optimizes destination price net of transport freight & handling'],
                      ].map(([a, b]) => (
                        <div className="consider-row" key={a}>
                          <span>
                            <Check size={14} />
                          </span>
                          <div>
                            <b>{a}</b>
                            <small>{b}</small>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="copilot-note">
                      <ShieldCheck size={19} />
                      <b>Human-in-the-loop decision support</b>
                      <p>
                        Discount recommendations and route schedules assist dispatch managers. Validate final consignments against local handling and buyer acceptance before dispatch.
                      </p>
                    </div>
                  </section>
                </div>
              )}

              {page === 'Database & Audit' && (
                <div className="tab-pane active" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Database Tier Status Hero Banner */}
                  <div className="panel" style={{ borderLeft: '4px solid #10b981', padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ padding: '0.85rem', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                          <ShieldCheck size={30} color="#10b981" />
                        </div>
                        <div>
                          <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: '#f8fafc' }}>
                            Relational Database & Execution Audit Tier
                          </h3>
                          <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem', color: '#94a3b8' }}>
                            Connected via <b>SQLAlchemy 2.x ORM</b> to {dbTelemetry?.dialect ? dbTelemetry.dialect.toUpperCase() : 'Relational Database'} · 3-Tier Enterprise Architecture
                          </p>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <button
                          className="action-pill-btn"
                          onClick={fetchDbData}
                          title="Refresh Database Telemetry"
                        >
                          <RefreshCw size={14} /> Refresh DB Stats
                        </button>
                        <button
                          className="action-pill-btn"
                          style={{ borderColor: 'rgba(16, 185, 129, 0.35)', color: '#10b981', background: 'rgba(16, 185, 129, 0.08)' }}
                          onClick={handleSeedDatabase}
                          title="Re-seed database tables"
                        >
                          <Database size={14} /> Reset & Re-Seed Tables
                        </button>
                      </div>
                    </div>

                    {/* Table row counters */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
                      <div style={{ padding: '1.1rem', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.07)' }}>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Table: inventory_batches</span>
                        <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '6px', color: '#38bdf8' }}>
                          {dbTelemetry?.tables?.inventory_batches ?? inventory.length}
                        </div>
                        <small style={{ color: '#64748b', fontSize: '0.8rem' }}>Active perishable produce lots</small>
                      </div>

                      <div style={{ padding: '1.1rem', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.07)' }}>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Table: destinations</span>
                        <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '6px', color: '#c084fc' }}>
                          {dbTelemetry?.tables?.destinations ?? 4}
                        </div>
                        <small style={{ color: '#64748b', fontSize: '0.8rem' }}>Wholesale mandis & centers</small>
                      </div>

                      <div style={{ padding: '1.1rem', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.07)' }}>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Table: transport_routes</span>
                        <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '6px', color: '#f59e0b' }}>
                          {dbTelemetry?.tables?.transport_routes ?? 4}
                        </div>
                        <small style={{ color: '#64748b', fontSize: '0.8rem' }}>Transit routes & corridors</small>
                      </div>

                      <div style={{ padding: '1.1rem', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.07)' }}>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Table: optimization_runs</span>
                        <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '6px', color: '#10b981' }}>
                          {dbTelemetry?.tables?.optimization_runs ?? dbHistory.length}
                        </div>
                        <small style={{ color: '#64748b', fontSize: '0.8rem' }}>Audited execution logs</small>
                      </div>
                    </div>
                  </div>

                  {/* Audit Trail Table of Execution Runs */}
                  <div className="panel" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
                          Optimization Run Audit Trail
                        </h4>
                        <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                          Persisted in connected database table: <code>optimization_runs</code>
                        </p>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: '#94a3b8', background: 'rgba(255, 255, 255, 0.04)', padding: '4px 10px', borderRadius: '6px' }}>
                        Showing {dbHistory.length} audited runs
                      </span>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                            <th style={{ padding: '10px' }}>Run ID</th>
                            <th style={{ padding: '10px' }}>Timestamp</th>
                            <th style={{ padding: '10px' }}>Solver Mode</th>
                            <th style={{ padding: '10px' }}>Delivered</th>
                            <th style={{ padding: '10px' }}>Spoiled</th>
                            <th style={{ padding: '10px' }}>Net Revenue</th>
                            <th style={{ padding: '10px' }}>Net Profit</th>
                            <th style={{ padding: '10px' }}>Fulfillment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dbHistory.map((run: any) => (
                            <tr key={run.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                              <td style={{ padding: '10px', fontFamily: 'monospace', fontWeight: 700 }}>#{run.id}</td>
                              <td style={{ padding: '10px', color: '#94a3b8' }}>
                                {run.timestamp ? new Date(run.timestamp).toLocaleTimeString() : 'Recent'}
                              </td>
                              <td style={{ padding: '10px' }}>
                                <span style={{ padding: '2px 8px', borderRadius: '4px', background: run.solver_mode === 'milp' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(56, 189, 248, 0.15)', color: run.solver_mode === 'milp' ? '#c084fc' : '#38bdf8', fontSize: '0.75rem', fontWeight: 600 }}>
                                  {String(run.solver_mode || 'HEURISTIC').toUpperCase()}
                                </span>
                              </td>
                              <td style={{ padding: '10px', fontWeight: 600 }}>{fmt(run.delivered_kg)} kg</td>
                              <td style={{ padding: '10px', color: run.spoiled_kg > 0 ? '#ef4444' : '#10b981' }}>{fmt(run.spoiled_kg)} kg</td>
                              <td style={{ padding: '10px' }}>{money(run.net_revenue_inr)}</td>
                              <td style={{ padding: '10px', color: run.net_profit_inr >= 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                                {money(run.net_profit_inr)}
                              </td>
                              <td style={{ padding: '10px' }}>
                                {fmt(run.demand_fulfillment_percent)}%
                              </td>
                            </tr>
                          ))}
                          {dbHistory.length === 0 && (
                            <tr>
                              <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                                No optimization runs logged yet. Execute a plan to record audit logs to the database.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <footer>
            <div>
              <img src="/agronex-mark.png" alt="AgroNex Mark" />
              <span>
                <b>AgroNex</b> · Intelligent Perishable Produce Distribution System
              </span>
            </div>
            <span>
              Regional Supply Network <i /> Grounded in deterministic constraints
            </span>
          </footer>
        </div>
      </main>

      {/* Upload CSV Modal */}
      {showUploadModal && (
        <div className="modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Upload Supply Network Data</h3>
              <button onClick={() => setShowUploadModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="tab-bar">
                {(['inventory', 'destinations', 'transport'] as const).map(tab => (
                  <button
                    key={tab}
                    className={`tab-btn ${uploadEntity === tab ? 'active' : ''}`}
                    onClick={() => { setUploadEntity(tab); setUploadCsvText(''); }}
                  >
                    {tab === 'inventory' ? 'Inventory Batches' : tab === 'destinations' ? 'Destination Demand' : 'Transport Routes'}
                  </button>
                ))}
              </div>

              <label className="upload-dropzone">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                <FileUp size={24} />
                <b>Choose a CSV file to upload</b>
                <p>Or paste CSV content directly into the editor below</p>
              </label>

              <textarea
                className="csv-textarea"
                value={uploadCsvText}
                onChange={e => setUploadCsvText(e.target.value)}
                placeholder={`Paste ${uploadEntity} CSV text here...`}
              />
            </div>

            <div className="modal-foot">
              <a
                href={`${API}/api/data/template/${uploadEntity}`}
                target="_blank"
                rel="noreferrer"
              >
                <Download size={13} /> Download {uploadEntity} CSV Template
              </a>

              <div className="modal-actions">
                <button className="btn btn-light" onClick={() => setShowUploadModal(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={submitCsvUpload}
                  disabled={uploading || !uploadCsvText.trim()}
                >
                  <Upload size={14} /> {uploading ? 'Validating…' : 'Import & Replan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Operations Controller Profile & Settings Modal */}
      {showProfileModal && (
        <div className="modal-backdrop" onClick={() => setShowProfileModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><User size={18} style={{ verticalAlign: 'middle', marginRight: 8, color: '#1e6440' }} /> Operations Controller Profile</h3>
              <button type="button" onClick={() => setShowProfileModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: '#f5f9f3', borderRadius: 12, marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: '#1e6440', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 800 }}>
                  AN
                </div>
                <div>
                  <b style={{ fontSize: 13, color: '#1a3325' }}>Lead Dispatch Operations Controller</b>
                  <small style={{ display: 'block', color: '#68826f', marginTop: 2 }}>{activeWorkspace}</small>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#15803d', fontWeight: 700, marginTop: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} /> Active Session (Production Node)
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
                <div style={{ padding: '12px 14px', border: '1px solid #e2ebd8', borderRadius: 10, background: '#fff' }}>
                  <span style={{ fontSize: 10, color: '#778a7b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>
                    Hardware & AI Acceleration
                  </span>
                  <b style={{ fontSize: 12, color: '#1f3829', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Cpu size={16} color="#16a34a" /> {aiStatus?.acceleration || 'NVIDIA GeForce RTX Local GPU'}
                  </b>
                  <small style={{ color: '#62796a', display: 'block', marginTop: 4 }}>
                    Model: <strong>{aiStatus?.active_model || 'qwen3:8b'}</strong> ({aiStatus?.provider || 'Local Ollama'}) · Zero-latency private inference
                  </small>
                </div>

                <div style={{ padding: '12px 14px', border: '1px solid #e2ebd8', borderRadius: 10, background: '#fff' }}>
                  <span style={{ fontSize: 10, color: '#778a7b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>
                    Active Optimization Engine
                  </span>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      className={`btn ${solverMode === 'heuristic' ? 'btn-primary' : 'btn-light'}`}
                      style={{ flex: 1, fontSize: 11, height: 34 }}
                      onClick={() => handleSolverModeChange('heuristic')}
                    >
                      Heuristic (Fast)
                    </button>
                    <button
                      type="button"
                      className={`btn ${solverMode === 'milp' ? 'btn-primary' : 'btn-light'}`}
                      style={{ flex: 1, fontSize: 11, height: 34 }}
                      onClick={() => handleSolverModeChange('milp')}
                    >
                      <Sparkles size={13} /> Exact MILP (Optimal)
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ borderTop: '1px solid #edf2ea', paddingTop: 14 }}>
                <span style={{ fontSize: 10, color: '#778a7b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>
                  Database Maintenance & Reset
                </span>
                <p style={{ fontSize: 10, color: '#6b7d70', lineHeight: 1.5, margin: '0 0 10px' }}>
                  Restore all produce batches, demand nodes, and transport corridors to the verified initial benchmark snapshot.
                </p>
                <button
                  type="button"
                  className="btn btn-light"
                  style={{ width: '100%', borderColor: '#fca5a5', color: '#b91c1c' }}
                  onClick={handleResetDatabase}
                >
                  <RefreshCw size={14} /> Reset Network to Default Snapshot
                </button>
              </div>
            </div>

            <div className="modal-foot">
              <span style={{ fontSize: 10, color: '#7a8e80' }}>AgroNex v1.2.0 Production Build</span>
              <button type="button" className="btn btn-primary" onClick={() => setShowProfileModal(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Produce Batch Modal */}
      {showAddBatchModal && (
        <div className="modal-backdrop" onClick={() => setShowAddBatchModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Plus size={18} style={{ verticalAlign: 'middle', marginRight: 6, color: '#1e6440' }} /> Add Produce Inventory Batch</h3>
              <button type="button" onClick={() => setShowAddBatchModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleQuickAddBatch}>
              <div className="modal-body">
                <p style={{ fontSize: 11, color: '#667c6d', margin: '0 0 16px', lineHeight: 1.5 }}>
                  Enter fresh produce lot details. Batches with remaining shelf life &le; handling buffer (1h) will be automatically quarantined for composting.
                </p>

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Commodity</label>
                    <select
                      className="form-select"
                      value={newBatch.commodity}
                      onChange={e => setNewBatch({ ...newBatch, commodity: e.target.value })}
                    >
                      <option value="Tomatoes">Tomatoes (Solanum lycopersicum)</option>
                      <option value="Mangoes">Mangoes (Alphonso / Kesar)</option>
                      <option value="Apples">Apples (Shimla / Kinnaur)</option>
                      <option value="Onions">Onions (Nashik Red)</option>
                      <option value="Spinach">Spinach (Fresh Leafy Green)</option>
                      <option value="Strawberries">Strawberries (Mahabaleshwar)</option>
                      <option value="Grapes">Grapes (Thomson Seedless)</option>
                      <option value="Bell Peppers">Bell Peppers (Capsicum)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Quantity (kg)</label>
                    <input
                      type="number"
                      className="form-input"
                      required
                      min="10"
                      step="10"
                      value={newBatch.quantity_kg}
                      onChange={e => setNewBatch({ ...newBatch, quantity_kg: Number(e.target.value) })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Remaining Shelf Life (Hours)</label>
                    <input
                      type="number"
                      className="form-input"
                      required
                      min="0"
                      step="0.5"
                      value={newBatch.remaining_shelf_life_hours}
                      onChange={e => setNewBatch({ ...newBatch, remaining_shelf_life_hours: Number(e.target.value) })}
                    />
                    <span className="form-hint">0h = Expired (Immediate Compost Quarantine)</span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Target Selling Price (₹/kg)</label>
                    <input
                      type="number"
                      className="form-input"
                      required
                      min="1"
                      step="1"
                      value={newBatch.selling_price_per_kg}
                      onChange={e => setNewBatch({ ...newBatch, selling_price_per_kg: Number(e.target.value) })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Farmer Procurement COGS (₹/kg)</label>
                    <input
                      type="number"
                      className="form-input"
                      required
                      min="0"
                      step="1"
                      value={newBatch.unit_cost_per_kg}
                      onChange={e => setNewBatch({ ...newBatch, unit_cost_per_kg: Number(e.target.value) })}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Dock Handling Time (Hours)</label>
                    <input
                      type="number"
                      className="form-input"
                      required
                      min="0.5"
                      step="0.5"
                      value={newBatch.handling_time_hours}
                      onChange={e => setNewBatch({ ...newBatch, handling_time_hours: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-foot">
                <button type="button" className="btn btn-light" onClick={() => setShowAddBatchModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={addingBatch}>
                  <Plus size={15} /> {addingBatch ? 'Saving & Optimizing…' : 'Add to Inventory & Optimize'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  foot,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  foot: string;
  tone: string;
}) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>
        <Icon size={18} />
      </div>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-foot">{foot}</span>
    </div>
  );
}

function AllocationTable({ plan, detailed = false }: { plan?: Plan; detailed?: boolean }) {
  const allocations = plan?.allocations || [];
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Batch / Produce</th>
            <th>Destination Hub</th>
            <th>Dispatched Quantity</th>
            <th>Transit Arrival</th>
            <th>Net Sales Value</th>
            {detailed && <th>Route Feasibility & Scarcity Reason</th>}
          </tr>
        </thead>
        <tbody>
          {allocations.slice(0, detailed ? 100 : 5).map((a: any, i: number) => (
            <tr key={`${a.batch_id}-${a.destination_id}-${i}`}>
              <td>
                <b className="batch-code">{a.batch_id}</b>
                <span className="subcell">{a.commodity} · from {a.origin_id}</span>
              </td>
              <td>
                <div className="destination-cell">
                  <MapPin size={14} />
                  <span>{a.destination_name}</span>
                </div>
              </td>
              <td>
                <b>{fmt(a.quantity_kg)} kg</b>
              </td>
              <td>
                <span className="arrival-pill">
                  <Clock3 size={12} />
                  {fmt(a.arrival_time_hours)}h
                </span>
              </td>
              <td>
                <b>{money(a.expected_revenue)}</b>
                <span className="subcell">
                  -{money((a.transport_cost || 0) + (a.handling_cost || 0))} costs
                </span>
              </td>
              {detailed && <td className="reason-cell">{a.reason}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!allocations.length && (
        <div className="empty-chart">No feasible dispatches found under current network constraints.</div>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (n: number) => void;
  note: string;
}) {
  return (
    <div className="slider-control">
      <div className="slider-heading">
        <label>{label}</label>
        <b>
          {value > 0 ? '+' : ''}
          {value}
          {suffix}
        </b>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <div className="slider-limits">
        <span>{min}{suffix}</span>
        <span>{max}{suffix}</span>
      </div>
      <p>{note}</p>
    </div>
  );
}

function PnlCards({ m }: { m?: PlanMetrics }) {
  if (!m) return null;
  return (
    <div className="pnl-grid">
      <div className="pnl-card profit">
        <div className="pnl-label">
          <span>MoFPI Net Economic Profit</span>
          <TrendingUp size={14} color="#15803d" />
        </div>
        <span className="pnl-value profit">{money(m.net_profit)}</span>
        <span className="pnl-sub">
          Delivered Revenue - Transport - Handling - COGS - Spoilage Penalties
        </span>
      </div>

      <div className="pnl-card cogs">
        <div className="pnl-label">
          <span>Delivered Produce COGS</span>
          <Package size={14} color="#475569" />
        </div>
        <span className="pnl-value cogs">{money(m.procurement_cost)}</span>
        <span className="pnl-sub">
          Farmer acquisition cost for {fmt(m.delivered_kg)} kg dispatched produce
        </span>
      </div>

      <div className="pnl-card spoilage">
        <div className="pnl-label">
          <span>Spoilage Write-Off & Disposal</span>
          <AlertTriangle size={14} color="#b91c1c" />
        </div>
        <span className="pnl-value spoilage">-{money(m.spoilage_penalties)}</span>
        <span className="pnl-sub">
          Lost inventory value + ₹5/kg environmental composting fee
        </span>
      </div>
    </div>
  );
}

function QuarantinedWasteTable({
  waste = [],
  immediateSpoilageKg = 0,
  expanded,
  onToggle,
}: {
  waste?: QuarantinedWaste[];
  immediateSpoilageKg?: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!waste || waste.length === 0) return null;
  return (
    <div className="quarantine-panel">
      <div className="quarantine-header" onClick={onToggle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="quarantine-badge">
            <Leaf size={12} /> IMMEDIATE COMPOST WASTE
          </span>
          <b style={{ fontSize: 12, color: '#991b1b' }}>
            Quarantined Waste (Organic Compost & Biogas Diversion)
          </b>
          <span style={{ fontSize: 11, color: '#b91c1c' }}>
            ({waste.length} batches · {fmt(immediateSpoilageKg)} kg)
          </span>
        </div>
        <button
          style={{ background: 'transparent', border: 0, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 4 }}
          type="button"
        >
          <small style={{ fontWeight: 700 }}>{expanded ? 'Collapse' : 'Expand'}</small>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {expanded && (
        <div className="table-scroll" style={{ background: '#fff' }}>
          <table>
            <thead>
              <tr>
                <th>Batch ID</th>
                <th>Commodity</th>
                <th>Quantity</th>
                <th>Shelf Life vs Buffer</th>
                <th>Classification</th>
                <th>Action & Grounded Justification</th>
              </tr>
            </thead>
            <tbody>
              {waste.map(w => (
                <tr key={w.batch_id}>
                  <td><b className="batch-code" style={{ color: '#991b1b' }}>{w.batch_id}</b></td>
                  <td>
                    <div className="commodity-cell">
                      <span className="mini-leaf" style={{ background: '#fee2e2', color: '#991b1b' }}>
                        <Leaf size={14} />
                      </span>
                      {w.commodity}
                    </div>
                  </td>
                  <td><b>{fmt(w.quantity_kg)} kg</b></td>
                  <td>
                    <span style={{ fontSize: 10, color: '#991b1b', fontWeight: 600 }}>
                      {fmt(w.remaining_shelf_life_hours || 0)}h &le; {fmt(w.handling_time_hours || 0)}h buffer
                    </span>
                  </td>
                  <td>
                    <span className="status-tag status-risk" style={{ background: '#fee2e2', color: '#991b1b' }}>
                      {w.status}
                    </span>
                  </td>
                  <td className="reason-cell" style={{ color: '#7f1d1d' }}>
                    {w.reason || w.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default App;
