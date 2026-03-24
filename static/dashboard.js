// ── Layout persistence ────────────────────────────────────────────────────────

const LAYOUT_KEY = "dashboard-layout-v3";

const DEFAULT_LAYOUT = {
  "card-tasks":     { col: 1, colEnd: 9,  row: 1, rowEnd: 11 },
  "card-calendar":  { col: 9, colEnd: 13, row: 1, rowEnd: 5  },
  "card-weather":   { col: 9, colEnd: 13, row: 5, rowEnd: 8  },
  "card-training":  { col: 9, colEnd: 13, row: 8, rowEnd: 11 },
};

function saveLayout() {
  const layout = {};
  document.querySelectorAll(".card-wrapper").forEach(el => {
    const style = el.style;
    layout[el.id] = {
      col:    parseInt(style.gridColumnStart) || null,
      colEnd: parseInt(style.gridColumnEnd)   || null,
      row:    parseInt(style.gridRowStart)    || null,
      rowEnd: parseInt(style.gridRowEnd)      || null,
    };
  });
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

function applyLayout(layout) {
  Object.entries(layout).forEach(([id, pos]) => {
    const el = document.getElementById(id);
    if (!el || !pos.col) return;
    el.style.gridColumn = `${pos.col} / ${pos.colEnd}`;
    el.style.gridRow    = `${pos.row} / ${pos.rowEnd}`;
  });
}

// Load saved layout or use CSS defaults
try {
  const saved = localStorage.getItem(LAYOUT_KEY);
  if (saved) applyLayout(JSON.parse(saved));
} catch (e) {
  localStorage.removeItem(LAYOUT_KEY);
}

// ── Lock / Unlock ─────────────────────────────────────────────────────────────

const lockBtn = document.getElementById("lockBtn");
const gridEl  = document.getElementById("grid");
let isLocked  = true;
let autoLockTimer;

function setLocked(locked) {
  isLocked = locked;
  gridEl.classList.toggle("unlocked-mode", !locked);
  lockBtn.textContent = locked ? "⊞ Unlock" : "⊠ Lock";
  lockBtn.classList.toggle("unlocked", !locked);
  clearTimeout(autoLockTimer);
  if (!locked) {
    autoLockTimer = setTimeout(() => setLocked(true), 30000);
  }
}
lockBtn.addEventListener("click", () => setLocked(!isLocked));

// ── Live clock ────────────────────────────────────────────────────────────────

function tick() {
  const now = new Date();
  let h = now.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const m = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("clock").textContent = `${h}:${m}`;
  document.getElementById("ampm").textContent = ampm;
}
setInterval(tick, 1000);
tick();

// ── Grid helpers ──────────────────────────────────────────────────────────────

const COLS = 12;
const ROWS = 10;

function getGridMetrics() {
  const rect = gridEl.getBoundingClientRect();
  const gap = 8;
  const colW = (rect.width  - gap * (COLS - 1)) / COLS;
  const rowH = (rect.height - gap * (ROWS - 1)) / ROWS;
  return { rect, colW, rowH, gap };
}

function pxToCell(px, cellSize, gap) {
  return Math.max(1, Math.round(px / (cellSize + gap)) + 1);
}

function getCardPosition(el) {
  const cs = getComputedStyle(el);
  return {
    col:    parseInt(cs.gridColumnStart),
    colEnd: parseInt(cs.gridColumnEnd),
    row:    parseInt(cs.gridRowStart),
    rowEnd: parseInt(cs.gridRowEnd),
  };
}

// ── Drag to move ──────────────────────────────────────────────────────────────

let dragging = null;
let ghost    = null;
let preview  = null;
let dragOffX, dragOffY;

document.querySelectorAll(".card-wrapper").forEach(wrapper => {
  wrapper.querySelector(".card").addEventListener("pointerdown", e => {
    if (isLocked) return;
    if (e.target.closest(".task-check")) return;

    e.preventDefault();
    const pos  = getCardPosition(wrapper);
    const rect = wrapper.getBoundingClientRect();
    dragOffX   = e.clientX - rect.left;
    dragOffY   = e.clientY - rect.top;

    // Ghost follows the mouse
    ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.style.width  = rect.width  + "px";
    ghost.style.height = rect.height + "px";
    ghost.style.left   = rect.left   + "px";
    ghost.style.top    = rect.top    + "px";
    document.body.appendChild(ghost);

    // Drop preview stays in grid
    preview = document.createElement("div");
    preview.className = "drop-preview";
    gridEl.appendChild(preview);
    updatePreview(pos, preview);

    dragging = { wrapper, pos };
    wrapper.style.opacity = "0.3";
    clearTimeout(autoLockTimer);
  });
});

function updatePreview(pos, previewEl) {
  previewEl.style.gridColumn = `${pos.col} / ${pos.colEnd}`;
  previewEl.style.gridRow    = `${pos.row} / ${pos.rowEnd}`;
  // Position as absolute within grid
  const { rect: gRect, colW, rowH, gap } = getGridMetrics();
  const x = (pos.col - 1) * (colW + gap);
  const y = (pos.row - 1) * (rowH + gap);
  const w = (pos.colEnd - pos.col) * (colW + gap) - gap;
  const h = (pos.rowEnd - pos.row) * (rowH + gap) - gap;
  previewEl.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:rgba(0,0,0,0.06);border:2px dashed #999;border-radius:14px;pointer-events:none;z-index:400;`;
}

document.addEventListener("pointermove", e => {
  if (!dragging) return;
  e.preventDefault();

  ghost.style.left = (e.clientX - dragOffX) + "px";
  ghost.style.top  = (e.clientY - dragOffY) + "px";

  const { rect: gRect, colW, rowH, gap } = getGridMetrics();
  const relX = e.clientX - dragOffX - gRect.left;
  const relY = e.clientY - dragOffY - gRect.top;
  const { pos } = dragging;
  const span_c = pos.colEnd - pos.col;
  const span_r = pos.rowEnd - pos.row;

  const newCol    = Math.max(1, Math.min(COLS - span_c + 1, pxToCell(relX, colW, gap)));
  const newRow    = Math.max(1, Math.min(ROWS - span_r + 1, pxToCell(relY, rowH, gap)));
  const newColEnd = newCol + span_c;
  const newRowEnd = newRow + span_r;

  updatePreview({ col: newCol, colEnd: newColEnd, row: newRow, rowEnd: newRowEnd }, preview);
  dragging.newPos = { col: newCol, colEnd: newColEnd, row: newRow, rowEnd: newRowEnd };
});

document.addEventListener("pointerup", () => {
  if (!dragging) return;
  const { wrapper, newPos } = dragging;

  if (newPos) {
    wrapper.style.gridColumn = `${newPos.col} / ${newPos.colEnd}`;
    wrapper.style.gridRow    = `${newPos.row} / ${newPos.rowEnd}`;
    saveLayout();
  }

  wrapper.style.opacity = "1";
  ghost.remove();
  preview.remove();
  ghost = preview = null;
  dragging = null;
  autoLockTimer = setTimeout(() => setLocked(true), 30000);
});

// ── Resize ────────────────────────────────────────────────────────────────────

let resizing = null;

document.querySelectorAll(".resize-handle").forEach(handle => {
  handle.addEventListener("pointerdown", e => {
    if (isLocked) return;
    e.preventDefault();
    e.stopPropagation();

    const wrapper = handle.closest(".card-wrapper");
    const pos     = getCardPosition(wrapper);
    resizing = { wrapper, startPos: pos, startX: e.clientX, startY: e.clientY };
    clearTimeout(autoLockTimer);
  });
});

document.addEventListener("pointermove", e => {
  if (!resizing) return;
  e.preventDefault();

  const { wrapper, startPos, startX, startY } = resizing;
  const { colW, rowH, gap } = getGridMetrics();

  const dCol = Math.round((e.clientX - startX) / (colW + gap));
  const dRow = Math.round((e.clientY - startY) / (rowH + gap));

  const newColEnd = Math.max(startPos.col + 1, Math.min(COLS + 1, startPos.colEnd + dCol));
  const newRowEnd = Math.max(startPos.row + 1, Math.min(ROWS + 1, startPos.rowEnd + dRow));

  wrapper.style.gridColumn = `${startPos.col} / ${newColEnd}`;
  wrapper.style.gridRow    = `${startPos.row} / ${newRowEnd}`;
});

document.addEventListener("pointerup", () => {
  if (!resizing) return;
  saveLayout();
  resizing = null;
  autoLockTimer = setTimeout(() => setLocked(true), 30000);
});

// ── Card click → modal ────────────────────────────────────────────────────────

function handleCardClick(e, type) {
  if (!isLocked) return;
  if (e.target.closest(".task-check")) return;
  openModal(type);
}

function openModal(type) {
  if (type === "training") {
    renderTrainingModal(); // async, opens modal itself
    return;
  }
  document.getElementById("modalContent").innerHTML = renderModalContent(type);
  document.getElementById("modalOverlay").classList.add("open");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}

document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// ── Modal renderers ───────────────────────────────────────────────────────────

function renderModalContent(type) {
  if (type === "tasks")    return renderTasksModal();
  if (type === "weather")  return `<div class="modal-title">Weather</div><p class="placeholder">Extended forecast coming soon.</p>`;
  if (type === "calendar") return `<div class="modal-title">Today's Calendar</div><p class="placeholder">Outlook sync coming soon.</p>`;
  if (type === "training") return renderTrainingModal();
  return "";
}

function renderTasksModal() {
  if (!TASKS.length) return `<div class="modal-title">Tasks</div><p class="placeholder">No open tasks found.</p>`;
  const items = TASKS.map((task, i) => `
    <div class="modal-task-item">
      <button class="modal-task-check" data-index="${i}" onclick="completeTask(event,${i})"></button>
      <div class="modal-task-body">
        <div class="modal-task-text">${esc(task.text)}</div>
        <div class="modal-task-file">${esc(task.file)}</div>
      </div>
      <div class="modal-task-actions">
        <button class="btn-obsidian" onclick="openInObsidian(${i})">Open in Obsidian</button>
      </div>
    </div>`).join("");
  return `<div class="modal-title">Tasks (${TASKS.length} open)</div>${items}`;
}

async function renderTrainingModal() {
  const t = TRAINING;
  const header = `<div class="modal-title">Week ${t.week} · ${esc(t.phase)} · ${t.days_to_race} days to ${esc(t.race_date)}</div>`;
  const toggle = `
    <div class="pva-toggle">
      <button class="pva-btn active" id="pvaBoth" onclick="setPVAView('both')">Plan + Actual</button>
      <button class="pva-btn" id="pvaPlan" onclick="setPVAView('plan')">Plan Only</button>
    </div>`;

  document.getElementById("modalContent").innerHTML = header + toggle + `<div id="pvaContent"><p class="placeholder">Loading…</p></div>`;
  document.getElementById("modalOverlay").classList.add("open");

  try {
    const res  = await fetch("/api/training-month");
    const data = await res.json();
    window._pvaData = data.weeks;
    renderPVAView("both");
  } catch (e) {
    document.getElementById("pvaContent").innerHTML = `<p class="placeholder">Could not load data: ${esc(e.message)}</p>`;
  }
}

function setPVAView(mode) {
  document.querySelectorAll(".pva-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(mode === "both" ? "pvaBoth" : "pvaPlan").classList.add("active");
  renderPVAView(mode);
}

const KIND_ICON = { run: "🏃", bike: "🚴", strength: "💪", walk: "🚶", other: "●" };

function daySummaryLine(summary) {
  if (!summary) return "";
  const parts = [];
  if (summary.run)      parts.push(`🏃 ${summary.run.miles}mi${summary.run.pace ? " · " + summary.run.pace + "/mi" : ""}${summary.run.hr ? " · " + summary.run.hr + "bpm" : ""}`);
  if (summary.bike)     parts.push(`🚴 ${summary.bike.miles}mi`);
  if (summary.strength) parts.push(`💪 ${summary.strength.duration}`);
  if (summary.walk)     parts.push(`🚶 ${summary.walk.miles}mi`);
  return parts.join(" · ");
}

function renderPVAView(mode) {
  const weeks = window._pvaData;
  if (!weeks) return;

  const html = weeks.map(week => {
    const dayCells = week.days.map(day => {
      const summary = day.summary;
      const future  = day.future;
      const isToday = day.today;
      const hasActs = summary && Object.keys(summary).length > 0;

      let status = day.planned === "Rest" ? "rest" : "miss";
      if (future)  status = "future";
      if (hasActs) status = "hit";

      const summaryLine = mode === "both" ? daySummaryLine(summary) : "";
      const missedEl    = mode === "both" && !future && !hasActs && day.planned !== "Rest"
        ? `<div class="pva-missed">—</div>` : "";

      return `
        <div class="pva-day pva-${status} ${isToday ? "pva-today" : ""}">
          <div class="pva-day-label">${day.day.slice(0,2)}<span class="pva-date">${day.date.slice(5)}</span></div>
          <div class="pva-planned">${esc(day.planned)}</div>
          ${summaryLine ? `<div class="pva-actual">${summaryLine}</div>` : missedEl}
        </div>`;
    }).join("");

    const runMiles = week.days.reduce((s, d) => s + (d.summary?.run?.miles || 0), 0);
    const totalLabel = mode === "both" && runMiles
      ? ` · Done: ${runMiles.toFixed(1)} mi run` : "";

    return `
      <div class="pva-week">
        <div class="pva-week-label">
          Wk ${week.week_num} <span class="pva-phase">${esc(week.phase)}</span>
          <span class="pva-totals">Plan: ${week.total} mi${totalLabel}</span>
        </div>
        <div class="pva-days">${dayCells}</div>
        ${mode === "both" ? renderDayDetails(week.days) : ""}
      </div>`;
  }).join("");

  document.getElementById("pvaContent").innerHTML = html;
}

function renderDayDetails(days) {
  const rows = days.flatMap(day => (day.activities || []).map(a => `
    <tr>
      <td style="padding:5px 8px;font-size:11px;color:#999;">${day.date.slice(5)} ${day.day.slice(0,2)}</td>
      <td style="padding:5px 8px;font-size:12px;">${KIND_ICON[a.kind] || "●"} ${esc(a.name)}</td>
      <td style="padding:5px 8px;font-size:12px;">${a.miles > 0 ? a.miles + " mi" : "—"}</td>
      <td style="padding:5px 8px;font-size:12px;">${a.duration}</td>
      <td style="padding:5px 8px;font-size:12px;">${a.pace ? a.pace + "/mi" : "—"}</td>
      <td style="padding:5px 8px;font-size:12px;">${a.hr ? a.hr + " bpm" : "—"}</td>
    </tr>`)).join("");
  if (!rows) return "";
  return `
    <table style="width:100%;border-collapse:collapse;margin-top:8px;border-top:1px solid #f0f0f0;">
      <thead><tr style="font-size:10px;color:#aaa;text-transform:uppercase;">
        <th style="padding:4px 8px;text-align:left;">Date</th>
        <th style="padding:4px 8px;text-align:left;">Activity</th>
        <th style="padding:4px 8px;text-align:left;">Dist</th>
        <th style="padding:4px 8px;text-align:left;">Time</th>
        <th style="padding:4px 8px;text-align:left;">Pace</th>
        <th style="padding:4px 8px;text-align:left;">HR</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Task actions ──────────────────────────────────────────────────────────────

async function completeTask(event, index) {
  event.stopPropagation();
  const task = TASKS[index];
  if (!task?.path) return;
  document.querySelectorAll(`[data-index="${index}"]`).forEach(b => b.classList.add("completing"));
  try {
    const res  = await fetch("/api/task/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: task.path, line: task.line }),
    });
    const data = await res.json();
    if (data.ok) {
      TASKS.splice(index, 1);
      const overlay = document.getElementById("modalOverlay");
      if (overlay.classList.contains("open")) {
        document.getElementById("modalContent").innerHTML = renderTasksModal();
      }
      document.querySelectorAll(`.task-item[data-index="${index}"]`).forEach(el => {
        el.style.opacity = "0.3";
      });
    } else {
      alert("Could not complete task: " + data.error);
    }
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function openInObsidian(index) {
  const task = TASKS[index];
  if (!task) return;
  await fetch("/api/open-obsidian", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rel_path: task.rel_path }),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
