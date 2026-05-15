export function normalizeCustomSymptomText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function sanitizeCustomSymptomText(text, max = 80) {
  return String(text || "")
    .replace(/\0/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max)
    .trim();
}

export function sanitizeCustomSymptomNote(note, max = 160) {
  return String(note || "")
    .replace(/\0/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max)
    .trim();
}

export function normalizeCustomSymptomDisplayText(text, max = 80) {
  const cleaned = sanitizeCustomSymptomText(text, max);
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function customSymptomLooksUrgent(text) {
  const t = normalizeCustomSymptomText(text);
  if (!t) return false;
  return /\b(faint|fainted|fainting|passed out|passing out|pass out|trouble breathing|can't breathe|cant breathe|cannot breathe|shortness of breath|severe pain|very heavy bleeding|heavy bleeding|chest pain)\b/.test(t);
}

export function collectCustomSymptomRecurrence(logsByDate, days = 30, fromDate = new Date()) {
  const end = new Date(fromDate);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(0, days - 1));

  const map = new Map();

  for (const [dateKey, log] of Object.entries(logsByDate || {})) {
    const entryDate = new Date(dateKey + "T00:00:00");
    if (isNaN(entryDate.getTime()) || entryDate < start || entryDate > end) continue;

    for (const item of log?.otherSymptoms || []) {
      const normalizedText = normalizeCustomSymptomText(item?.text);
      if (!normalizedText) continue;

      if (!map.has(normalizedText)) {
        map.set(normalizedText, {
          normalizedText,
          displayText: normalizeCustomSymptomDisplayText(item?.text),
          count: 0,
          dates: [],
          dateCount: 0,
          firstDate: null,
          lastDate: null,
        });
      }

      const row = map.get(normalizedText);
      row.count += 1;
      row.dates.push(dateKey);
      row.dateCount = new Set(row.dates).size;
      if (!row.firstDate || dateKey < row.firstDate) row.firstDate = dateKey;
      if (!row.lastDate || dateKey > row.lastDate) row.lastDate = dateKey;
      if (!row.displayText && item?.text) row.displayText = normalizeCustomSymptomDisplayText(item.text);
    }
  }

  return [...map.values()].sort((a, b) =>
    b.count !== a.count
      ? b.count - a.count
      : b.lastDate !== a.lastDate
      ? String(b.lastDate || "").localeCompare(String(a.lastDate || ""))
      : a.displayText.localeCompare(b.displayText)
  );
}

export function summarizeCustomSymptoms(
  logsByDate,
  { days = 30, maxItems = 2, fromDate = new Date(), readinessWindowDays = 14 } = {}
) {
  const recurrence = collectCustomSymptomRecurrence(logsByDate, days, fromDate);
  if (!recurrence.length) return [];

  const repeated = recurrence.filter((row) => row.count >= 2).slice(0, Math.max(0, maxItems));
  const insights = repeated.map((row, idx) => {
    const dayPhrase = row.dateCount > 1
      ? ` across ${row.dateCount} recent days`
      : "";
    const message = row.count >= 3
      ? `You've logged "${row.displayText}" ${row.count} times recently${dayPhrase}.`
      : idx % 2 === 0
      ? `You've logged "${row.displayText}" more than once recently${dayPhrase}.`
      : `"${row.displayText}" has come up again in your recent history${dayPhrase}.`;

    return {
      kind: "recurring",
      displayText: row.displayText,
      count: row.count,
      dateCount: row.dateCount,
      firstDate: row.firstDate,
      lastDate: row.lastDate,
      urgent: customSymptomLooksUrgent(row.displayText),
      message,
      guidance: customSymptomLooksUrgent(row.displayText)
        ? "If this symptom feels severe, sudden, or worrying, consider seeking medical advice."
        : row.count >= 3
        ? "If this keeps happening, it may be worth keeping an eye on."
        : "",
    };
  });

  if (insights.length) return insights;

  const top = recurrence[0];
  if (!top?.lastDate) return [];

  const end = new Date(fromDate);
  end.setHours(0, 0, 0, 0);
  const lastDate = new Date(top.lastDate + "T00:00:00");
  const ageDays = Math.round((end - lastDate) / 86400000);
  if (ageDays > readinessWindowDays) return [];

  return [{
    kind: "one_off",
    displayText: top.displayText,
    count: top.count,
    dateCount: top.dateCount,
    firstDate: top.firstDate,
    lastDate: top.lastDate,
    urgent: customSymptomLooksUrgent(top.displayText),
    message: `This has been saved to your symptom history. If "${top.displayText}" comes up again, it may form part of a pattern.`,
    guidance: customSymptomLooksUrgent(top.displayText)
      ? "If this symptom feels severe, sudden, or worrying, consider seeking medical advice."
      : "",
  }];
}

export function buildCustomSymptomInsights(logsByDate, options = {}) {
  return summarizeCustomSymptoms(logsByDate, options);
}
