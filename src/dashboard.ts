import type { DashboardData } from './types.js';
import { SOURCE_COLORS, SOURCE_LABELS } from './types.js';

export function renderDashboard(data: DashboardData): string {
	const jsonData = JSON.stringify(data);

	return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TokenBBQ Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#0f1117',
        card: '#1a1d27',
        border: '#2a2d37',
      }
    }
  }
}
</script>
<style>
  body { background: #0f1117; }
  .heatmap-cell { width: 14px; height: 14px; border-radius: 3px; }
  .heatmap-0 { background: #1a1d27; }
  .heatmap-1 { background: #0e4429; }
  .heatmap-2 { background: #006d32; }
  .heatmap-3 { background: #26a641; }
  .heatmap-4 { background: #39d353; }
</style>
</head>
<body class="dark text-gray-200 min-h-screen p-4 md:p-8">

<div class="max-w-7xl mx-auto">
  <!-- Header -->
  <div class="flex items-center justify-between mb-8">
    <div>
      <h1 class="text-3xl font-bold text-white flex items-center gap-3">
        <span class="text-4xl">🔥</span> TokenBBQ
      </h1>
      <p class="text-gray-400 mt-1">AI Coding Tool Usage Dashboard</p>
    </div>
    <div class="text-right text-sm text-gray-500">
      <div>Generated: <span id="generated"></span></div>
      <div id="sourcesList" class="mt-1"></div>
    </div>
  </div>

  <!-- Summary Cards -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
    <div class="bg-card border border-border rounded-xl p-5">
      <div class="text-gray-400 text-sm mb-1">Total Cost</div>
      <div class="text-2xl font-bold text-orange-400" id="totalCost"></div>
    </div>
    <div class="bg-card border border-border rounded-xl p-5">
      <div class="text-gray-400 text-sm mb-1">Total Tokens</div>
      <div class="text-2xl font-bold text-blue-400" id="totalTokens"></div>
    </div>
    <div class="bg-card border border-border rounded-xl p-5">
      <div class="text-gray-400 text-sm mb-1">Active Days</div>
      <div class="text-2xl font-bold text-green-400" id="activeDays"></div>
    </div>
    <div class="bg-card border border-border rounded-xl p-5">
      <div class="text-gray-400 text-sm mb-1">Top Model</div>
      <div class="text-lg font-bold text-purple-400 truncate" id="topModel"></div>
    </div>
  </div>

  <!-- Charts Row 1 -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
    <div class="lg:col-span-2 bg-card border border-border rounded-xl p-5">
      <h2 class="text-lg font-semibold text-white mb-4">Daily Token Usage</h2>
      <canvas id="dailyChart" height="100"></canvas>
    </div>
    <div class="bg-card border border-border rounded-xl p-5">
      <h2 class="text-lg font-semibold text-white mb-4">Cost by Provider</h2>
      <canvas id="sourceChart" height="200"></canvas>
    </div>
  </div>

  <!-- Charts Row 2 -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
    <div class="bg-card border border-border rounded-xl p-5">
      <h2 class="text-lg font-semibold text-white mb-4">Top Models by Cost</h2>
      <canvas id="modelChart" height="160"></canvas>
    </div>
    <div class="bg-card border border-border rounded-xl p-5">
      <h2 class="text-lg font-semibold text-white mb-4">Monthly Trend</h2>
      <canvas id="monthlyChart" height="160"></canvas>
    </div>
  </div>

  <!-- Activity Heatmap -->
  <div class="bg-card border border-border rounded-xl p-5 mb-4">
    <h2 class="text-lg font-semibold text-white mb-4">Activity (Last 90 Days)</h2>
    <div id="heatmap" class="flex gap-[3px] flex-wrap"></div>
  </div>

  <!-- Daily Table -->
  <div class="bg-card border border-border rounded-xl p-5">
    <h2 class="text-lg font-semibold text-white mb-4">Daily Breakdown</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-gray-400 border-b border-border">
            <th class="text-left py-2 px-3">Date</th>
            <th class="text-left py-2 px-3">Sources</th>
            <th class="text-right py-2 px-3">Input</th>
            <th class="text-right py-2 px-3">Output</th>
            <th class="text-right py-2 px-3">Cache R</th>
            <th class="text-right py-2 px-3">Cache W</th>
            <th class="text-right py-2 px-3">Cost</th>
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

<script>
const DATA = ${jsonData};
const SOURCE_COLORS = ${JSON.stringify(SOURCE_COLORS)};
const SOURCE_LABELS = ${JSON.stringify(SOURCE_LABELS)};

function fmt(n) { return n.toLocaleString('en-US'); }
function fmtUSD(n) { return '$' + n.toFixed(2); }
function shortModel(m) {
  return m.replace(/^claude-/, '').replace(/-\\d{8}$/, '').replace(/^\\[pi\\]\\s*/, '[pi] ');
}

// Summary Cards
document.getElementById('totalCost').textContent = fmtUSD(DATA.totals.costUSD);
document.getElementById('totalTokens').textContent = fmt(DATA.totals.totalTokens);
document.getElementById('activeDays').textContent = DATA.totals.activeDays;
document.getElementById('topModel').textContent = shortModel(DATA.totals.topModel);
document.getElementById('generated').textContent = new Date(DATA.generated).toLocaleString();

// Sources list
const sourcesHtml = DATA.bySource.map(s =>
  '<span class="inline-block px-2 py-0.5 rounded text-xs mr-1" style="background:' +
  SOURCE_COLORS[s.source] + '22;color:' + SOURCE_COLORS[s.source] + '">' +
  SOURCE_LABELS[s.source] + '</span>'
).join('');
document.getElementById('sourcesList').innerHTML = sourcesHtml;

// Chart defaults
Chart.defaults.color = '#9ca3af';
Chart.defaults.borderColor = '#2a2d37';

// Daily Chart (stacked bar by source)
(function() {
  const labels = DATA.daily.map(d => d.date);
  const sources = [...new Set(DATA.daily.flatMap(d => d.sources))];
  const datasets = sources.map(src => ({
    label: SOURCE_LABELS[src] || src,
    data: DATA.daily.map(d => {
      if (!d.sources.includes(src)) return 0;
      return d.tokens.input + d.tokens.output + d.tokens.cacheCreation + d.tokens.cacheRead;
    }),
    backgroundColor: SOURCE_COLORS[src] || '#666',
    borderRadius: 3,
  }));
  new Chart(document.getElementById('dailyChart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
      scales: {
        x: { stacked: true, ticks: { maxTicksLimit: 15 } },
        y: { stacked: true, ticks: { callback: v => fmt(v) } }
      }
    }
  });
})();

// Source Donut
(function() {
  const labels = DATA.bySource.map(s => SOURCE_LABELS[s.source] || s.source);
  const values = DATA.bySource.map(s => s.costUSD);
  const colors = DATA.bySource.map(s => SOURCE_COLORS[s.source] || '#666');
  new Chart(document.getElementById('sourceChart'), {
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
        tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmtUSD(ctx.parsed) } }
      }
    }
  });
})();

// Model Ranking (horizontal bar, top 10)
(function() {
  const top = DATA.byModel.slice(0, 10);
  new Chart(document.getElementById('modelChart'), {
    type: 'bar',
    data: {
      labels: top.map(m => shortModel(m.model)),
      datasets: [{
        data: top.map(m => m.costUSD),
        backgroundColor: top.map((m, i) => {
          const src = m.sources[0];
          return SOURCE_COLORS[src] || '#6366F1';
        }),
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtUSD(ctx.parsed.x) } } },
      scales: { x: { ticks: { callback: v => fmtUSD(v) } } }
    }
  });
})();

// Monthly Trend (line)
(function() {
  new Chart(document.getElementById('monthlyChart'), {
    type: 'line',
    data: {
      labels: DATA.monthly.map(m => m.month),
      datasets: [{
        label: 'Cost (USD)',
        data: DATA.monthly.map(m => m.costUSD),
        borderColor: '#E87B35',
        backgroundColor: '#E87B3522',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#E87B35',
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtUSD(ctx.parsed.y) } } },
      scales: { y: { ticks: { callback: v => fmtUSD(v) } } }
    }
  });
})();

// Heatmap
(function() {
  const container = document.getElementById('heatmap');
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 89);

  const heatmapMap = {};
  DATA.heatmap.forEach(h => { heatmapMap[h.date] = h.totalTokens; });

  const maxTokens = Math.max(...Object.values(heatmapMap).map(Number), 1);

  for (let i = 0; i < 90; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const tokens = heatmapMap[key] || 0;

    const level = tokens === 0 ? 0 : Math.min(Math.ceil((tokens / maxTokens) * 4), 4);

    const cell = document.createElement('div');
    cell.className = 'heatmap-cell heatmap-' + level;
    cell.title = key + ': ' + fmt(tokens) + ' tokens';
    container.appendChild(cell);
  }
})();

// Daily Table
(function() {
  const tbody = document.getElementById('dailyTableBody');
  const rows = [...DATA.daily].reverse();
  for (const d of rows) {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-border/50 hover:bg-white/5';
    const srcs = d.sources.map(s =>
      '<span class="inline-block px-1.5 py-0.5 rounded text-xs" style="background:' +
      SOURCE_COLORS[s] + '22;color:' + SOURCE_COLORS[s] + '">' +
      (SOURCE_LABELS[s] || s) + '</span>'
    ).join(' ');
    tr.innerHTML =
      '<td class="py-2 px-3 text-gray-300">' + d.date + '</td>' +
      '<td class="py-2 px-3">' + srcs + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300">' + fmt(d.tokens.input) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300">' + fmt(d.tokens.output) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300">' + fmt(d.tokens.cacheRead) + '</td>' +
      '<td class="py-2 px-3 text-right text-gray-300">' + fmt(d.tokens.cacheCreation) + '</td>' +
      '<td class="py-2 px-3 text-right font-medium text-orange-400">' + fmtUSD(d.costUSD) + '</td>';
    tbody.appendChild(tr);
  }
})();
</script>
</body>
</html>`;
}
