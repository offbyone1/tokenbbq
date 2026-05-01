import type { DashboardData } from './types.js';
import { SOURCE_COLORS, SOURCE_LABELS } from './types.js';
import { SOURCE_ORDER } from './aggregator.js';
import { DASHBOARD_BRAND_ICON_DATA_URL } from './dashboard-icon.js';

export function renderDashboard(data: DashboardData, options?: any): string {
	const jsonData = JSON.stringify(data).replace(/</g, "\\u003c");
	const brandLogoUrl = options?.brandLogoUrl ?? null;
	return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TokenBBQ Dashboard</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#E87B35" d="M16 3c2 5-2 7-2 11 0 3 2 5 4 5s4-2 4-5c0-2-1-3-1-5 4 3 6 7 6 11 0 6-5 10-11 10S5 26 5 20c0-7 7-9 11-17z"/></svg>`,
	)}">
<script src="https://cdn.tailwindcss.com"><\/script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
<script>
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#0f1117',
        card: '#1a1d27',
        border: '#2a2d37',
        'light-card': '#ffffff',
        'light-border': '#e5e7eb',
        'light-surface': '#f9fafb',
      }
    }
  }
}
<\/script>
<style>
  .dark body { background: #0f1117; }
  .light body { background: #f9fafb; }
  .dashboard-shell,
  .dashboard-shell * {
    user-select: none;
    -webkit-user-select: none;
    caret-color: transparent;
    cursor: default;
  }
  .heatmap-cell { width: 14px; height: 14px; border-radius: 3px; cursor: pointer; transition: transform 0.1s; }
  .heatmap-cell:hover { transform: scale(1.3); }
  .dark .heatmap-0 { background: #1a1d27; }
  .dark .heatmap-1 { background: #0e4429; }
  .dark .heatmap-2 { background: #006d32; }
  .dark .heatmap-3 { background: #26a641; }
  .dark .heatmap-4 { background: #39d353; }
  .light .heatmap-0 { background: #ebedf0; }
  .light .heatmap-1 { background: #9be9a8; }
  .light .heatmap-2 { background: #40c463; }
  .light .heatmap-3 { background: #30a14e; }
  .light .heatmap-4 { background: #216e39; }
  .sort-btn { cursor: pointer; user-select: none; }
  .sort-btn:hover { color: #E87B35; }
  .sort-asc::after { content: ' ▲'; font-size: 8px; }
  .sort-desc::after { content: ' ▼'; font-size: 8px; }
  .daily-row-toggle {
    display: inline-block;
    color: #6b7280;
    font-size: 11px;
    line-height: 1;
    transform-origin: center;
    transition: transform 0.16s ease, color 0.16s ease;
  }
  .daily-row-toggle.open {
    color: #E87B35;
    transform: rotate(90deg);
  }
  .table-parent-row {
    cursor: pointer !important;
  }
  .table-child-row {
    animation: table-child-reveal 0.16s ease-out;
  }
  .table-tree-bullet-wrap {
    display: inline-flex;
    align-items: center;
    padding-left: 24px;
    min-height: 20px;
  }
  .table-tree-bullet {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    transform: rotate(45deg);
    background: linear-gradient(135deg, #f7c778 0%, #e87b35 100%);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 0 10px rgba(232, 123, 53, 0.18);
  }
  @keyframes table-child-reveal {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .brand-mark {
    display: inline-flex;
    width: 46px;
    height: 46px;
    flex: 0 0 46px;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 4px 10px rgba(232, 123, 53, 0.3));
  }
  .brand-mark svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .brand-mark img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .dashboard-shell button,
  .dashboard-shell select,
  .dashboard-shell a,
  .dashboard-shell .sort-btn,
  .dashboard-shell .heatmap-cell {
    cursor: pointer;
  }
  @media (max-width: 640px) {
    .brand-mark {
      width: 40px;
      height: 40px;
      flex-basis: 40px;
    }
  }
  .clickable-card { cursor: pointer; transition: transform 0.3s cubic-bezier(0.16,1,0.3,1), border-color 0.2s, box-shadow 0.2s; will-change: transform; }
  .clickable-card:hover { border-color: rgba(232,123,53,0.55) !important; box-shadow: 0 8px 24px rgba(0,0,0,0.15), 0 0 0 1px rgba(232,123,53,0.1); }
  .clickable-card:active { transform: scale(0.975); opacity: 0.9; transition: transform 0.1s cubic-bezier(0.16,1,0.3,1); }
  #popupOverlay {
    visibility: hidden;
    opacity: 0;
    transition: visibility 0s 0.35s, opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
  }
  @supports (-webkit-backdrop-filter: none) or (backdrop-filter: none) {
    #popupOverlay {
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
    }
  }
  #popupOverlay.popup-open {
    visibility: visible;
    opacity: 1;
    transition: visibility 0s 0s, opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }
  #popupBox {
    opacity: 0;
    transform-origin: 50% 50%;
    transform: translate(var(--tx-x, 0px), var(--tx-y, 10px)) scale(var(--tx-s, 0.9));
    transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), border-radius 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    scrollbar-width: thin; scrollbar-color: #353849 transparent;
    border-radius: 20px;
  }
  #popupOverlay.popup-open #popupBox {
    opacity: 1;
    transform: translate(0, 0) scale(1);
    border-radius: 12px;
  }
  #popupBox::-webkit-scrollbar { width: 5px; }
  #popupBox::-webkit-scrollbar-track { background: transparent; }
  #popupBox::-webkit-scrollbar-thumb { background: #353849; border-radius: 3px; }
  .p-stat-grid { display: grid; gap: 10px; margin: 12px 0; }
  .p-stat-grid.cols-2 { grid-template-columns: 1fr 1fr; }
  .p-stat-grid.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
  .p-stat-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 12px 14px; position: relative; overflow: hidden; }
  .p-stat-card::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; border-radius:10px 10px 0 0; }
  .p-stat-card .p-stat-val { font-size: 20px; font-weight: 700; color: #f9fafb; line-height: 1.2; }
  .p-stat-card .p-stat-lbl { font-size: 11px; color: #6b7280; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.04em; }
  .p-donut-wrap { display: flex; align-items: center; gap: 20px; margin: 12px 0; }
  .p-donut-legend { flex: 1; min-width: 0; }
  .p-donut-legend-item { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; }
  .p-donut-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .p-ring-wrap { display: flex; flex-direction: column; align-items: center; }
  .p-ring-label { font-size: 11px; color: #6b7280; margin-top: 6px; text-align: center; }
  .p-bar-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
  .p-bar-label { flex: 0 0 100px; font-size: 12px; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .p-bar-track { flex: 1; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; }
  .p-bar-fill { height: 100%; border-radius: 3px; animation: bar-reveal 0.5s ease-out; }
  .p-bar-val { flex: 0 0 70px; text-align: right; font-size: 12px; color: #e5e7eb; font-weight: 500; }
  @keyframes bar-reveal { from { width: 0; } }
  @keyframes ring-fill { from { stroke-dashoffset: var(--ring-circ); } }
  @keyframes donut-fill { from { stroke-dashoffset: var(--seg-circ); } }
  @keyframes spark-draw { from { stroke-dashoffset: var(--spark-len); } to { stroke-dashoffset: 0; } }
  .p-spark-line { animation: spark-draw 0.8s ease-out forwards; }
</style>
</head>
<body class="dark text-gray-200 min-h-screen p-4 md:p-8 transition-colors duration-200">

<div class="max-w-7xl mx-auto dashboard-shell">
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-3xl font-bold text-white dark:text-white flex items-center gap-3">
        <span class="brand-mark" aria-hidden="true"><img src="${brandLogoUrl ?? DASHBOARD_BRAND_ICON_DATA_URL}" alt="" /></span>
        TokenBBQ
      </h1>
      <p class="text-gray-400 mt-1">AI Coding Tool Usage Dashboard</p>
    </div>
    <div class="flex items-center gap-4">
      <select id="timeFilter" class="bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
        <option value="all">All Time</option>
        <option value="7">Last 7 Days</option>
        <option value="30">Last 30 Days</option>
        <option value="90" selected>Last 90 Days</option>
      </select>
      <button id="themeToggle" class="p-2 rounded-lg bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border hover:bg-border/50 transition-colors" title="Toggle theme">
        <svg id="sunIcon" class="w-5 h-5 hidden" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd"></path></svg>
        <svg id="moonIcon" class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"></path></svg>
      </button>
    </div>
  </div>
  <div class="flex items-center justify-between mb-6 text-sm text-gray-500">
    <div id="sourcesList"></div>
    <div>Generated: <span id="generated"></span></div>
  </div>

  <!-- Summary Cards -->
  <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
    <div id="card-total-tokens" class="clickable-card bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5">
      <div class="text-gray-400 text-sm mb-1">Total Tokens</div>
      <div class="text-2xl font-bold text-blue-400" id="totalTokens"></div>
    </div>
    <div id="card-total-cost" class="clickable-card bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5">
      <div class="text-gray-400 text-sm mb-1">Total Cost</div>
      <div class="text-2xl font-bold text-orange-400" id="totalCost"></div>
    </div>
    <div id="card-cost-per-day" class="clickable-card bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5">
      <div class="text-gray-400 text-sm mb-1">Cost / Day</div>
      <div class="text-2xl font-bold text-yellow-400" id="costPerDay"></div>
    </div>
    <div id="card-active-days" class="clickable-card bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5">
      <div class="text-gray-400 text-sm mb-1">Active Days</div>
      <div class="text-2xl font-bold text-green-400" id="activeDays"></div>
    </div>
    <div id="card-top-model" class="clickable-card bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5">
      <div class="text-gray-400 text-sm mb-1">Top Model</div>
      <div class="text-lg font-bold truncate" id="topModel"></div>
    </div>
  </div>

  <!-- Charts Row 1 -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
    <div id="chart-daily" class="clickable-card lg:col-span-2 bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5">
      <h2 class="text-lg font-semibold text-white dark:text-white light:text-gray-900 mb-4">Daily Token Usage</h2>
      <canvas id="dailyChart" height="100"></canvas>
    </div>
    <div id="chart-source" class="clickable-card bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5">
      <h2 class="text-lg font-semibold text-white dark:text-white light:text-gray-900 mb-4">Tokens by Provider</h2>
      <canvas id="sourceChart" height="200"></canvas>
    </div>
  </div>

  <!-- Charts Row 2 -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
    <div id="chart-model" class="clickable-card bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5">
      <h2 class="text-lg font-semibold text-white dark:text-white light:text-gray-900 mb-4">Top Models by Tokens</h2>
      <canvas id="modelChart" height="160"></canvas>
    </div>
    <div id="chart-monthly" class="clickable-card bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5">
      <h2 class="text-lg font-semibold text-white dark:text-white light:text-gray-900 mb-4">Monthly Trend</h2>
      <canvas id="monthlyChart" height="160"></canvas>
    </div>
  </div>

  <!-- Activity Heatmap -->
  <div id="chart-heatmap" class="clickable-card bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5 mb-4">
    <h2 class="text-lg font-semibold text-white dark:text-white light:text-gray-900 mb-4" id="heatmapTitle">Activity (Last 90 Days)</h2>
    <div id="heatmap" class="flex gap-[3px] flex-wrap"></div>
  </div>

  <!-- Projects -->
  <div id="chart-projects" class="bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5 mb-4">
    <h2 class="text-lg font-semibold text-white dark:text-white light:text-gray-900 mb-4">Projects</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-gray-400 border-b border-border dark:border-border light:border-light-border">
            <th class="text-left py-2 px-3 sort-btn" data-proj-sort="project">Project</th>
            <th class="text-left py-2 px-3">Providers</th>
            <th class="text-right py-2 px-3 sort-btn" data-proj-sort="tokens">Tokens</th>
            <th class="text-right py-2 px-3 sort-btn" data-proj-sort="cost">Cost</th>
            <th class="text-right py-2 px-3 sort-btn" data-proj-sort="events">Events</th>
            <th class="text-right py-2 px-3 sort-btn" data-proj-sort="last">Last Active</th>
          </tr>
        </thead>
        <tbody id="projectsTableBody"></tbody>
      </table>
    </div>
      <div class="mt-3 flex justify-center">
        <button id="projectsToggleAll" class="text-sm text-gray-400 hover:text-white dark:hover:text-white light:hover:text-gray-900 transition-colors hidden">
          Show all
        </button>
      </div>
  </div>

  <!-- Daily Table -->
  <div class="bg-card dark:bg-card light:bg-light-card border border-border dark:border-border light:border-light-border rounded-xl p-5">
    <div class="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
      <h2 class="text-lg font-semibold text-white dark:text-white light:text-gray-900">Daily Breakdown</h2>
      <div id="dailyTableFilters" class="flex flex-wrap gap-2"></div>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-gray-400 border-b border-border dark:border-border light:border-light-border">
            <th class="text-left py-2 px-3 sort-btn" data-sort="date">Date</th>
            <th class="text-left py-2 px-3">Sources</th>
            <th class="text-right py-2 px-3 sort-btn" data-sort="input">Input</th>
            <th class="text-right py-2 px-3 sort-btn" data-sort="output">Output</th>
            <th class="text-right py-2 px-3 sort-btn" data-sort="cacheRead">Cache R</th>
            <th class="text-right py-2 px-3 sort-btn" data-sort="cacheCreation">Cache W</th>
            <th class="text-right py-2 px-3 sort-btn" data-sort="cost">Cost</th>
          </tr>
        </thead>
        <tbody id="dailyTableBody"></tbody>
      </table>
    </div>
  </div>

  <!-- Footer -->
  <div class="text-center text-gray-600 text-sm mt-8 mb-4">
    TokenBBQ &mdash; <a href="https://github.com/offbyone1/tokenbbq" class="text-gray-500 hover:text-gray-300 underline">github.com/offbyone1/tokenbbq</a>
  </div>
</div>

<!-- Deep-Info Popup Modal -->
<div id="popupOverlay" role="dialog" aria-modal="true"
  style="position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:9999;align-items:center;justify-content:center;padding:16px">
  <div id="popupBox"
    class="bg-card dark:bg-card border border-border dark:border-border rounded-xl"
    style="width:100%;max-width:780px;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,0.5);overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid #2a2d37;flex-shrink:0">
      <h3 id="popupTitle" class="text-white dark:text-white" style="font-size:15px;font-weight:600;margin:0"></h3>
      <button type="button" id="popupClose"
        class="text-gray-500 hover:text-white"
        style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:none;background:transparent;font-size:15px;cursor:pointer;flex-shrink:0">✕</button>
    </div>
    <div id="popupContent" class="text-gray-300" style="overflow-y:auto;padding:4px 20px 20px;flex:1;font-size:13px"></div>
  </div>
</div>

<script>
let DATA = ${jsonData};
const SOURCE_COLORS = ${JSON.stringify(SOURCE_COLORS)};
const SOURCE_LABELS = ${JSON.stringify(SOURCE_LABELS)};
const SOURCE_ORDER = ${JSON.stringify(SOURCE_ORDER)};
const BRAND_COLORS = {
  primary: '#E87B35',
  primarySoft: '#E87B3533',
  primaryGhost: '#E87B3510',
  trendUp: '#dc6b5c',
  trendDown: '#74aa9c',
};
const LIVE_REFRESH_MS = 5000;

let filteredData = null;
let dailyChartInstance = null;
let sourceChartInstance = null;
let modelChartInstance = null;
let monthlyChartInstance = null;
let popupHeroChart = null;
let currentSort = { key: 'date', dir: 'desc' };
let currentProjSort = { key: 'tokens', dir: 'desc' };
let projectsExpanded = false;
const expandedProjects = new Set();
let currentTimeFilter = '90';
let selectedTableSources = new Set();
let tableSourceFilterDirty = false;
let expandedTableDates = new Set();
let liveRefreshInFlight = false;
let lastDataSignature = '';

function fmt(n) { return n.toLocaleString('en-US'); }
function fmtUSD(n) { return '$' + n.toFixed(2); }
function fmtTokens(n) {
  if (n == null || isNaN(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString('en-US');
}
function shortModel(m) {
  if (!m || m === 'N/A') return 'N/A';
  return m.replace(/^claude-/, '').replace(/-\\d{8}$/, '').replace(/^\\[pi\\]\\s*/, '[pi] ');
}
function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}
function emptyTokens() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 };
}
function addTokens(a, b) {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheRead: a.cacheRead + b.cacheRead,
    reasoning: a.reasoning + b.reasoning,
  };
}
function sumTokens(tokens) {
  return tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead;
}
function unique(values) {
  return [...new Set(values)];
}
function sourceRank(source) {
  const index = SOURCE_ORDER.indexOf(source);
  return index === -1 ? SOURCE_ORDER.length : index;
}
function sortSourceList(values) {
  return [...values].sort((a, b) => sourceRank(a) - sourceRank(b) || String(a).localeCompare(String(b)));
}
function dataSignature(data) {
  const { generated, ...rest } = data;
  return JSON.stringify(rest);
}
function renderGenerated(value) {
  document.getElementById('generated').textContent = new Date(value).toLocaleString();
}
function filterWindow(days) {
  if (days === 'all') return null;
  const count = Math.max(parseInt(days, 10) || 0, 1);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (count - 1));
  return {
    days: count,
    start,
    end,
    startKey: isoDate(start),
    endKey: isoDate(end),
    label: 'Last ' + count + ' Days',
  };
}
function inRange(dateKey, window) {
  return !window || (dateKey >= window.startKey && dateKey <= window.endKey);
}
function aggregateBySource(entries) {
  const sourceMap = Object.create(null);
  entries.forEach(entry => {
    if (!sourceMap[entry.source]) {
      sourceMap[entry.source] = {
        source: entry.source,
        tokens: emptyTokens(),
        costUSD: 0,
        models: [],
        eventCount: 0,
      };
    }
    sourceMap[entry.source].tokens = addTokens(sourceMap[entry.source].tokens, entry.tokens);
    sourceMap[entry.source].costUSD += entry.costUSD;
    sourceMap[entry.source].eventCount += entry.eventCount;
  });
  return Object.values(sourceMap).sort((a, b) => b.costUSD - a.costUSD);
}
function aggregateByModel(entries) {
  const modelMap = Object.create(null);
  entries.forEach(entry => {
    if (!modelMap[entry.model]) {
      modelMap[entry.model] = {
        model: entry.model,
        tokens: emptyTokens(),
        costUSD: 0,
        sources: [],
        eventCount: 0,
      };
    }
    modelMap[entry.model].tokens = addTokens(modelMap[entry.model].tokens, entry.tokens);
    modelMap[entry.model].costUSD += entry.costUSD;
    modelMap[entry.model].sources.push(...entry.sources);
    modelMap[entry.model].eventCount += entry.eventCount;
  });
  return Object.values(modelMap)
    .map(entry => ({ ...entry, sources: sortSourceList(unique(entry.sources)) }))
    .sort((a, b) => b.costUSD - a.costUSD);
}
function aggregateBySourceModel(entries) {
  const sourceModelMap = Object.create(null);
  entries.forEach(entry => {
    const key = entry.source + ':' + entry.model;
    if (!sourceModelMap[key]) {
      sourceModelMap[key] = {
        source: entry.source,
        model: entry.model,
        tokens: emptyTokens(),
        costUSD: 0,
        eventCount: 0,
      };
    }
    sourceModelMap[key].tokens = addTokens(sourceModelMap[key].tokens, entry.tokens);
    sourceModelMap[key].costUSD += entry.costUSD;
    sourceModelMap[key].eventCount += entry.eventCount;
  });
  return Object.values(sourceModelMap)
    .sort((a, b) => b.costUSD - a.costUSD || sourceRank(a.source) - sourceRank(b.source) || a.model.localeCompare(b.model));
}
function aggregateMonthly(daily) {
  const monthlyMap = Object.create(null);
  daily.forEach(entry => {
    const month = entry.date.slice(0, 7);
    if (!monthlyMap[month]) {
      monthlyMap[month] = {
        month,
        tokens: emptyTokens(),
        costUSD: 0,
        models: [],
        sources: [],
        eventCount: 0,
      };
    }
    monthlyMap[month].tokens = addTokens(monthlyMap[month].tokens, entry.tokens);
    monthlyMap[month].costUSD += entry.costUSD;
    monthlyMap[month].models.push(...entry.models);
    monthlyMap[month].sources.push(...entry.sources);
    monthlyMap[month].eventCount += entry.eventCount;
  });
  return Object.values(monthlyMap)
    .map(entry => ({
      ...entry,
      models: unique(entry.models),
      sources: sortSourceList(unique(entry.sources)),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
function aggregateDailyTableRows(entries) {
  const dailyMap = Object.create(null);
  entries.forEach(entry => {
    if (!dailyMap[entry.date]) {
      dailyMap[entry.date] = {
        date: entry.date,
        tokens: emptyTokens(),
        costUSD: 0,
        sources: [],
        eventCount: 0,
      };
    }
    dailyMap[entry.date].tokens = addTokens(dailyMap[entry.date].tokens, entry.tokens);
    dailyMap[entry.date].costUSD += entry.costUSD;
    dailyMap[entry.date].sources.push(entry.source);
    dailyMap[entry.date].eventCount += entry.eventCount;
  });
  return Object.values(dailyMap)
    .map(entry => ({ ...entry, sources: sortSourceList(unique(entry.sources)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
function buildTotals(daily, bySource, byModel) {
  const base = daily.reduce((acc, entry) => {
    acc.tokens = addTokens(acc.tokens, entry.tokens);
    acc.costUSD += entry.costUSD;
    acc.eventCount += entry.eventCount;
    return acc;
  }, { tokens: emptyTokens(), costUSD: 0, eventCount: 0 });

  return {
    ...DATA.totals,
    tokens: base.tokens,
    costUSD: base.costUSD,
    totalTokens: sumTokens(base.tokens),
    eventCount: base.eventCount,
    activeDays: daily.length,
    topModel: byModel[0]?.model || 'N/A',
    topSource: bySource[0]?.source || null,
  };
}
function filterData(days) {
  const window = filterWindow(days);
  const daily = DATA.daily.filter(entry => inRange(entry.date, window));
  const dailyBySource = DATA.dailyBySource.filter(entry => inRange(entry.date, window));
  const dailyByModel = DATA.dailyByModel.filter(entry => inRange(entry.date, window));
  const dailyBySourceModel = DATA.dailyBySourceModel.filter(entry => inRange(entry.date, window));
  const heatmap = DATA.heatmap.filter(entry => inRange(entry.date, window));
  const bySource = aggregateBySource(dailyBySource);
  const byModel = aggregateByModel(dailyByModel);
  const bySourceModel = aggregateBySourceModel(dailyBySourceModel);
  const monthly = aggregateMonthly(daily);

  return {
    ...DATA,
    daily,
    dailyBySource,
    dailyByModel,
    dailyBySourceModel,
    monthly,
    heatmap,
    bySource,
    byModel,
    bySourceModel,
    totals: buildTotals(daily, bySource, byModel),
    filter: {
      value: days,
      label: window ? window.label : 'All Time',
    },
  };
}
function renderSourcesList(data) {
  const html = sortSourceList(data.bySource.map(s => s.source)).map(source =>
    '<span class="inline-block px-2 py-0.5 rounded text-xs mr-1" style="background:' +
    SOURCE_COLORS[source] + '22;color:' + SOURCE_COLORS[source] + '">' +
    (SOURCE_LABELS[source] || source) + '</span>'
  ).join('');
  document.getElementById('sourcesList').innerHTML = html || '<span class="text-gray-500">No active sources</span>';
}
function getAvailableTableSources(data) {
  return sortSourceList(data.bySource.map(s => s.source));
}
function syncTableSourceSelection(data) {
  const availableSources = getAvailableTableSources(data);
  if (!tableSourceFilterDirty) {
    selectedTableSources = new Set(availableSources);
    return availableSources;
  }
  const nextSelection = new Set();
  availableSources.forEach(source => {
    if (selectedTableSources.has(source)) nextSelection.add(source);
  });
  selectedTableSources = nextSelection;
  return availableSources;
}
function allTableSourcesSelected(availableSources) {
  return availableSources.length > 0 && availableSources.every(source => selectedTableSources.has(source));
}
function renderTableFilters(data) {
  const container = document.getElementById('dailyTableFilters');
  container.innerHTML = '';

  const availableSources = syncTableSourceSelection(data);
  if (availableSources.length === 0) {
    container.innerHTML = '<span class="text-xs text-gray-500">No providers in this range</span>';
    return;
  }

  const allButton = document.createElement('button');
  const allActive = allTableSourcesSelected(availableSources);
  allButton.type = 'button';
  allButton.textContent = 'All';
  allButton.className = 'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors';
  allButton.style.background = allActive ? '#E87B3522' : 'transparent';
  allButton.style.borderColor = allActive ? '#E87B3555' : '#4b556333';
  allButton.style.color = allActive ? '#E87B35' : '#9ca3af';
  allButton.addEventListener('click', () => {
    selectedTableSources = new Set(availableSources);
    tableSourceFilterDirty = false;
    renderTableFilters(data);
    renderTable(data);
  });
  container.appendChild(allButton);

  availableSources.forEach(source => {
    const active = selectedTableSources.has(source);
    const color = SOURCE_COLORS[source] || '#666';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors';
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.style.background = active ? color + '22' : 'transparent';
    button.style.borderColor = active ? color + '55' : color + '33';
    button.style.color = active ? color : '#9ca3af';

    const dot = document.createElement('span');
    dot.className = 'inline-block w-2 h-2 rounded-full';
    dot.style.background = color;
    dot.style.opacity = active ? '1' : '0.45';
    button.appendChild(dot);
    button.appendChild(document.createTextNode(SOURCE_LABELS[source] || source));

    button.addEventListener('click', () => {
      if (selectedTableSources.has(source)) selectedTableSources.delete(source);
      else selectedTableSources.add(source);
      tableSourceFilterDirty = !availableSources.every(item => selectedTableSources.has(item));
      renderTableFilters(data);
      renderTable(data);
    });

    container.appendChild(button);
  });
}
function buildTableRows(data) {
  const availableSources = getAvailableTableSources(data);
  if (availableSources.length === 0) return [];
  if (allTableSourcesSelected(availableSources)) return aggregateDailyTableRows(data.dailyBySource);
  if (selectedTableSources.size === 0) return [];
  return aggregateDailyTableRows(data.dailyBySource.filter(entry => selectedTableSources.has(entry.source)));
}
function buildExpandedSourceRows(date, data) {
  return data.dailyBySource
    .filter(entry => entry.date === date && selectedTableSources.has(entry.source))
    .sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
}
function toggleExpandedDate(date) {
  if (expandedTableDates.has(date)) expandedTableDates.delete(date);
  else expandedTableDates.add(date);
}

function updateDashboard(data) {
  document.getElementById('totalCost').textContent = fmtUSD(data.totals.costUSD);
  document.getElementById('totalTokens').textContent = fmtTokens(data.totals.totalTokens);
  document.getElementById('activeDays').textContent = data.totals.activeDays;
  const topModelEl = document.getElementById('topModel');
  const topModelEntry = data.bySourceModel && data.bySourceModel.length > 0 ? data.bySourceModel[0] : null;
  topModelEl.textContent = shortModel(topModelEntry ? topModelEntry.model : data.totals.topModel);
  topModelEl.style.color = topModelEntry ? (SOURCE_COLORS[topModelEntry.source] || '#c084fc') : '#c084fc';
  
  const costPerDay = data.totals.activeDays > 0 ? data.totals.costUSD / data.totals.activeDays : 0;
  document.getElementById('costPerDay').textContent = fmtUSD(costPerDay);

  renderSourcesList(data);
  renderDailyChart(data);
  renderSourceChart(data);
  renderModelChart(data);
  renderMonthlyChart(data);
  renderHeatmap(data);
  window.__latestData = data;
  renderProjects(data);
  renderTableFilters(data);
  renderTable(data);
}

// Theme toggle
(function() {
  const html = document.documentElement;
  const sunIcon = document.getElementById('sunIcon');
  const moonIcon = document.getElementById('moonIcon');
  
  function updateTheme() {
    const isDark = html.classList.contains('dark');
    sunIcon.classList.toggle('hidden', isDark);
    moonIcon.classList.toggle('hidden', !isDark);
    Chart.defaults.color = isDark ? '#9ca3af' : '#6b7280';
    Chart.defaults.borderColor = isDark ? '#2a2d37' : '#e5e7eb';
  }
  
  document.getElementById('themeToggle').addEventListener('click', () => {
    html.classList.toggle('dark');
    html.classList.toggle('light');
    updateTheme();
    if (filteredData) updateDashboard(filteredData);
  });
  
  updateTheme();
})();

// Time filter
document.getElementById('timeFilter').addEventListener('change', (e) => {
  currentTimeFilter = e.target.value;
  filteredData = filterData(currentTimeFilter);
  updateDashboard(filteredData);
});
renderGenerated(DATA.generated);

// Chart defaults
Chart.defaults.color = '#9ca3af';
Chart.defaults.borderColor = '#2a2d37';
Chart.defaults.animation = false;

function renderDailyChart(data) {
  if (dailyChartInstance) dailyChartInstance.destroy();
  
  const labels = data.daily.map(d => d.date);
  const sources = data.bySource.map(s => s.source);
  const dailySourceLookup = Object.create(null);
  data.dailyBySource.forEach(entry => {
    dailySourceLookup[entry.date + ':' + entry.source] = sumTokens(entry.tokens);
  });

  const datasets = sources.map(src => ({
    label: SOURCE_LABELS[src] || src,
    data: data.daily.map(d => dailySourceLookup[d.date + ':' + src] || 0),
    backgroundColor: SOURCE_COLORS[src] || '#666',
    borderRadius: 3,
  }));

  dailyChartInstance = new Chart(document.getElementById('dailyChart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
      scales: {
        x: { stacked: true, ticks: { maxTicksLimit: 15 } },
        y: { stacked: true, ticks: { callback: v => fmt(Number(v)) } }
      }
    }
  });
}

function renderSourceChart(data) {
  if (sourceChartInstance) sourceChartInstance.destroy();
  
  const labels = data.bySource.map(s => SOURCE_LABELS[s.source] || s.source);
  const values = data.bySource.map(s => sumTokens(s.tokens));
  const colors = data.bySource.map(s => SOURCE_COLORS[s.source] || '#666');
  const total = values.reduce((a, b) => a + b, 0);

  sourceChartInstance = new Chart(document.getElementById('sourceChart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }]
    },
    options: {
      responsive: true,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = total > 0 ? (ctx.parsed / total) * 100 : 0;
              return ctx.label + ': ' + fmtTokens(ctx.parsed) + ' (' + pct.toFixed(1) + '%)';
            }
          }
        }
      }
    }
  });
}

function getModelChartRows(data) {
  const maxRows = 10;
  const selected = [];
  const seenRows = new Set();
  const activeSources = sortSourceList(data.bySource.map(s => s.source));
  const models = data.bySourceModel || [];

  activeSources.forEach(source => {
    const match = models.find(model => model.source === source && !seenRows.has(model.source + ':' + model.model));
    if (!match) return;
    selected.push(match);
    seenRows.add(match.source + ':' + match.model);
  });

  models.forEach(model => {
    if (selected.length >= maxRows) return;
    if (seenRows.has(model.source + ':' + model.model)) return;
    selected.push(model);
    seenRows.add(model.source + ':' + model.model);
  });

  return selected
    .slice(0, maxRows)
    .sort((a, b) => sumTokens(b.tokens) - sumTokens(a.tokens) || a.model.localeCompare(b.model));
}

function renderModelChart(data) {
  if (modelChartInstance) modelChartInstance.destroy();
  
  const top = getModelChartRows(data);
  modelChartInstance = new Chart(document.getElementById('modelChart'), {
    type: 'bar',
    data: {
      labels: top.map(m => shortModel(m.model) + ' · ' + (SOURCE_LABELS[m.source] || m.source)),
      datasets: [{
        data: top.map(m => sumTokens(m.tokens)),
        backgroundColor: top.map(m => SOURCE_COLORS[m.source] || '#6366F1'),
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtTokens(ctx.parsed.x) } } },
      scales: { x: { ticks: { callback: v => fmtTokens(Number(v)) } } }
    }
  });
}

function renderMonthlyChart(data) {
  if (monthlyChartInstance) monthlyChartInstance.destroy();

  monthlyChartInstance = new Chart(document.getElementById('monthlyChart'), {
    type: 'line',
    data: {
      labels: data.monthly.map(m => m.month),
      datasets: [{
        label: 'Tokens',
        data: data.monthly.map(m => sumTokens(m.tokens)),
        borderColor: BRAND_COLORS.primary,
        backgroundColor: BRAND_COLORS.primarySoft,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: BRAND_COLORS.primary,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtTokens(ctx.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtTokens(Number(v)) } } }
    }
  });
}

function renderHeatmap(data) {
  const container = document.getElementById('heatmap');
  const title = document.getElementById('heatmapTitle');
  container.innerHTML = '';
  title.textContent = 'Activity (' + data.filter.label + ')';

  const heatmapMap = {};
  data.heatmap.forEach(h => { heatmapMap[h.date] = h.totalTokens; });

  const maxTokens = Math.max(...Object.values(heatmapMap).map(Number), 1);
  const window = filterWindow(data.filter.value);

  let startDate = null;
  let endDate = null;

  if (window) {
    startDate = new Date(window.start);
    endDate = new Date(window.end);
  } else if (data.heatmap.length > 0) {
    startDate = new Date(data.heatmap[0].date + 'T00:00:00');
    endDate = new Date(data.heatmap[data.heatmap.length - 1].date + 'T00:00:00');
  }

  if (!startDate || !endDate) {
    container.innerHTML = '<div class="text-sm text-gray-500">No activity in this range</div>';
    return;
  }

  for (const cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    const key = isoDate(cursor);
    const tokens = heatmapMap[key] || 0;
    const level = tokens === 0 ? 0 : Math.min(Math.ceil((tokens / maxTokens) * 4), 4);

    const cell = document.createElement('div');
    cell.className = 'heatmap-cell heatmap-' + level;
    cell.title = key + ': ' + fmt(tokens) + ' tokens';
    cell.dataset.date = key;
    cell.addEventListener('click', () => {
      const row = document.querySelector('[data-row-date="' + key + '"]');
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('ring-2', 'ring-orange-400');
        setTimeout(() => row.classList.remove('ring-2', 'ring-orange-400'), 2000);
      }
    });
    container.appendChild(cell);
  }
}

function renderTable(data) {
  const tbody = document.getElementById('dailyTableBody');
  tbody.innerHTML = '';
  
  let rows = buildTableRows(data);
  
  if (currentSort.key === 'date') {
    rows.sort((a, b) => currentSort.dir === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  } else {
    const keyMap = { input: 'input', output: 'output', cacheRead: 'cacheRead', cacheCreation: 'cacheCreation', cost: 'costUSD' };
    const key = keyMap[currentSort.key];
    rows.sort((a, b) => {
      const aValue = key === 'costUSD' ? a.costUSD : a.tokens[key];
      const bValue = key === 'costUSD' ? b.costUSD : b.tokens[key];
      return currentSort.dir === 'asc'
        ? aValue - bValue || a.date.localeCompare(b.date)
        : bValue - aValue || b.date.localeCompare(a.date);
    });
  }
  
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.classList.remove('sort-asc', 'sort-desc');
    if (btn.dataset.sort === currentSort.key) {
      btn.classList.add(currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7" class="py-4 px-3 text-center text-gray-500">No rows match the selected providers</td>';
    tbody.appendChild(tr);
    return;
  }

  for (const d of rows) {
    const expandedRows = buildExpandedSourceRows(d.date, data);
    const isExpanded = expandedTableDates.has(d.date) && expandedRows.length > 0;
    const tr = document.createElement('tr');
    tr.className = 'table-parent-row border-b border-border/50 hover:bg-white/5 dark:hover:bg-white/5 light:hover:bg-gray-100 transition-colors';
    tr.dataset.rowDate = d.date;
    tr.title = isExpanded ? 'Click to collapse provider breakdown' : 'Click to expand provider breakdown';
    const srcs = sortSourceList(d.sources).map(s =>
      '<span class="inline-block px-1.5 py-0.5 rounded text-xs" style="background:' +
      SOURCE_COLORS[s] + '22;color:' + SOURCE_COLORS[s] + '">' +
      (SOURCE_LABELS[s] || s) + '</span>'
    ).join(' ');
    tr.innerHTML =
      '<td class="py-2 px-3 text-gray-300 dark:text-gray-300 light:text-gray-700"><span class="inline-flex items-center gap-2"><span class="daily-row-toggle' + (isExpanded ? ' open' : '') + '">▸</span><span>' + d.date + '</span></span></td>' +
      '<td class="py-2 px-3">' + srcs + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmt(d.tokens.input) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmt(d.tokens.output) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmt(d.tokens.cacheRead) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmt(d.tokens.cacheCreation) + '</td>' +
      '<td class="py-2 px-3 text-right font-medium text-orange-400">' + fmtUSD(d.costUSD) + '</td>';
    tr.addEventListener('click', () => {
      toggleExpandedDate(d.date);
      renderTable(data);
    });
    tbody.appendChild(tr);

    if (!isExpanded) continue;

    for (const child of expandedRows) {
      const childTr = document.createElement('tr');
      childTr.className = 'table-child-row border-b border-border/30';
      childTr.style.background = 'rgba(255,255,255,0.02)';
      const childSource = SOURCE_LABELS[child.source] || child.source;
      childTr.innerHTML =
        '<td class="py-2 px-3 text-gray-500 dark:text-gray-500 light:text-gray-500"><span class="table-tree-label"><span class="table-tree-line">└</span><span>' + childSource + '</span></span></td>' +
        '<td class="py-2 px-3"><div class="pl-4"><span class="inline-block px-1.5 py-0.5 rounded text-xs" style="background:' + SOURCE_COLORS[child.source] + '22;color:' + SOURCE_COLORS[child.source] + '">' + childSource + '</span></div></td>' +
        '<td class="py-2 px-3 text-right text-gray-400 dark:text-gray-400 light:text-gray-600">' + fmt(child.tokens.input) + '</td>' +
        '<td class="py-2 px-3 text-right text-gray-400 dark:text-gray-400 light:text-gray-600">' + fmt(child.tokens.output) + '</td>' +
        '<td class="py-2 px-3 text-right text-gray-400 dark:text-gray-400 light:text-gray-600">' + fmt(child.tokens.cacheRead) + '</td>' +
        '<td class="py-2 px-3 text-right text-gray-400 dark:text-gray-400 light:text-gray-600">' + fmt(child.tokens.cacheCreation) + '</td>' +
        '<td class="py-2 px-3 text-right font-medium text-orange-300">' + fmtUSD(child.costUSD) + '</td>';
      if (childTr.firstElementChild) {
        childTr.firstElementChild.innerHTML =
          '<span class="table-tree-bullet-wrap" aria-hidden="true"><span class="table-tree-bullet"></span></span>';
      }
      tbody.appendChild(childTr);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function totalProjectTokens(p) {
  const t = p.tokens || {};
  return (t.input || 0) + (t.output || 0) + (t.cacheCreation || 0) + (t.cacheRead || 0);
}

function renderProjects(data) {
  const tbody = document.getElementById('projectsTableBody');
  const toggleBtn = document.getElementById('projectsToggleAll');
  tbody.innerHTML = '';

  const all = (data.byProject || []).slice();
  const dir = currentProjSort.dir === 'asc' ? 1 : -1;
  all.sort((a, b) => {
    switch (currentProjSort.key) {
      case 'project': return dir * a.project.localeCompare(b.project);
      case 'tokens':  return dir * (totalProjectTokens(a) - totalProjectTokens(b));
      case 'cost':    return dir * (a.costUSD - b.costUSD);
      case 'events':  return dir * (a.eventCount - b.eventCount);
      case 'last':    return dir * a.lastActive.localeCompare(b.lastActive);
      default:        return 0;
    }
  });

  // sort indicators on headers
  document.querySelectorAll('[data-proj-sort]').forEach(btn => {
    btn.classList.remove('sort-asc', 'sort-desc');
    if (btn.dataset.projSort === currentProjSort.key) {
      btn.classList.add(currentProjSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });

  // toggle button visibility + label
  if (all.length <= 5) {
    toggleBtn.classList.add('hidden');
  } else {
    toggleBtn.classList.remove('hidden');
    toggleBtn.textContent = projectsExpanded
      ? 'Show top 5'
      : 'Show all (' + all.length + ')';
  }

  const rows = projectsExpanded ? all : all.slice(0, 5);

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" class="py-4 px-3 text-center text-gray-500">No project information yet.</td>';
    tbody.appendChild(tr);
    return;
  }

  for (const p of rows) {
    const chips = p.sources.map(s =>
      '<span class="inline-block px-1.5 py-0.5 rounded text-xs" style="background:' +
      SOURCE_COLORS[s] + '22;color:' + SOURCE_COLORS[s] + '">' +
      (SOURCE_LABELS[s] || s) + '</span>'
    ).join(' ');

    const isOpen = expandedProjects.has(p.projectPath || p.project);
    const tr = document.createElement('tr');
    tr.className = 'project-parent-row border-b border-border/50 hover:bg-white/5 dark:hover:bg-white/5 light:hover:bg-gray-100 transition-colors cursor-pointer';
    tr.dataset.projKey = p.projectPath || p.project;
    tr.title = isOpen ? 'Click to collapse provider breakdown' : 'Click to expand provider breakdown';
    tr.innerHTML =
      '<td class="py-2 px-3 text-gray-200 dark:text-gray-200 light:text-gray-800"><span class="inline-flex items-center gap-2"><span class="daily-row-toggle' + (isOpen ? ' open' : '') + '">▸</span><span>' + escapeHtml(p.project) + '</span></span></td>' +
      '<td class="py-2 px-3">' + chips + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmt(totalProjectTokens(p)) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmtUSD(p.costUSD) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmt(p.eventCount) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-400 dark:text-gray-400 light:text-gray-600">' + escapeHtml(p.lastActive) + '</td>';
    tbody.appendChild(tr);

    if (isOpen) {
      const perSource = p.perSource || [];
      if (perSource.length === 0) {
        const emptyTr = document.createElement('tr');
        emptyTr.className = 'bg-black/10 dark:bg-black/20 light:bg-gray-50 border-b border-border/30';
        emptyTr.innerHTML = '<td colspan="6" class="py-2 px-3 pl-12 text-xs text-gray-500">No per-source breakdown available.</td>';
        tbody.appendChild(emptyTr);
      } else {
        for (const s of perSource) {
          const tot = (s.tokens.input||0) + (s.tokens.output||0) + (s.tokens.cacheCreation||0) + (s.tokens.cacheRead||0);
          const chip =
            '<span class="inline-block px-1.5 py-0.5 rounded text-xs" style="background:' +
            SOURCE_COLORS[s.source] + '22;color:' + SOURCE_COLORS[s.source] + '">' +
            (SOURCE_LABELS[s.source] || s.source) + '</span>';
          const subTr = document.createElement('tr');
          subTr.className = 'project-subrow bg-black/10 dark:bg-black/20 light:bg-gray-50 border-b border-border/30';
          subTr.innerHTML =
            '<td></td>' +
            '<td class="py-1.5 px-3 text-xs">' + chip + '</td>' +
            '<td class="py-1.5 px-3 text-right text-xs text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmt(tot) + '</td>' +
            '<td class="py-1.5 px-3 text-right text-xs text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmtUSD(s.costUSD) + '</td>' +
            '<td class="py-1.5 px-3 text-right text-xs text-gray-300 dark:text-gray-300 light:text-gray-700">' + fmt(s.eventCount) + '</td>' +
            '<td></td>';
          tbody.appendChild(subTr);
        }
      }
    }
  }
}

// Sort handlers
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!btn.dataset.sort) return;
    const key = btn.dataset.sort;
    if (currentSort.key === key) {
      currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      currentSort.key = key;
      currentSort.dir = 'desc';
    }
    if (filteredData) renderTable(filteredData);
  });
});

document.querySelectorAll('[data-proj-sort]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.projSort;
    if (currentProjSort.key === key) {
      currentProjSort.dir = currentProjSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      currentProjSort.key = key;
      currentProjSort.dir = key === 'project' ? 'asc' : 'desc';
    }
    renderProjects(window.__latestData || DATA);
  });
});

{
  const toggleBtn = document.getElementById('projectsToggleAll');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      projectsExpanded = !projectsExpanded;
      renderProjects(window.__latestData || DATA);
    });
  }
}

{
  const tbody = document.getElementById('projectsTableBody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const row = e.target.closest('.project-parent-row');
      if (!row) return;
      const key = row.dataset.projKey;
      if (!key) return;
      if (expandedProjects.has(key)) {
        expandedProjects.delete(key);
      } else {
        expandedProjects.add(key);
      }
      renderProjects(window.__latestData || DATA);
    });
  }
}

// Initial render
lastDataSignature = dataSignature(DATA);
filteredData = filterData(currentTimeFilter);
updateDashboard(filteredData);

async function refreshDashboardData() {
  if (liveRefreshInFlight) return;
  liveRefreshInFlight = true;

  try {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) return;

    const nextData = await res.json();
    if (!nextData || typeof nextData !== 'object') return;
    const nextSignature = dataSignature(nextData);
    if (nextSignature === lastDataSignature) return;

    DATA = nextData;
    lastDataSignature = nextSignature;
    filteredData = filterData(currentTimeFilter);
    renderGenerated(DATA.generated);
    updateDashboard(filteredData);
  } catch {
    // Ignore transient refresh failures and keep the last rendered snapshot.
  } finally {
    liveRefreshInFlight = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshDashboardData();
});

// ===== POPUP SYSTEM =====

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function pctStr(a, b) { return b > 0 ? (a / b * 100).toFixed(1) + '%' : '—'; }
function pSection(title) {
  return '<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;margin:24px 0 8px;padding-top:2px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:6px">' + escHtml(title) + '</div>';
}

// Visual Helpers
function pStatCard(label, value, accent, sub) {
  return '<div class="p-stat-card"><div style="background:'+accent+'" class="p-stat-card-accent"></div>'
    + '<div class="p-stat-val">' + value + '</div><div class="p-stat-lbl">' + label + '</div>'
    + (sub ? '<div style="font-size:10px;color:#9ca3af;margin-top:6px">' + sub + '</div>' : '')
    + '</div>';
}
function pSparkline(values, color, height = 40) {
  if (values.length < 2) return '';
  const max = Math.max(...values, 0.0001), min = Math.min(...values);
  const range = max - min || 1;
  const w = 100, h = height - 4;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = height - 2 - ((v - min) / range) * h;
    return x + ',' + y;
  });
  let len = 0;
  for (let i = 1; i < values.length; i++) {
    const lx = (1 / (values.length - 1)) * w;
    const ly = ((values[i] - min) / range) * h - ((values[i-1] - min) / range) * h;
    len += Math.sqrt(lx*lx + ly*ly);
  }
  return '<svg viewBox="0 0 100 ' + height + '" preserveAspectRatio="none" style="width:100%;height:' + height + 'px;overflow:visible">'
    + '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
    + 'class="p-spark-line" style="--spark-len:' + (len*1.2) + 'px;stroke-dasharray:' + (len*1.2) + 'px;stroke-dashoffset:' + (len*1.2) + 'px" />'
    + '</svg>';
}
function pDonut(segments, size = 120, donutWidth = 20) {
  const r = (size - donutWidth) / 2;
  const circ = 2 * Math.PI * r;
  let html = '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="transform:rotate(-90deg)">';
  html += '<circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="'+donutWidth+'"/>';
  let offset = 0;
  segments.forEach((seg, i) => {
    const dash = seg.pct * circ;
    html += '<circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" fill="none" stroke="'+seg.color+'" stroke-width="'+donutWidth+'" '
      + 'stroke-dasharray="'+dash+' '+(circ-dash)+'" stroke-dashoffset="-'+offset+'" '
      + 'style="--seg-circ:'+(circ)+'px;animation:donut-fill 0.8s '+(i*0.1)+'s ease-out backwards;transition:opacity 0.2s" />';
    offset += dash;
  });
  html += '</svg>';
  return html;
}
function pProgressRing(pct, color, size = 80, stroke = 8) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  return '<div style="position:relative;width:'+size+'px;height:'+size+'px">'
    + '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="transform:rotate(-90deg)">'
    + '<circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="'+stroke+'"/>'
    + '<circle cx="'+(size/2)+'" cy="'+(size/2)+'" r="'+r+'" fill="none" stroke="'+color+'" stroke-width="'+stroke+'" stroke-linecap="round" '
    + 'stroke-dasharray="'+circ+'" stroke-dashoffset="'+(circ - dash)+'" style="--ring-circ:'+circ+'px;animation:ring-fill 1s cubic-bezier(0.16,1,0.3,1) backwards" />'
    + '</svg>'
    + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff">' + Math.round(pct*100) + '%</div>'
    + '</div>';
}
function pBarRow(label, valStr, pct, color) {
  return '<div class="p-bar-row">'
    + '<div class="p-bar-label" title="'+escHtml(label)+'">'+escHtml(label)+'</div>'
    + '<div class="p-bar-track"><div class="p-bar-fill" style="width:'+(pct*100)+'%;background:'+color+'"></div></div>'
    + '<div class="p-bar-val">'+valStr+'</div>'
    + '</div>';
}

function pRow(label, value, sub) {
  return '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)">'
    + '<span style="color:#9ca3af;font-size:13px">' + escHtml(label) + '</span>'
    + '<span style="color:#f3f4f6;font-size:13px;font-weight:500;text-align:right;margin-left:16px">'
    + value + (sub ? '<div style="font-size:11px;color:#6b7280;font-weight:400">' + escHtml(sub) + '</div>' : '')
    + '</span></div>';
}
function pTable(headers, rows) {
  let h = '<div style="overflow-x:auto;margin-top:4px"><table style="width:100%;border-collapse:collapse;font-size:12px">';
  h += '<thead><tr>';
  headers.forEach((hdr, i) => {
    h += '<th style="padding:3px 8px 5px;color:#6b7280;font-weight:500;text-align:' + (i === 0 ? 'left' : 'right') + ';white-space:nowrap;border-bottom:1px solid rgba(255,255,255,0.07)">' + escHtml(hdr) + '</th>';
  });
  h += '</tr></thead><tbody>';
  rows.forEach((row, ri) => {
    h += '<tr style="border-top:1px solid rgba(255,255,255,0.04);background:' + (ri % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent') + '">';
    row.forEach((cell, ci) => {
      h += '<td style="padding:5px 8px;color:' + (ci === 0 ? '#d1d5db' : '#e5e7eb') + ';text-align:' + (ci === 0 ? 'left' : 'right') + ';white-space:nowrap">' + cell + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function showPopup(title, contentHtml, sourceEl = null) {
  destroyPopupHeroChart();
  document.getElementById('popupTitle').textContent = title;
  document.getElementById('popupContent').innerHTML = contentHtml;
  document.getElementById('popupContent').scrollTop = 0;

  const box = document.getElementById('popupBox');
  if (sourceEl) {
    const r = sourceEl.getBoundingClientRect();
    const dX = (r.left + r.width / 2) - (window.innerWidth / 2);
    const dY = (r.top + r.height / 2) - (window.innerHeight / 2);
    box.style.setProperty('--tx-x', dX + 'px');
    box.style.setProperty('--tx-y', dY + 'px');
    box.style.setProperty('--tx-s', '0.05');
  } else {
    box.style.setProperty('--tx-x', '0px');
    box.style.setProperty('--tx-y', '20px');
    box.style.setProperty('--tx-s', '0.9');
  }

  const overlay = document.getElementById('popupOverlay');
  overlay.classList.add('popup-open');

  // Render popup hero chart if the builder staged data in window.__popupHeroData
  requestAnimationFrame(() => {
    const stage = window.__popupHeroData;
    if (!stage) return;
    if (stage.kind === 'daily') renderPopupDailyHero(stage);
    else if (stage.kind === 'monthly') renderPopupMonthlyHero(stage);
    window.__popupHeroData = null;
  });
}

function destroyPopupHeroChart() {
  if (popupHeroChart) {
    popupHeroChart.destroy();
    popupHeroChart = null;
  }
}

function renderPopupDailyHero(stage) {
  const canvas = document.getElementById('popupDailyChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, BRAND_COLORS.primarySoft);
  gradient.addColorStop(1, BRAND_COLORS.primaryGhost);
  popupHeroChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: stage.labels,
      datasets: [{
        label: 'Tokens',
        data: stage.values,
        borderColor: BRAND_COLORS.primary,
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: BRAND_COLORS.primary,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => items[0].label,
            label: ctx => fmtTokens(ctx.parsed.y) + ' tokens'
          }
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 8, color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { callback: v => fmtTokens(Number(v)), color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
}

function renderPopupMonthlyHero(stage) {
  const canvas = document.getElementById('popupMonthlyChart');
  if (!canvas) return;
  popupHeroChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: stage.labels,
      datasets: [{
        label: 'Tokens',
        data: stage.tokens,
        backgroundColor: BRAND_COLORS.primary,
        hoverBackgroundColor: '#F09147',
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.72,
        categoryPercentage: 0.9,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => items[0].label,
            label: ctx => {
              const i = ctx.dataIndex;
              const tokLabel = fmtTokens(stage.tokens[i]) + ' tokens';
              const costLabel = fmtUSD(stage.costs[i]);
              const g = stage.changes[i];
              const gLabel = g == null ? '' : ' · ' + (g >= 0 ? '↑' : '↓') + ' ' + Math.abs(g).toFixed(1) + '%';
              return tokLabel + ' · ' + costLabel + gLabel;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#9ca3af' }, grid: { display: false } },
        y: { ticks: { callback: v => fmtTokens(Number(v)), color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
}

function closePopup() {
  document.getElementById('popupOverlay').classList.remove('popup-open');
  destroyPopupHeroChart();
}
document.getElementById('popupOverlay').addEventListener('click', closePopup);
document.getElementById('popupBox').addEventListener('click', e => e.stopPropagation());
document.getElementById('popupClose').addEventListener('click', closePopup);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopup(); });

// ===== ANALYTICS HELPERS =====

function computeStreaks(daily) {
  if (!daily.length) return { longest: 0, current: 0 };
  const dates = [...new Set(daily.map(d => d.date))].sort();
  let longest = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + 'T12:00:00');
    const next = new Date(dates[i] + 'T12:00:00');
    const diff = Math.round((next - prev) / 86400000);
    if (diff === 1) { cur++; longest = Math.max(longest, cur); }
    else cur = 1;
  }
  const dateSet = new Set(dates);
  let currentStreak = 0;
  for (let d = new Date(dates[dates.length - 1] + 'T12:00:00'), i = 0; i <= dates.length; i++, d.setDate(d.getDate() - 1)) {
    if (dateSet.has(isoDate(d))) currentStreak++;
    else break;
  }
  return { longest: Math.max(longest, 1), current: currentStreak };
}

function computeDayOfWeek(daily) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const costSums = new Array(7).fill(0);
  const tokenSums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  daily.forEach(d => {
    const dow = new Date(d.date + 'T12:00:00').getDay();
    costSums[dow] += d.costUSD;
    tokenSums[dow] += sumTokens(d.tokens);
    counts[dow]++;
  });
  return names.map((name, i) => ({
    name,
    avgCost: counts[i] > 0 ? costSums[i] / counts[i] : 0,
    avgTokens: counts[i] > 0 ? tokenSums[i] / counts[i] : 0,
    activeDays: counts[i],
  }));
}

// ===== POPUP CONTENT BUILDERS =====

function buildCostPopup(data) {
  const t = data.totals;
  const costPerDay = t.activeDays > 0 ? t.costUSD / t.activeDays : 0;
  const totalTok = Math.max(t.totalTokens, 1);
  const cacheHitRate = t.tokens.input + t.tokens.cacheRead > 0 ? t.tokens.cacheRead / (t.tokens.input + t.tokens.cacheRead) : 0;
  const roughSavings = cacheHitRate > 0 ? (t.tokens.cacheRead / totalTok) * t.costUSD * 0.9 : 0;

  const dSegs = data.bySource.map(s => ({
    pct: s.costUSD / Math.max(t.costUSD, 0.001),
    color: SOURCE_COLORS[s.source] || '#aaa',
    label: SOURCE_LABELS[s.source] || s.source,
    val: s.costUSD
  }));

  let html = '';
  html += '<div class="p-stat-grid cols-3">'
    + pStatCard('30-Day Proj.', fmtUSD(costPerDay * 30), '#f87171')
    + pStatCard('90-Day Proj.', fmtUSD(costPerDay * 90), '#f87171')
    + pStatCard('Annual Proj.', '<span style="color:#fbbf24">'+fmtUSD(costPerDay * 365)+'</span>', '#fbbf24')
    + '</div>';

  html += '<div class="p-stat-grid cols-2">'
    + pStatCard('Cost / 1M Tokens', fmtUSD(t.costUSD / totalTok * 1000000), '#a855f7')
    + pStatCard('Est. Cache Savings', fmtUSD(roughSavings), '#34d399')
    + '</div>';

  html += pSection('Cost by Provider');
  html += '<div class="p-donut-wrap">'
    + pDonut(dSegs, 140, 24)
    + '<div class="p-donut-legend">'
    + dSegs.map(s => '<div class="p-donut-legend-item"><div class="p-donut-legend-dot" style="background:'+s.color+'"></div><div style="flex:1;color:#d1d5db">'+s.label+'</div><div style="font-weight:600;color:#fff">'+fmtUSD(s.val)+'</div></div>').join('')
    + '</div></div>';

  return html;
}

function buildTokensPopup(data) {
  const t = data.totals;
  const tok = t.tokens;
  const total = Math.max(t.totalTokens, 1);
  const cacheIn = tok.input + tok.cacheRead;
  const cacheHitRate = cacheIn > 0 ? tok.cacheRead / cacheIn : 0;
  const ioRatio = tok.output > 0 ? (tok.input / tok.output).toFixed(2) : '∞';

  const segs = [
    { label: 'Input', val: tok.input, color: '#60a5fa' },
    { label: 'Output', val: tok.output, color: '#e87b35' },
    { label: 'Cache Read', val: tok.cacheRead, color: '#34d399' },
    { label: 'Cache Write', val: tok.cacheCreation, color: '#a78bfa' }
  ];
  if (tok.reasoning > 0) segs.push({ label: 'Reasoning', val: tok.reasoning, color: '#fbbf24' });
  const dSegs = segs.map(s => ({ ...s, pct: s.val / total }));

  let html = '';
  html += '<div class="p-stat-grid cols-2">'
    + pStatCard('I/O Ratio', ioRatio + ' : 1', '#60a5fa')
    + pStatCard('Avg Tokens / Day', fmt(Math.round(total / Math.max(t.activeDays, 1))), '#a78bfa')
    + '</div>';

  html += pSection('Token Composition & Cache');
  html += '<div class="p-donut-wrap">'
    + pDonut(dSegs, 160, 28)
    + '<div class="p-donut-legend">'
    + dSegs.map(s => '<div class="p-donut-legend-item"><div class="p-donut-legend-dot" style="background:'+s.color+'"></div><div style="flex:1;color:#d1d5db">'+s.label+'</div><div style="font-weight:600;color:#fff">'+pctStr(s.val, total)+'</div></div>').join('')
    + '</div>'
    + '<div class="p-ring-wrap">'
    + pProgressRing(cacheHitRate, '#34d399', 80, 8)
    + '<div class="p-ring-label">Cache Hit Rate</div>'
    + '</div>'
    + '</div>';

  const peakDay = data.daily.reduce((b, d) => sumTokens(d.tokens) > sumTokens(b.tokens) ? d : b, data.daily[0]);
  if (peakDay) {
    html += pSection('Peak Usage');
    html += pRow('Highest day', fmt(sumTokens(peakDay.tokens)), peakDay.date);
  }

  return html;
}

function buildActiveDaysPopup(data) {
  const t = data.totals;
  const daily = data.daily;
  const streaks = computeStreaks(daily);
  const dow = computeDayOfWeek(daily);
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  let calDays = 1;
  if (sorted.length > 1) {
    const first = new Date(sorted[0].date + 'T12:00:00');
    const last = new Date(sorted[sorted.length - 1].date + 'T12:00:00');
    calDays = Math.round((last - first) / 86400000) + 1;
  }
  const activeRate = calDays > 0 ? t.activeDays / calDays : 0;
  const monthMap = {};
  daily.forEach(d => { const m = d.date.slice(0, 7); monthMap[m] = (monthMap[m] || 0) + 1; });
  const months = Object.entries(monthMap).sort();
  const maxMonthDays = Math.max(...months.map(([, v]) => v), 1);

  let html = '';
  html += '<div style="display:flex;gap:16px;margin:12px 0">'
    + '<div class="p-ring-wrap" style="flex-shrink:0">'
    + pProgressRing(activeRate, '#4ade80', 96, 10)
    + '<div class="p-ring-label">Coverage Map</div>'
    + '</div>'
    + '<div class="p-stat-grid cols-2" style="flex:1;margin:0">'
    + pStatCard('Longest Streak', streaks.longest + ' d', '#f87171')
    + pStatCard('Current Streak', streaks.current + ' d', '#fbbf24')
    + pStatCard('Avg Days / Week', t.activeDays > 0 ? (t.activeDays / (calDays / 7)).toFixed(1) : '0', '#60a5fa')
    + pStatCard('Total Tracked', calDays + ' d', '#9ca3af')
    + '</div></div>';

  html += pSection('Activity by Day of Week');
  const maxDow = Math.max(...dow.map(d => d.activeDays), 1);
  dow.forEach(d => {
    html += pBarRow(d.name, d.activeDays + ' d', d.activeDays / maxDow, '#39d353');
  });

  if (months.length > 1) {
    html += pSection('Monthly Consistency');
    months.forEach(([month, count]) => {
      html += pBarRow(month, count + ' d', count / maxMonthDays, '#60a5fa');
    });
  }
  return html;
}

function buildCostPerDayPopup(data) {
  const daily = data.daily;
  const t = data.totals;
  if (!daily.length) return '<div style="color:#6b7280;padding:16px 0">No data in range</div>';
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const half = Math.floor(sorted.length / 2);
  const firstAvg = half ? sorted.slice(0, half).reduce((s, d) => s + d.costUSD, 0) / half : 0;
  const secondAvg = half ? sorted.slice(half).reduce((s, d) => s + d.costUSD, 0) / (sorted.length - half) : 0;
  
  const change = firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg * 100 : 0;
  const isUp = change > 0;
  const trendCol = Math.abs(change) < 5 ? '#9ca3af' : isUp ? '#f87171' : '#4ade80';
  const arrow = Math.abs(change) < 5 ? '→' : isUp ? '↑' : '↓';

  let html = '';
  html += '<div style="background:rgba(0,0,0,0.2);padding:16px;border-radius:12px;margin:12px 0">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px">'
    + '<div><div style="font-size:24px;font-weight:700;color:'+trendCol+'">' + arrow + ' ' + Math.abs(change).toFixed(1) + '%</div>'
    + '<div style="font-size:12px;color:#9ca3af;margin-top:2px">Cost trend (recent vs prior)</div></div>'
    + '<div style="text-align:right"><div style="font-size:16px;color:#fff">'+fmtUSD(secondAvg)+'/d</div><div style="font-size:11px;color:#6b7280">Current period</div></div>'
    + '</div>';
    
  if (sorted.length > 3) {
    html += pSparkline(sorted.map(d => d.costUSD), '#fbbf24', 50);
  }
  html += '</div>';

  const peakDay = daily.reduce((b, d) => d.costUSD > b.costUSD ? d : b, daily[0]);
  const stdDev = Math.sqrt(daily.reduce((s, d) => s + Math.pow(d.costUSD - (t.costUSD/t.activeDays), 2), 0) / Math.max(daily.length, 1));

  html += '<div class="p-stat-grid cols-2">'
    + pStatCard('Highest Day', fmtUSD(peakDay.costUSD), '#f87171', peakDay.date)
    + pStatCard('Volatility (Std Dev)', '±' + fmtUSD(stdDev), '#a855f7', 'Lower = more stable')
    + '</div>';

  html += pSection('Average Cost by Day of Week');
  const dow = computeDayOfWeek(daily);
  const maxDow = Math.max(...dow.map(d => d.avgCost), 0.001);
  dow.forEach(d => {
    html += pBarRow(d.name, fmtUSD(d.avgCost), d.avgCost / maxDow, '#fbbf24');
  });

  return html;
}

function buildTopModelPopup(data) {
  const modelsWithTok = data.byModel.map(m => ({
    m,
    tok: m.tokens.input + m.tokens.output + m.tokens.cacheRead + m.tokens.cacheCreation
  }));
  modelsWithTok.sort((a, b) => b.tok - a.tok);
  const totalTok = Math.max(modelsWithTok.reduce((s, r) => s + r.tok, 0), 1);
  let html = '';

  html += '<div class="p-stat-grid cols-2">'
    + pStatCard('Unique Models', modelsWithTok.length, BRAND_COLORS.primary)
    + pStatCard('Top Model Tokens', modelsWithTok.length ? fmtTokens(modelsWithTok[0].tok) : '0', SOURCE_COLORS['claude-code'], modelsWithTok.length ? pctStr(modelsWithTok[0].tok, totalTok) + ' of total' : '')
    + '</div>';

  html += pSection('All models ranked by tokens');
  html += '<div style="margin-top:12px">';
  const maxModelTok = modelsWithTok.length ? modelsWithTok[0].tok : 1;

  modelsWithTok.forEach(({ m, tok }) => {
    const col = SOURCE_COLORS[m.sources[0]] || BRAND_COLORS.primary;
    html += '<div style="margin-bottom:12px">'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:4px">'
      + '<span style="font-family:monospace;font-size:12px;color:#e5e7eb">' + escHtml(shortModel(m.model)) + '</span>'
      + '<span style="font-size:12px;font-weight:600;color:'+col+'">' + fmtTokens(tok) + ' <span style="font-weight:400;color:#6b7280;font-size:11px;margin-left:6px">(' + pctStr(tok, totalTok) + ')</span></span>'
      + '</div>'
      + '<div class="p-bar-track" style="height:4px;margin-bottom:4px"><div class="p-bar-fill" style="width:'+(tok/maxModelTok*100)+'%;background:'+col+'"></div></div>'
      + '<div style="font-size:10px;color:#9ca3af;display:flex;gap:12px">'
      + '<span>' + m.sources.map(s => escHtml(SOURCE_LABELS[s] || s)).join(', ') + '</span>'
      + '<span>' + m.eventCount + ' req</span>'
      + '</div></div>';
  });
  html += '</div>';

  return html;
}

function buildDailyChartPopup(data) {
  const daily = data.daily;
  if (!daily.length) return '<div style="color:#6b7280;padding:16px 0">No data in range</div>';

  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));

  let html = '';

  // Hero: Area chart with brand-orange gradient (rendered after insertion — see Task 9).
  html += '<div style="background:rgba(0,0,0,0.2);padding:16px;border-radius:12px;margin:12px 0 16px">'
    + '<div style="font-size:12px;color:#9ca3af;margin-bottom:8px">Token volume timeline</div>'
    + '<canvas id="popupDailyChart" height="220" style="max-height:220px"></canvas>'
    + '</div>';

  const weekMap = {};
  daily.forEach(d => {
    const dt = new Date(d.date + 'T12:00:00');
    const mon = new Date(dt);
    mon.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const wk = isoDate(mon);
    if (!weekMap[wk]) weekMap[wk] = { tokens: 0 };
    weekMap[wk].tokens += sumTokens(d.tokens);
  });
  const weeks = Object.entries(weekMap).sort();
  const bestWeek = weeks.length ? weeks.reduce((b, w) => w[1].tokens > b[1].tokens ? w : b, weeks[0]) : null;

  const avgDaily = Math.round(data.totals.totalTokens / Math.max(daily.length, 1));
  html += '<div class="p-stat-grid cols-2">'
    + pStatCard('Avg Daily Tokens', fmtTokens(avgDaily), BRAND_COLORS.primary)
    + pStatCard('Busiest Week', bestWeek ? fmtTokens(bestWeek[1].tokens) : '0', SOURCE_COLORS['claude-code'], bestWeek ? 'Week of ' + bestWeek[0] : '')
    + '</div>';

  html += pSection('Token Volume by Day of Week');
  const dow = computeDayOfWeek(daily);
  const maxDow = Math.max(...dow.map(d => d.avgTokens), 1);
  dow.forEach(d => {
    html += pBarRow(d.name, fmtTokens(Math.round(d.avgTokens)), d.avgTokens / maxDow, BRAND_COLORS.primary);
  });

  // Stage hero data for showPopup to pick up (side-effect — script tags in innerHTML don't execute)
  window.__popupHeroData = { kind: 'daily', values: sorted.map(d => sumTokens(d.tokens)), labels: sorted.map(d => d.date) };

  return html;
}

function buildSourceChartPopup(data) {
  const sourceTok = data.bySource.map(s => ({
    source: s.source,
    tokens: s.tokens,
    total: s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheCreation
  }));
  const total = Math.max(sourceTok.reduce((a, b) => a + b.total, 0), 1);
  const dSegs = sourceTok.map(s => ({
    pct: s.total / total,
    color: SOURCE_COLORS[s.source] || '#aaa',
    label: SOURCE_LABELS[s.source] || s.source,
    val: s.total
  }));

  let html = '';

  html += '<div class="p-donut-wrap">'
    + pDonut(dSegs, 160, 24)
    + '<div class="p-donut-legend">'
    + dSegs.map(s => '<div class="p-donut-legend-item"><div class="p-donut-legend-dot" style="background:'+s.color+'"></div><div style="flex:1;color:#d1d5db">'+s.label+'</div><div style="font-weight:600;color:#fff">'+pctStr(s.val, total)+'</div></div>').join('')
    + '</div></div>';

  html += pSection('Token Volume by Provider');
  const maxTok = Math.max(...sourceTok.map(s => s.total), 1);

  sourceTok.forEach(s => {
    const cIn = s.tokens.input + s.tokens.cacheRead;
    const cacheHit = cIn > 0 ? Math.round(s.tokens.cacheRead / cIn * 100) : 0;
    const col = SOURCE_COLORS[s.source] || '#aaa';

    html += '<div style="margin-bottom:14px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:4px">'
      + '<div style="font-weight:600;color:'+col+'">' + escHtml(SOURCE_LABELS[s.source] || s.source) + ' <span style="font-size:11px;color:#6b7280;font-weight:400;margin-left:6px">' + cacheHit + '% cache hit</span></div>'
      + '<div style="font-size:12px;color:#e5e7eb">' + fmtTokens(s.total) + ' <span style="color:#6b7280;font-size:10px">tokens</span></div>'
      + '</div>'
      + '<div class="p-bar-track"><div class="p-bar-fill" style="width:'+(s.total/maxTok*100)+'%;background:'+col+'"></div></div>'
      + '</div>';
  });

  return html;
}

function buildModelChartPopup(data) {
  // Same as Top Model popup now, since user says "Alle Modelle (nicht nur top 10) mit Tokens, Events"
  // so we can reuse the new visual logic
  return buildTopModelPopup(data);
}

function buildMonthlyChartPopup(data) {
  const months = data.monthly;
  if (!months.length) return '<div style="color:#6b7280;padding:16px 0">No data in range</div>';

  const monthsTok = months.map(m => sumTokens(m.tokens));
  const monthsCost = months.map(m => m.costUSD);

  // Compute month-over-month change using tokens
  const changes = monthsTok.map((t, i) => {
    if (i === 0) return null;
    const prev = monthsTok[i - 1];
    if (prev <= 0) return null;
    return (t - prev) / prev * 100;
  });

  let html = '';

  // Hero: thick vertical bars (rendered after insertion — see renderPopupMonthlyHero)
  html += '<div style="background:rgba(0,0,0,0.2);padding:16px;border-radius:12px;margin:12px 0 16px">'
    + '<div style="font-size:12px;color:#9ca3af;margin-bottom:8px">Monthly token volume</div>'
    + '<canvas id="popupMonthlyChart" height="240" style="max-height:240px"></canvas>'
    + '</div>';

  const sortedByTok = [...months].map((m, i) => ({ m, t: monthsTok[i] })).sort((a, b) => b.t - a.t);
  const avgMonthlyTok = monthsTok.reduce((s, t) => s + t, 0) / months.length;

  html += '<div class="p-stat-grid cols-2">'
    + pStatCard('Avg Monthly Tokens', fmtTokens(Math.round(avgMonthlyTok)), BRAND_COLORS.primary)
    + pStatCard('Peak Month', fmtTokens(sortedByTok[0].t), SOURCE_COLORS['claude-code'], sortedByTok[0].m.month)
    + '</div>';

  html += pSection('Month-over-month Analysis');

  const maxMonthTok = Math.max(...monthsTok, 1);
  months.forEach((m, i) => {
    const tok = monthsTok[i];
    const g = changes[i];
    let changeLabel = '';
    if (g != null) {
      const up = g >= 0;
      const col = up ? BRAND_COLORS.trendUp : BRAND_COLORS.trendDown;
      changeLabel = '<span style="color:' + col + ';font-size:11px;margin-left:8px">' + (up ? '↑ ' : '↓ ') + Math.abs(g).toFixed(1) + '%</span>';
    }

    html += '<div style="margin-bottom:10px">'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">'
      + '<div><span style="color:#d1d5db">' + m.month + '</span>' + changeLabel + '</div>'
      + '<strong style="color:#fff">' + fmtTokens(tok) + '</strong>'
      + '</div>'
      + '<div class="p-bar-track" style="height:5px"><div class="p-bar-fill" style="width:' + (tok / maxMonthTok * 100) + '%;background:' + BRAND_COLORS.primary + '"></div></div>'
      + '</div>';
  });

  // Stage hero data for showPopup to pick up (side-effect — script tags in innerHTML don't execute)
  window.__popupHeroData = { kind: 'monthly', labels: months.map(m => m.month), tokens: monthsTok, costs: monthsCost, changes: changes };

  return html;
}

function buildHeatmapPopup(data) {
  const heatmap = data.heatmap;
  const streaks = computeStreaks(data.daily);
  const activeCells = heatmap.filter(h => h.totalTokens > 0).length;
  const activeRate = heatmap.length > 0 ? activeCells / heatmap.length : 0;
  
  let html = '';
  html += '<div style="display:flex;gap:20px;margin:12px 0">'
    + '<div class="p-ring-wrap" style="flex-shrink:0">'
    + pProgressRing(activeRate, '#39d353', 100, 10)
    + '<div class="p-ring-label">Activity Rate</div>'
    + '</div>'
    + '<div class="p-stat-grid cols-2" style="flex:1;margin:0">'
    + pStatCard('Max Streak', streaks.longest + ' d', '#f87171', 'Consecutive days')
    + pStatCard('Current Streak', streaks.current + ' d', '#f59e0b', 'Active run')
    + '</div></div>';

  html += pSection('Activity Density');
  
  const dowCounts = new Array(7).fill(0);
  heatmap.forEach(h => {
    if (h.totalTokens > 0) {
      const dow = new Date(h.date + 'T12:00:00').getDay();
      dowCounts[dow]++;
    }
  });
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxDow = Math.max(...dowCounts, 1);
  
  dayNames.forEach((name, i) => {
    html += pBarRow(name, dowCounts[i] + ' d', dowCounts[i] / maxDow, '#4ade80');
  });

  return html;
}

// Wire up click handlers — cards: full click / charts: skip canvas clicks (Chart.js handles those)
(function setupCardClicks() {
  document.getElementById('card-total-cost').addEventListener('click', (e) =>
    showPopup('Cost Analysis', buildCostPopup(filteredData), e.currentTarget));
  document.getElementById('card-total-tokens').addEventListener('click', (e) =>
    showPopup('Token Breakdown', buildTokensPopup(filteredData), e.currentTarget));
  document.getElementById('card-active-days').addEventListener('click', (e) =>
    showPopup('Activity Analysis', buildActiveDaysPopup(filteredData), e.currentTarget));
  document.getElementById('card-cost-per-day').addEventListener('click', (e) =>
    showPopup('Spending Patterns', buildCostPerDayPopup(filteredData), e.currentTarget));
  document.getElementById('card-top-model').addEventListener('click', (e) =>
    showPopup('Model Rankings', buildTopModelPopup(filteredData), e.currentTarget));

  function chartClick(id, title, builder) {
    document.getElementById(id).addEventListener('click', e => {
      showPopup(title, builder(filteredData), e.currentTarget);
    });
  }
  chartClick('chart-daily',   'Daily Usage Patterns', buildDailyChartPopup);
  chartClick('chart-source',  'Provider Deep Dive',   buildSourceChartPopup);
  chartClick('chart-model',   'All Models',           buildModelChartPopup);
  chartClick('chart-monthly', 'Monthly Analysis',     buildMonthlyChartPopup);
  chartClick('chart-heatmap', 'Activity Calendar',    buildHeatmapPopup);
}());

setInterval(() => {
  if (!document.hidden) refreshDashboardData();
}, LIVE_REFRESH_MS);

(function subscribeToServerEvents() {
  if (typeof EventSource === 'undefined') return;
  let es = null;
  let reconnectTimer = null;

  function connect() {
    es = new EventSource('/api/stream');
    es.addEventListener('update', () => {
      if (!document.hidden) refreshDashboardData();
    });
    es.onerror = () => {
      // Browser will sometimes auto-reconnect; if not, fall back to a manual
      // retry after a short delay. Polling stays running as a safety net.
      if (es) { try { es.close(); } catch (_) {} es = null; }
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 5000);
      }
    };
  }
  connect();
}());
<\/script>
</body>
</html>`;
}
