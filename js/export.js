/* =====================================================================
 * Exportaciones: PDF (jsPDF, dibujado vectorial con colores) y
 * MS Project (formato XML de Microsoft Project, MSPDI).
 *
 * Cada exportador recibe `api` (estado + utilidades de app.js) y un modo:
 *   "simple" -> solo WBS y Gantt
 *   "full"   -> informe detallado
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
  async function pdf(api, mode) {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) throw new Error("no se pudo cargar la librería de PDF");
    const full = mode === "full";
    const { state } = api;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
    const PW = 420, PH = 297, M = 12;
    const ctx = { doc, api, full, PW, PH, M };

    doc.setProperties({ title: `${state.name} - ${full ? "Informe de cronograma" : "WBS y Gantt"}`, subject: "WBS y diagrama de Gantt", creator: "WBS y Gantt · Equipo 04" });

    if (full) {
      drawSummaryPage(ctx);
      doc.addPage();
    }
    drawWBS(ctx);
    doc.addPage();
    drawGantt(ctx);
    if (full) {
      doc.addPage();
      drawDictionary(ctx);
    }

    // Pie de página en todas las hojas
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
      doc.text(`${state.name} · Equipo 04 · Dirección de Proyectos`, M, PH - 6);
      doc.text(`Página ${i} de ${pages}`, PW - M, PH - 6, { align: "right" });
    }

    const name = full ? "informe-cronograma-migracion-aws.pdf" : "wbs-gantt-migracion-aws.pdf";
    return { name, blob: doc.output("blob") };
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
    const { doc, api, full, PW, PH, M } = ctx;
    const { state } = api;
    let y = pageHeader(ctx, "Estructura de Desglose del Trabajo (WBS)", `${state.name} · ${api.state.tasks.length} paquetes de trabajo en ${state.phases.length} fases`);
    const phases = sortedPhases(api);
    const n = Math.max(phases.length, 1);
    const gap = 3.5;
    const colW = (PW - 2 * M - gap * (n - 1)) / n;
    const pad = 2.2;

    // Medidas de texto
    const phaseFs = n > 10 ? 7 : 8.6, taskFs = n > 10 ? 6.6 : 8, dateFs = 6.4;
    const lh = fs => fs * 0.3528 * 1.18; // alto de línea en mm

    // Raíz
    const [ps, pe] = projectSpan(api);
    doc.setFont("helvetica", "bold").setFontSize(10);
    const rootLines = doc.splitTextToSize(state.name.toUpperCase(), 92);
    const rootH = rootLines.length * lh(10) + (full ? 8 : 5);
    const rootW = 100, rootX = (PW - rootW) / 2;
    doc.setDrawColor(...INK).setLineWidth(0.6).setFillColor(255, 255, 255);
    doc.roundedRect(rootX, y, rootW, rootH, 2, 2, "FD");
    doc.setTextColor(...INK).text(rootLines, PW / 2, y + 2.5 + lh(10) * 0.8, { align: "center" });
    if (full) {
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
    const phaseH = Math.max(...phaseLines.map(l => l.length)) * lh(phaseFs) + 2 * pad + (full ? 3.2 : 0.6);
    const phaseY = busY + 5;

    // Alto de cada tarea; si no entra en la hoja, se achica el espaciado
    const taskW = colW - 5;
    const measure = t => {
      doc.setFont("helvetica", "normal").setFontSize(taskFs);
      const lines = doc.splitTextToSize(`${t.code} ${t.name}`, taskW - 2 * pad - 1);
      return { lines, h: lines.length * lh(taskFs) + 2 * pad + (full ? lh(dateFs) + 0.6 : 0) };
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
      if (full && tasks.length) {
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
        doc.setFillColor(255, 255, 255).setDrawColor(...(full && inf.critical ? CRIT : LINE)).setLineWidth(full && inf.critical ? 0.45 : 0.3);
        doc.roundedRect(tx, ty, taskW, o.h, 1.2, 1.2, "FD");
        doc.setFillColor(...rgb).rect(tx, ty + 0.3, 1.1, o.h - 0.6, "F");
        doc.setFont("helvetica", "normal").setFontSize(taskFs).setTextColor(...INK);
        doc.text(o.lines, tx + pad + 1, ty + pad + lh(taskFs) * 0.8);
        if (full) {
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

    if (full) {
      doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED);
      doc.setDrawColor(...CRIT).setLineWidth(0.45).rect(M, PH - 16, 6, 3.5);
      doc.text("Paquete en la ruta crítica", M + 8, PH - 13.4);
    }
  }

  /* --- Hoja(s) Gantt --- */
  function drawGantt(ctx) {
    const { doc, api, full, PW, PH, M } = ctx;
    const { state } = api;
    const phases = sortedPhases(api);
    const [ps, pe] = projectSpan(api);
    const msMax = state.milestones.length ? Math.max(...state.milestones.map(m => m.day)) : 0;
    const from = Math.floor(ps / 7) * 7;
    const to = Math.ceil(Math.max(pe, msMax) / 7) * 7;

    // Columnas de la tabla izquierda
    const cols = full
      ? [["Cód.", 11, "l"], ["Paquete de trabajo", 62, "l"], ["Inicio", 15, "l"], ["Fin", 15, "l"], ["Días", 9, "r"], ["%", 8, "r"]]
      : [["Cód.", 11, "l"], ["Paquete de trabajo", 70, "l"], ["Días", 9, "r"]];
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
    if (state.milestones.length) {
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

      // Grilla vertical semanal
      for (let w = from; w <= to; w += 7) {
        doc.setDrawColor(...GRID).setLineWidth(0.2).line(X(w), top + headH / 2, X(w), yEnd);
      }
      doc.setDrawColor(...LINE).setLineWidth(0.3).line(M, top + headH, PW - M, top + headH);
      doc.line(tx0 - 1, top, tx0 - 1, yEnd);

      // Líneas de hitos y de hoy
      for (const m of state.milestones) {
        doc.setDrawColor(150, 155, 170).setLineWidth(0.25).setLineDashPattern([1, 1], 0).line(X(m.day), top + headH, X(m.day), yEnd);
      }
      doc.setLineDashPattern([], 0);
      if (full) {
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
          const vals = full ? [r.p.code, r.p.name, s != null ? api.fmt(s) : "", e != null ? api.fmt(e - 1) : "", s != null ? e - s : "", ts.length ? weightedProgress(api, ts) : ""]
            : [r.p.code, r.p.name, s != null ? e - s : ""];
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
          const vals = full ? [t.code, t.name, api.fmt(t.start), api.fmt(api.lastDay(t)), t.duration, t.progress || 0] : [t.code, t.name, t.duration];
          drawCells(doc, cols, vals, M + 1, textY, fs, false, INK, 3);
          doc.setDrawColor(...GRID).setLineWidth(0.15).line(M, y + rowH, tx0 - 1, y + rowH);
          const bh = rowH * 0.62, bx = X(t.start), bw = Math.max(t.duration * px, 0.8);
          if (t.loe) {
            doc.setFillColor(...tint(rgb, 0.75)).rect(bx, mid - bh / 2, bw, bh, "F");
            doc.setDrawColor(...tint(rgb, 0.3)).setLineWidth(0.2);
            for (let hx = bx; hx < bx + bw; hx += 2.2) doc.line(hx, mid + bh / 2, Math.min(hx + bh, bx + bw), mid - bh / 2);
          } else {
            doc.setFillColor(...tint(rgb, 0.6)).rect(bx, mid - bh / 2, bw, bh, "F");
            if (t.progress) doc.setFillColor(...rgb).rect(bx, mid - bh / 2, bw * t.progress / 100, bh, "F");
          }
          const critical = full && inf.critical;
          doc.setDrawColor(...(critical ? CRIT : rgb)).setLineWidth(critical ? 0.5 : 0.25).rect(bx, mid - bh / 2, bw, bh, "S");
          doc.setFont("helvetica", "normal").setFontSize(fs - 1).setTextColor(...MUTED);
          const label = full ? t.name : `${t.code} ${t.name}`;
          const lx = bx + bw + 1.2;
          const lw = doc.getTextWidth(label);
          if (lx + lw < PW - M) doc.text(label, lx, textY);
          else if (bx - 1.2 - lw > tx0) doc.text(label, bx - 1.2, textY, { align: "right" });
          else {
            doc.setFillColor(255, 255, 255).rect(bx + 1, mid - bh / 2 + 0.3, lw + 1.6, bh - 0.6, "F");
            doc.setTextColor(...INK).text(label, bx + 1.8, textY);
          }
        } else if (r.kind === "mshead") {
          doc.setFillColor(246, 247, 251).rect(M, y, PW - 2 * M, rowH, "F");
          drawCells(doc, cols, ["", "Hitos del Project Charter"], M + 1, textY, fs, true, INK);
          for (const m of state.milestones) diamond(doc, X(m.day), mid, rowH * 0.32);
        } else if (r.kind === "ms") {
          const vals = full ? [r.m.id, r.m.name, "", api.fmt(r.m.day - 1), "0", ""] : [r.m.id, r.m.name, "0"];
          drawCells(doc, cols, vals, M + 1, textY, fs, false, INK, 3);
          diamond(doc, X(r.m.day), mid, rowH * 0.3);
          doc.setFont("helvetica", "normal").setFontSize(fs - 1).setTextColor(...MUTED);
          const mlabel = `${r.m.name} · semana ${api.weekOf(r.m.day - 1)}`;
          if (X(r.m.day) + 2.4 + doc.getTextWidth(mlabel) < PW - M) doc.text(mlabel, X(r.m.day) + 2.4, textY);
          else doc.text(mlabel, X(r.m.day) - 2.4, textY, { align: "right" });
        }
      });

      // Dependencias (solo informe detallado, dentro de la misma hoja)
      if (full) {
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

      // Leyenda
      const ly = PH - 19;
      doc.setFont("helvetica", "normal").setFontSize(6.8).setTextColor(...MUTED);
      let lx = M;
      const item = (draw, text) => { draw(lx, ly); doc.setTextColor(...MUTED).text(text, lx + 8, ly + 2.4); lx += 12 + doc.getTextWidth(text); };
      for (const p of phases) {
        const rgb = hexToRgb(p.color);
        item((x, yy) => doc.setFillColor(...rgb).rect(x, yy, 6, 3, "F"), `${p.code}. ${p.name}`);
      }
      lx = M;
      const ly2 = ly + 5;
      const item2 = (draw, text) => { draw(lx, ly2); doc.setTextColor(...MUTED).text(text, lx + 8, ly2 + 2.4); lx += 12 + doc.getTextWidth(text); };
      item2((x, yy) => diamond(doc, x + 3, yy + 1.5, 1.6), "Hito");
      item2((x, yy) => doc.setFillColor(200, 200, 210).rect(x, yy + 0.5, 6, 2, "F"), "Nivel de esfuerzo (rayado)");
      if (full) {
        item2((x, yy) => doc.setDrawColor(...CRIT).setLineWidth(0.5).rect(x, yy, 6, 3, "S"), "Ruta crítica");
        item2((x, yy) => doc.setDrawColor(...TODAY).setLineWidth(0.6).line(x + 3, yy - 0.5, x + 3, yy + 3.5), "Hoy");
        item2((x, yy) => doc.setDrawColor(150, 155, 170).setLineWidth(0.25).line(x, yy + 1.5, x + 6, yy + 1.5), "Dependencia fin-comienzo");
      }
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
    const { doc, api, PW, M } = ctx;
    const { state } = api;
    let y = pageHeader(ctx, "Informe de cronograma del proyecto", `${state.name} · WBS, cronograma, ruta crítica y diccionario de la WBS`);
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
    kpis.forEach(([v, l], i) => {
      const x = M + i * (kw + 4);
      doc.setDrawColor(...LINE).setLineWidth(0.3).setFillColor(250, 251, 253).roundedRect(x, y, kw, 18, 1.5, 1.5, "FD");
      doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(...INK).text(v, x + 4, y + 9);
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED).text(l, x + 4, y + 14.5);
    });
    y += 26;

    // Tabla de fases
    const colW = (PW - 2 * M - 10) / 2;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text("Fases", M, y);
    let ty = y + 4;
    const phCols = [["", 5, "l"], ["Fase", 74, "l"], ["Inicio", 20, "l"], ["Fin", 20, "l"], ["Semanas", 18, "r"], ["Paquetes", 18, "r"], ["Avance", 18, "r"]];
    ty = tableHeader(doc, phCols, M, ty, colW);
    for (const p of sortedPhases(api)) {
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
    const x2 = M + colW + 10;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text("Hitos del Project Charter", x2, y);
    let my = y + 4;
    const msCols = [["", 6, "l"], ["Hito", 100, "l"], ["Semana", 20, "r"], ["Fecha", 26, "r"]];
    my = tableHeader(doc, msCols, x2, my, colW);
    for (const m of state.milestones) {
      diamond(doc, x2 + 3, my + 3, 1.4);
      drawCells(doc, msCols, ["", `${m.id} · ${m.name}`, api.weekOf(m.day - 1), api.fmt(m.day - 1)], x2 + 1, my + 4, 8, false, INK);
      doc.setDrawColor(...GRID).setLineWidth(0.2).line(x2, my + 6, x2 + colW, my + 6);
      my += 6;
    }

    // Ruta crítica
    y = Math.max(ty, my) + 10;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text("Ruta crítica", M, y);
    const crit = [...state.tasks].filter(t => api.analysis.info.get(t.code)?.critical).sort((a, b) => a.start - b.start || api.codeCmp(a.code, b.code));
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...INK);
    const critText = crit.length ? crit.map(t => `${t.code} ${t.name}`).join("  >  ") : "No hay paquetes con holgura cero.";
    const critLines = doc.splitTextToSize(critText, PW - 2 * M);
    doc.text(critLines, M, y + 6);
    y += 6 + critLines.length * 4.2 + 6;

    // Supuestos
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

  /* --- Diccionario de la WBS (informe detallado) --- */
  function drawDictionary(ctx) {
    const { doc, api, PW, PH, M } = ctx;
    const cols = [["Cód.", 12, "l"], ["Paquete de trabajo", 70, "l"], ["Inicio", 17, "l"], ["Fin", 17, "l"], ["Días", 10, "r"], ["Semanas", 16, "r"],
      ["Predecesoras", 34, "l"], ["Holgura", 14, "r"], ["Crítica", 13, "l"], ["Avance", 13, "r"], ["Responsable", 34, "l"], ["Notas", PW - 2 * M - 250, "l"]];
    const W = PW - 2 * M;
    const start = () => tableHeader(doc, cols, M, pageHeader(ctx, "Diccionario de la WBS", "Detalle de cada paquete de trabajo: fechas, dependencias, holgura y responsable"), W);
    let y = start();
    const fs = 7.5;
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
        const notes = doc.splitTextToSize(t.notes || "", cols[11][1] - 2);
        const h = Math.max(5.6, notes.length * 3.2 + 2.4);
        if (y + h > PH - 16) { doc.addPage(); y = start(); }
        drawCells(doc, cols.slice(0, 11), [t.code, t.name, api.fmt(t.start), api.fmt(api.lastDay(t)), t.duration,
          `${api.weekOf(t.start)}-${api.weekOf(api.lastDay(t))}`, t.deps.join(", ") || "-", t.loe ? "n/a" : inf.slack,
          t.loe ? "NE" : inf.critical ? "Sí" : "No", `${t.progress || 0}%`, t.owner || "-"], M + 1, y + 3.9, fs, false, INK);
        if (inf.critical) {
          const cx = M + 1 + cols.slice(0, 8).reduce((s, c) => s + c[1], 0);
          doc.setFont("helvetica", "bold").setTextColor(...CRIT).text("Sí", cx, y + 3.9);
        }
        if (notes.length) {
          doc.setFont("helvetica", "normal").setTextColor(...INK).text(notes, M + 1 + W - cols[11][1], y + 3.9);
        }
        doc.setDrawColor(...GRID).setLineWidth(0.2).line(M, y + h, M + W, y + h);
        y += h;
      }
    }
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...MUTED);
    doc.text("NE: nivel de esfuerzo (no participa de la ruta crítica). Holgura en días.", M, Math.min(y + 6, PH - 12));
  }

  /* ------------------------------------------------------------------ */
  /* MS Project (MSPDI XML)                                              */
  /* ------------------------------------------------------------------ */
  function msproject(api, mode) {
    const full = mode === "full";
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
    state.milestones.forEach((m, i) => uidByCode.set("H" + i, uid++));

    const owners = full ? [...new Set(state.tasks.map(t => (t.owner || "").trim()).filter(Boolean))] : [];
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
        (full ? `<PercentComplete>${weightedProgress(api, ts)}</PercentComplete>` : "") +
        `<ExtendedAttribute><FieldID>188743731</FieldID><Value>${esc(p.name)}</Value></ExtendedAttribute>` +
        `</Task>`);
      ts.forEach((t, i) => {
        const inf = api.analysis.info.get(t.code) || {};
        const preds = full ? t.deps.filter(d => uidByCode.has(d)).map(d => `<PredecessorLink><PredecessorUID>${uidByCode.get(d)}</PredecessorUID><Type>1</Type><CrossProject>0</CrossProject><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join("") : "";
        const notes = full ? [t.notes, t.loe ? "Nivel de esfuerzo" : `Holgura total: ${inf.slack} días${inf.critical ? " (crítica)" : ""}`].filter(Boolean).join(" | ") : "";
        tasks.push(`<Task><UID>${uidByCode.get(t.code)}</UID><ID>${id++}</ID><Name>${esc(t.name)}</Name><Type>0</Type><IsNull>0</IsNull>` +
          `<WBS>${esc(t.code)}</WBS><OutlineNumber>${esc(p.code)}.${i + 1}</OutlineNumber><OutlineLevel>2</OutlineLevel>` +
          `<Start>${dt(t.start, "08:00:00")}</Start><Finish>${dt(api.lastDay(t), "17:00:00")}</Finish>` +
          `<Duration>${dur(t.duration)}</Duration><DurationFormat>7</DurationFormat><Summary>0</Summary><Milestone>0</Milestone>` +
          `<ConstraintType>4</ConstraintType><ConstraintDate>${dt(t.start, "08:00:00")}</ConstraintDate>` +
          (full ? `<PercentComplete>${t.progress || 0}</PercentComplete>` : "") +
          (notes ? `<Notes>${esc(notes)}</Notes>` : "") +
          `<ExtendedAttribute><FieldID>188743731</FieldID><Value>${esc(p.name)}</Value></ExtendedAttribute>` +
          (full ? `<ExtendedAttribute><FieldID>188743734</FieldID><Value>${inf.critical ? "Sí" : "No"}</Value></ExtendedAttribute>` : "") +
          preds + `</Task>`);
        if (full && t.owner && resUid.has(t.owner.trim())) {
          assignments.push(`<Assignment><UID>${assignments.length + 1}</UID><TaskUID>${uidByCode.get(t.code)}</TaskUID><ResourceUID>${resUid.get(t.owner.trim())}</ResourceUID><Units>1</Units></Assignment>`);
        }
      });
    }

    if (state.milestones.length) {
      const ms = state.milestones;
      const s = Math.min(...ms.map(m => m.day - 1)), e = Math.max(...ms.map(m => m.day - 1));
      const code = String(phases.length + 1);
      tasks.push(`<Task><UID>${msUid}</UID><ID>${id++}</ID><Name>Hitos del Project Charter</Name><Type>1</Type><IsNull>0</IsNull><WBS>${code}</WBS><OutlineNumber>${code}</OutlineNumber><OutlineLevel>1</OutlineLevel>` +
        `<Start>${dt(s, "17:00:00")}</Start><Finish>${dt(e, "17:00:00")}</Finish><Summary>1</Summary></Task>`);
      ms.forEach((m, i) => {
        tasks.push(`<Task><UID>${uidByCode.get("H" + i)}</UID><ID>${id++}</ID><Name>${esc(`${m.id} · ${m.name}`)}</Name><Type>1</Type><IsNull>0</IsNull>` +
          `<WBS>${code}.${i + 1}</WBS><OutlineNumber>${code}.${i + 1}</OutlineNumber><OutlineLevel>2</OutlineLevel>` +
          `<Start>${dt(m.day - 1, "17:00:00")}</Start><Finish>${dt(m.day - 1, "17:00:00")}</Finish><Duration>PT0H0M0S</Duration><DurationFormat>7</DurationFormat>` +
          `<Milestone>1</Milestone><Summary>0</Summary><ConstraintType>2</ConstraintType><ConstraintDate>${dt(m.day - 1, "17:00:00")}</ConstraintDate></Task>`);
      });
    }

    const weekDays = [1, 2, 3, 4, 5, 6, 7].map(d => `<WeekDay><DayType>${d}</DayType><DayWorking>1</DayWorking><WorkingTimes>` +
      `<WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime>` +
      `</WorkingTimes></WeekDay>`).join("");

    const resources = full ? owners.map((o, i) => `<Resource><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${esc(o)}</Name><Type>1</Type><IsNull>0</IsNull></Resource>`).join("") : "";

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
<ExtendedAttribute><FieldID>188743731</FieldID><FieldName>Text1</FieldName><Alias>Fase</Alias></ExtendedAttribute>
${full ? "<ExtendedAttribute><FieldID>188743734</FieldID><FieldName>Text2</FieldName><Alias>Ruta crítica</Alias></ExtendedAttribute>" : ""}
</ExtendedAttributes>
<Calendars><Calendar><UID>1</UID><Name>Proyecto (7 días)</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>${weekDays}</WeekDays></Calendar></Calendars>
<Tasks>
${tasks.join("\n")}
</Tasks>
<Resources>${resources}</Resources>
<Assignments>${assignments.join("")}</Assignments>
</Project>
`;
    const base = full ? "ms-project-detallado-migracion-aws" : "ms-project-wbs-gantt-migracion-aws";
    // En claude.ai no se pueden descargar .xml: se entrega dentro de un .zip
    if (window.EMBEDDED_VIEW) return { name: `${base}.zip`, blob: zipStore([{ name: `${base}.xml`, data: new TextEncoder().encode(xml) }]) };
    return { name: `${base}.xml`, blob: new Blob([xml], { type: "application/xml" }) };
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

  window.Exporters = { pdf, msproject };
})();
