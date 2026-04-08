/**
 * pdf-report-data.js - Report Data Builder
 *
 * Collects, normalises, sorts, and summarises all data required for the
 * Bloom cycle report PDF. The PDF renderer (report.js) receives clean, pre-
 * ordered structures and never performs sorting or business logic inline.
 *
 * Sorting contract:
 *   cyclesNewestFirst   - most recent period start first (for history table)
 *   symptomLog          - most recent date first (for symptom table)
 *   topSymptoms         - descending by occurrence count (for trends section)
 *   alerts              - ordered by severity (cycle outliers before lateness)
 */

// ── Sorting utilities (exported for testing) ──────────────────────────────────

/** Sort ISO date strings descending (most recent first). */
export function sortDatesDesc(dates) {
  return [...dates].sort((a, b) => b.localeCompare(a));
}

/** Sort ISO date strings ascending (oldest first). */
export function sortDatesAsc(dates) {
  return [...dates].sort((a, b) => a.localeCompare(b));
}

/**
 * Sort an array of objects by a date-valued field, descending.
 * @param {Object[]} records
 * @param {string}   field  - key that holds an ISO date string
 */
export function sortRecordsDesc(records, field = "date") {
  return [...records].sort((a, b) =>
    String(b[field] || "").localeCompare(String(a[field] || ""))
  );
}

/**
 * Sort an array of objects by a date-valued field, ascending.
 */
export function sortRecordsAsc(records, field = "date") {
  return [...records].sort((a, b) =>
    String(a[field] || "").localeCompare(String(b[field] || ""))
  );
}

/**
 * Sort a symptom-frequency map's entries descending by count.
 * Returns [ [symptomLabel, count], … ]
 */
export function sortByFrequencyDesc(freqMap) {
  return Object.entries(freqMap).sort(([, a], [, b]) => b - a);
}

// ── Date helpers (module-private) ─────────────────────────────────────────────

function daysBetween(isoA, isoB) {
  return Math.round(
    (new Date(isoB + "T00:00:00") - new Date(isoA + "T00:00:00")) / 86_400_000
  );
}

function addDays(isoDate, n) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoToKey(d);
}

function isoToKey(dateObj) {
  const y  = dateObj.getFullYear();
  const m  = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function todayKey() {
  return isoToKey(new Date());
}

// ── Flow helpers ──────────────────────────────────────────────────────────────

function isPeriodFlow(flow) {
  return ["spotting", "light", "medium", "heavy"].includes(
    String(flow || "").toLowerCase()
  );
}

// ── Period-start detection ────────────────────────────────────────────────────
// A period "start" is a day with period flow that has no period flow the day
// before it. This mirrors the logic in phase.js and report.js exactly.

function getPeriodStarts(logsByDate) {
  const allDays = Object.keys(logsByDate || {})
    .filter((d) => isPeriodFlow(logsByDate[d]?.flow))
    .sort();
  const daySet = new Set(allDays);
  return allDays.filter((d) => !daySet.has(addDays(d, -1)));
}

// ── Period-length computation ─────────────────────────────────────────────────
// Count consecutive logged period-flow days starting from `start`.
// Caps at 14 to guard against data gaps that could produce unrealistic values.

function computePeriodLength(start, logsByDate) {
  let n = 0;
  let d = start;
  while (isPeriodFlow(logsByDate[d]?.flow) && n < 14) {
    n++;
    d = addDays(d, 1);
  }
  return n || null;
}

// ── Cycle regularity ──────────────────────────────────────────────────────────

function computeRegularity(cycleLengths, avgCycleLength) {
  if (cycleLengths.length < 2) {
    return {
      label: "Not enough data", badgeLabel: "Not enough data",
      tier: null, inTypicalRange: null, range: null, min: null, max: null,
    };
  }
  const min          = Math.min(...cycleLengths);
  const max          = Math.max(...cycleLengths);
  const range        = max - min;
  const isInRange    = avgCycleLength != null && avgCycleLength >= 21 && avgCycleLength <= 35;
  const tier         = range <= 3 ? "tight" : range <= 7 ? "moderate" : "loose";
  const longerCycle  = avgCycleLength != null && avgCycleLength > 35;

  let label, badgeLabel;
  if (tier === "tight") {
    if (isInRange) {
      label = "Very regular"; badgeLabel = "Very regular";
    } else if (longerCycle) {
      label = "Consistent (longer than typical range)"; badgeLabel = "Consistent";
    } else {
      label = "Consistent (shorter than typical range)"; badgeLabel = "Consistent";
    }
  } else if (tier === "moderate") {
    if (isInRange) {
      label = "Regular"; badgeLabel = "Regular";
    } else if (longerCycle) {
      label = "Fairly consistent (longer than typical range)"; badgeLabel = "Fairly consistent";
    } else {
      label = "Fairly consistent (shorter than typical range)"; badgeLabel = "Fairly consistent";
    }
  } else {
    label = "Irregular"; badgeLabel = "Irregular";
  }

  return { label, badgeLabel, tier, inTypicalRange: isInRange, range, min, max };
}

// ── Symptom frequency map ─────────────────────────────────────────────────────

function buildSymptomFrequency(logsByDate) {
  const freq = {};
  for (const log of Object.values(logsByDate)) {
    if (Array.isArray(log.symptoms)) {
      for (const s of log.symptoms) {
        if (s) freq[s] = (freq[s] || 0) + 1;
      }
    }
  }
  return freq;
}

// ── Narrative summary ─────────────────────────────────────────────────────────

function buildNarrative(d) {
  if (!d.cyclesTracked) {
    return (
      "No period data has been logged yet. " +
      "Open the Calendar tab and log your period days to see your personalised summary here."
    );
  }

  const parts = [];

  if (d.avgCycleLength) {
    parts.push(
      `Your average cycle length is ${d.avgCycleLength} days` +
      (d.avgPeriodLength ? `, with periods typically lasting around ${d.avgPeriodLength} days` : "") +
      "."
    );
  }

  if (d.regularity?.tier) {
    const { tier, inTypicalRange, range, min, max } = d.regularity;
    if (tier === "tight") {
      if (inTypicalRange) {
        parts.push("Your cycle has been very consistent - your period tends to arrive on a predictable schedule.");
      } else {
        parts.push(
          "Your cycle is highly consistent and follows a reliable pattern - it falls outside the typical 21-35 day range, " +
          "but its consistency means it is predictable for you specifically."
        );
      }
    } else if (tier === "moderate") {
      if (inTypicalRange) {
        parts.push(`Your cycle lengths have varied by up to ${range} days, which is within a normal range for most people.`);
      } else {
        parts.push(
          `Your cycle falls outside the typical 21-35 day range and shows some variation (${min}-${max} days). ` +
          `Tracking over time will help clarify whether this is a stable pattern for you.`
        );
      }
    } else {
      parts.push(
        `Your cycle has shown notable variability, with lengths ranging from ${min} to ${max} days. ` +
        `Some variation is normal, but if the pattern is persistent it may be worth mentioning to your healthcare provider.`
      );
    }
  }

  if (d.currentPhase && d.currentPhase !== "unknown" && d.confidenceLevel?.toLowerCase() !== "low") {
    const phaseDesc = {
      menstrual:  "You are currently in your menstrual phase.",
      follicular: "You are currently in your follicular phase, when energy often starts to rise.",
      ovulation:  "You are currently around your ovulation window.",
      luteal:     "You are currently in your luteal phase.",
    };
    if (phaseDesc[d.currentPhase]) parts.push(phaseDesc[d.currentPhase]);
  }

  if (d.nextPeriodDate) {
    const today      = todayKey();
    const daysUntil  = daysBetween(today, d.nextPeriodDate);
    if (daysUntil > 1) {
      parts.push(
        `Your next period is expected around ${formatDateLong(d.nextPeriodDate)} - approximately ${daysUntil} day${daysUntil !== 1 ? "s" : ""} away.`
      );
    } else if (daysUntil === 0 || daysUntil === 1) {
      parts.push("Your period is expected very soon based on your cycle history.");
    } else {
      const late = Math.abs(daysUntil);
      parts.push(
        `Your period is approximately ${late} day${late !== 1 ? "s" : ""} past its expected date based on your average cycle length. ` +
        `This can happen for many reasons including stress, travel, or hormonal changes.`
      );
    }
  }

  return parts.join(" ");
}

// ── Alert / flag detection ────────────────────────────────────────────────────

function buildAlerts({ completedCycles, nextPeriodDate }) {
  const alerts = [];

  const outliers = completedCycles.filter(
    (c) => c.cycleLength != null && (c.cycleLength < 21 || c.cycleLength > 35)
  );
  if (outliers.length) {
    alerts.push({
      title: "Cycle length outside typical range",
      body:
        `${outliers.length} of your logged cycle${outliers.length !== 1 ? "s" : ""} fell outside the typical 21-35 day range. ` +
        `This is worth mentioning to your healthcare provider, especially if it is a recurring pattern.`,
    });
  }

  if (nextPeriodDate) {
    const today    = todayKey();
    const daysLate = daysBetween(nextPeriodDate, today);
    if (daysLate >= 5) {
      alerts.push({
        title: "Period may be later than expected",
        body:
          `Based on your average cycle length, your period is approximately ${daysLate} day${daysLate !== 1 ? "s" : ""} past its expected date. ` +
          `Stress, travel, illness, and other factors can delay a period. If you are concerned, a pregnancy test or a conversation with your doctor is a good next step.`,
      });
    }
  }

  return alerts;
}

// ── "What This Means For You" interpretation ─────────────────────────────────
// 3-4 sentences interpreting consistency, length context, and notable patterns.

function buildInterpretation(d) {
  if (!d.cyclesTracked) return null;
  const { avgCycleLength, avgPeriodLength, regularity, topSymptoms, dayInCycle, currentPhase } = d;
  const parts = [];

  // Consistency + range context
  if (regularity?.tier === "tight") {
    if (regularity.inTypicalRange) {
      parts.push(
        "Your cycle is highly consistent and falls within the typical range - this is one of the clearest signs of a stable, predictable pattern."
      );
    } else if (avgCycleLength > 35) {
      parts.push(
        `Your cycle runs longer than the typical 21-35 day range, but it is highly consistent - it follows a reliable rhythm that is your own normal, even if it differs from textbook timing.`
      );
    } else {
      parts.push(
        `Your cycle is shorter than the typical range but highly consistent - it follows a reliable pattern that is your own normal.`
      );
    }
  } else if (regularity?.tier === "moderate") {
    if (regularity.inTypicalRange) {
      parts.push(
        "Your cycle falls within the typical 21-35 day range with some natural month-to-month variation - this is a common and healthy pattern."
      );
    } else {
      parts.push(
        "Your cycle is outside the typical range and shows some variation from cycle to cycle - continued logging will help clarify whether this is a stable baseline for you."
      );
    }
  } else if (regularity?.tier === "loose") {
    parts.push(
      "Your cycle lengths have varied considerably across your tracked cycles. Some variation is normal, but a wide range over time may be worth discussing with your doctor."
    );
  }

  // Period length context
  if (avgPeriodLength) {
    if (avgPeriodLength <= 3) {
      parts.push(`Your periods are on the shorter side at around ${avgPeriodLength} days, which is within the normal range for many people.`);
    } else if (avgPeriodLength <= 6) {
      parts.push(`Your periods typically last about ${avgPeriodLength} days, which is within the typical range.`);
    } else {
      parts.push(`Your periods average about ${avgPeriodLength} days, which is on the longer side - if paired with heavy flow, this is worth noting when you speak with your provider.`);
    }
  }

  // Day-in-cycle context for longer cycles
  if (dayInCycle && dayInCycle > 28 && avgCycleLength > 35) {
    parts.push(
      `Being on day ${dayInCycle} of your cycle is completely expected given your longer cycle pattern - this is not a sign that something is wrong.`
    );
  }

  // Symptom note
  if (topSymptoms?.length >= 3) {
    const top3 = topSymptoms.slice(0, 3).map(([s]) => s.toLowerCase()).join(", ");
    parts.push(
      `Your most frequently logged symptoms - ${top3} - may be worth discussing with your provider if they are affecting your daily life.`
    );
  }

  return parts.slice(0, 4).join(" ") || null;
}

// ── Standout pattern insight (top of Insights section) ───────────────────────
// A single sentence synthesising the user's most notable pattern.

function buildPatternInsight(d) {
  if (!d.cyclesTracked || d.cyclesTracked < 2) return null;
  const { regularity, avgCycleLength, topSymptoms } = d;
  if (!regularity?.tier || regularity.tier === null) return null;

  if (regularity.tier === "tight" && !regularity.inTypicalRange && avgCycleLength > 35) {
    return (
      "Your cycle is longer than average but highly consistent - this makes it predictable even if it doesn't follow typical timing, and is likely your body's natural rhythm."
    );
  }
  if (regularity.tier === "tight" && !regularity.inTypicalRange && avgCycleLength < 21) {
    return (
      "Your cycle is shorter than average but very consistent - this predictable pattern is likely your body's natural rhythm, even though it differs from typical ranges."
    );
  }
  if (regularity.tier === "tight" && regularity.inTypicalRange) {
    return (
      "Your cycle is both regular and within the typical range - this is one of the clearest signs of a stable, predictable pattern."
    );
  }
  if (regularity.tier === "loose") {
    if (topSymptoms?.length >= 2) {
      return (
        "Your cycle has shown notable variation alongside recurring symptoms - tracking both together gives your doctor the clearest picture of what is happening."
      );
    }
    return (
      "Your cycle has been variable - continuing to log consistently will help reveal whether this is a stable pattern or something that shifts over time."
    );
  }
  // moderate
  if (!regularity.inTypicalRange) {
    return (
      "Your cycle is outside the typical 21-35 day range but shows reasonable consistency - with more data, a clearer personal pattern will emerge."
    );
  }
  return (
    "Your cycle falls within the typical range with some natural month-to-month variation - this is a common and healthy pattern."
  );
}

// ── Date formatters (exported for use in report.js and the HTML preview) ──────

export function formatDateLong(isoDate) {
  if (!isoDate) return "-";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

export function formatDateMed(isoDate) {
  if (!isoDate) return "-";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * buildReportData(logsByDate, cycleState, userName?)
 *
 * Assembles all sections of the report from raw log data and the cycle state
 * returned by fetchCycleState() (cycle-state.js). Returns a single plain
 * object - the PDF renderer and the HTML preview both read from this.
 *
 * cycleState shape (from fetchCycleState):
 *   ready, phase, phaseLabel, dayInCycle, avgCycleLength, predictedCycleLength,
 *   confidence {level, windowDays, message}, nextPeriodDate, ovulationDate,
 *   fertileStart, fertileEnd, cyclesLogged, source ("backend"|"local")
 *
 * @param {Object}  logsByDate  - { "YYYY-MM-DD": { date, flow, notes, symptoms[], symptomSeverity } }
 * @param {Object}  cycleState  - result of fetchCycleState(logs) from cycle-state.js
 * @param {string}  [userName]  - optional display name
 * @returns {Object}
 */
export function buildReportData(logsByDate, cycleState, userName = null) {
  // Normalise: cycleState.confidence may be an object {level,windowDays,message}
  // or a legacy string. Always expose a flat confidenceLevel string.
  const cyclePhase = cycleState; // alias for readability below
  const today        = todayKey();
  const periodStarts = getPeriodStarts(logsByDate);

  // ── Build cycle array (chronological order internally) ───────────────────
  const cycles = [];
  for (let i = 0; i < periodStarts.length; i++) {
    const start      = periodStarts[i];
    const nextStart  = periodStarts[i + 1] ?? null;
    const cycleLen   = nextStart ? daysBetween(start, nextStart) : null;
    const periodLen  = computePeriodLength(start, logsByDate);
    const isCurrent  = nextStart === null;

    // Drop clearly erroneous cycle lengths (< 10 or > 120 days) from cloud-
    // merged data that may contain gaps. Current cycle is always kept.
    if (!isCurrent && cycleLen != null && (cycleLen < 10 || cycleLen > 120)) {
      continue;
    }

    cycles.push({
      start,
      nextStart,
      cycleLength:  cycleLen,
      periodLength: periodLen,
      isCurrent,
      daysSoFar:    isCurrent ? daysBetween(start, today) + 1 : null,
    });
  }

  // ── Sorted views ─────────────────────────────────────────────────────────
  // History table: most recent period start first
  const cyclesNewestFirst = sortRecordsDesc(cycles, "start");

  const completedCycles = cycles.filter((c) => !c.isCurrent && c.cycleLength != null);
  const cycleLengths    = completedCycles.map((c) => c.cycleLength);
  const periodLengths   = cycles.map((c) => c.periodLength).filter(Boolean);

  const avgCycleLength = cycleLengths.length
    ? Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length)
    : null;

  const avgPeriodLength = periodLengths.length
    ? Math.round(periodLengths.reduce((a, b) => a + b, 0) / periodLengths.length)
    : null;

  const regularity = computeRegularity(cycleLengths, avgCycleLength);

  // ── Symptom log: most recent first ───────────────────────────────────────
  const symptomLog = sortRecordsDesc(
    Object.entries(logsByDate)
      .filter(([, log]) => log.symptoms?.length > 0 || log.notes)
      .map(([date, log]) => ({
        date,
        symptoms: log.symptoms || [],
        notes:    log.notes    || "",
        severity: log.symptomSeverity || {},
      })),
    "date"
  );

  // ── Symptom frequency: descending by count ────────────────────────────────
  const topSymptoms = sortByFrequencyDesc(buildSymptomFrequency(logsByDate));

  // ── Phase & prediction values from cycleState ────────────────────────────
  const currentPhase        = cyclePhase?.phase              ?? "unknown";
  const phaseLabel          = cyclePhase?.phaseLabel         ?? null;
  const dayInCycle          = cyclePhase?.dayInCycle         ?? null;
  const nextPeriodDate      = cyclePhase?.nextPeriodDate     ?? null;
  const ovulationDate       = cyclePhase?.ovulationDate      ?? null;
  const fertileStart        = cyclePhase?.fertileStart       ?? null;
  const fertileEnd          = cyclePhase?.fertileEnd         ?? null;
  const predictedCycleLength= cyclePhase?.predictedCycleLength ?? null;
  const source              = cyclePhase?.source             ?? "local";

  // confidence may be an object {level, windowDays, message} or a legacy string
  const rawConf        = cyclePhase?.confidence ?? "low";
  const confidenceLevel   = (typeof rawConf === "object" ? rawConf.level  : rawConf) ?? "Low";
  const confidenceMessage = (typeof rawConf === "object" ? rawConf.message : null);
  // Keep the full object for the PDF generator
  const confidence = rawConf;

  const lastPeriodStart = periodStarts.length
    ? periodStarts[periodStarts.length - 1]
    : null;

  const cyclesTracked = periodStarts.length;

  // ── Narrative, interpretation, alerts ────────────────────────────────────
  const narrativePayload = {
    cyclesTracked, avgCycleLength, avgPeriodLength, regularity,
    lastPeriodStart, nextPeriodDate, currentPhase, phaseLabel,
    confidence, confidenceLevel, dayInCycle,
  };

  const narrativeSummary = buildNarrative(narrativePayload);

  const interpretationPayload = {
    cyclesTracked, avgCycleLength, avgPeriodLength, regularity,
    topSymptoms, dayInCycle, currentPhase,
  };

  const interpretation  = buildInterpretation(interpretationPayload);
  const patternInsight  = buildPatternInsight({ cyclesTracked, regularity, avgCycleLength, topSymptoms });

  const alerts = buildAlerts({ completedCycles, nextPeriodDate });

  return {
    // Meta
    generatedDate:    today,
    userName,

    // Summary stats
    avgCycleLength,
    avgPeriodLength,
    predictedCycleLength,
    cyclesTracked,
    lastPeriodStart,
    nextPeriodDate,
    ovulationDate,
    fertileStart,
    fertileEnd,
    regularity,
    currentPhase,
    phaseLabel,
    confidence,
    confidenceLevel,
    confidenceMessage,
    dayInCycle,
    source,           // "backend" (ML) or "local" (rule-based)

    // Pre-sorted tables (renderer must NOT re-sort these)
    cyclesNewestFirst,   // history table  - most recent first
    symptomLog,          // symptom table  - most recent first
    topSymptoms,         // trends section - highest frequency first

    // Prose
    narrativeSummary,
    interpretation,    // "What This Means For You" - 3-4 interpretive sentences
    patternInsight,    // standout single-sentence insight for trends section

    // Alerts (only populated when warranted)
    alerts,
  };
}
