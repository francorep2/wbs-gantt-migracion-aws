/* =====================================================================
 * WBS + Gantt interactivo · Migración a AWS - Mercado Hogar S.R.L.
 * JavaScript puro, sin dependencias. Los datos se guardan en localStorage.
 * ===================================================================== */
(() => {
  "use strict";

  const STORAGE_KEY = "wbs-gantt-mercado-hogar-v1";
  const THEME_KEY = "wbs-gantt-theme";
  const DAY_MS = 86400000;
  const ZOOM_PX = { day: 28, week: 9, month: 3.5 };
  const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "style") node.style.cssText = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  };

  /* ------------------------------------------------------------------ */
  /* Estado                                                              */
  /* ------------------------------------------------------------------ */
  let state;
  const ui = { view: "wbs", zoom: "week", search: "", showDates: true, critical: true, deps: true, milestones: true, cascade: true };

  function fromDefault() {
    const d = structuredClone(window.DEFAULT_PROJECT);
    return {
      name: d.name,
      startDate: d.startDate,
      phases: d.phases.map(p => ({ code: p.code, name: p.name, color: p.color, collapsed: false })),
      tasks: d.phases.flatMap(p => p.tasks.map(t => ({
        code: t.code, phase: p.code, name: t.name, start: t.start, duration: t.duration,
        deps: t.deps || [], progress: t.progress || 0, owner: t.owner || "", notes: t.notes || "", loe: !!t.loe,
      }))),
      milestones: d.milestones,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tasks) && Array.isArray(parsed.phases)) return parsed;
      }
    } catch (_) { /* sin almacenamiento disponible */ }
    return fromDefault();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* ignorar */ }
  }

  /* ------------------------------------------------------------------ */
  /* Utilidades de fechas y códigos                                      */
  /* ------------------------------------------------------------------ */
  const startMs = () => Date.parse(state.startDate + "T00:00:00Z");
  const dayToDate = d => new Date(startMs() + d * DAY_MS);
  const isoDay = d => dayToDate(d).toISOString().slice(0, 10);
  const isoToDay = iso => Math.round((Date.parse(iso + "T00:00:00Z") - startMs()) / DAY_MS);
  const fmt = d => { const x = dayToDate(d); return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCFullYear()).slice(2)}`; };
  const weekOf = d => Math.floor(d / 7) + 1;
  const endOf = t => t.start + t.duration; // exclusivo
  const lastDay = t => endOf(t) - 1;       // inclusivo, para mostrar

  const codeCmp = (a, b) => {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] ?? -1) - (pb[i] ?? -1);
      if (diff) return diff;
    }
    return 0;
  };
  const taskByCode = code => state.tasks.find(t => t.code === code);
  const phaseByCode = code => state.phases.find(p => p.code === code);
  const tasksOf = phaseCode => state.tasks.filter(t => t.phase === phaseCode).sort((a, b) => codeCmp(a.code, b.code));

  /* ------------------------------------------------------------------ */
  /* Ruta crítica (CPM sobre las fechas planificadas)                    */
  /* ------------------------------------------------------------------ */
  function analyze() {
    const work = state.tasks.filter(t => !t.loe);
    const succ = new Map(state.tasks.map(t => [t.code, []]));
    for (const t of state.tasks) for (const d of t.deps) if (succ.has(d)) succ.get(d).push(t.code);

    const projectEnd = work.length ? Math.max(...work.map(endOf)) : 0;
    const lf = new Map();
    const visiting = new Set();
    const lateFinish = code => {
      if (lf.has(code)) return lf.get(code);
      if (visiting.has(code)) return projectEnd; // ciclo: cortar
      visiting.add(code);
      let v = projectEnd;
      for (const s of succ.get(code) || []) {
        const st = taskByCode(s);
        if (!st || st.loe) continue;
        v = Math.min(v, lateFinish(s) - st.duration); // LF(t) = min(LS de sucesoras)
      }
      visiting.delete(code);
      lf.set(code, v);
      return v;
    };

    const info = new Map();
    for (const t of state.tasks) {
      const preds = t.deps.map(taskByCode).filter(Boolean);
      const earliest = preds.length ? Math.max(...preds.map(endOf)) : -Infinity;
      const violated = t.start < earliest;
      const slack = t.loe ? null : lateFinish(t.code) - endOf(t);
      info.set(t.code, { slack, critical: !t.loe && slack <= 0, violated, successors: succ.get(t.code) || [] });
    }
    return { info, projectEnd };
  }

  /* Empuja hacia adelante las sucesoras que quedaron antes del fin de sus predecesoras */
  function cascadeFrom(code, seen = new Set()) {
    if (seen.has(code)) return;
    seen.add(code);
    for (const s of state.tasks.filter(t => t.deps.includes(code))) {
      const earliest = Math.max(...s.deps.map(taskByCode).filter(Boolean).map(endOf));
      if (s.start < earliest) s.start = earliest;
      cascadeFrom(s.code, seen);
    }
  }

  function hasCycle(code, deps) {
    const stack = [...deps];
    const seen = new Set();
    while (stack.length) {
      const c = stack.pop();
      if (c === code) return true;
      if (seen.has(c)) continue;
      seen.add(c);
      const t = taskByCode(c);
      if (t) stack.push(...t.deps);
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Render general                                                      */
  /* ------------------------------------------------------------------ */
  let analysis;
  function render() {
    analysis = analyze();
    $("#project-name").textContent = state.name;
    $("#start-date").value = state.startDate;
    renderSummary();
    if (ui.view === "wbs") renderWBS(); else renderGantt();
  }

  function renderSummary() {
    const all = state.tasks;
    const work = all.filter(t => !t.loe);
    const start = all.length ? Math.min(...all.map(t => t.start)) : 0;
    const end = all.length ? Math.max(...all.map(endOf)) : 0;
    const totalDur = work.reduce((s, t) => s + t.duration, 0) || 1;
    const progress = Math.round(work.reduce((s, t) => s + t.duration * (t.progress || 0), 0) / totalDur);
    const crit = [...analysis.info.values()].filter(i => i.critical).length;
    const warn = [...analysis.info.values()].filter(i => i.violated).length;
    const kpi = (value, label, extra) => el("div", { class: "kpi" }, el("b", { text: value }), el("span", { text: label }), extra);
    $("#summary").replaceChildren(
      kpi(`${Math.ceil((end - start) / 7)} semanas`, `${end - start} días corridos`),
      kpi(fmt(start), "Inicio"),
      kpi(fmt(end - 1), "Fin estimado"),
      kpi(String(all.length), `paquetes en ${state.phases.length} fases`),
      kpi(`${progress}%`, "Avance ponderado", el("div", { class: "kbar" }, el("i", { style: `width:${progress}%` }))),
      kpi(String(crit), "tareas críticas"),
      warn ? kpi(`⚠ ${warn}`, "dependencias no respetadas") : "",
    );
  }

  /* ------------------------------------------------------------------ */
  /* Vista WBS                                                           */
  /* ------------------------------------------------------------------ */
  function renderWBS() {
    const root = $("#wbs");
    const q = ui.search.trim().toLowerCase();
    const matches = t => !q || `${t.code} ${t.name}`.toLowerCase().includes(q);
    $("#view-wbs").classList.toggle("hide-dates", !ui.showDates);

    const phases = [...state.phases].sort((a, b) => codeCmp(a.code, b.code)).map(p => {
      const tasks = tasksOf(p.code);
      const span = tasks.length ? [Math.min(...tasks.map(t => t.start)), Math.max(...tasks.map(endOf))] : null;
      const anyHit = tasks.some(matches) || (q && p.name.toLowerCase().includes(q));
      const phaseNode = el("div", {
        class: "wbs-node wbs-phase-node",
        title: "Clic: contraer/expandir · Doble clic: renombrar",
        onclick: () => { p.collapsed = !p.collapsed; save(); renderWBS(); },
        ondblclick: e => { e.stopPropagation(); renamePhase(p); },
      },
        el("span", { class: "caret", text: p.collapsed ? "▸" : "▾" }),
        `${p.code}. ${p.name.toUpperCase()}`,
        el("span", { class: "meta", text: span ? `Sem ${weekOf(span[0])}–${weekOf(span[1] - 1)} · ${tasks.length} paquetes` : "sin paquetes" }),
      );
      const items = tasks.map(t => {
        const inf = analysis.info.get(t.code);
        return el("li", {},
          el("div", {
            class: `wbs-node wbs-task${ui.critical && inf.critical ? " crit" : ""}${q && !matches(t) ? " dim" : ""}${q && matches(t) ? " hit" : ""}`,
            onclick: () => openTask(t.code),
            onmouseenter: e => showTip(e, t), onmouseleave: hideTip,
          },
            el("span", { class: "code", text: t.code }), t.name,
            el("span", { class: "dates", text: `${fmt(t.start)} → ${fmt(lastDay(t))} · ${t.duration} d${t.owner ? " · " + t.owner : ""}` }),
            el("div", { class: "prog" }, el("i", { style: `width:${t.progress || 0}%` })),
          ));
      });
      items.push(el("li", { class: "add-li" }, el("button", { class: "wbs-add", onclick: () => openTask(null, p.code), text: "+ paquete" })));
      if (!tasks.length) items.push(el("li", {}, el("button", { class: "wbs-add", onclick: () => deletePhase(p), text: "Eliminar fase" })));
      return el("div", { class: `wbs-phase${p.collapsed ? " collapsed" : ""}${q && !anyHit ? " dim" : ""}`, style: `--phase:${p.color}` },
        phaseNode, el("ul", { class: "wbs-children" }, items));
    });

    const end = state.tasks.length ? Math.max(...state.tasks.map(endOf)) : 0;
    root.replaceChildren(
      el("div", { class: "wbs-root" }, state.name.toUpperCase(), el("small", { text: `${fmt(0)} → ${fmt(end - 1)}` })),
      el("div", { class: "wbs-stem" }),
      el("div", { class: "wbs-phases" }, phases),
    );
    // La línea vertical de cada fase termina a la altura del último hijo
    for (const ul of $$(".wbs-children", root)) {
      const last = ul.lastElementChild;
      if (last) ul.style.setProperty("--last-mid", `${ul.clientHeight - (last.offsetTop + last.offsetHeight / 2)}px`);
    }
  }

  async function renamePhase(p) {
    const name = await ask("Renombrar fase", { value: p.name, ok: "Guardar" });
    if (name && name.trim()) { p.name = name.trim(); save(); render(); }
  }

  async function deletePhase(p) {
    if (!(await ask(`¿Eliminar la fase ${p.code}. ${p.name}?`, { ok: "Eliminar", danger: true }))) return;
    state.phases = state.phases.filter(x => x !== p);
    save(); render();
  }

  async function addPhase() {
    const name = await ask("Nombre de la nueva fase", { value: "", ok: "Agregar" });
    if (!name || !name.trim()) return;
    const next = String(Math.max(0, ...state.phases.map(p => parseInt(p.code, 10) || 0)) + 1);
    const palette = ["#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#14b8a6", "#ec4899", "#64748b", "#84cc16"];
    state.phases.push({ code: next, name: name.trim(), color: palette[(+next - 1) % palette.length], collapsed: false });
    save(); render();
  }

  /* ------------------------------------------------------------------ */
  /* Vista Gantt                                                         */
  /* ------------------------------------------------------------------ */
  function renderGantt() {
    const px = ZOOM_PX[ui.zoom];
    const rowH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--row-h"), 10) || 34;
    const minStart = Math.min(0, ...state.tasks.map(t => t.start));
    const maxEnd = Math.max(7, ...state.tasks.map(endOf), ...state.milestones.map(m => m.day));
    const from = Math.floor(minStart / 7) * 7 - (ui.zoom === "day" ? 0 : 7);
    const to = Math.ceil(maxEnd / 7) * 7 + 14;
    const width = (to - from) * px;
    const x = d => (d - from) * px;
    const crit = ui.critical;

    /* --- cabecera --- */
    const topCells = [], botCells = [];
    const startDow = (dayToDate(0).getUTCDay() + 6) % 7; // 0 = lunes
    if (ui.zoom === "day") {
      for (let d = from; d < to; d++) {
        const dt = dayToDate(d);
        const dow = (startDow + ((d % 7) + 7)) % 7;
        if (dow === 0) topCells.push(el("div", { class: "scale-cell major", style: `left:${x(d)}px;width:${7 * px}px`, text: `Sem ${weekOf(d)} · ${fmt(d)}` }));
        botCells.push(el("div", { class: "scale-cell", style: `left:${x(d)}px;width:${px}px;text-align:center;padding:4px 0 0`, text: "LMMJVSD"[dow] + dt.getUTCDate() }));
      }
    } else {
      // meses (fila superior)
      let d = from;
      while (d < to) {
        const dt = dayToDate(d);
        const next = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1);
        const nd = Math.min(to, d + Math.round((next - dt.getTime()) / DAY_MS));
        topCells.push(el("div", { class: "scale-cell major", style: `left:${x(d)}px;width:${(nd - d) * px}px`, text: `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}` }));
        d = nd;
      }
      // semanas del proyecto (fila inferior)
      for (let w = from; w < to; w += 7) {
        const label = w < 0 ? "" : (ui.zoom === "week" ? `S${weekOf(w)}` : String(weekOf(w)));
        botCells.push(el("div", { class: "scale-cell", style: `left:${x(w)}px;width:${7 * px}px`, title: `Semana ${weekOf(w)} · ${fmt(w)}`, text: label }));
      }
    }
    const head = el("div", { class: "g-head" },
      el("div", { class: "g-row" }, el("div", { class: "g-left" }, el("span", { text: "" })), el("div", { class: "g-track", style: `width:${width}px` }, topCells)),
      el("div", { class: "g-row" },
        el("div", { class: "g-left" }, el("span", { text: "Cód." }), el("span", { text: "Tarea" }), el("span", { text: "Inicio" }), el("span", { text: "Fin" }), el("span", { class: "num", text: "Días" }), el("span", { class: "num", text: "%" })),
        el("div", { class: "g-track", style: `width:${width}px` }, botCells)),
    );

    /* --- filas --- */
    const rows = [];
    const rowIndex = new Map();
    const phases = [...state.phases].sort((a, b) => codeCmp(a.code, b.code));
    for (const p of phases) {
      const tasks = tasksOf(p.code);
      const s = tasks.length ? Math.min(...tasks.map(t => t.start)) : null;
      const e = tasks.length ? Math.max(...tasks.map(endOf)) : null;
      const tot = tasks.reduce((a, t) => a + t.duration, 0) || 1;
      const prog = Math.round(tasks.reduce((a, t) => a + t.duration * (t.progress || 0), 0) / tot);
      rows.push(el("div", { class: `g-row phase${p.collapsed ? " collapsed" : ""}`, style: `--phase:${p.color}` },
        el("div", { class: "g-left", onclick: () => { p.collapsed = !p.collapsed; save(); renderGantt(); }, title: "Clic para contraer/expandir" },
          el("span", { text: p.code }), el("span", { class: "name", text: p.name }),
          el("span", { text: s != null ? fmt(s) : "" }), el("span", { text: e != null ? fmt(e - 1) : "" }),
          el("span", { class: "num", text: s != null ? e - s : "" }), el("span", { class: "num", text: tasks.length ? prog : "" })),
        el("div", { class: "g-track", style: `width:${width}px` },
          s != null ? el("div", { class: "summary-bar", style: `left:${x(s)}px;width:${(e - s) * px}px` }) : null)));
      if (p.collapsed) { rowIndex.set("phase:" + p.code, rows.length - 1); for (const t of tasks) rowIndex.set(t.code, rows.length - 1); continue; }
      for (const t of tasks) {
        const inf = analysis.info.get(t.code);
        rowIndex.set(t.code, rows.length);
        const w = Math.max(t.duration * px, 4);
        const bar = el("div", {
          class: `bar${crit && inf.critical ? " crit" : ""}${t.loe ? " loe" : ""}${inf.violated ? " warn" : ""}`,
          style: `left:${x(t.start)}px;width:${w}px`,
          "data-code": t.code,
        },
          el("div", { class: "fill", style: `width:${t.progress || 0}%` }),
          el("div", { class: "lbl", text: w > 40 ? `${t.progress || 0}%` : "" }),
          el("div", { class: "handle" }));
        bar.addEventListener("pointerdown", e => startDrag(e, t, bar, px));
        bar.addEventListener("mouseenter", e => showTip(e, t));
        bar.addEventListener("mousemove", moveTip);
        bar.addEventListener("mouseleave", hideTip);
        rows.push(el("div", { class: "g-row task", style: `--phase:${p.color}` },
          el("div", { class: "g-left", onclick: () => openTask(t.code), title: t.name },
            el("span", { text: t.code }), el("span", { class: "name", text: t.name }),
            el("span", { text: fmt(t.start) }), el("span", { text: fmt(lastDay(t)) }),
            el("span", { class: "num", text: t.duration }), el("span", { class: "num", text: t.progress || 0 })),
          el("div", { class: "g-track", style: `width:${width}px` }, bar,
            el("div", { class: "bar-out", style: `left:${x(endOf(t)) + 6}px`, text: t.name }))));
      }
    }
    if (ui.milestones && state.milestones.length) {
      rows.push(el("div", { class: "g-row ms" },
        el("div", { class: "g-left" }, el("span", { text: "◆" }), el("span", { class: "name", text: "Hitos del Project Charter" })),
        el("div", { class: "g-track", style: `width:${width}px` },
          state.milestones.map(m =>
            el("div", { class: "diamond", style: `left:${x(m.day)}px`, title: `${m.id} · ${m.name} · ${fmt(m.day - 1)} (fin semana ${weekOf(m.day - 1)})` })))));
      for (const m of state.milestones) {
        rows.push(el("div", { class: "g-row ms" },
          el("div", { class: "g-left" }, el("span", { text: m.id }), el("span", { class: "name", text: m.name }), el("span", { text: "" }), el("span", { text: fmt(m.day - 1) }), el("span", { class: "num", text: "0" }), el("span", { text: "" })),
          el("div", { class: "g-track", style: `width:${width}px` },
            el("div", { class: "diamond", style: `left:${x(m.day)}px` }),
            el("div", { class: "diamond-lbl", style: `left:${x(m.day)}px`, text: `Semana ${weekOf(m.day - 1)}` }))));
      }
    }

    /* --- grilla de fondo --- */
    const leftW = "var(--left-w)";
    const grid = el("div", { class: "g-grid", style: `left:${leftW};width:${width}px` });
    const step = ui.zoom === "day" ? 1 : 7;
    for (let d = from; d < to; d += step) grid.append(el("div", { class: "col", style: `left:${x(d)}px` }));
    if (ui.zoom === "day") {
      for (let d = from; d < to; d++) {
        const dow = (startDow + ((d % 7) + 7)) % 7;
        if (dow === 5) grid.append(el("div", { class: "wkend", style: `left:${x(d)}px;width:${2 * px}px` }));
      }
    }
    if (ui.milestones) for (const m of state.milestones) grid.append(el("div", { class: "ms-line", style: `left:${x(m.day)}px` }));
    const today = Math.floor((Date.now() - startMs()) / DAY_MS);
    if (today >= from && today <= to) grid.append(el("div", { class: "today", style: `left:${x(today)}px`, title: "Hoy" }));

    /* --- flechas de dependencias --- */
    let svg = null;
    if (ui.deps) {
      const ns = "http://www.w3.org/2000/svg";
      svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "deps");
      svg.setAttribute("width", width);
      svg.setAttribute("height", rows.length * rowH);
      svg.style.left = leftW;
      svg.innerHTML = `<defs>
        <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor" stroke="none"/></marker>
      </defs>`;
      svg.style.color = "var(--muted)";
      for (const t of state.tasks) {
        if (!rowIndex.has(t.code) || phaseByCode(t.phase)?.collapsed) continue;
        for (const dc of t.deps) {
          const p = taskByCode(dc);
          if (!p || !rowIndex.has(dc) || phaseByCode(p.phase)?.collapsed) continue;
          const x1 = x(endOf(p)), y1 = rowIndex.get(dc) * rowH + rowH / 2;
          const x2 = x(t.start), y2 = rowIndex.get(t.code) * rowH + rowH / 2;
          let d;
          if (x2 - x1 >= 12) d = `M${x1},${y1} H${x1 + 6} V${y2} H${x2 - 1}`;
          else {
            const ym = y2 + (y2 > y1 ? -rowH / 2 : rowH / 2);
            d = `M${x1},${y1} H${x1 + 6} V${ym} H${x2 - 8} V${y2} H${x2 - 1}`;
          }
          const path = document.createElementNS(ns, "path");
          path.setAttribute("d", d);
          path.setAttribute("marker-end", "url(#arr)");
          const bad = endOf(p) > t.start;
          const isCrit = crit && analysis.info.get(t.code).critical && analysis.info.get(dc).critical && endOf(p) === t.start;
          path.setAttribute("class", bad ? "bad" : isCrit ? "crit" : "");
          svg.append(path);
        }
      }
    }

    const body = el("div", { class: "g-body", style: "position:relative" }, grid, svg, rows);
    const scroller = $("#gantt-scroll");
    const keep = { left: scroller.scrollLeft, top: scroller.scrollTop };
    $("#gantt").replaceChildren(head, body);
    scroller.scrollLeft = keep.left; scroller.scrollTop = keep.top;
  }

  /* --- arrastrar barras --- */
  function startDrag(e, t, bar, px) {
    if (e.button !== 0) return;
    e.preventDefault();
    const mode = e.target.classList.contains("handle") ? "resize" : "move";
    const x0 = e.clientX;
    const orig = { start: t.start, duration: t.duration };
    let delta = 0, moved = false;
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
    const left0 = parseFloat(bar.style.left), width0 = parseFloat(bar.style.width);

    const onMove = ev => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 3) moved = true;
      delta = Math.round(dx / px);
      if (mode === "move") bar.style.left = `${left0 + delta * px}px`;
      else { delta = Math.max(delta, 1 - orig.duration); bar.style.width = `${Math.max(width0 + delta * px, 4)}px`; }
      const preview = mode === "move" ? { ...t, start: orig.start + delta } : { ...t, duration: orig.duration + delta };
      showTip(ev, preview);
    };
    const onUp = () => {
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
      bar.removeEventListener("pointercancel", onUp);
      bar.classList.remove("dragging");
      hideTip();
      if (!moved) { openTask(t.code); return; }
      if (delta) {
        if (mode === "move") t.start = orig.start + delta; else t.duration = orig.duration + delta;
        if (ui.cascade) cascadeFrom(t.code);
        save();
        toast(`${t.code} · ${fmt(t.start)} → ${fmt(lastDay(t))} (${t.duration} días)`);
      }
      render();
    };
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
    bar.addEventListener("pointercancel", onUp);
  }

  /* ------------------------------------------------------------------ */
  /* Tooltip y avisos                                                    */
  /* ------------------------------------------------------------------ */
  const tip = $("#tooltip");
  function showTip(e, t) {
    const inf = analysis.info.get(t.code) || {};
    const lines = [
      `${fmt(t.start)} → ${fmt(lastDay(t))} · ${t.duration} días (sem ${weekOf(t.start)}–${weekOf(lastDay(t))})`,
      `Avance: ${t.progress || 0}%`,
      t.deps.length ? `Predecesoras: ${t.deps.join(", ")}` : null,
      t.loe ? "Nivel de esfuerzo" : inf.slack != null ? `Holgura: ${inf.slack} días${inf.critical ? " · CRÍTICA" : ""}` : null,
      inf.violated ? "⚠ Empieza antes de que termine una predecesora" : null,
      t.owner ? `Responsable: ${t.owner}` : null,
    ].filter(Boolean);
    tip.replaceChildren(el("b", { text: `${t.code} ${t.name}` }), ...lines.map(l => el("div", { text: l })));
    tip.hidden = false;
    moveTip(e);
  }
  function moveTip(e) {
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let left = e.clientX + pad, top = e.clientY + pad;
    if (left + r.width > innerWidth) left = e.clientX - r.width - pad;
    if (top + r.height > innerHeight) top = e.clientY - r.height - pad;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  }
  function hideTip() { tip.hidden = true; }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  /* ------------------------------------------------------------------ */
  /* Diálogo de confirmación / texto (reemplaza prompt y confirm)        */
  /* ------------------------------------------------------------------ */
  // Con `value` pide un texto y resuelve con él (o null); sin `value` confirma y resuelve true/false.
  function ask(message, { value, ok = "Aceptar", danger = false } = {}) {
    const d = $("#ask-dialog");
    $("#ask-msg").textContent = message;
    const input = $("#ask-input");
    input.hidden = value === undefined;
    input.value = value ?? "";
    const okBtn = $("#ask-ok");
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? "danger" : "primary"}`;
    d.returnValue = "";
    d.showModal();
    (value === undefined ? okBtn : input).focus();
    return new Promise(resolve => {
      d.addEventListener("close", () => {
        const accepted = d.returnValue === "ok";
        resolve(value === undefined ? accepted : accepted ? input.value : null);
      }, { once: true });
    });
  }
  $("#ask-cancel").addEventListener("click", () => $("#ask-dialog").close("cancel"));

  /* ------------------------------------------------------------------ */
  /* Diálogo de edición                                                  */
  /* ------------------------------------------------------------------ */
  const dlg = $("#task-dialog");
  const form = $("#task-form");
  let editing = null; // código original o null si es nueva

  function nextCode(phaseCode) {
    const nums = tasksOf(phaseCode).map(t => parseInt(t.code.split(".")[1], 10) || 0);
    return `${phaseCode}.${Math.max(0, ...nums) + 1}`;
  }

  function openTask(code, phaseCode) {
    hideTip();
    const t = code ? taskByCode(code) : null;
    editing = code;
    const phase = t ? t.phase : (phaseCode || state.phases[0]?.code);
    if (!phase) { toast("Primero creá una fase"); return; }
    form.phase.replaceChildren(...[...state.phases].sort((a, b) => codeCmp(a.code, b.code)).map(p => el("option", { value: p.code, text: `${p.code}. ${p.name}` })));
    const prevInPhase = tasksOf(phase).at(-1);
    const data = t || { code: nextCode(phase), phase, name: "", start: prevInPhase ? endOf(prevInPhase) : 0, duration: 5, deps: [], progress: 0, owner: "", notes: "", loe: false };
    $("#dlg-title").textContent = t ? `Editar ${t.code}` : "Nueva tarea";
    form.code.value = data.code;
    form.phase.value = data.phase;
    form.name.value = data.name;
    form.startDate.value = isoDay(data.start);
    form.duration.value = data.duration;
    form.endDate.value = isoDay(lastDay(data));
    form.progress.value = data.progress || 0;
    form.owner.value = data.owner || "";
    form.deps.value = data.deps.join(", ");
    form.loe.checked = !!data.loe;
    form.notes.value = data.notes || "";
    $("#dlg-delete").hidden = !t;
    $("#form-error").textContent = "";
    dlg.showModal();
    form.name.focus();
  }

  const syncEnd = () => {
    const s = form.startDate.value, d = parseInt(form.duration.value, 10);
    if (s && d > 0) form.endDate.value = isoDay(isoToDay(s) + d - 1);
  };
  form.startDate.addEventListener("input", syncEnd);
  form.duration.addEventListener("input", syncEnd);
  form.phase.addEventListener("change", () => { if (!editing) form.code.value = nextCode(form.phase.value); });

  form.addEventListener("submit", e => {
    e.preventDefault();
    const err = msg => { $("#form-error").textContent = msg; };
    const code = form.code.value.trim();
    const deps = form.deps.value.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!code) return err("El código es obligatorio.");
    if (code !== editing && taskByCode(code)) return err(`Ya existe una tarea con código ${code}.`);
    const missing = deps.filter(d => d !== editing && !taskByCode(d));
    if (missing.length) return err(`No existen las predecesoras: ${missing.join(", ")}.`);
    if (deps.includes(code) || (editing && deps.includes(editing))) return err("Una tarea no puede depender de sí misma.");
    if (editing && hasCycle(editing, deps)) return err("Esas predecesoras generan una dependencia circular.");
    const duration = parseInt(form.duration.value, 10);
    if (!(duration > 0)) return err("La duración debe ser mayor a 0.");

    const values = {
      code, phase: form.phase.value, name: form.name.value.trim(), start: isoToDay(form.startDate.value), duration,
      deps, progress: Math.min(100, Math.max(0, parseInt(form.progress.value, 10) || 0)),
      owner: form.owner.value.trim(), notes: form.notes.value.trim(), loe: form.loe.checked,
    };
    if (editing) {
      const t = taskByCode(editing);
      if (code !== editing) for (const o of state.tasks) o.deps = o.deps.map(d => (d === editing ? code : d));
      Object.assign(t, values);
    } else {
      state.tasks.push(values);
    }
    if (ui.cascade) cascadeFrom(code);
    save();
    dlg.close();
    render();
  });

  $("#dlg-cancel").addEventListener("click", () => dlg.close());
  $("#dlg-delete").addEventListener("click", async () => {
    if (!editing || !(await ask(`¿Eliminar la tarea ${editing}?`, { ok: "Eliminar", danger: true }))) return;
    state.tasks = state.tasks.filter(t => t.code !== editing);
    for (const t of state.tasks) t.deps = t.deps.filter(d => d !== editing);
    save(); dlg.close(); render();
  });

  /* ------------------------------------------------------------------ */
  /* Archivo: exportar / importar / imprimir                             */
  /* ------------------------------------------------------------------ */
  // Guarda un archivo. Fuera de claude.ai usa un link de descarga; embebido usa la capacidad "downloads".
  async function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    if (window.EMBEDDED_VIEW) {
      const dl = window.claude?.use ? await window.claude.use("downloads") : null;
      if (!dl) { toast("Las descargas no están disponibles en esta vista"); return; }
      try { await dl.save({ filename: name, data: blob }); toast(`Descargado: ${name}`); }
      catch (e) { if (e?.code !== "declined") toast(`No se pudo descargar (${e?.code || "error"})`); }
      return;
    }
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function runExport(kind, mode) {
    if (!window.Exporters) { toast("El módulo de exportación no cargó"); return; }
    toast("Generando archivo…");
    try {
      const api = { state, analysis, fmt, isoDay, endOf, lastDay, weekOf, codeCmp, tasksOf, phaseByCode, dayToDate };
      const file = kind === "pdf" ? await window.Exporters.pdf(api, mode) : window.Exporters.msproject(api, mode);
      await download(file.name, file.blob);
    } catch (e) {
      console.error(e);
      toast(`No se pudo generar el archivo: ${e.message}`);
    }
  }

  function exportCSV() {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Código", "Fase", "Tarea", "Inicio", "Fin", "Duración (días)", "Semana inicio", "Semana fin", "Avance %", "Predecesoras", "Responsable", "Crítica", "Holgura (días)", "Notas"];
    const lines = [...state.tasks].sort((a, b) => codeCmp(a.code, b.code)).map(t => {
      const inf = analysis.info.get(t.code);
      return [t.code, phaseByCode(t.phase)?.name, t.name, fmt(t.start), fmt(lastDay(t)), t.duration, weekOf(t.start), weekOf(lastDay(t)),
        t.progress || 0, t.deps.join(", "), t.owner, inf.critical ? "Sí" : "No", inf.slack ?? "", t.notes].map(esc).join(";");
    });
    download("cronograma-migracion-aws.csv", "﻿" + [header.map(esc).join(";"), ...lines].join("\r\n"), "text/csv;charset=utf-8");
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.tasks) || !Array.isArray(data.phases) || !data.startDate) throw new Error("formato");
        data.milestones = data.milestones || [];
        state = data;
        save(); render(); toast("Proyecto importado");
      } catch (_) { toast("El archivo no tiene el formato esperado"); }
    };
    reader.readAsText(file);
  }

  const actions = {
    "export-json": () => download("wbs-gantt-migracion-aws.json", JSON.stringify(state, null, 2), "application/json"),
    "import-json": () => $("#import-file").click(),
    "export-csv": exportCSV,
    "pdf-simple": () => runExport("pdf", "simple"),
    "pdf-full": () => runExport("pdf", "full"),
    "msp-simple": () => runExport("msp", "simple"),
    "msp-full": () => runExport("msp", "full"),
    "print": () => {
      document.body.classList.add(`print-${ui.view}`);
      window.print();
      document.body.classList.remove(`print-${ui.view}`);
    },
    "reset": async () => {
      if (!(await ask("Se perderán los cambios y se vuelve a la WBS original. ¿Continuar?", { ok: "Restaurar", danger: true }))) return;
      state = fromDefault(); save(); render(); toast("Datos originales restaurados");
    },
  };

  /* ------------------------------------------------------------------ */
  /* Eventos de la interfaz                                              */
  /* ------------------------------------------------------------------ */
  function setView(v) {
    ui.view = v;
    $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === v));
    $$(".view").forEach(s => s.classList.toggle("active", s.id === `view-${v}`));
    try { localStorage.setItem(STORAGE_KEY + ":view", v); } catch (_) { /* ignorar */ }
    render();
  }
  $$(".tab").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));

  $("#menu-btn").addEventListener("click", e => { e.stopPropagation(); $("#menu-list").hidden = !$("#menu-list").hidden; });
  document.addEventListener("click", () => ($("#menu-list").hidden = true));
  $("#menu-list").addEventListener("click", e => {
    const a = e.target.closest("[data-action]");
    if (a) { $("#menu-list").hidden = true; actions[a.dataset.action](); }
  });
  $("#import-file").addEventListener("change", e => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ""; });

  $("#wbs-search").addEventListener("input", e => { ui.search = e.target.value; renderWBS(); });
  $("#wbs-show-dates").addEventListener("change", e => { ui.showDates = e.target.checked; renderWBS(); });
  $("#wbs-expand").addEventListener("click", () => { state.phases.forEach(p => (p.collapsed = false)); save(); render(); });
  $("#wbs-collapse").addEventListener("click", () => { state.phases.forEach(p => (p.collapsed = true)); save(); render(); });
  $("#wbs-add-phase").addEventListener("click", addPhase);

  $("#zoom").addEventListener("click", e => {
    const b = e.target.closest("[data-zoom]");
    if (!b) return;
    ui.zoom = b.dataset.zoom;
    $$("#zoom button").forEach(x => x.classList.toggle("active", x === b));
    renderGantt();
  });
  for (const [id, key] of [["g-critical", "critical"], ["g-deps", "deps"], ["g-milestones", "milestones"], ["g-cascade", "cascade"]]) {
    $("#" + id).addEventListener("change", e => { ui[key] = e.target.checked; render(); });
  }
  $("#start-date").addEventListener("change", e => {
    if (!e.target.value) return;
    state.startDate = e.target.value; save(); render();
    toast(`Inicio del proyecto: ${fmt(0)}`);
  });
  $("#g-add-task").addEventListener("click", () => openTask(null));

  const title = $("#project-name");
  title.addEventListener("dblclick", () => { title.contentEditable = "true"; title.focus(); });
  title.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
  title.addEventListener("blur", () => {
    if (title.contentEditable !== "true") return;
    title.contentEditable = "false";
    const v = title.textContent.trim();
    if (v) { state.name = v; save(); }
    render();
  });

  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }
  $("#theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* ignorar */ }
  });

  window.addEventListener("resize", () => { if (ui.view === "wbs") renderWBS(); });

  /* ------------------------------------------------------------------ */
  /* Inicio                                                              */
  /* ------------------------------------------------------------------ */
  if (window.EMBEDDED_VIEW) $$('[data-action="print"]').forEach(b => b.remove());
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (_) { /* ignorar */ }
  state = load();
  let initialView = "wbs";
  try { initialView = localStorage.getItem(STORAGE_KEY + ":view") || "wbs"; } catch (_) { /* ignorar */ }
  setView(initialView === "gantt" ? "gantt" : "wbs");
})();
