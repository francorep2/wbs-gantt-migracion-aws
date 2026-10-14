/* =====================================================================
 * Exportaciones: PDF (jsPDF, dibujado vectorial con colores) y
 * MS Project (formato XML de Microsoft Project, MSPDI).
 *
 * Cada exportador recibe `api` (estado ya filtrado + utilidades de app.js)
 * y un objeto de opciones armado en el panel "Exportar" (ver app.js),
 * y devuelve { name, blob }.
 * ===================================================================== */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Utilidades de color                                                 */
  /* ------------------------------------------------------------------ */
  const hexToRgb = hex => {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const tint = (rgb, k) => rgb.map(c => Math.round(c + (255 - c) * k)); // k=0 color, k=1 blanco
  const shade = (rgb, k) => rgb.map(c => Math.round(c * (1 - k)));

  const INK = [28, 34, 48];
  const MUTED = [107, 115, 133];
  const LINE = [200, 205, 215];
  const GRID = [232, 235, 241];
  const CRIT = [220, 38, 38];
  const TODAY = [249, 115, 22];

  /* ------------------------------------------------------------------ */
  /* PDF                                                                 */
  /* ------------------------------------------------------------------ */
  async function pdf(api, o) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) throw new Error("no se pudo cargar la librería de PDF");
    const { state } = api;
    const sizes = { a3: [420, 297], a4: [297, 210] };
    const pageSize = sizes[o.pageSize] ? o.pageSize : "a3";
    const [PW, PH] = sizes[pageSize];
    const M = 12;
    const sections = [[o.summary, drawSummaryPage], [o.wbs, drawWBS], [o.gantt, drawGantt], [o.dictionary, drawDictionary]].filter(([sec]) => sec?.on);
    if (!sections.length) throw new Error("no elegiste ninguna sección para el PDF");
    if (!state.tasks.length) throw new Error("no quedó ningún paquete seleccionado");

    const doc = pdfSafe(new jsPDF({ orientation: "landscape", unit: "mm", format: pageSize }));
    const ctx = { doc, api, o, PW, PH, M };
    doc.setProperties({ title: `${state.name} - WBS y cronograma`, subject: "WBS y diagrama de Gantt", creator: "WBS y Gantt · Equipo 04" });
    sections.forEach(([, draw], i) => { if (i) doc.addPage(); draw(ctx); });

    // Pie de página en todas las hojas
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
      doc.text(`${state.name} · Equipo 04 · Dirección de Proyectos`, M, PH - 6);
      doc.text(`Página ${i} de ${pages}`, PW - M, PH - 6, { align: "right" });
    }

    return { name: `${o.fileName || "cronograma-migracion-aws"}.pdf`, blob: doc.output("blob") };
  }

  // Las fuentes estándar de jsPDF solo cubren WinAnsi: flechas y otros símbolos salen como basura ("!”").
  const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  const GLYPHS = { "↔": "<->", "→": "->", "←": "<-", "⇒": "=>", "≈": "~", "≤": "<=", "≥": ">=", "✓": "Sí", "▸": ">", "▾": "v" };
  const toWinAnsi = v => typeof v === "string"
    ? v.replace(/[^\u0000-\u00ff]/g, ch => GLYPHS[ch] ?? (WIN_ANSI_EXTRA.includes(ch) ? ch : "?"))
    : Array.isArray(v) ? v.map(toWinAnsi) : v;
  function pdfSafe(doc) {
    for (const fn of ["text", "splitTextToSize", "getTextWidth"]) {
      const orig = doc[fn].bind(doc);
      doc[fn] = (t, ...rest) => orig(toWinAnsi(t), ...rest);
    }
    return doc;
  }

  function pageHeader(ctx, title, subtitle) {
    const { doc, api, PW, M } = ctx;
    doc.setFillColor(...INK).rect(0, 0, PW, 3, "F");
    doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...INK);
    doc.text(title, M, M + 4);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
    doc.text(subtitle || api.state.name, M, M + 10);
    const today = new Date();
    doc.text(`Generado el ${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`, PW - M, M + 4, { align: "right" });
    doc.setDrawColor(...LINE).setLineWidth(0.3).line(M, M + 13, PW - M, M + 13);
    return M + 18;
  }

  const sortedPhases = api => [...api.state.phases].sort((a, b) => api.codeCmp(a.code, b.code));
  const projectSpan = api => {
    const ts = api.state.tasks;
    return ts.length ? [Math.min(...ts.map(t => t.start)), Math.max(...ts.map(api.endOf))] : [0, 7];
  };
  const weightedProgress = (api, tasks) => {
    const w = tasks.filter(t => !t.loe);
    const tot = w.reduce((s, t) => s + t.duration, 0) || 1;
    return Math.round(w.reduce((s, t) => s + t.duration * (t.progress || 0), 0) / tot);
  };

  /* --- Hoja WBS --- */
  function drawWBS(ctx) {
    const { doc, api, o, PW, PH, M } = ctx;
    const dates = !!o.wbs.dates, markCrit = !!o.wbs.critical;
    const { state } = api;
    let y = pageHeader(ctx, "Estructura de Desglose del Trabajo (WBS)", `${state.name} · ${api.state.tasks.length} paquetes de trabajo en ${state.phases.length} fases`);
    const phases = sortedPhases(api);
    const n = Math.max(phases.length, 1);
    const gap = 3.5;
    const colW = (PW - 2 * M - gap * (n - 1)) / n;
    const pad = 2.2;

    // Medidas de texto
    const small = colW < 34;
    const phaseFs = small ? 6.4 : 8.6, taskFs = small ? 6 : 8, dateFs = small ? 5.2 : 6.4;
    const lh = fs => fs * 0.3528 * 1.18; // alto de línea en mm

    // Raíz
    const [ps, pe] = projectSpan(api);
    doc.setFont("helvetica", "bold").setFontSize(10);
    const rootLines = doc.splitTextToSize(state.name.toUpperCase(), 92);
    const rootH = rootLines.length * lh(10) + (dates ? 8 : 5);
    const rootW = 100, rootX = (PW - rootW) / 2;
    doc.setDrawColor(...INK).setLineWidth(0.6).setFillColor(255, 255, 255);
    doc.roundedRect(rootX, y, rootW, rootH, 2, 2, "FD");
    doc.setTextColor(...INK).text(rootLines, PW / 2, y + 2.5 + lh(10) * 0.8, { align: "center" });
    if (dates) {
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED);
      doc.text(`${api.fmt(ps)} a ${api.fmt(pe - 1)} · ${Math.ceil((pe - ps) / 7)} semanas`, PW / 2, y + rootH - 2.2, { align: "center" });
    }
    const busY = y + rootH + 6;
    doc.setDrawColor(...MUTED).setLineWidth(0.35);
    doc.line(PW / 2, y + rootH, PW / 2, busY);
    const cx = i => M + i * (colW + gap) + colW / 2;
    if (n > 1) doc.line(cx(0), busY, cx(n - 1), busY);

    // Medir alto de las cajas de fase para alinearlas
    doc.setFont("helvetica", "bold").setFontSize(phaseFs);
    const phaseLines = phases.map(p => doc.splitTextToSize(`${p.code}. ${p.name.toUpperCase()}`, colW - 2 * pad));
    const phaseH = Math.max(...phaseLines.map(l => l.length)) * lh(phaseFs) + 2 * pad + (dates ? 3.2 : 0.6);
    const phaseY = busY + 5;

    // Alto de cada tarea; si no entra en la hoja, se achica el espaciado
    const taskW = colW - 5;
    const measure = t => {
      doc.setFont("helvetica", "normal").setFontSize(taskFs);
      const lines = doc.splitTextToSize(`${t.code} ${t.name}`, taskW - 2 * pad - 1);
      return { lines, h: lines.length * lh(taskFs) + 2 * pad + (dates ? lh(dateFs) + 0.6 : 0) };
    };
    const colTasks = phases.map(p => api.tasksOf(p.code).map(t => ({ t, ...measure(t) })));
    const avail = PH - 14 - (phaseY + phaseH + 4);
    // Separación entre cajas: se reparte el alto disponible (entre 1,5 y 9 mm)
    const maxCount = Math.max(1, ...colTasks.map(c => c.length));
    const tallest = Math.max(0, ...colTasks.map(c => c.reduce((s, x) => s + x.h, 0)));
    const vgap = Math.min(9, Math.max(1.5, (avail * 0.92 - tallest) / maxCount));

    phases.forEach((p, i) => {
      const rgb = hexToRgb(p.color);
      const x = M + i * (colW + gap);
      doc.setDrawColor(...MUTED).setLineWidth(0.35).line(cx(i), busY, cx(i), phaseY);
      doc.setDrawColor(...rgb).setLineWidth(0.6).setFillColor(...tint(rgb, 0.85));
      doc.roundedRect(x, phaseY, colW, phaseH, 1.6, 1.6, "FD");
      doc.setFont("helvetica", "bold").setFontSize(phaseFs).setTextColor(...shade(rgb, 0.45));
      doc.text(phaseLines[i], x + colW / 2, phaseY + pad + lh(phaseFs) * 0.8, { align: "center" });
      const tasks = colTasks[i];
      if (dates && tasks.length) {
        const s = Math.min(...tasks.map(o => o.t.start)), e = Math.max(...tasks.map(o => api.endOf(o.t)));
        doc.setFont("helvetica", "normal").setFontSize(5.8).setTextColor(...MUTED);
        doc.text(`Sem ${api.weekOf(s)}-${api.weekOf(e - 1)} · ${tasks.length} paquetes`, x + colW / 2, phaseY + phaseH - 1.4, { align: "center" });
      }

      // Hijos
      const stemX = x + 2;
      let ty = phaseY + phaseH + 4;
      let lastMid = ty;
      for (const o of tasks) {
        const tx = x + 5;
        const inf = api.analysis.info.get(o.t.code) || {};
        doc.setFillColor(255, 255, 255).setDrawColor(...(markCrit && inf.critical ? CRIT : LINE)).setLineWidth(markCrit && inf.critical ? 0.45 : 0.3);
        doc.roundedRect(tx, ty, taskW, o.h, 1.2, 1.2, "FD");
        doc.setFillColor(...rgb).rect(tx, ty + 0.3, 1.1, o.h - 0.6, "F");
        doc.setFont("helvetica", "normal").setFontSize(taskFs).setTextColor(...INK);
        doc.text(o.lines, tx + pad + 1, ty + pad + lh(taskFs) * 0.8);
        if (dates) {
          doc.setFontSize(dateFs).setTextColor(...MUTED);
          doc.text(`${api.fmt(o.t.start)} a ${api.fmt(api.lastDay(o.t))} · ${o.t.duration} d`, tx + pad + 1, ty + o.h - pad + 0.3);
        }
        const mid = ty + o.h / 2;
        doc.setDrawColor(...MUTED).setLineWidth(0.35).line(stemX, mid, tx, mid);
        lastMid = mid;
        ty += o.h + vgap;
      }
      if (tasks.length) doc.setDrawColor(...MUTED).setLineWidth(0.35).line(stemX, phaseY + phaseH, stemX, lastMid);
    });

    if (markCrit) {
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED);
      doc.setDrawColor(...CRIT).setLineWidth(0.45).rect(M, PH - 16, 6, 3.5);
      doc.text("Paquete en la ruta crítica", M + 8, PH - 13.4);
    }
  }

  /* --- Hoja(s) Gantt --- */
  function drawGantt(ctx) {
    const { doc, api, o, PW, PH, M } = ctx;
    const g = o.gantt;
    const { state } = api;
    const phases = sortedPhases(api);
    const [ps, pe] = projectSpan(api);
    const msMax = state.milestones.length ? Math.max(...state.milestones.map(m => m.day)) : 0;
    const from = Math.floor(ps / 7) * 7;
    const to = Math.ceil(Math.max(pe, msMax) / 7) * 7;

    // Columnas de la tabla izquierda
    const cols = [["Cód.", 11, "l", "code"], ["Paquete de trabajo", 0, "l", "name"]];
    if (g.colDates) cols.push(["Inicio", 15, "l", "start"], ["Fin", 15, "l", "end"]);
    if (g.colDays) cols.push(["Días", 9, "r", "days"]);
    if (g.colProgress) cols.push(["%", 8, "r", "pct"]);
    cols[1][1] = PW > 400 ? (cols.length > 4 ? 62 : 70) : (cols.length > 4 ? 44 : 52);
    const cellVals = d => cols.map(c => d[c[3]]);
    const leftW = cols.reduce((s, c) => s + c[1], 0);
    const tx0 = M + leftW + 2, tw = PW - M - tx0;
    const px = tw / (to - from);
    const X = d => tx0 + (d - from) * px;

    // Filas
    const rows = [];
    for (const p of phases) {
      rows.push({ kind: "phase", p });
      for (const t of api.tasksOf(p.code)) rows.push({ kind: "task", p, t });
    }
    if (g.milestones && state.milestones.length) {
      rows.push({ kind: "mshead" });
      for (const m of state.milestones) rows.push({ kind: "ms", m });
    }

    const headH = 10;
    let top = 0;
    const bottom = PH - 22;
    const startPage = () => {
      top = pageHeader(ctx, "Diagrama de Gantt", `${state.name} · ${api.fmt(ps)} a ${api.fmt(pe - 1)} · ${Math.ceil((pe - ps) / 7)} semanas`);
      return top + headH;
    };
    let y0 = startPage();
    const MIN_ROW = 3.2;
    const fitRows = Math.floor((bottom - y0) / MIN_ROW);
    const rowH = Math.min(5.2, Math.max(MIN_ROW, (bottom - y0) / Math.min(rows.length, fitRows)));
    const fs = rowH >= 4.6 ? 7 : rowH >= 3.8 ? 6.2 : 5.6;
    const perPage = Math.floor((bottom - y0) / rowH + 1e-6);

    const rowY = new Map(); // código -> {page, y}
    const pagesRows = [];
    for (let i = 0; i < rows.length; i += perPage) pagesRows.push(rows.slice(i, i + perPage));

    pagesRows.forEach((pageRows, pi) => {
      if (pi > 0) { doc.addPage(); y0 = startPage(); }
      const yEnd = y0 + pageRows.length * rowH;

      // Cabecera de escala: meses + semanas
      doc.setFillColor(246, 247, 251).rect(M, top, PW - 2 * M, headH, "F");
      doc.setFont("helvetica", "bold").setFontSize(6.8).setTextColor(...MUTED);
      let cx = M + 1;
      for (const [label, w, al] of cols) {
        doc.text(label, al === "r" ? cx + w - 2 : cx, top + headH - 2.2, { align: al === "r" ? "right" : "left" });
        cx += w;
      }
      let d = from;
      doc.setFontSize(6.8).setTextColor(...INK);
      while (d < to) {
        const dt = api.dayToDate(d);
        const next = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1);
        const nd = Math.min(to, d + Math.round((next - dt.getTime()) / 86400000));
        doc.setDrawColor(...LINE).setLineWidth(0.25).line(X(d), top, X(d), top + headH / 2);
        const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
        if ((nd - d) * px > 10) doc.text(`${meses[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`, X(d) + 1, top + 3.6);
        d = nd;
      }
      doc.setFont("helvetica", "normal").setFontSize(5.6).setTextColor(...MUTED);
      for (let w = from; w < to; w += 7) {
        doc.text(`S${api.weekOf(w)}`, X(w) + (7 * px) / 2, top + headH - 1.6, { align: "center" });
      }

      // Feriados (calendario laboral) y grilla vertical semanal
      for (let d = from; d < to; d++) if (api.holidayName?.(d)) doc.setFillColor(...tint(TODAY, 0.82)).rect(X(d), top + headH, Math.max(px, 0.6), yEnd - top - headH, "F");
      for (let w = from; w <= to; w += 7) {
        doc.setDrawColor(...GRID).setLineWidth(0.2).line(X(w), top + headH / 2, X(w), yEnd);
      }
      doc.setDrawColor(...LINE).setLineWidth(0.3).line(M, top + headH, PW - M, top + headH);
      doc.line(tx0 - 1, top, tx0 - 1, yEnd);

      // Líneas de hitos y de hoy
      if (g.milestones) for (const m of state.milestones) {
        doc.setDrawColor(150, 155, 170).setLineWidth(0.25).setLineDashPattern([1, 1], 0).line(X(m.day), top + headH, X(m.day), yEnd);
      }
      doc.setLineDashPattern([], 0);
      if (g.today) {
        const today = Math.floor((Date.now() - api.dayToDate(0).getTime()) / 86400000);
        if (today >= from && today <= to) doc.setDrawColor(...TODAY).setLineWidth(0.5).line(X(today), top + headH, X(today), yEnd);
      }

      pageRows.forEach((r, i) => {
        const y = y0 + i * rowH;
        const mid = y + rowH / 2;
        const textY = mid + fs * 0.3528 * 0.35;
        if (r.kind === "phase") {
          const rgb = hexToRgb(r.p.color);
          doc.setFillColor(...tint(rgb, 0.88)).rect(M, y, PW - 2 * M, rowH, "F");
          const ts = api.tasksOf(r.p.code);
          const s = ts.length ? Math.min(...ts.map(t => t.start)) : null;
          const e = ts.length ? Math.max(...ts.map(api.endOf)) : null;
          const vals = cellVals({ code: r.p.code, name: r.p.name, start: s != null ? api.fmt(s) : "", end: e != null ? api.fmt(e - 1) : "", days: s != null ? e - s : "", pct: ts.length ? weightedProgress(api, ts) : "" });
          drawCells(doc, cols, vals, M + 1, textY, fs, true, shade(rgb, 0.5));
          if (s != null) {
            const bh = rowH * 0.32;
            doc.setFillColor(...rgb).rect(X(s), mid - bh / 2, (e - s) * px, bh, "F");
            doc.triangle(X(s), mid + bh / 2, X(s) + 1.6, mid + bh / 2, X(s), mid + bh / 2 + 1.3, "F");
            doc.triangle(X(e), mid + bh / 2, X(e) - 1.6, mid + bh / 2, X(e), mid + bh / 2 + 1.3, "F");
          }
        } else if (r.kind === "task") {
          const t = r.t, rgb = hexToRgb(r.p.color);
          const inf = api.analysis.info.get(t.code) || {};
          rowY.set(t.code, { page: doc.getNumberOfPages(), y: mid });
          const vals = cellVals({ code: t.code, name: t.name, start: api.fmt(t.start), end: api.fmt(api.lastDay(t)), days: t.duration, pct: t.progress || 0 });
          drawCells(doc, cols, vals, M + 1, textY, fs, false, INK, 3);
          doc.setDrawColor(...GRID).setLineWidth(0.15).line(M, y + rowH, tx0 - 1, y + rowH);
          const bh = rowH * 0.62, bx = X(t.start), bw = Math.max(t.duration * px, 0.8);
          if (t.buffer) {
            doc.setFillColor(...tint(MUTED, 0.8)).rect(bx, mid - bh / 2, bw, bh, "F");
            doc.setDrawColor(...MUTED).setLineWidth(0.25).setLineDashPattern([0.8, 0.6], 0).rect(bx, mid - bh / 2, bw, bh, "S").setLineDashPattern([], 0);
          } else if (t.loe) {
            doc.setFillColor(...tint(rgb, 0.75)).rect(bx, mid - bh / 2, bw, bh, "F");
            doc.setDrawColor(...tint(rgb, 0.3)).setLineWidth(0.2);
            for (let hx = bx; hx < bx + bw; hx += 2.2) doc.line(hx, mid + bh / 2, Math.min(hx + bh, bx + bw), mid - bh / 2);
          } else {
            doc.setFillColor(...tint(rgb, 0.6)).rect(bx, mid - bh / 2, bw, bh, "F");
            if (t.progress) doc.setFillColor(...rgb).rect(bx, mid - bh / 2, bw * t.progress / 100, bh, "F");
          }
          const critical = g.critical && inf.critical;
          if (!t.buffer) doc.setDrawColor(...(critical ? CRIT : rgb)).setLineWidth(critical ? 0.5 : 0.25).rect(bx, mid - bh / 2, bw, bh, "S");
          if (g.labels) {
            doc.setFont("helvetica", "normal").setFontSize(fs - 1).setTextColor(...MUTED);
            const label = t.name;
            const lx = bx + bw + 1.2;
            const lw = doc.getTextWidth(label);
            if (lx + lw < PW - M) doc.text(label, lx, textY);
            else if (bx - 1.2 - lw > tx0) doc.text(label, bx - 1.2, textY, { align: "right" });
            else {
              doc.setFillColor(255, 255, 255).rect(bx + 1, mid - bh / 2 + 0.3, lw + 1.6, bh - 0.6, "F");
              doc.setTextColor(...INK).text(label, bx + 1.8, textY);
            }
          }
        } else if (r.kind === "mshead") {
          doc.setFillColor(246, 247, 251).rect(M, y, PW - 2 * M, rowH, "F");
          drawCells(doc, cols, ["", "Hitos del Project Charter"], M + 1, textY, fs, true, INK);
          for (const m of state.milestones) diamond(doc, X(m.day), mid, rowH * 0.32);
        } else if (r.kind === "ms") {
          const vals = cellVals({ code: r.m.id, name: r.m.name, start: "", end: api.fmt(r.m.day - 1), days: "0", pct: "" });
          drawCells(doc, cols, vals, M + 1, textY, fs, false, INK, 3);
          diamond(doc, X(r.m.day), mid, rowH * 0.3);
          doc.setFont("helvetica", "normal").setFontSize(fs - 1).setTextColor(...MUTED);
          const mlabel = `${r.m.name} · semana ${api.weekOf(r.m.day - 1)}`;
          if (X(r.m.day) + 2.4 + doc.getTextWidth(mlabel) < PW - M) doc.text(mlabel, X(r.m.day) + 2.4, textY);
          else doc.text(mlabel, X(r.m.day) - 2.4, textY, { align: "right" });
        }
      });

      // Dependencias (dentro de la misma hoja)
      if (g.deps) {
        const page = doc.getNumberOfPages();
        for (const r of pageRows) {
          if (r.kind !== "task") continue;
          const t = r.t;
          const to_ = rowY.get(t.code);
          for (const dc of t.deps) {
            const from_ = rowY.get(dc);
            const p = api.state.tasks.find(x => x.code === dc);
            if (!from_ || !p || from_.page !== page) continue;
            const x1 = X(api.endOf(p)), x2 = X(t.start);
            const crit = api.analysis.info.get(t.code)?.critical && api.analysis.info.get(dc)?.critical && api.endOf(p) === t.start;
            const bad = api.endOf(p) > t.start;
            doc.setDrawColor(...(bad ? CRIT : crit ? CRIT : [150, 155, 170])).setLineWidth(crit ? 0.3 : 0.18);
            if (bad) doc.setLineDashPattern([0.8, 0.6], 0);
            const xm = Math.max(x1 + 0.8, Math.min(x2 - 0.8, x1 + 0.8));
            doc.line(x1, from_.y, xm, from_.y);
            doc.line(xm, from_.y, xm, to_.y);
            doc.line(xm, to_.y, x2, to_.y);
            doc.setLineDashPattern([], 0);
            doc.setFillColor(...(bad || crit ? CRIT : [150, 155, 170]));
            doc.triangle(x2, to_.y, x2 - 1, to_.y - 0.6, x2 - 1, to_.y + 0.6, "F");
          }
        }
      }

      // Leyenda: todas las fases y los símbolos, en filas que se cortan solas (hasta 3 filas)
      if (!g.legend) return;
      const legend = phases.map(p => { const rgb = hexToRgb(p.color); return [(x, yy) => doc.setFillColor(...rgb).rect(x, yy, 6, 3, "F"), `${p.code}. ${p.name}`]; });
      if (g.milestones) legend.push([(x, yy) => diamond(doc, x + 3, yy + 1.5, 1.6), "Hito"]);
      if (state.tasks.some(t => t.buffer)) legend.push([(x, yy) => doc.setFillColor(...tint(MUTED, 0.8)).rect(x, yy, 6, 3, "F"), "Reserva de contingencia"]);
      { let hasHoliday = false; for (let d = from; d < to && !hasHoliday; d++) hasHoliday = !!api.holidayName?.(d);
        if (hasHoliday) legend.push([(x, yy) => doc.setFillColor(...tint(TODAY, 0.7)).rect(x + 2, yy - 0.5, 2, 4, "F"), "Feriado"]); }
      if (state.tasks.some(t => t.loe)) legend.push([(x, yy) => doc.setFillColor(200, 200, 210).rect(x, yy + 0.5, 6, 2, "F"), "Nivel de esfuerzo (rayado)"]);
      if (g.critical) legend.push([(x, yy) => doc.setDrawColor(...CRIT).setLineWidth(0.5).rect(x, yy, 6, 3, "S"), "Ruta crítica"]);
      if (g.today) legend.push([(x, yy) => doc.setDrawColor(...TODAY).setLineWidth(0.6).line(x + 3, yy - 0.5, x + 3, yy + 3.5), "Hoy"]);
      if (g.deps) legend.push([(x, yy) => doc.setDrawColor(150, 155, 170).setLineWidth(0.25).line(x, yy + 1.5, x + 6, yy + 1.5), "Dependencia fin-comienzo"]);
      const layout = fs => {
        doc.setFont("helvetica", "normal").setFontSize(fs);
        let x = M, row = 0;
        const pos = legend.map(([, text]) => {
          const w = 11 + doc.getTextWidth(text);
          if (x > M && x + w > PW - M) { x = M; row++; }
          const at = [x, row]; x += w; return at;
        });
        return { pos, rows: row + 1 };
      };
      let fsL = 6.8, lay = layout(fsL);
      while (lay.rows > 3 && fsL > 5) lay = layout(fsL -= 0.6);
      const legH = 4.4, ly = PH - 9 - lay.rows * legH;
      legend.forEach(([draw, text], i) => {
        const [x, row] = lay.pos[i], yy = ly + row * legH;
        draw(x, yy);
        doc.setTextColor(...MUTED).text(text, x + 8, yy + 2.4);
      });
    });
  }

  function diamond(doc, x, y, r) {
    doc.setFillColor(...INK);
    doc.triangle(x - r, y, x, y - r, x + r, y, "F");
    doc.triangle(x - r, y, x, y + r, x + r, y, "F");
  }

  function drawCells(doc, cols, vals, x, y, fs, bold, color, indentName = 0) {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(fs).setTextColor(...color);
    let cx = x;
    cols.forEach(([, w, al], i) => {
      let v = vals[i] == null ? "" : String(vals[i]);
      const ind = i === 1 ? indentName : 0;
      const maxW = w - 2 - ind;
      if (doc.getTextWidth(v) > maxW) {
        while (v.length > 1 && doc.getTextWidth(v + "...") > maxW) v = v.slice(0, -1);
        v += "...";
      }
      if (al === "r") doc.text(v, cx + w - 2, y, { align: "right" });
      else doc.text(v, cx + ind, y);
      cx += w;
    });
  }

  /* --- Portada / resumen (informe detallado) --- */
  function drawSummaryPage(ctx) {
    const { doc, api, o, PW, M } = ctx;
    const { state } = api;
    const sm = o.summary;
    let y = pageHeader(ctx, "Resumen del proyecto", state.name);
    const [ps, pe] = projectSpan(api);
    const infos = [...api.analysis.info.values()];

    // Indicadores
    const kpis = [
      [`${Math.ceil((pe - ps) / 7)} semanas`, `${pe - ps} días corridos`],
      [api.fmt(ps), "Inicio"],
      [api.fmt(pe - 1), "Fin estimado"],
      [String(state.tasks.length), `paquetes en ${state.phases.length} fases`],
      [`${weightedProgress(api, state.tasks)}%`, "Avance ponderado"],
      [String(infos.filter(i => i.critical).length), "paquetes críticos"],
    ];
    const kw = (PW - 2 * M - 5 * 4) / 6;
    if (sm.kpis) kpis.forEach(([v, l], i) => {
      const x = M + i * (kw + 4);
      doc.setDrawColor(...LINE).setLineWidth(0.3).setFillColor(250, 251, 253).roundedRect(x, y, kw, 18, 1.5, 1.5, "FD");
      doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(...INK).text(v, x + 4, y + 9);
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED).text(l, x + 4, y + 14.5);
    });
    if (sm.kpis) y += 26;

    // Tabla de fases
    const both = sm.phases && sm.milestones;
    const colW = both ? (PW - 2 * M - 10) / 2 : Math.min(PW - 2 * M, 200);
    let ty = y;
    const phCols = [["", 5, "l"], ["Fase", colW - 99, "l"], ["Inicio", 20, "l"], ["Fin", 20, "l"], ["Semanas", 18, "r"], ["Paquetes", 18, "r"], ["Avance", 18, "r"]];
    if (sm.phases) {
      doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text("Fases", M, y);
      ty = tableHeader(doc, phCols, M, y + 4, colW);
    }
    if (sm.phases) for (const p of sortedPhases(api)) {
      const ts = api.tasksOf(p.code);
      const s = ts.length ? Math.min(...ts.map(t => t.start)) : null;
      const e = ts.length ? Math.max(...ts.map(api.endOf)) : null;
      doc.setFillColor(...hexToRgb(p.color)).rect(M + 1, ty + 1.3, 3, 3, "F");
      drawCells(doc, phCols, ["", `${p.code}. ${p.name}`, s != null ? api.fmt(s) : "-", e != null ? api.fmt(e - 1) : "-",
        s != null ? `${api.weekOf(s)}-${api.weekOf(e - 1)}` : "-", ts.length, ts.length ? `${weightedProgress(api, ts)}%` : "-"], M + 1, ty + 4, 8, false, INK);
      doc.setDrawColor(...GRID).setLineWidth(0.2).line(M, ty + 6, M + colW, ty + 6);
      ty += 6;
    }

    // Hitos
    const x2 = both ? M + colW + 10 : M;
    let my = y;
    const msCols = [["", 6, "l"], ["Hito", colW - 52, "l"], ["Semana", 20, "r"], ["Fecha", 26, "r"]];
    if (sm.milestones) {
      if (!both) my = ty + (sm.phases ? 10 : 0);
      doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text("Hitos del Project Charter", x2, my);
      my = tableHeader(doc, msCols, x2, my + 4, colW);
    }
    if (sm.milestones) for (const m of state.milestones) {
      diamond(doc, x2 + 3, my + 3, 1.4);
      drawCells(doc, msCols, ["", `${m.id} · ${m.name}`, api.weekOf(m.day - 1), api.fmt(m.day - 1)], x2 + 1, my + 4, 8, false, INK);
      doc.setDrawColor(...GRID).setLineWidth(0.2).line(x2, my + 6, x2 + colW, my + 6);
      my += 6;
    }

    // Ruta crítica
    y = Math.max(ty, my) + (sm.phases || sm.milestones ? 10 : 0);
    if (sm.critical) {
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text("Ruta crítica", M, y);
    const crit = [...state.tasks].filter(t => api.analysis.info.get(t.code)?.critical).sort((a, b) => a.start - b.start || api.codeCmp(a.code, b.code));
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...INK);
    const critText = crit.length ? crit.map(t => `${t.code} ${t.name}`).join("  >  ") : "No hay paquetes con holgura cero.";
    const critLines = doc.splitTextToSize(critText, PW - 2 * M);
    doc.text(critLines, M, y + 6);
    y += 6 + critLines.length * 4.2 + 6;
    }

    // Supuestos
    if (!sm.assumptions) return;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text("Supuestos del cronograma", M, y);
    const notes = [
      `Inicio del proyecto: ${api.fmt(0)}. Las duraciones están en días corridos (semanas de 7 días).`,
      "Las fases de la WBS se alinearon con las 8 fases y los hitos de 26 semanas del Anexo I y del Project Charter.",
      "Las dependencias son de tipo fin-comienzo y fueron propuestas a partir de la lógica técnica de la migración.",
      "La ruta crítica se calcula con las fechas planificadas: un paquete es crítico si su holgura total es cero.",
      "Los paquetes de Dirección de Proyectos (9.x) son de nivel de esfuerzo: duran todo el proyecto y no entran en la ruta crítica.",
    ];
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...INK);
    notes.forEach((n, i) => doc.text(`•  ${n}`, M, y + 6 + i * 5));
  }

  function tableHeader(doc, cols, x, y, w) {
    doc.setFillColor(241, 243, 248).rect(x, y, w, 6, "F");
    drawCells(doc, cols, cols.map(c => c[0]), x + 1, y + 4, 7.5, true, MUTED);
    return y + 6;
  }

  /* --- Diccionario de la WBS --- */
  function drawDictionary(ctx) {
    const { doc, api, o, PW, PH, M } = ctx;
    const dc = o.dictionary;
    const W = PW - 2 * M;
    const cols = [["Cód.", 12, "l", "code"], ["Paquete de trabajo", 70, "l", "name"]];
    if (dc.dates) cols.push(["Inicio", 17, "l", "start"], ["Fin", 17, "l", "end"]);
    if (dc.days) cols.push(["Días", 10, "r", "days"]);
    if (dc.workdays) cols.push(["Hábiles", 13, "r", "wd"]);
    if (dc.weeks) cols.push(["Semanas", 16, "r", "weeks"]);
    if (dc.deps) cols.push(["Predecesoras", 34, "l", "deps"]);
    if (dc.slack) cols.push(["Holgura", 14, "r", "slack"]);
    if (dc.critical) cols.push(["Crítica", 13, "l", "crit"]);
    if (dc.progress) cols.push(["Avance", 13, "r", "pct"]);
    if (dc.owner) cols.push(["Responsable", 34, "l", "owner"]);
    const used = cols.reduce((s, c) => s + c[1], 0);
    const notesW = dc.notes ? Math.max(30, W - used) : 0;
    const overflow = used + notesW - W;
    if (overflow > 0) cols[1][1] = Math.max(36, cols[1][1] - overflow);
    else if (!dc.notes) cols[1][1] += -overflow;
    const allCols = dc.notes ? [...cols, ["Notas", notesW, "l", "notes"]] : cols;
    const start = () => tableHeader(doc, allCols, M, pageHeader(ctx, "Diccionario de la WBS", "Detalle de cada paquete de trabajo"), W);
    let y = start();
    const fs = 7.5;
    const critX = M + 1 + cols.slice(0, cols.findIndex(c => c[3] === "crit")).reduce((s, c) => s + c[1], 0);
    const notesX = M + 1 + cols.reduce((s, c) => s + c[1], 0);
    for (const p of sortedPhases(api)) {
      const rgb = hexToRgb(p.color);
      if (y + 12 > PH - 16) { doc.addPage(); y = start(); }
      doc.setFillColor(...tint(rgb, 0.85)).rect(M, y, W, 6, "F");
      doc.setFillColor(...rgb).rect(M, y, 1.2, 6, "F");
      doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...shade(rgb, 0.5)).text(`${p.code}. ${p.name}`, M + 3, y + 4.1);
      y += 6;
      for (const t of api.tasksOf(p.code)) {
        const inf = api.analysis.info.get(t.code) || {};
        doc.setFont("helvetica", "normal").setFontSize(fs);
        const notes = dc.notes ? doc.splitTextToSize(t.notes || "", notesW - 2) : [];
        const h = Math.max(5.6, notes.length * 3.2 + 2.4);
        if (y + h > PH - 16) { doc.addPage(); y = start(); }
        const v = { code: t.code, name: t.name, start: api.fmt(t.start), end: api.fmt(api.lastDay(t)), days: t.duration, wd: api.workDaysOf ? api.workDaysOf(t) : "",
          weeks: `${api.weekOf(t.start)}-${api.weekOf(api.lastDay(t))}`, deps: t.deps.join(", ") || "-", slack: t.loe ? "n/a" : inf.slack,
          crit: t.loe ? "NE" : inf.critical ? "" : "No", pct: `${t.progress || 0}%`, owner: t.owner || "-" };
        drawCells(doc, cols, cols.map(c => v[c[3]]), M + 1, y + 3.9, fs, false, INK);
        if (dc.critical && inf.critical) doc.setFont("helvetica", "bold").setTextColor(...CRIT).text("Sí", critX, y + 3.9);
        if (notes.length) doc.setFont("helvetica", "normal").setTextColor(...INK).text(notes, notesX, y + 3.9);
        doc.setDrawColor(...GRID).setLineWidth(0.2).line(M, y + h, M + W, y + h);
        y += h;
      }
    }
    if (dc.critical || dc.slack) {
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED);
      doc.text("NE: nivel de esfuerzo (no participa de la ruta crítica). Holgura en días.", M, Math.min(y + 6, PH - 12));
    }
  }

  /* ------------------------------------------------------------------ */
  /* MS Project (MSPDI XML)                                              */
  /* ------------------------------------------------------------------ */
  function msproject(api, m) {
    if (!api.state.tasks.length) throw new Error("no quedó ningún paquete seleccionado");
    const { state } = api;
    const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const dt = (day, time) => `${api.isoDay(day)}T${time}`;
    const dur = days => `PT${days * 8}H0M0S`;
    const [ps, pe] = projectSpan(api);

    const tasks = [];
    let uid = 1, id = 1;
    const uidByCode = new Map();
    const phases = sortedPhases(api);

    // Tarea resumen del proyecto (UID 0)
    tasks.push(`<Task><UID>0</UID><ID>0</ID><Name>${esc(state.name)}</Name><Type>1</Type><IsNull>0</IsNull><WBS>0</WBS><OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel><Start>${dt(ps, "08:00:00")}</Start><Finish>${dt(pe - 1, "17:00:00")}</Finish><Summary>1</Summary></Task>`);

    // Primero se asignan UIDs para poder resolver predecesoras
    for (const p of phases) {
      uidByCode.set("F" + p.code, uid++);
      for (const t of api.tasksOf(p.code)) uidByCode.set(t.code, uid++);
    }
    const msUid = uid++;
    state.milestones.forEach((_, i) => uidByCode.set("H" + i, uid++));

    const owners = m.resources ? [...new Set(state.tasks.map(t => (t.owner || "").trim()).filter(Boolean))] : [];
    const resUid = new Map(owners.map((o, i) => [o, i + 1]));
    const assignments = [];

    for (const p of phases) {
      const ts = api.tasksOf(p.code);
      const s = ts.length ? Math.min(...ts.map(t => t.start)) : 0;
      const e = ts.length ? Math.max(...ts.map(api.endOf)) : 1;
      tasks.push(`<Task><UID>${uidByCode.get("F" + p.code)}</UID><ID>${id++}</ID><Name>${esc(p.name)}</Name><Type>1</Type><IsNull>0</IsNull>` +
        `<WBS>${esc(p.code)}</WBS><OutlineNumber>${esc(p.code)}</OutlineNumber><OutlineLevel>1</OutlineLevel>` +
        `<Start>${dt(s, "08:00:00")}</Start><Finish>${dt(e - 1, "17:00:00")}</Finish><Duration>${dur(e - s)}</Duration><DurationFormat>7</DurationFormat>` +
        `<Summary>1</Summary><Milestone>0</Milestone>` +
        (m.progress ? `<PercentComplete>${weightedProgress(api, ts)}</PercentComplete>` : "") +
        (m.fields ? `<ExtendedAttribute><FieldID>188743731</FieldID><Value>${esc(p.name)}</Value></ExtendedAttribute>` : "") +
        `</Task>`);
      ts.forEach((t, i) => {
        const inf = api.analysis.info.get(t.code) || {};
        const preds = m.deps ? t.deps.filter(d => uidByCode.has(d)).map(d => `<PredecessorLink><PredecessorUID>${uidByCode.get(d)}</PredecessorUID><Type>1</Type><CrossProject>0</CrossProject><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join("") : "";
        const notes = m.notes ? [t.notes, t.loe ? "Nivel de esfuerzo" : `Holgura total: ${inf.slack} días${inf.critical ? " (crítica)" : ""}`].filter(Boolean).join(" | ") : "";
        tasks.push(`<Task><UID>${uidByCode.get(t.code)}</UID><ID>${id++}</ID><Name>${esc(t.name)}</Name><Type>0</Type><IsNull>0</IsNull>` +
          `<WBS>${esc(t.code)}</WBS><OutlineNumber>${esc(p.code)}.${i + 1}</OutlineNumber><OutlineLevel>2</OutlineLevel>` +
          `<Start>${dt(t.start, "08:00:00")}</Start><Finish>${dt(api.lastDay(t), "17:00:00")}</Finish>` +
          `<Duration>${dur(t.duration)}</Duration><DurationFormat>7</DurationFormat><Summary>0</Summary><Milestone>0</Milestone>` +
          `<ConstraintType>4</ConstraintType><ConstraintDate>${dt(t.start, "08:00:00")}</ConstraintDate>` +
          (m.progress ? `<PercentComplete>${t.progress || 0}</PercentComplete>` : "") +
          (notes ? `<Notes>${esc(notes)}</Notes>` : "") +
          (m.fields ? `<ExtendedAttribute><FieldID>188743731</FieldID><Value>${esc(p.name)}</Value></ExtendedAttribute>` : "") +
          (m.fields ? `<ExtendedAttribute><FieldID>188743734</FieldID><Value>${inf.critical ? "Sí" : "No"}</Value></ExtendedAttribute>` : "") +
          preds + `</Task>`);
        if (m.resources && t.owner && resUid.has(t.owner.trim())) {
          assignments.push(`<Assignment><UID>${assignments.length + 1}</UID><TaskUID>${uidByCode.get(t.code)}</TaskUID><ResourceUID>${resUid.get(t.owner.trim())}</ResourceUID><Units>1</Units></Assignment>`);
        }
      });
    }

    if (m.milestones && state.milestones.length) {
      const ms = state.milestones;
      const s = Math.min(...ms.map(m => m.day - 1)), e = Math.max(...ms.map(m => m.day - 1));
      const code = String(phases.length + 1);
      tasks.push(`<Task><UID>${msUid}</UID><ID>${id++}</ID><Name>Hitos del Project Charter</Name><Type>1</Type><IsNull>0</IsNull><WBS>${code}</WBS><OutlineNumber>${code}</OutlineNumber><OutlineLevel>1</OutlineLevel>` +
        `<Start>${dt(s, "17:00:00")}</Start><Finish>${dt(e, "17:00:00")}</Finish><Summary>1</Summary></Task>`);
      ms.forEach((mi, i) => {
        tasks.push(`<Task><UID>${uidByCode.get("H" + i)}</UID><ID>${id++}</ID><Name>${esc(`${mi.id} · ${mi.name}`)}</Name><Type>1</Type><IsNull>0</IsNull>` +
          `<WBS>${code}.${i + 1}</WBS><OutlineNumber>${code}.${i + 1}</OutlineNumber><OutlineLevel>2</OutlineLevel>` +
          `<Start>${dt(mi.day - 1, "17:00:00")}</Start><Finish>${dt(mi.day - 1, "17:00:00")}</Finish><Duration>PT0H0M0S</Duration><DurationFormat>7</DurationFormat>` +
          `<Milestone>1</Milestone><Summary>0</Summary><ConstraintType>2</ConstraintType><ConstraintDate>${dt(mi.day - 1, "17:00:00")}</ConstraintDate></Task>`);
      });
    }

    const weekDays = [1, 2, 3, 4, 5, 6, 7].map(d => `<WeekDay><DayType>${d}</DayType><DayWorking>1</DayWorking><WorkingTimes>` +
      `<WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime>` +
      `</WorkingTimes></WeekDay>`).join("");

    const resources = m.resources ? owners.map((o, i) => `<Resource><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${esc(o)}</Name><Type>1</Type><IsNull>0</IsNull></Resource>`).join("") : "";

    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
<SaveVersion>14</SaveVersion>
<Name>${esc(state.name)}.xml</Name>
<Title>${esc(state.name)}</Title>
<Company>Equipo 04 · Dirección de Proyectos</Company>
<ScheduleFromStart>1</ScheduleFromStart>
<StartDate>${dt(ps, "08:00:00")}</StartDate>
<FinishDate>${dt(pe - 1, "17:00:00")}</FinishDate>
<CalendarUID>1</CalendarUID>
<DefaultStartTime>08:00:00</DefaultStartTime>
<DefaultFinishTime>17:00:00</DefaultFinishTime>
<MinutesPerDay>480</MinutesPerDay>
<MinutesPerWeek>3360</MinutesPerWeek>
<DaysPerMonth>30</DaysPerMonth>
<DurationFormat>7</DurationFormat>
<WeekStartDay>1</WeekStartDay>
<NewTasksAreManual>0</NewTasksAreManual>
<ExtendedAttributes>
${m.fields ? "<ExtendedAttribute><FieldID>188743731</FieldID><FieldName>Text1</FieldName><Alias>Fase</Alias></ExtendedAttribute>" : ""}
${m.fields ? "<ExtendedAttribute><FieldID>188743734</FieldID><FieldName>Text2</FieldName><Alias>Ruta crítica</Alias></ExtendedAttribute>" : ""}
</ExtendedAttributes>
<Calendars><Calendar><UID>1</UID><Name>Proyecto (7 días)</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>${weekDays}</WeekDays></Calendar></Calendars>
<Tasks>
${tasks.join("\n")}
</Tasks>
<Resources>${resources}</Resources>
<Assignments>${assignments.join("")}</Assignments>
</Project>
`;
    const base = m.fileName || "ms-project-migracion-aws";
    // En claude.ai no se pueden descargar .xml: se entrega dentro de un .zip
    if (window.EMBEDDED_VIEW) return { name: `${base}.zip`, blob: zipStore([{ name: `${base}.xml`, data: new TextEncoder().encode(xml) }]) };
    return { name: `${base}.xml`, blob: new Blob([xml], { type: "application/xml" }) };
  }

  /* ------------------------------------------------------------------ */
  /* draw.io / diagrams.net (.drawio, XML de mxGraph sin comprimir)      */
  /* ------------------------------------------------------------------ */
  function drawio(api, o) {
    const { state } = api;
    if (!state.tasks.length) throw new Error("no quedó ningún paquete seleccionado");
    if (!o.wbs && !o.gantt) throw new Error("no elegiste ninguna hoja para draw.io");
    const attr = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
    const html = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const hex = rgb => "#" + rgb.map(c => c.toString(16).padStart(2, "0")).join("");
    const crit = code => !!api.analysis.info.get(code)?.critical;
    const phases = sortedPhases(api);
    const [ps, pe] = projectSpan(api);

    // Arma una hoja: cada celda es [id, value(html), style, geom|null, extra]
    const page = (id, name, cells) => {
      const body = cells.map(c => c.edge
        ? `<mxCell id="${c.id}" style="${c.style}" edge="1" parent="1" source="${c.source}" target="${c.target}"><mxGeometry relative="1" as="geometry"/></mxCell>`
        : `<mxCell id="${c.id}" value="${attr(c.value)}" style="${c.style}" vertex="1" parent="1"><mxGeometry x="${Math.round(c.x)}" y="${Math.round(c.y)}" width="${Math.round(c.w)}" height="${Math.round(c.h)}" as="geometry"/></mxCell>`).join("\n");
      return `<diagram id="${id}" name="${attr(name)}"><mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>\n${body}\n</root></mxGraphModel></diagram>`;
    };
    const box = (fill, stroke, extra = "") => `rounded=1;whiteSpace=wrap;html=1;arcSize=8;fillColor=${fill};strokeColor=${stroke};fontFamily=Helvetica;${extra}`;
    const text = (extra = "") => `text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;fontFamily=Helvetica;${extra}`;
    const pages = [];

    /* --- WBS: organigrama --- */
    if (o.wbs) {
      const cells = [];
      const colW = 180, gap = 24, taskW = colW - 22, taskH = o.wbsDates ? 54 : 40, vgap = 12;
      const totalW = phases.length * colW + (phases.length - 1) * gap;
      const rootW = 320, rootH = o.wbsDates ? 64 : 48;
      cells.push({ id: "root", x: (totalW - rootW) / 2, y: 0, w: rootW, h: rootH, style: box("#ffffff", "#1c2230", "strokeWidth=2;fontStyle=1;fontSize=14;"),
        value: `<b>${html(state.name.toUpperCase())}</b>` + (o.wbsDates ? `<br><font style="font-size:11px" color="#6b7385">${api.fmt(ps)} a ${api.fmt(pe - 1)} · ${Math.ceil((pe - ps) / 7)} semanas</font>` : "") });
      const phaseY = rootH + 50, phaseH = o.wbsDates ? 66 : 52;
      phases.forEach((p, i) => {
        const rgb = hexToRgb(p.color);
        const x = i * (colW + gap);
        const ts = api.tasksOf(p.code);
        const pid = `F${p.code}`;
        const weeks = ts.length ? `Sem ${api.weekOf(Math.min(...ts.map(t => t.start)))}-${api.weekOf(Math.max(...ts.map(api.endOf)) - 1)} · ${ts.length} paquetes` : "";
        cells.push({ id: pid, x, y: phaseY, w: colW, h: phaseH, style: box(hex(tint(rgb, 0.85)), p.color, `strokeWidth=2;fontSize=12;fontColor=${hex(shade(rgb, 0.45))};`),
          value: `<b>${html(`${p.code}. ${p.name.toUpperCase()}`)}</b>` + (o.wbsDates && weeks ? `<br><font style="font-size:10px" color="#6b7385">${weeks}</font>` : "") });
        cells.push({ id: `e-root-${pid}`, edge: true, source: "root", target: pid, style: "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=none;strokeColor=#6b7385;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" });
        ts.forEach((t, j) => {
          const isCrit = o.critical && crit(t.code);
          cells.push({ id: `T${t.code}`, x: x + 22, y: phaseY + phaseH + 16 + j * (taskH + vgap), w: taskW, h: taskH,
            style: box("#ffffff", isCrit ? "#dc2626" : "#c8cdd7", `align=left;spacingLeft=8;fontSize=11;fontColor=#1c2230;${isCrit ? "strokeWidth=2;" : ""}`),
            value: html(`${t.code} ${t.name}`) + (o.wbsDates ? `<br><font style="font-size:9px" color="#6b7385">${api.fmt(t.start)} a ${api.fmt(api.lastDay(t))} · ${t.duration} d</font>` : "") });
          cells.push({ id: `e-${pid}-${t.code}`, edge: true, source: pid, target: `T${t.code}`, style: "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=none;strokeColor=#6b7385;exitX=0.06;exitY=1;entryX=0;entryY=0.5;" });
        });
      });
      pages.push(page("wbs", "WBS", cells));
    }

    /* --- Gantt: tabla + barras por semana --- */
    if (o.gantt) {
      const cells = [];
      const msMax = o.milestones && state.milestones.length ? Math.max(...state.milestones.map(m => m.day)) : 0;
      const from = Math.floor(ps / 7) * 7, to = Math.ceil(Math.max(pe, msMax) / 7) * 7;
      const DX = 7, RH = 26, HEAD = 40;
      const cols = [["Cód.", 44], ["Paquete de trabajo", 250], ["Inicio", 74], ["Fin", 74], ["Días", 44]];
      const leftW = cols.reduce((s, c) => s + c[1], 0);
      const X0 = leftW + 12, X = d => X0 + (d - from) * DX;
      const rows = [];
      for (const p of phases) { rows.push({ p }); for (const t of api.tasksOf(p.code)) rows.push({ p, t }); }
      if (o.milestones && state.milestones.length) { rows.push({ mshead: true }); state.milestones.forEach(m => rows.push({ m })); }
      const H = HEAD + rows.length * RH;

      // Cabecera: columnas, meses y semanas
      let cx = 0;
      for (const [label, w] of cols) { cells.push({ id: `h-${label}`, x: cx, y: 0, w, h: HEAD, style: text("fontStyle=1;fontSize=11;fontColor=#6b7385;verticalAlign=bottom;spacingBottom=4;"), value: label }); cx += w; }
      const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      for (let d = from; d < to;) {
        const dt = api.dayToDate(d);
        const nd = Math.min(to, d + Math.round((Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) - dt.getTime()) / 86400000));
        cells.push({ id: `m${d}`, x: X(d), y: 0, w: (nd - d) * DX, h: HEAD / 2, style: "rounded=0;html=1;fillColor=#f6f7fb;strokeColor=#c8cdd7;fontSize=11;fontStyle=1;fontColor=#1c2230;", value: (nd - d) * DX > 40 ? `${meses[dt.getUTCMonth()]} ${dt.getUTCFullYear()}` : "" });
        d = nd;
      }
      for (let w = from; w < to; w += 7) {
        cells.push({ id: `w${w}`, x: X(w), y: HEAD / 2, w: 7 * DX, h: HEAD / 2, style: "rounded=0;html=1;fillColor=#ffffff;strokeColor=#e8ebf1;fontSize=9;fontColor=#6b7385;", value: `S${api.weekOf(w)}` });
        cells.push({ id: `g${w}`, x: X(w), y: HEAD, w: 7 * DX, h: rows.length * RH, style: "rounded=0;html=1;fillColor=none;strokeColor=#e8ebf1;" });
      }

      rows.forEach((r, i) => {
        const y = HEAD + i * RH, mid = y + RH / 2;
        const rowCells = (vals, bold, color) => {
          let x = 0;
          vals.forEach((v, k) => { cells.push({ id: `c${i}-${k}`, x, y, w: cols[k][1], h: RH, style: text(`fontSize=11;fontColor=${color};${bold ? "fontStyle=1;" : ""}${k === 1 && !bold ? "spacingLeft=12;" : ""}${k === 4 ? "align=right;" : ""}`), value: html(v) }); x += cols[k][1]; });
        };
        if (r.t) {
          const t = r.t, rgb = hexToRgb(r.p.color), isCrit = o.critical && crit(t.code);
          rowCells([t.code, t.name, api.fmt(t.start), api.fmt(api.lastDay(t)), String(t.duration)], false, "#1c2230");
          cells.push({ id: `B${t.code}`, x: X(t.start), y: mid - 8, w: Math.max(t.duration * DX, 4), h: 16, value: "",
            style: `rounded=0;html=1;fillColor=${hex(tint(rgb, t.loe ? 0.75 : 0.55))};strokeColor=${isCrit ? "#dc2626" : r.p.color};${isCrit ? "strokeWidth=2;" : ""}${t.loe ? `fillStyle=hatch;gradientColor=none;` : ""}${t.buffer ? "fillColor=#e5e7eb;strokeColor=#6b7385;dashed=1;" : ""}` });
          cells.push({ id: `L${t.code}`, x: X(api.endOf(t)) + 4, y, w: 260, h: RH, style: text("fontSize=10;fontColor=#6b7385;"), value: html(t.name) });
        } else if (r.p) {
          const ts = api.tasksOf(r.p.code), rgb = hexToRgb(r.p.color);
          const s = Math.min(...ts.map(t => t.start)), e = Math.max(...ts.map(api.endOf));
          cells.push({ id: `rb${i}`, x: 0, y, w: X(to), h: RH, value: "", style: `rounded=0;html=1;strokeColor=none;fillColor=${hex(tint(rgb, 0.9))};` });
          rowCells([r.p.code, r.p.name, api.fmt(s), api.fmt(e - 1), String(e - s)], true, hex(shade(rgb, 0.5)));
          cells.push({ id: `P${r.p.code}`, x: X(s), y: mid - 4, w: (e - s) * DX, h: 8, value: "", style: `rounded=0;html=1;fillColor=${r.p.color};strokeColor=none;` });
        } else if (r.mshead) {
          cells.push({ id: `rb${i}`, x: 0, y, w: X(to), h: RH, value: "", style: "rounded=0;html=1;strokeColor=none;fillColor=#f6f7fb;" });
          rowCells(["", "Hitos del Project Charter", "", "", ""], true, "#1c2230");
        } else if (r.m) {
          rowCells([r.m.id, r.m.name, "", api.fmt(r.m.day - 1), "0"], false, "#1c2230");
          cells.push({ id: `M${i}`, x: X(r.m.day) - 8, y: mid - 8, w: 16, h: 16, value: "", style: "rhombus;html=1;fillColor=#1c2230;strokeColor=none;" });
          cells.push({ id: `ML${i}`, x: X(r.m.day) + 12, y, w: 300, h: RH, style: text("fontSize=10;fontColor=#6b7385;"), value: html(`${r.m.name} · semana ${api.weekOf(r.m.day - 1)}`) });
          cells.push({ id: `MV${i}`, x: X(r.m.day), y: HEAD, w: 1, h: rows.length * RH, value: "", style: "rounded=0;html=1;fillColor=none;strokeColor=#969baa;dashed=1;" });
        }
      });

      if (o.deps) for (const t of state.tasks) for (const dc of t.deps) {
        if (!state.tasks.some(x => x.code === dc)) continue;
        const isCrit = o.critical && crit(t.code) && crit(dc);
        cells.push({ id: `d-${dc}-${t.code}`, edge: true, source: `B${dc}`, target: `B${t.code}`,
          style: `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endSize=4;exitX=1;exitY=0.5;entryX=0;entryY=0.5;strokeColor=${isCrit ? "#dc2626" : "#969baa"};` });
      }

      // Leyenda de fases debajo
      let lx = 0;
      phases.forEach(p => {
        cells.push({ id: `lg${p.code}`, x: lx, y: H + 20, w: 14, h: 10, value: "", style: `rounded=0;html=1;fillColor=${p.color};strokeColor=none;` });
        cells.push({ id: `lgt${p.code}`, x: lx + 18, y: H + 14, w: 180, h: 22, style: text("fontSize=10;fontColor=#6b7385;"), value: html(`${p.code}. ${p.name}`) });
        lx += 200;
      });
      pages.push(page("gantt", "Gantt", cells));
    }

    const xml = `<mxfile host="WBS y Gantt · Equipo 04" type="device">\n${pages.join("\n")}\n</mxfile>\n`;
    const base = o.fileName || "wbs-gantt-migracion-aws";
    if (window.EMBEDDED_VIEW) return { name: `${base}.zip`, blob: zipStore([{ name: `${base}.drawio`, data: new TextEncoder().encode(xml) }]) };
    return { name: `${base}.drawio`, blob: new Blob([xml], { type: "application/vnd.jgraph.mxfile" }) };
  }

  /* ZIP sin compresión (método "store"), suficiente para un archivo */
  function zipStore(files) {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true);
      parts.push(local, name, f.data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, size, true); cen.setUint32(24, size, true); cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(cen, name);
      offset += 30 + name.length + size;
    }
    const cenSize = central.reduce((s, p) => s + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  window.Exporters = { pdf, msproject, drawio };
})();
