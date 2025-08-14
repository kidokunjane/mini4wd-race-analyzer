// Distribution page logic
(() => {
  const APP_VERSION = (typeof window !== 'undefined' && window.__APP_VERSION__) || 'dev';
  const vEl = document.getElementById('appVersion');
  if (vEl) vEl.textContent = `v${APP_VERSION}`;

  const STORAGE_KEY = 'm4ra_data_v1';
  const pad = (n, w = 2) => n.toString().padStart(w, '0');
  const quantize10 = (ms) => Math.round(ms / 10) * 10; // 0.01s
  const formatTime = (ms) => {
    if (!Number.isFinite(ms)) return '-';
    const q = quantize10(ms);
    const totalSeconds = Math.floor(q / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    const hundredths = Math.floor((q % 1000) / 10);
    return `${pad(m)}:${pad(s)}.${pad(hundredths, 2)}`;
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"groups":{},"order":[]}'); } catch { return { groups: {}, order: [] }; }
  }

  function getQuery(key) {
    const u = new URL(location.href);
    return u.searchParams.get(key);
  }

  const state = load();
  const gid = getQuery('group');
  const group = gid ? state.groups[gid] : null;

  const title = document.getElementById('groupTitle');
  const meta = document.getElementById('groupMeta');
  const raceList = document.getElementById('raceList');
  document.getElementById('backBtn')?.addEventListener('click', () => {
    if (history.length > 1) history.back(); else location.href = './index.html';
  });
  if (!group) {
    title.textContent = 'グループが選択されていません';
    meta.textContent = 'indexからグループを選んで開いてください';
    // List all groups as links
    const container = document.createElement('div');
    container.className = 'list';
    (state.order || []).forEach(id => {
      const g = state.groups[id]; if (!g) return;
      const a = document.createElement('a');
      a.href = `./distribution.html?group=${encodeURIComponent(id)}`;
      a.className = 'list-item';
      a.textContent = g.name;
      container.appendChild(a);
    });
    raceList.parentElement.replaceWith(container);
    return;
  }

  title.textContent = group.name;
  meta.textContent = group.createdAt ? `作成: ${new Date(group.createdAt).toLocaleString()}` : '';

  // Collect first-place times with metadata
  const entriesAll = group.races
    .map(r => {
      const t = (typeof r.firstTimeMs === 'number') ? r.firstTimeMs : ((r.times && r.times.length) ? Math.min(...r.times) : null);
      if (!Number.isFinite(t)) return null;
      return { t: quantize10(t), when: r.createdAt, participants: r.participants, finishes: (r.finishes ?? r.times?.length ?? 0) };
    })
    .filter(Boolean);
  const firsts = entriesAll.map(e => e.t);

  const summaryEl = document.getElementById('summary');
  if (!firsts.length) {
    summaryEl.textContent = 'データがありません（完走レースの1位タイムが必要）';
  }

  const mean = firsts.length ? (firsts.reduce((a,b)=>a+b,0)/firsts.length) : null;
  const median = firsts.length ? (()=>{ const a=[...firsts].sort((x,y)=>x-y); const n=a.length; const m=Math.floor(n/2); return n%2? a[m] : (a[m-1]+a[m])/2; })() : null;
  const stddev = firsts.length ? ( ()=>{ const m=mean; const v = firsts.reduce((s,x)=>s+Math.pow(x-m,2),0)/firsts.length; return Math.sqrt(v);} )() : null;
  const best = firsts.length ? Math.min(...firsts) : null;
  const worst = firsts.length ? Math.max(...firsts) : null;
  summaryEl.textContent = `件数:${firsts.length} 平均:${formatTime(mean)} 中央:${formatTime(median)} σ:${formatTime(stddev)} 最速:${formatTime(best)} 最遅:${formatTime(worst)}`;

  const canvas = document.getElementById('histCanvas');
  const ctx = canvas.getContext('2d');
  const DPR = window.devicePixelRatio || 1;
  // Resize for DPR
  const cssW = canvas.clientWidth || 900;
  const cssH = canvas.clientHeight || 360;
  canvas.width = Math.floor(cssW * DPR);
  canvas.height = Math.floor(cssH * DPR);
  ctx.scale(DPR, DPR);

  let currentChart = { start: 0, binSize: 0, binCount: 0, padL: 48, padR: 20, padT: 20, padB: 40, w: 0, h: 0, binsMap: [] };

  function drawHistogram(binSec) {
    ctx.clearRect(0,0,cssW,cssH);
    if (!firsts.length) return;
    const binSize = Math.max(0.01, binSec) * 1000; // to ms
    const min = Math.min(...firsts);
    const max = Math.max(...firsts);
    const range = Math.max(binSize, max - min);
    const binCount = Math.min(40, Math.max(5, Math.ceil(range / binSize)));
    const bins = new Array(binCount).fill(0);
    const binsMap = Array.from({ length: binCount }, () => []);
    const start = min;
    entriesAll.forEach(e => {
      let idx = Math.floor((e.t - start) / binSize);
      if (idx < 0) idx = 0; if (idx >= binCount) idx = binCount - 1;
      bins[idx]++;
      binsMap[idx].push(e);
    });
    const maxBin = Math.max(...bins, 1);

    // axes
    const padL = 48, padR = 20, padT = 20, padB = 40;
    const w = cssW - padL - padR;
    const h = cssH - padT - padB;
    currentChart = { start, binSize, binCount, padL, padR, padT, padB, w, h, binsMap };
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + h);
    ctx.lineTo(padL + w, padT + h);
    ctx.stroke();

    // bars
    const barW = w / binCount * 0.9;
    bins.forEach((v, i) => {
      const x = padL + (i + 0.05) * (w / binCount);
      const bh = v / maxBin * (h - 2);
      ctx.fillStyle = '#93c5fd';
      ctx.fillRect(x, padT + h - bh, barW, bh);
    });

    // x-axis labels (min, mid, max)
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto';
    const mid = start + range / 2;
    const labels = [start, mid, start + range];
    labels.forEach((val, i) => {
      const tx = padL + (i === 0 ? 0 : i === 1 ? w / 2 : w);
      const text = formatTime(val);
      ctx.fillText(text, tx - ctx.measureText(text).width / 2, padT + h + 16);
    });
  }

  const BIN_SEC = 0.5;
  drawHistogram(BIN_SEC);

  // Tap on bar to show dialog
  const binDialog = document.getElementById('binDialog');
  const closeBinDialog = document.getElementById('closeBinDialog');
  closeBinDialog?.addEventListener('click', () => binDialog.close());
  canvas.addEventListener('click', (evt) => {
    if (!firsts.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    const { padL, padT, w, h, binCount, binsMap, start, binSize } = currentChart;
    if (x < padL || x > padL + w || y < padT || y > padT + h) return;
    const binW = w / binCount;
    const idx = Math.max(0, Math.min(binCount - 1, Math.floor((x - padL) / binW)));
    const items = binsMap[idx] || [];
    const from = start + idx * binSize;
    const to = from + binSize;
    document.getElementById('binDialogTitle').textContent = `範囲: ${formatTime(from)} 〜 ${formatTime(to)}（${items.length}件）`;
    const body = document.getElementById('binDialogBody');
    body.innerHTML = '';
    if (!items.length) {
      body.innerHTML = '<div class="meta">該当レースはありません</div>';
    } else {
      const list = document.createElement('div');
      list.className = 'list';
      items
        .slice()
        .sort((a,b)=>a.t-b.t)
        .forEach(e => {
          const row = document.createElement('div');
          row.className = 'list-item';
          row.innerHTML = `<div>
            <div class="meta">${new Date(e.when).toLocaleString()}</div>
            <div class="meta">参加:${e.participants} 完走:${e.finishes}</div>
          </div>
          <div class="time-large">${formatTime(e.t)}</div>`;
          list.appendChild(row);
        });
      body.appendChild(list);
    }
    binDialog.showModal();
  });

  // list of races
  raceList.innerHTML = '';
  group.races
    .slice()
    .sort((a,b)=>b.createdAt - a.createdAt)
    .forEach(r => {
      const best = (typeof r.firstTimeMs === 'number') ? r.firstTimeMs : ((r.times && r.times.length) ? Math.min(...r.times) : null);
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `<div>
        <div class="title">${new Date(r.createdAt).toLocaleString()}</div>
        <div class="meta">参加:${r.participants} 完走:${r.finishes ?? r.times?.length ?? 0}</div>
      </div>
      <div class="meta">ベスト: <strong>${formatTime(best)}</strong></div>`;
      raceList.appendChild(item);
    });
})();
