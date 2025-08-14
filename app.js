// Mini4WD Race Analyzer - Vanilla JS PWA

// ---------- Utilities ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const APP_VERSION = (typeof window !== 'undefined' && window.__APP_VERSION__) || 'dev';
const pad = (n, w = 2) => n.toString().padStart(w, '0');
const quantize10 = (ms) => Math.round(ms / 10) * 10; // 0.01s 単位に丸め
const formatTime = (ms) => {
  if (!Number.isFinite(ms)) return '-';
  const q = quantize10(ms);
  const totalSeconds = Math.floor(q / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const hundredths = Math.floor((q % 1000) / 10);
  return `${pad(m)}:${pad(s)}.${pad(hundredths, 2)}`;
};

// ---------- Storage ----------
const STORAGE_KEY = 'm4ra_data_v1';
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { groups: {}, order: [] };
    const data = JSON.parse(raw);
    if (!data.groups) data.groups = {};
    if (!Array.isArray(data.order)) data.order = Object.keys(data.groups);
    return data;
  } catch (e) {
    console.error('loadData error', e);
    return { groups: {}, order: [] };
  }
}
function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let state = loadData();
let currentGroupId = null;

// ---------- Stopwatch ----------
class Stopwatch {
  constructor(onTick) {
    this._running = false;
    this._base = 0;
    this._offset = 0;
    this._raf = 0;
    this.onTick = onTick;
  }
  start() {
    if (this._running) return;
    this._running = true;
    this._base = performance.now() - this._offset;
    const loop = () => {
      if (!this._running) return;
      this._offset = performance.now() - this._base;
      this.onTick?.(this._offset);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }
  stop() {
    if (!this._running) return;
    this._running = false;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._offset = performance.now() - this._base;
    this.onTick?.(this._offset);
  }
  reset() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._base = 0;
    this._offset = 0;
    this.onTick?.(0);
  }
  get elapsed() { return this._offset; }
  get running() { return this._running; }
}

// ---------- Rendering ----------
function renderGroups() {
  const list = $('#groupList');
  list.innerHTML = '';
  if (!state.order.length) {
    const empty = document.createElement('div');
    empty.className = 'list-item';
    empty.innerHTML = '<span class="meta">グループはまだありません。上で作成してください。</span>';
    list.appendChild(empty);
    $('#groupDetailSection').classList.add('hidden');
    return;
  }
  state.order.forEach((gid) => {
    const g = state.groups[gid];
    if (!g) return;
    const el = document.createElement('button');
    el.className = 'list-item';
    el.type = 'button';
    el.innerHTML = `<span class="title">${escapeHtml(g.name)}</span>
      <span class="meta">レース数: ${g.races.length}</span>`;
    el.addEventListener('click', () => selectGroup(gid));
    list.appendChild(el);
  });
}

function selectGroup(gid) {
  currentGroupId = gid;
  renderGroupDetail(gid);
}

function computeGroupStats(group) {
  const totalParticipants = group.races.reduce((a, r) => a + (r.participants || 0), 0);
  const totalFinishers = group.races.reduce((a, r) => a + (r.finishes || (r.times?.length || 0)), 0);
  const completionRate = totalParticipants > 0 ? (totalFinishers / totalParticipants) : null;

  const firsts = group.races
    .map(r => {
      if (typeof r.firstTimeMs === 'number') return r.firstTimeMs;
      if (Array.isArray(r.times) && r.times.length) return Math.min(...r.times);
      return null;
    })
    .filter((x) => Number.isFinite(x));
  const firstsQ = firsts.map(quantize10);
  const mean = firstsQ.length ? (firstsQ.reduce((a, b) => a + b, 0) / firstsQ.length) : null;
  const median = firstsQ.length ? computeMedian(firstsQ) : null;
  const stddev = firstsQ.length ? computeStdDev(firstsQ, mean) : null;
  const best = firstsQ.length ? Math.min(...firstsQ) : null;
  const worst = firstsQ.length ? Math.max(...firstsQ) : null;
  return { totalParticipants, totalFinishers, completionRate, mean, median, stddev, best, worst, raceCount: group.races.length, firsts: firstsQ };
}

function renderGroupDetail(gid) {
  const section = $('#groupDetailSection');
  const statsEl = $('#groupStats');
  const rankList = $('#rankList');
  const raceList = $('#raceList');
  const group = state.groups[gid];
  if (!group) return;
  section.classList.remove('hidden');
  $('#group-detail-title').textContent = `グループ: ${group.name}`;

  const { totalParticipants, totalFinishers, completionRate, mean, median, stddev, best, worst, raceCount, firsts } = computeGroupStats(group);
  statsEl.innerHTML = '';

  const stat = (label, value) => {
    const el = document.createElement('div');
    el.className = 'stat';
    el.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    return el;
  };
  // Header createdAt small text
  const createdAtEl = document.getElementById('groupCreatedAt');
  if (createdAtEl) createdAtEl.textContent = group.createdAt ? `作成: ${new Date(group.createdAt).toLocaleString()}` : '';

  statsEl.append(
    stat('レース数', raceCount),
    stat('参加者合計', totalParticipants),
    stat('完走者合計', totalFinishers),
    stat('完走率', completionRate == null ? '-' : `${(completionRate * 100).toFixed(1)}%`),
    stat('１位平均(平均)', mean == null ? '-' : formatTime(mean)),
    stat('１位中央値', median == null ? '-' : formatTime(median)),
    stat('標準偏差', stddev == null ? '-' : formatTime(stddev)),
    stat('トップタイム(最速)', best == null ? '-' : formatTime(best)),
    stat('最低タイム(最遅)', worst == null ? '-' : formatTime(worst)),
  );

  // Predict win probability
  const expectedInput = $('#expectedTimeInput');
  const winProbEl = $('#winProb');
  if (typeof group.expectedMs === 'number') {
    expectedInput.value = (group.expectedMs / 1000).toFixed(2);
  } else {
    expectedInput.value = '';
  }
  const p = computeWinProbability(firsts, group.expectedMs);
  winProbEl.textContent = p == null ? '-' : `${(p * 100).toFixed(1)}%`;

  // Render best-time ranking (top 10)
  rankList.innerHTML = '';
  const entries = group.races
    .map(r => {
      const t = (typeof r.firstTimeMs === 'number') ? r.firstTimeMs : ((r.times && r.times.length) ? Math.min(...r.times) : null);
      return Number.isFinite(t) ? { t: quantize10(t), when: r.createdAt } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t)
    .slice(0, 10);
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-item';
    empty.innerHTML = '<span class="meta">ランキングはまだありません（完走レースの1位タイムが必要）</span>';
    rankList.appendChild(empty);
  } else {
    entries.forEach((e, i) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `
        <div class="title">#${i + 1}</div>
        <div style="display:flex; align-items:center; gap:12px">
          <div class="meta">${new Date(e.when).toLocaleString()}</div>
          <div class="meta"><strong>${formatTime(e.t)}</strong></div>
        </div>
      `;
      rankList.appendChild(item);
    });
  }

  raceList.innerHTML = '';
  group.races
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach((r) => {
      const best = (typeof r.firstTimeMs === 'number') ? r.firstTimeMs : ((r.times && r.times.length) ? Math.min(...r.times) : null);
      const item = document.createElement('div');
      item.className = 'list-item';
      const when = new Date(r.createdAt).toLocaleString();
      const raceInfo = `参加:${r.participants} 完走:${r.finishes ?? r.times?.length ?? 0}`;
      item.innerHTML = `
        <div>
          <div class="title">${when}</div>
          <div class="meta">${raceInfo}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px">
          <div class="meta">ベスト: <strong>${formatTime(best)}</strong></div>
          <button type="button" class="small" data-edit="${r.id}">編集</button>
          <button type="button" class="small danger" data-del="${r.id}">削除</button>
        </div>
      `;
      item.querySelector('[data-edit]')?.addEventListener('click', () => openEditRaceDialog(gid, r.id));
      item.querySelector('[data-del]')?.addEventListener('click', () => deleteRace(gid, r.id));
      raceList.appendChild(item);
    });
}

// ---------- Event wiring ----------
function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c]));
}

function computeMedian(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  if (n % 2 === 0) return (a[mid - 1] + a[mid]) / 2;
  return a[mid];
}

function computeStdDev(arr, mean) {
  if (!arr.length) return null;
  const m = mean ?? (arr.reduce((s, x) => s + x, 0) / arr.length);
  const variance = arr.reduce((s, x) => s + Math.pow(x - m, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function computeWinProbability(firsts, expectedMs) {
  if (!Array.isArray(firsts) || firsts.length === 0) return null;
  if (!Number.isFinite(expectedMs) || expectedMs < 0) return null;
  const wins = firsts.filter(t => expectedMs <= t).length;
  return wins / firsts.length;
}

$('#groupCreateForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#groupNameInput').value.trim();
  if (!name) return;
  const id = uid();
  state.groups[id] = { id, name, races: [], createdAt: Date.now() };
  state.order.unshift(id);
  saveData(state);
  $('#groupNameInput').value = '';
  renderGroups();
  selectGroup(id);
});

$('#deleteGroupBtn').addEventListener('click', () => {
  if (!currentGroupId) return;
  const g = state.groups[currentGroupId];
  const ok = confirm(`グループ「${g.name}」を削除しますか？（元に戻せません）`);
  if (!ok) return;
  delete state.groups[currentGroupId];
  state.order = state.order.filter(id => id !== currentGroupId);
  currentGroupId = null;
  saveData(state);
  renderGroups();
});

$('#newRaceBtn').addEventListener('click', () => openRaceDialog());

// ---------- Race Dialog + Stopwatch ----------
let sw = null;
let capturedTime = null; // 1位タイム（ミリ秒）

function openRaceDialog() {
  if (!currentGroupId) return alert('先にグループを選択してください');
  const dlg = $('#raceDialog');
  $('#participantsInput').value = 4;
  $('#finishersInput').value = 0;
  $('#timerDisplay').textContent = '00:00.0';
  $('#recordedInfo').textContent = '';
  $('#saveRaceBtn').disabled = true;

  sw = new Stopwatch((ms) => $('#timerDisplay').textContent = formatTime(ms));
  $('#startBtn').disabled = false;
  $('#stopBtn').disabled = true;
  $('#resetBtn').disabled = true;
  capturedTime = null;

  dlg.showModal();
  updateSaveEnabled();
}

$('#closeRaceDialog').addEventListener('click', () => {
  $('#raceDialog').close();
});

$('#startBtn').addEventListener('click', () => {
  sw?.start();
  $('#startBtn').disabled = true;
  $('#stopBtn').disabled = false;
  $('#resetBtn').disabled = false;
  capturedTime = null;
  $('#recordedInfo').textContent = '';
  updateSaveEnabled();
});

$('#stopBtn').addEventListener('click', () => {
  sw?.stop();
  $('#startBtn').disabled = false;
  $('#stopBtn').disabled = true;
  capturedTime = sw ? quantize10(sw.elapsed) : null;
  $('#recordedInfo').textContent = capturedTime != null ? `記録: ${formatTime(capturedTime)}` : '';
  updateSaveEnabled();
});

$('#resetBtn').addEventListener('click', () => {
  sw?.reset();
  capturedTime = null;
  $('#recordedInfo').textContent = '';
  updateSaveEnabled();
});

function updateSaveEnabled() {
  const participants = clampInt($('#participantsInput').value, 1, 5);
  const finishers = clampInt($('#finishersInput').value, 0, participants);
  const canSave = finishers === 0 || (finishers > 0 && capturedTime != null);
  $('#saveRaceBtn').disabled = !canSave;
}

function clampInt(v, min, max) {
  const n = Math.max(min, Math.min(max, parseInt(v, 10) || min));
  return n;
}

$('#participantsInput').addEventListener('change', () => {
  const participants = clampInt($('#participantsInput').value, 1, 5);
  $('#participantsInput').value = participants;
  const finishers = clampInt($('#finishersInput').value, 0, participants);
  $('#finishersInput').value = finishers;
  updateSaveEnabled();
});

$('#finishersInput').addEventListener('change', () => {
  const participants = clampInt($('#participantsInput').value, 1, 5);
  const finishers = clampInt($('#finishersInput').value, 0, participants);
  $('#finishersInput').value = finishers;
  updateSaveEnabled();
});

$('#raceForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentGroupId) return;
  const participants = clampInt($('#participantsInput').value, 1, 5);
  const finishers = clampInt($('#finishersInput').value, 0, participants);
  if (finishers > 0 && capturedTime == null) {
    alert('完走者がいる場合は、ストップで１位タイムを記録してください');
    return;
  }
  const race = {
    id: uid(),
    participants,
    finishes: finishers,
    firstTimeMs: finishers > 0 ? capturedTime : null,
    createdAt: Date.now(),
  };
  state.groups[currentGroupId].races.push(race);
  saveData(state);
  $('#raceDialog').close();
  renderGroupDetail(currentGroupId);
  renderGroups();
});

// ---------- Expected time input ----------
$('#expectedTimeInput').addEventListener('input', () => {
  if (!currentGroupId) return;
  const sec = parseFloat($('#expectedTimeInput').value);
  const ms = Number.isFinite(sec) && sec >= 0 ? Math.round(sec * 100) * 10 : null; // 0.01s単位で丸め（10ms）
  state.groups[currentGroupId].expectedMs = ms;
  saveData(state);
  // Re-render to update probability
  renderGroupDetail(currentGroupId);
});

// ---------- Install prompt (optional) ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $('#installBtn');
  btn.hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#installBtn').hidden = true;
});

// ---------- Init ----------
renderGroups();
const vEl = document.getElementById('appVersion');
if (vEl) vEl.textContent = `v${APP_VERSION}`;

// ---------- Edit/Delete Race ----------
let editingRace = null; // { gid, raceId }

function openEditRaceDialog(gid, raceId) {
  const group = state.groups[gid];
  if (!group) return;
  const race = group.races.find(r => r.id === raceId);
  if (!race) return;
  editingRace = { gid, raceId };
  $('#editParticipantsDisplay').value = race.participants;
  $('#editFinishersInput').max = race.participants;
  $('#editFinishersInput').value = race.finishes ?? (race.times?.length ?? 0);
  const tms = (typeof race.firstTimeMs === 'number') ? race.firstTimeMs : ((race.times && race.times.length) ? Math.min(...race.times) : null);
  $('#editFirstTimeInput').value = Number.isFinite(tms) ? (tms / 1000).toFixed(2) : '';
  toggleEditTimeRequirement();
  $('#editRaceDialog').showModal();
}

function toggleEditTimeRequirement() {
  const participants = parseInt($('#editParticipantsDisplay').value, 10) || 1;
  const f = clampInt($('#editFinishersInput').value, 0, participants);
  $('#editFinishersInput').value = f;
  const needTime = f > 0;
  $('#editFirstTimeInput').disabled = !needTime;
}

$('#editFinishersInput').addEventListener('change', toggleEditTimeRequirement);
$('#closeEditDialog').addEventListener('click', () => {
  $('#editRaceDialog').close();
  editingRace = null;
});

$('#editRaceForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!editingRace) return;
  const { gid, raceId } = editingRace;
  const group = state.groups[gid];
  const race = group.races.find(r => r.id === raceId);
  if (!race) return;
  const participants = parseInt($('#editParticipantsDisplay').value, 10) || race.participants || 1;
  const finishers = clampInt($('#editFinishersInput').value, 0, participants);
  let ms = null;
  const sec = parseFloat($('#editFirstTimeInput').value);
  if (finishers > 0) {
    if (!Number.isFinite(sec) || sec < 0) {
      alert('１位タイム（秒）を正しく入力してください');
      return;
    }
    ms = Math.round(sec * 100) * 10; // 0.01s単位（10ms）
  }
  race.finishes = finishers;
  race.firstTimeMs = finishers > 0 ? ms : null;
  saveData(state);
  $('#editRaceDialog').close();
  editingRace = null;
  renderGroupDetail(gid);
  renderGroups();
});

function deleteRace(gid, raceId) {
  const group = state.groups[gid];
  if (!group) return;
  const ok = confirm('このレースを削除しますか？（元に戻せません）');
  if (!ok) return;
  const idx = group.races.findIndex(r => r.id === raceId);
  if (idx >= 0) {
    group.races.splice(idx, 1);
    saveData(state);
    renderGroupDetail(gid);
    renderGroups();
  }
}
