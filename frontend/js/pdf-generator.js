/**
 * pdf-generator.js - Bloom Personal Cycle Report
 * Palette and layout match the actual Bloom app design system.
 */

import { jsPDF }  from "jspdf";
import autoTable  from "jspdf-autotable";
import { formatDateLong, formatDateMed } from "./pdf-report-data.js";

// ── Palette (mirrors theme.css exactly) ───────────────────────────────────────
const C = {
  primary:        [212,  24, 122],   // #D4187A  ← real app primary
  primaryMed:     [188,  16, 108],   // slightly deeper, for heavy backgrounds
  primaryLight:   [245, 197, 220],   // #F5C5DC
  primaryLightest:[255, 240, 247],   // #FFF0F7
  border:         [240, 208, 228],   // #F0D0E4
  borderDark:     [212, 160, 192],   // #D4A0C0
  bgCard:         [255, 254, 251],   // #FFFEFB
  bgPage:         [255, 247, 250],   // #FFF7FA
  white:          [255, 255, 255],
  textDark:       [ 42,  24,  44],
  textMid:        [ 85,  58,  88],
  textMuted:      [138, 108, 138],
  success:        [ 56, 130,  78],
  warning:        [168,  88,  22],
  info:           [ 68, 105, 168],
};

// ── Page geometry ─────────────────────────────────────────────────────────────
const PW     = 210;
const PH     = 297;
const M      = 18;
const CW     = PW - M * 2;
const BOTTOM = 272;

// ── Low-level drawing helpers ──────────────────────────────────────────────────
const tc = (doc, c) => doc.setTextColor(...c);
const fc = (doc, c) => doc.setFillColor(...c);
const dc = (doc, c) => doc.setDrawColor(...c);

function hRule(doc, y, color = C.border) {
  dc(doc, color);
  doc.setLineWidth(0.25);
  doc.line(M, y, PW - M, y);
  return y + 1;
}

// ── Content-page branded header (drawn on every non-cover page) ───────────────
function drawPageHeader(doc) {
  fc(doc, C.primary);
  doc.rect(0, 0, PW, 10, "F");
  // Small white circle accent
  fc(doc, [255, 255, 255, 0.25]);
  fc(doc, [230, 100, 160]);
  doc.circle(6, 5, 5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  tc(doc, C.white);
  doc.text("bloom", M, 6.8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  tc(doc, [255, 210, 235]);
  doc.text("Personal Cycle Report", PW - M, 6.8, { align: "right" });
  // Thin rule under header
  dc(doc, C.primaryLight);
  doc.setLineWidth(0.2);
  doc.line(0, 10, PW, 10);
}

// ── Section heading (full-width pill) ─────────────────────────────────────────
function sectionHeading(doc, label, y) {
  y = maybeNewPage(doc, y, 24);
  fc(doc, C.primaryLightest);
  dc(doc, C.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(M, y - 5, CW, 17, 3, 3, "FD");
  fc(doc, C.primary);
  doc.roundedRect(M, y - 5, 4.5, 17, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  tc(doc, C.primary);
  doc.text(label.toUpperCase(), M + 11, y + 6);
  return y + 22;
}

// ── Page-break guard ──────────────────────────────────────────────────────────
function maybeNewPage(doc, y, needed = 40) {
  if (y + needed > BOTTOM) {
    doc.addPage();
    drawPageHeader(doc);
    return 22;
  }
  return y;
}

// ── Footer stamp (runs after all pages are built) ─────────────────────────────
function stampFooters(doc, firstContentPage, totalContent) {
  for (let p = firstContentPage; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p);
    fc(doc, C.primaryLightest);
    doc.rect(0, PH - 11, PW, 11, "F");
    dc(doc, C.border);
    doc.setLineWidth(0.2);
    doc.line(0, PH - 11, PW, PH - 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    tc(doc, C.textMuted);
    const n = p - firstContentPage + 1;
    doc.text("Bloom - Personal Cycle Report", M, PH - 4);
    doc.text(`Page ${n} of ${totalContent}`, PW - M, PH - 4, { align: "right" });
  }
}

// ── COVER PAGE ────────────────────────────────────────────────────────────────
function drawCover(doc, data) {
  const bandH = 100;  // top pink band height

  // ── Page background: soft blush ──
  fc(doc, C.primaryLightest);
  doc.rect(0, 0, PW, PH, "F");

  // ── Top primary band ──
  fc(doc, C.primary);
  doc.rect(0, 0, PW, bandH, "F");

  // ── Decorative circles - top-right corner, partial off-page ──
  fc(doc, C.primaryMed);
  doc.circle(PW + 10, -10, 58, "F");
  fc(doc, [220, 60, 140]);
  doc.circle(PW + 10, -10, 40, "F");
  fc(doc, [230, 100, 160]);
  doc.circle(PW + 10, -10, 24, "F");

  // ── Small accent circle bottom-left of band ──
  fc(doc, C.primaryMed);
  doc.circle(-6, bandH + 6, 30, "F");
  fc(doc, [220, 60, 140]);
  doc.circle(-6, bandH + 6, 18, "F");

  // ── "bloom" wordmark ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(58);
  tc(doc, C.white);
  doc.text("bloom", PW / 2, 60, { align: "center" });

  // ── Subtitle ──
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12.5);
  tc(doc, [255, 215, 237]);
  doc.text("Personal Cycle Report", PW / 2, 76, { align: "center" });

  // ── Thin white rule ──
  dc(doc, [255, 200, 228]);
  doc.setLineWidth(0.3);
  doc.line(M + 36, 84, PW - M - 36, 84);

  // ── Date ──
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  tc(doc, [255, 230, 244]);
  doc.text(`Generated ${formatDateLong(data.generatedDate)}`, PW / 2, 93, { align: "center" });

  // ── For: name (on blush background below band) ──
  const afterBandY = bandH + 14;
  if (data.userName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    tc(doc, C.primary);
    doc.text(`Prepared for ${data.userName}`, PW / 2, afterBandY, { align: "center" });
  }

  // ── Tagline ──
  const taglineY = data.userName ? afterBandY + 10 : afterBandY;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  tc(doc, C.textMid);
  const tagline = doc.splitTextToSize(
    "Your personal menstrual health insights - for personal review or sharing with a healthcare provider.",
    CW - 24
  );
  doc.text(tagline, PW / 2, taglineY, { align: "center" });

  // ── Quick stats cards (white cards on blush) ──
  if (data.cyclesTracked > 0) {
    const tilesStartY = taglineY + tagline.length * 5 + 14;
    const tileW = (CW - 8) / 3;
    const tileH = 38;
    const quickStats = [
      {
        label: "Avg Cycle",
        value: data.avgCycleLength ? `${data.avgCycleLength} days` : "-",
        sub:   data.avgCycleLength ? "average length" : "need more data",
      },
      {
        label: "Cycles Tracked",
        value: String(data.cyclesTracked),
        sub:   data.cyclesTracked === 1 ? "cycle logged" : "cycles logged",
      },
      {
        label: "Regularity",
        value: data.regularity?.label ?? "-",
        sub:   "cycle pattern",
      },
    ];

    quickStats.forEach(({ label, value, sub }, i) => {
      const x = M + i * (tileW + 4);
      // White card
      fc(doc, C.white);
      dc(doc, C.border);
      doc.setLineWidth(0.4);
      doc.roundedRect(x, tilesStartY, tileW, tileH, 4, 4, "FD");
      // Pink top accent stripe
      fc(doc, C.primaryLight);
      doc.roundedRect(x, tilesStartY, tileW, 4, 2, 2, "F");
      fc(doc, C.primaryLight);
      doc.rect(x, tilesStartY + 2, tileW, 2, "F");

      // Value
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      tc(doc, C.primary);
      doc.text(value, x + tileW / 2, tilesStartY + 18, { align: "center", maxWidth: tileW - 4 });

      // Label
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      tc(doc, C.textMuted);
      doc.text(label.toUpperCase(), x + tileW / 2, tilesStartY + 26, { align: "center" });

      // Sub-label
      if (sub) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.2);
        tc(doc, C.textMuted);
        doc.text(sub, x + tileW / 2, tilesStartY + 32, { align: "center" });
      }
    });

    // ── Report contents overview below tiles ──
    const overviewY = tilesStartY + tileH + 18;
    hRule(doc, overviewY - 4, C.border);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    tc(doc, C.primary);
    doc.text("What's inside this report", M, overviewY + 4);

    const items = [
      "Cycle summary - averages, phase, and next period estimate",
      "Cycle history - a full table of your tracked cycles",
      "Symptom log - your most recent 90 entries",
      "Patterns & insights - top symptoms and cycle variability",
      "Notable observations - anything that stands out in your data",
      "Next steps - personalised suggestions based on your cycle",
    ];
    items.forEach((item, i) => {
      const iy = overviewY + 13 + i * 8.5;
      if (iy > PH - 26) return;
      fc(doc, C.primary);
      doc.circle(M + 2, iy - 1.5, 1.4, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      tc(doc, C.textMid);
      doc.text(item, M + 7, iy);
    });
  }

  // ── Cover footer ──
  fc(doc, C.white);
  doc.rect(0, PH - 14, PW, 14, "F");
  dc(doc, C.border);
  doc.setLineWidth(0.2);
  doc.line(0, PH - 14, PW, PH - 14);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  tc(doc, C.textMuted);
  doc.text(
    "Bloom - Educational Health Tracker  •  Not a medical document  •  For personal use only",
    PW / 2, PH - 5.5, { align: "center" }
  );
}

// ── SUMMARY SECTION ───────────────────────────────────────────────────────────
function drawSummary(doc, data, y) {
  y = sectionHeading(doc, "Your Cycle at a Glance", y);

  const gap   = 4;
  const tileW = (CW - gap * 2) / 3;
  const tileH = 34;

  const phase = data.phaseLabel ?? (data.currentPhase !== "unknown" ? data.currentPhase : null);
  const confLevel = data.confidenceLevel?.toLowerCase() ?? "low";

  // When the ML backend provides a predicted length that differs from the statistical
  // average, show it as an extra tile so users can see the ML result directly.
  const showPredicted = !!(data.predictedCycleLength && data.predictedCycleLength !== data.avgCycleLength);

  const baseTiles = [
    {
      label: "Avg Cycle Length",
      value: data.avgCycleLength ? `${data.avgCycleLength} days` : "-",
      sub:   data.avgCycleLength ? "per completed cycle" : "need 2+ cycles",
    },
    {
      label: "Avg Period Length",
      value: data.avgPeriodLength ? `${data.avgPeriodLength} days` : "-",
      sub:   data.avgPeriodLength ? "days of bleeding" : "need more data",
    },
    {
      label: "Cycles Tracked",
      value: String(data.cyclesTracked || 0),
      sub:   data.cyclesTracked === 1 ? "cycle logged" : "cycles logged",
    },
    {
      label: "Last Period",
      value: data.lastPeriodStart ? formatDateMed(data.lastPeriodStart) : "-",
      sub:   "period start date",
    },
    {
      label: "Next Period Expected",
      value: data.nextPeriodDate ? formatDateMed(data.nextPeriodDate) : "-",
      sub:   data.nextPeriodDate ? "estimated" : "need more data",
    },
    {
      label: "Current Phase",
      value: phase ?? "-",
      sub: (() => {
        if (!data.dayInCycle) return confLevel === "low" ? "need more data" : "";
        const base = `Day ${data.dayInCycle} of cycle`;
        if (data.avgCycleLength > 35) return `${base} (longer cycle)`;
        if (data.avgCycleLength < 21) return `${base} (shorter cycle)`;
        return base;
      })(),
    },
  ];

  // Extra tiles shown when ML backend is available
  const mlTiles = showPredicted ? [
    {
      label: "ML Predicted Cycle",
      value: `${data.predictedCycleLength} days`,
      sub:   "ML-enhanced estimate",
    },
    {
      label: "Est. Ovulation",
      value: data.ovulationDate ? formatDateMed(data.ovulationDate) : "-",
      sub:   data.ovulationDate ? "estimated date" : "need more data",
    },
    {
      label: "Fertile Window",
      value: data.fertileStart && data.fertileEnd
        ? `${formatDateMed(data.fertileStart)} – ${formatDateMed(data.fertileEnd)}`
        : "-",
      sub: data.fertileStart ? "estimated window" : "need more data",
    },
  ] : [];

  const filteredTiles = [...baseTiles, ...mlTiles];

  filteredTiles.forEach(({ label, value, sub }, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const x   = M + col * (tileW + gap);
    const ty  = y + row * (tileH + gap);

    fc(doc, C.bgCard);
    dc(doc, C.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, ty, tileW, tileH, 3, 3, "FD");
    // Top accent
    fc(doc, C.primaryLight);
    doc.roundedRect(x, ty, tileW, 3.5, 2, 2, "F");
    fc(doc, C.primaryLight);
    doc.rect(x, ty + 1.8, tileW, 1.8, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    tc(doc, C.primary);
    doc.text(value, x + tileW / 2, ty + 16, { align: "center", maxWidth: tileW - 4 });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    tc(doc, C.textMuted);
    doc.text(label.toUpperCase(), x + tileW / 2, ty + 23, { align: "center" });

    if (sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.2);
      tc(doc, C.textMuted);
      doc.text(sub, x + tileW / 2, ty + 29, { align: "center" });
    }
  });

  const tileRows = Math.ceil(filteredTiles.length / 3);
  y += tileRows * (tileH + gap) + 10;

  // Regularity badge
  if (data.regularity?.tier) {
    y = maybeNewPage(doc, y, 14);
    const { tier, inTypicalRange, badgeLabel } = data.regularity;
    const badgeColor = tier === "loose" ? C.warning : inTypicalRange ? C.success : C.info;
    const badgeText  = (badgeLabel ?? "").toUpperCase();
    const badgeW     = Math.max(38, badgeText.length * 2.2 + 10);
    fc(doc, badgeColor);
    doc.roundedRect(M, y, badgeW, 8.5, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    tc(doc, C.white);
    doc.text(badgeText, M + badgeW / 2, y + 6, { align: "center" });
    y += 14;
  }

  // Confidence note (only shown when confidence is not High)
  if (data.confidenceMessage && data.confidenceLevel?.toLowerCase() !== "high") {
    const confLevel = data.confidenceLevel?.toLowerCase() ?? "low";
    const confColor = confLevel === "medium" ? C.info : C.warning;
    const noteText  = `Prediction confidence: ${data.confidenceLevel ?? "Low"} - ${data.confidenceMessage}`;
    y = maybeNewPage(doc, y, 14);
    const noteLines = doc.splitTextToSize(noteText, CW - 16);
    const noteH = noteLines.length * 4.8 + 10;
    fc(doc, C.primaryLightest);
    dc(doc, C.border);
    doc.setLineWidth(0.2);
    doc.roundedRect(M, y, CW, noteH, 3, 3, "FD");
    fc(doc, confColor);
    doc.roundedRect(M, y, 4, noteH, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    tc(doc, C.textMuted);
    doc.text(noteLines, M + 9, y + 7);
    y += noteH + 10;
  }

  // Interpretation
  if (data.interpretation) {
    y = maybeNewPage(doc, y, 28);
    hRule(doc, y, C.border);
    y += 7;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    tc(doc, C.textDark);
    doc.text("What this means for you", M, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    tc(doc, C.textMid);
    const lines = doc.splitTextToSize(data.interpretation, CW);
    doc.text(lines, M, y);
    y += lines.length * 5.2 + 8;
  }

  // Narrative
  y = maybeNewPage(doc, y, 18);
  hRule(doc, y, C.border);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  tc(doc, C.textMid);
  const narrativeLines = doc.splitTextToSize(data.narrativeSummary, CW);
  doc.text(narrativeLines, M, y);
  y += narrativeLines.length * 5.2 + 10;

  return y;
}

// ── CYCLE HISTORY ─────────────────────────────────────────────────────────────
function drawCycleHistory(doc, data, y) {
  if (!data.cyclesTracked) return y;
  y = maybeNewPage(doc, y, 30);
  y = sectionHeading(doc, "Cycle History", y);

  const rows = data.cyclesNewestFirst.map((c) => {
    const started   = formatDateMed(c.start);
    const periodLen = c.periodLength ? `${c.periodLength} days` : "-";
    const cycleLen  = c.isCurrent
      ? `Day ${c.daysSoFar} (ongoing)`
      : c.cycleLength ? `${c.cycleLength} days` : "-";
    let status, statusTag;
    if (c.isCurrent)             { status = "Ongoing"; statusTag = "info"; }
    else if (c.cycleLength < 21) { status = "Short";   statusTag = "warning"; }
    else if (c.cycleLength > 35) { status = "Long";    statusTag = "warning"; }
    else                         { status = "Normal";  statusTag = "success"; }
    return { started, periodLen, cycleLen, status, statusTag };
  });

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head:   [["Period Started", "Period Length", "Cycle Length", "Status"]],
    body:   rows.map((r) => [r.started, r.periodLen, r.cycleLen, r.status]),
    styles: {
      fontSize: 9,
      cellPadding: { top: 4, right: 6, bottom: 4, left: 6 },
      textColor: [...C.textDark],
      lineColor: [...C.border],
      lineWidth: 0.25,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [...C.primary],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      cellPadding: { top: 5, right: 6, bottom: 5, left: 6 },
    },
    alternateRowStyles: { fillColor: [...C.primaryLightest] },
    columnStyles: {
      0: { cellWidth: 38 },
      1: { cellWidth: 32, halign: "center" },
      2: { cellWidth: 42, halign: "center" },
      3: { cellWidth: 30, halign: "center" },
    },
    didParseCell(hook) {
      if (hook.section !== "body" || hook.column.index !== 3) return;
      const tag = rows[hook.row.index]?.statusTag;
      if (tag === "success") { hook.cell.styles.textColor = [...C.success]; hook.cell.styles.fontStyle = "bold"; }
      else if (tag === "warning") { hook.cell.styles.textColor = [...C.warning]; hook.cell.styles.fontStyle = "bold"; }
      else if (tag === "info")    { hook.cell.styles.textColor = [...C.info];    hook.cell.styles.fontStyle = "bold"; }
    },
  });

  return doc.lastAutoTable.finalY + 14;
}

// ── SYMPTOM LOG ───────────────────────────────────────────────────────────────
function drawSymptomLog(doc, data, y) {
  if (!data.symptomLog.length) return y;
  y = maybeNewPage(doc, y, 30);
  y = sectionHeading(doc, "Symptom Log", y);

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head:   [["Date", "Symptoms", "Notes"]],
    body:   data.symptomLog.slice(0, 90).map((entry) => [
      formatDateMed(entry.date),
      entry.symptoms.length ? entry.symptoms.join(", ") : "-",
      entry.notes || "-",
    ]),
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 3.5, right: 5, bottom: 3.5, left: 5 },
      textColor: [...C.textDark],
      lineColor: [...C.border],
      lineWidth: 0.25,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [...C.primary],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      cellPadding: { top: 4.5, right: 5, bottom: 4.5, left: 5 },
    },
    alternateRowStyles: { fillColor: [...C.primaryLightest] },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 84 },
      2: { cellWidth: CW - 114 },
    },
  });

  return doc.lastAutoTable.finalY + 14;
}

// ── PATTERNS & INSIGHTS ───────────────────────────────────────────────────────
function drawTrends(doc, data, y) {
  const { topSymptoms, regularity, cyclesTracked } = data;
  if (!topSymptoms.length && cyclesTracked < 2) return y;

  y = maybeNewPage(doc, y, 30);
  y = sectionHeading(doc, "Patterns & Insights", y);

  // Pattern insight callout box
  if (data.patternInsight) {
    y = maybeNewPage(doc, y, 18);
    const lines = doc.splitTextToSize(data.patternInsight, CW - 16);
    const boxH  = lines.length * 5.2 + 12;
    fc(doc, C.primaryLightest);
    dc(doc, C.border);
    doc.setLineWidth(0.25);
    doc.roundedRect(M, y, CW, boxH, 3, 3, "FD");
    fc(doc, C.primary);
    doc.roundedRect(M, y, 4, boxH, 2, 2, "F");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9.5);
    tc(doc, C.textMid);
    doc.text(lines, M + 10, y + 7);
    y += boxH + 12;
  }

  // Top symptoms
  if (topSymptoms.length) {
    y = maybeNewPage(doc, y, 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    tc(doc, C.textDark);
    doc.text("Most Frequent Symptoms", M, y);
    y += 8;

    const top8  = topSymptoms.slice(0, 8);
    const colW2 = (CW - 6) / 2;
    top8.forEach(([name, count], i) => {
      const col  = i % 2;
      const rowY = y + Math.floor(i / 2) * 10;
      const x    = M + col * (colW2 + 6);
      if (rowY + 10 > BOTTOM) return;
      // Subtle alternating row tint
      if (Math.floor(i / 2) % 2 === 0) {
        fc(doc, C.primaryLightest);
        doc.rect(x, rowY - 3.5, colW2, 9, "F");
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      tc(doc, C.primary);
      doc.text(`${i + 1}.`, x + 2, rowY + 3);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      tc(doc, C.textMid);
      doc.text(name, x + 9, rowY + 3);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      tc(doc, C.primary);
      doc.text(`${count}×`, x + colW2 - 2, rowY + 3, { align: "right" });
    });
    y += Math.ceil(top8.length / 2) * 10 + 12;
    hRule(doc, y, C.border);
    y += 8;
  }

  // Cycle variability
  if (cyclesTracked >= 2 && regularity?.tier) {
    y = maybeNewPage(doc, y, 22);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    tc(doc, C.textDark);
    doc.text("Cycle Variability", M, y);
    y += 6;
    const { tier, inTypicalRange, range, min, max } = regularity;
    let varText;
    if (tier === "tight") {
      varText = inTypicalRange
        ? `Your cycle lengths have been very consistent - a range of ${range ?? 0} day${range !== 1 ? "s" : ""} across your tracked cycles. This level of consistency makes your period easy to predict.`
        : `Your cycle lengths have been very consistent (varying by only ${range ?? 0} day${range !== 1 ? "s" : ""}), though they fall outside the typical 21–35 day range. That consistency means your cycle is predictable on its own schedule.`;
    } else if (tier === "moderate") {
      varText = inTypicalRange
        ? `Your cycle lengths have varied by about ${range} days (${min}–${max} days). This level of variation is common and generally within a normal range.`
        : `Your cycle lengths have varied by about ${range} days (${min}–${max} days) and fall outside the typical 21–35 day range. Continued logging will help clarify whether this is a stable personal pattern.`;
    } else {
      varText = `Your cycle lengths have varied notably, ranging from ${min} to ${max} days. Cycle irregularity can have many causes including stress, sleep, travel, and hormonal shifts. If this is a consistent pattern, it is worth discussing with a healthcare provider.`;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    tc(doc, C.textMid);
    const varLines = doc.splitTextToSize(varText, CW);
    doc.text(varLines, M, y);
    y += varLines.length * 5 + 10;
  }

  return y;
}

// ── NOTABLE OBSERVATIONS ──────────────────────────────────────────────────────
function drawAlerts(doc, data, y) {
  if (!data.alerts?.length) return y;
  y = maybeNewPage(doc, y, 30);
  y = sectionHeading(doc, "Notable Observations", y);

  for (const alert of data.alerts) {
    const titleLines = doc.splitTextToSize(alert.title, CW - 20);
    const bodyLines  = doc.splitTextToSize(alert.body, CW - 20);
    const boxH = titleLines.length * 5.2 + bodyLines.length * 4.8 + 18;
    y = maybeNewPage(doc, y, boxH + 10);
    fc(doc, C.bgCard);
    dc(doc, C.border);
    doc.setLineWidth(0.4);
    doc.roundedRect(M, y, CW, boxH, 3, 3, "FD");
    fc(doc, C.primary);
    doc.roundedRect(M, y, 4, boxH, 2, 2, "F");
    let ty = y + 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    tc(doc, C.textDark);
    doc.text(titleLines, M + 10, ty);
    ty += titleLines.length * 5.2 + 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    tc(doc, C.textMid);
    doc.text(bodyLines, M + 10, ty);
    y += boxH + 10;
  }

  return y;
}

// ── NEXT STEPS ────────────────────────────────────────────────────────────────
function drawNextSteps(doc, data, y) {
  y = maybeNewPage(doc, y, 42);
  y = sectionHeading(doc, "Next Steps", y);

  const hasOutliers = data.cyclesNewestFirst.some(
    (c) => !c.isCurrent && c.cycleLength != null && (c.cycleLength < 21 || c.cycleLength > 35)
  );

  const bullets = [
    "Keep logging - the more cycle data you have, the more accurate your predictions and pattern insights become.",
    "Watch for changes - if you notice consistent shifts in symptoms, flow intensity, or timing, note them so you can discuss them with a provider.",
  ];
  if (hasOutliers) {
    bullets.push(
      "Consider a provider conversation - some of your cycles fall outside the typical 21–35 day range. A healthcare provider can help clarify whether this is your personal baseline or something worth investigating."
    );
  }

  for (const bullet of bullets) {
    y = maybeNewPage(doc, y, 16);
    fc(doc, C.primary);
    doc.circle(M + 2.5, y - 1, 1.8, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    tc(doc, C.textMid);
    const lines = doc.splitTextToSize(bullet, CW - 10);
    doc.text(lines, M + 8, y);
    y += lines.length * 5.2 + 5;
  }

  return y + 6;
}

// ── DISCLAIMER ────────────────────────────────────────────────────────────────
function drawDisclaimer(doc, y) {
  y = maybeNewPage(doc, y, 28);
  // Soft amber notice box
  const boxH = 28;
  fc(doc, [255, 252, 242]);
  dc(doc, [230, 190, 100]);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, CW, boxH, 3, 3, "FD");
  fc(doc, [210, 155, 45]);
  doc.roundedRect(M, y, 4, boxH, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(140, 100, 15);
  doc.text("Important Notice", M + 10, y + 8);
  const text =
    "This report is generated by Bloom, an educational health-tracking tool. It is intended for personal " +
    "reference and to support conversations with healthcare professionals - it is not a diagnosis, prescription, " +
    "or substitute for medical advice. Predictions and phase estimates are based on your logged data and may not " +
    "reflect your individual physiology. Always consult a qualified healthcare provider for medical guidance.";
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.setTextColor(120, 80, 10);
  const lines = doc.splitTextToSize(text, CW - 16);
  doc.text(lines, M + 10, y + 15);
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
export function generatePDF(data) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setLineWidth(0.25);

  drawCover(doc, data);

  doc.addPage();
  drawPageHeader(doc);
  let y = 22;

  y = drawSummary(doc, data, y);
  y = drawCycleHistory(doc, data, y);
  y = drawSymptomLog(doc, data, y);
  y = drawTrends(doc, data, y);
  y = drawAlerts(doc, data, y);
  y = drawNextSteps(doc, data, y);
  drawDisclaimer(doc, y);

  const totalPages   = doc.getNumberOfPages();
  const contentPages = totalPages - 1;
  stampFooters(doc, 2, contentPages);

  doc.save(`bloom-cycle-report-${data.generatedDate}.pdf`);
}
