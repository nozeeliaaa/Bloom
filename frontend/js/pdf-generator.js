/**
 * pdf-generator.js - shared PDF generation for Bloom cycle reports.
 * Imported by report.js (report page) and dashboard.js (direct download).
 */

import { jsPDF }   from "jspdf";
import autoTable   from "jspdf-autotable";
import { formatDateLong, formatDateMed } from "./pdf-report-data.js";

// ── Colour palette ─────────────────────────────────────────────────────────────
const C = {
  primary:      [212, 116, 154],
  primaryDark:  [170,  78, 118],
  primaryDeep:  [140,  58,  98],
  primaryLight: [228, 175, 205],
  primaryPale:  [250, 238, 245],
  white:        [255, 255, 255],
  textDark:     [ 42,  24,  44],
  textMid:      [ 85,  58,  88],
  textMuted:    [138, 108, 138],
  divider:      [218, 192, 213],
  success:      [ 68, 138,  90],
  warning:      [176,  95,  35],
  info:         [ 78, 112, 172],
};

// ── Layout constants ───────────────────────────────────────────────────────────
const PW     = 210;
const PH     = 297;
const M      = 18;
const CW     = PW - M * 2;
const BOTTOM = 272;

// ── Low-level helpers ──────────────────────────────────────────────────────────
const tc = (doc, c) => doc.setTextColor(...c);
const fc = (doc, c) => doc.setFillColor(...c);
const dc = (doc, c) => doc.setDrawColor(...c);

function hRule(doc, y, shade = C.divider) {
  dc(doc, shade);
  doc.setLineWidth(0.25);
  doc.line(M, y, PW - M, y);
  return y + 1;
}

function maybeNewPage(doc, y, needed = 40) {
  if (y + needed > BOTTOM) { doc.addPage(); return 24; }
  return y;
}

function sectionHeading(doc, label, y) {
  y = maybeNewPage(doc, y, 20);
  fc(doc, C.primary);
  doc.roundedRect(M, y - 4, 4, 13, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  tc(doc, C.primaryDark);
  doc.text(label.toUpperCase(), M + 8, y + 5);
  return y + 16;
}

function stampFooters(doc, firstContentPage, totalContent) {
  for (let p = firstContentPage; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p);
    const contentPageNum = p - firstContentPage + 1;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    tc(doc, C.textMuted);
    doc.text("Bloom - Personal Cycle Report", M, PH - 7);
    doc.text(`Page ${contentPageNum} of ${totalContent}`, PW - M, PH - 7, { align: "right" });
  }
}

// ── Cover ──────────────────────────────────────────────────────────────────────
function drawCover(doc, data) {
  const coverH = 158;

  fc(doc, C.primaryDeep);
  doc.rect(0, 0, PW, coverH, "F");

  fc(doc, C.primaryDark);
  doc.circle(PW - 22, 36, 58, "F");
  fc(doc, C.primary);
  doc.circle(PW - 22, 36, 44, "F");
  fc(doc, C.primaryDeep);
  doc.circle(16, coverH + 4, 42, "F");
  fc(doc, [158, 72, 112]);
  doc.circle(16, coverH + 4, 28, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(56);
  tc(doc, C.white);
  doc.text("bloom", PW / 2, 76, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14.5);
  tc(doc, [245, 215, 232]);
  doc.text("Personal Cycle Report", PW / 2, 96, { align: "center" });

  dc(doc, [255, 255, 255]);
  doc.setLineWidth(0.35);
  doc.line(M + 28, 106, PW - M - 28, 106);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  tc(doc, [232, 195, 218]);
  doc.text(`Generated ${formatDateLong(data.generatedDate)}`, PW / 2, 116, { align: "center" });

  if (data.userName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    tc(doc, C.white);
    doc.text(`For ${data.userName}`, PW / 2, 130, { align: "center" });
  }

  const belowY = coverH + 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  tc(doc, C.textMid);
  const tagline = doc.splitTextToSize(
    "Your personal menstrual health insights - for personal review or sharing with a healthcare provider.",
    CW - 16
  );
  doc.text(tagline, PW / 2, belowY, { align: "center" });

  if (data.cyclesTracked > 0) {
    const tilesY = belowY + tagline.length * 5.2 + 12;
    const tileW  = (CW - 8) / 3;
    const tileH  = 28;
    const quickStats = [
      { label: "Avg Cycle",      value: data.avgCycleLength ? `${data.avgCycleLength} days` : "-" },
      { label: "Cycles Tracked", value: String(data.cyclesTracked) },
      { label: "Regularity",     value: data.regularity?.label ?? "-" },
    ];
    quickStats.forEach(({ label, value }, i) => {
      const x = M + i * (tileW + 4);
      fc(doc, C.primaryPale);
      dc(doc, C.divider);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, tilesY, tileW, tileH, 3, 3, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      tc(doc, C.primaryDark);
      doc.text(value, x + tileW / 2, tilesY + 11, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      tc(doc, C.textMuted);
      doc.text(label.toUpperCase(), x + tileW / 2, tilesY + 20, { align: "center" });
    });
  }

  fc(doc, C.primaryPale);
  doc.rect(0, PH - 14, PW, 14, "F");
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  tc(doc, C.textMuted);
  doc.text(
    "Bloom - Educational Health Tracker  •  Not a medical document  •  For personal use only",
    PW / 2, PH - 5.5, { align: "center" }
  );
}

// ── Summary ────────────────────────────────────────────────────────────────────
function drawSummary(doc, data, y) {
  y = sectionHeading(doc, "Your Cycle at a Glance", y);

  const gap   = 4;
  const tileW = (CW - gap * 2) / 3;
  const tileH = 30;

  const phase = data.phaseLabel ?? (data.currentPhase !== "unknown" ? data.currentPhase : null);

  const tiles = [
    { label: "Avg Cycle Length",     value: data.avgCycleLength  ? `${data.avgCycleLength} days`  : "-", sub: data.avgCycleLength  ? "per completed cycle" : "need 2+ cycles" },
    { label: "Avg Period Length",     value: data.avgPeriodLength ? `${data.avgPeriodLength} days` : "-", sub: data.avgPeriodLength ? "days of bleeding"    : "need more data" },
    { label: "Cycles Tracked",        value: String(data.cyclesTracked || 0), sub: data.cyclesTracked === 1 ? "cycle logged" : "cycles logged" },
    { label: "Last Period",           value: data.lastPeriodStart ? formatDateMed(data.lastPeriodStart) : "-", sub: "period start date" },
    { label: "Next Period Expected",  value: data.nextPeriodDate  ? formatDateMed(data.nextPeriodDate)  : "-", sub: data.nextPeriodDate ? "estimated" : "need more data" },
    {
      label: "Current Phase",
      value: phase ?? "-",
      sub: (() => {
        if (!data.dayInCycle) return data.confidence === "low" ? "need more data" : "";
        const base = `Day ${data.dayInCycle} of your cycle`;
        if (data.avgCycleLength > 35) return `${base} (longer cycle pattern)`;
        if (data.avgCycleLength < 21) return `${base} (shorter cycle pattern)`;
        return base;
      })(),
    },
  ];

  tiles.forEach(({ label, value, sub }, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const x   = M + col * (tileW + gap);
    const ty  = y + row * (tileH + gap);

    fc(doc, C.primaryPale);
    dc(doc, C.divider);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, ty, tileW, tileH, 3, 3, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    tc(doc, C.primaryDark);
    doc.text(value, x + tileW / 2, ty + 12, { align: "center", maxWidth: tileW - 4 });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    tc(doc, C.textMuted);
    doc.text(label.toUpperCase(), x + tileW / 2, ty + 20, { align: "center" });
    if (sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      tc(doc, C.textMuted);
      doc.text(sub, x + tileW / 2, ty + 26, { align: "center" });
    }
  });

  y += 2 * (tileH + gap) + 10;

  if (data.regularity?.tier) {
    y = maybeNewPage(doc, y, 16);
    const { tier, inTypicalRange, badgeLabel } = data.regularity;
    const badgeColor = tier === "loose" ? C.warning : inTypicalRange ? C.success : C.info;
    const badgeText  = (badgeLabel ?? "").toUpperCase();
    const badgeW     = Math.max(32, badgeText.length * 2.1 + 8);
    fc(doc, badgeColor);
    doc.roundedRect(M, y, badgeW, 8, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    tc(doc, C.white);
    doc.text(badgeText, M + badgeW / 2, y + 5.5, { align: "center" });
    y += 13;
  }

  if (data.interpretation) {
    y = maybeNewPage(doc, y, 28);
    hRule(doc, y);
    y += 7;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    tc(doc, C.primaryDark);
    doc.text("What This Means For You", M, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    tc(doc, C.textMid);
    const interpLines = doc.splitTextToSize(data.interpretation, CW);
    doc.text(interpLines, M, y);
    y += interpLines.length * 5.2 + 8;
  }

  y = maybeNewPage(doc, y, 20);
  hRule(doc, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  tc(doc, C.textMid);
  const narrativeLines = doc.splitTextToSize(data.narrativeSummary, CW);
  doc.text(narrativeLines, M, y);
  y += narrativeLines.length * 5.2 + 10;

  return y;
}

// ── Cycle history table ────────────────────────────────────────────────────────
function drawCycleHistory(doc, data, y) {
  if (!data.cyclesTracked) return y;
  y = maybeNewPage(doc, y, 30);
  y = sectionHeading(doc, "Cycle History", y);

  const rows = data.cyclesNewestFirst.map((c) => {
    const started   = formatDateMed(c.start);
    const periodLen = c.periodLength ? `${c.periodLength} days` : "-";
    const cycleLen  = c.isCurrent ? `Day ${c.daysSoFar} (ongoing)` : c.cycleLength ? `${c.cycleLength} days` : "-";
    let status, statusTag;
    if (c.isCurrent)          { status = "Ongoing"; statusTag = "info"; }
    else if (c.cycleLength < 21) { status = "Short";   statusTag = "warning"; }
    else if (c.cycleLength > 35) { status = "Long";    statusTag = "warning"; }
    else                         { status = "Normal";  statusTag = "success"; }
    return { started, periodLen, cycleLen, status, statusTag };
  });

  autoTable(doc, {
    startY: y, margin: { left: M, right: M },
    head:   [["Period Started", "Period Length", "Cycle Length", "Status"]],
    body:   rows.map((r) => [r.started, r.periodLen, r.cycleLen, r.status]),
    styles: { fontSize: 9, cellPadding: { top: 3.5, right: 6, bottom: 3.5, left: 6 }, textColor: [...C.textDark], lineColor: [...C.divider], lineWidth: 0.2, overflow: "linebreak" },
    headStyles: { fillColor: [...C.primary], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: [...C.primaryPale] },
    columnStyles: { 0: { cellWidth: 36 }, 1: { cellWidth: 30, halign: "center" }, 2: { cellWidth: 40, halign: "center" }, 3: { cellWidth: 28, halign: "center" } },
    didParseCell(hook) {
      if (hook.section !== "body" || hook.column.index !== 3) return;
      const { statusTag } = rows[hook.row.index];
      if (statusTag === "success") { hook.cell.styles.textColor = [...C.success]; hook.cell.styles.fontStyle = "bold"; }
      else if (statusTag === "warning") { hook.cell.styles.textColor = [...C.warning]; hook.cell.styles.fontStyle = "bold"; }
      else if (statusTag === "info")    { hook.cell.styles.textColor = [...C.info];    hook.cell.styles.fontStyle = "bold"; }
    },
  });

  return doc.lastAutoTable.finalY + 12;
}

// ── Symptom log table ──────────────────────────────────────────────────────────
function drawSymptomLog(doc, data, y) {
  if (!data.symptomLog.length) return y;
  y = maybeNewPage(doc, y, 30);
  y = sectionHeading(doc, "Symptom Log", y);

  autoTable(doc, {
    startY: y, margin: { left: M, right: M },
    head:   [["Date", "Symptoms", "Notes"]],
    body:   data.symptomLog.slice(0, 90).map((entry) => [
      formatDateMed(entry.date),
      entry.symptoms.length ? entry.symptoms.join(", ") : "-",
      entry.notes || "-",
    ]),
    styles: { fontSize: 8.5, cellPadding: { top: 3, right: 5, bottom: 3, left: 5 }, textColor: [...C.textDark], lineColor: [...C.divider], lineWidth: 0.2, overflow: "linebreak" },
    headStyles: { fillColor: [...C.primary], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: [...C.primaryPale] },
    columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 82 }, 2: { cellWidth: CW - 112 } },
  });

  return doc.lastAutoTable.finalY + 12;
}

// ── Patterns & insights ────────────────────────────────────────────────────────
function drawTrends(doc, data, y) {
  const { topSymptoms, regularity, cyclesTracked } = data;
  if (!topSymptoms.length && cyclesTracked < 2) return y;

  y = maybeNewPage(doc, y, 30);
  y = sectionHeading(doc, "Patterns & Insights", y);

  if (data.patternInsight) {
    y = maybeNewPage(doc, y, 16);
    const insightLines = doc.splitTextToSize(data.patternInsight, CW - 14);
    const boxH = insightLines.length * 5.2 + 10;
    fc(doc, C.primaryPale);
    dc(doc, C.divider);
    doc.setLineWidth(0.2);
    doc.roundedRect(M, y, CW, boxH, 3, 3, "FD");
    fc(doc, C.primary);
    doc.roundedRect(M, y, 3.5, boxH, 1, 1, "F");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9.5);
    tc(doc, C.primaryDark);
    doc.text(insightLines, M + 9, y + 6);
    y += boxH + 10;
  }

  if (topSymptoms.length) {
    y = maybeNewPage(doc, y, 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    tc(doc, C.primaryDark);
    doc.text("Most Frequent Symptoms", M, y);
    y += 7;
    const top8  = topSymptoms.slice(0, 8);
    const colW2 = (CW - 4) / 2;
    top8.forEach(([name, count], i) => {
      const col  = i % 2;
      const rowY = y + Math.floor(i / 2) * 8;
      const x    = M + col * (colW2 + 4);
      if (rowY + 8 > BOTTOM) return;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      tc(doc, C.textMuted);
      doc.text(`${i + 1}.`, x, rowY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      tc(doc, C.textMid);
      doc.text(name, x + 7, rowY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      tc(doc, C.primary);
      doc.text(`${count}×`, x + colW2 - 4, rowY, { align: "right" });
    });
    y += Math.ceil(top8.length / 2) * 8 + 10;
    hRule(doc, y, C.primaryPale);
    y += 7;
  }

  if (cyclesTracked >= 2 && regularity?.tier) {
    y = maybeNewPage(doc, y, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    tc(doc, C.primaryDark);
    doc.text("Cycle Variability", M, y);
    y += 6;
    const { tier, inTypicalRange, range, min, max } = regularity;
    let varText;
    if (tier === "tight") {
      varText = inTypicalRange
        ? `Your cycle lengths have been very consistent - a range of ${range ?? 0} day${range !== 1 ? "s" : ""} across your tracked cycles. This level of consistency makes your period easy to predict.`
        : `Your cycle lengths have been very consistent (varying by only ${range ?? 0} day${range !== 1 ? "s" : ""}), though they fall outside the typical 21–35 day range. That consistency means your cycle is predictable on its own schedule - this is likely your personal baseline.`;
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

// ── Notable observations ───────────────────────────────────────────────────────
function drawAlerts(doc, data, y) {
  if (!data.alerts?.length) return y;
  y = maybeNewPage(doc, y, 30);
  y = sectionHeading(doc, "Notable Observations", y);

  for (const alert of data.alerts) {
    const titleLines = doc.splitTextToSize(alert.title, CW - 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    const bodyLines  = doc.splitTextToSize(alert.body, CW - 18);
    const boxH = titleLines.length * 5.2 + bodyLines.length * 4.8 + 16;
    y = maybeNewPage(doc, y, boxH + 8);
    fc(doc, [255, 249, 254]);
    dc(doc, C.primaryLight);
    doc.setLineWidth(0.45);
    doc.roundedRect(M, y, CW, boxH, 3, 3, "FD");
    fc(doc, C.primary);
    doc.roundedRect(M, y, 3.5, boxH, 1, 1, "F");
    let ty = y + 7;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    tc(doc, C.primaryDark);
    doc.text(titleLines, M + 9, ty);
    ty += titleLines.length * 5.2 + 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    tc(doc, C.textMid);
    doc.text(bodyLines, M + 9, ty);
    y += boxH + 9;
  }

  return y;
}

// ── Next steps ─────────────────────────────────────────────────────────────────
function drawNextSteps(doc, data, y) {
  y = maybeNewPage(doc, y, 40);
  y = sectionHeading(doc, "Next Steps", y);

  const hasOutliers = data.cyclesNewestFirst.some(
    (c) => !c.isCurrent && c.cycleLength != null && (c.cycleLength < 21 || c.cycleLength > 35)
  );

  const bullets = [
    "Keep logging - the more cycle data you have, the more accurate your predictions and pattern insights become.",
    "Watch for changes - if you notice consistent shifts in symptoms, flow intensity, or timing from cycle to cycle, note them so you can discuss them with a provider.",
  ];
  if (hasOutliers) {
    bullets.push(
      "Consider a provider conversation - some of your cycles fall outside the typical 21–35 day range. " +
      "This is not necessarily a problem, but a healthcare provider can help you understand what is normal for your body and whether any follow-up is useful."
    );
  }

  for (const bullet of bullets) {
    y = maybeNewPage(doc, y, 14);
    fc(doc, C.primary);
    doc.circle(M + 2.5, y - 1, 1.5, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    tc(doc, C.textMid);
    const lines = doc.splitTextToSize(bullet, CW - 10);
    doc.text(lines, M + 7, y);
    y += lines.length * 5 + 4;
  }

  return y + 6;
}

// ── Disclaimer ─────────────────────────────────────────────────────────────────
function drawDisclaimer(doc, y) {
  y = maybeNewPage(doc, y, 24);
  hRule(doc, y);
  y += 6;
  const text =
    "This report is generated by Bloom, an educational health-tracking tool. It is intended for personal reference " +
    "and to support conversations with healthcare professionals - it is not a diagnosis, prescription, or substitute " +
    "for medical advice. Cycle predictions and phase estimates are based on statistical averages from your logged " +
    "data and may not reflect your individual physiology. Always consult a qualified healthcare provider for medical guidance.";
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.8);
  tc(doc, C.textMuted);
  const lines = doc.splitTextToSize(text, CW);
  doc.text(lines, M, y);
}

// ── Main export ────────────────────────────────────────────────────────────────
export function generatePDF(data) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setLineWidth(0.25);

  drawCover(doc, data);
  doc.addPage();
  let y = 24;

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
