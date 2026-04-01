/**
 * notifications.js - Browser notification system for Bloom
 *
 * Triggers one-per-day browser notifications based on user preferences:
 *   - Period reminder: fires 0-3 days before predicted next period
 *   - Daily logging reminder: fires if today has no log entry
 *   - Fertile window alert: fires when fertile window starts or starts tomorrow
 *
 * Also maintains a persistent in-app inbox (bloom_notification_inbox)
 * so users can review past notifications in the navbar bell panel.
 */

const PREFS_KEY    = "bloom_preferences";
const NOTIFIED_KEY = "bloom_notified";
const INBOX_KEY    = "bloom_notification_inbox";
const INBOX_MAX    = 50; // max notifications to keep

// ─── Inbox helpers ────────────────────────────────────────────────────────────

export function getInbox() {
  try { return JSON.parse(localStorage.getItem(INBOX_KEY)) || []; }
  catch { return []; }
}

function saveInbox(inbox) {
  localStorage.setItem(INBOX_KEY, JSON.stringify(inbox));
}

export function getUnreadCount() {
  return getInbox().filter((n) => !n.read).length;
}

export function markAllRead() {
  const inbox = getInbox().map((n) => ({ ...n, read: true }));
  saveInbox(inbox);
}

export function clearInbox() {
  saveInbox([]);
}

function addToInbox(title, body, id) {
  const inbox = getInbox();
  // Don't duplicate entries with the same id
  if (inbox.some((n) => n.id === id)) return;
  inbox.unshift({ id, title, body, ts: Date.now(), read: false });
  // Trim to max
  if (inbox.length > INBOX_MAX) inbox.splice(INBOX_MAX);
  saveInbox(inbox);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
  catch { return {}; }
}

function getNotified() {
  try { return JSON.parse(localStorage.getItem(NOTIFIED_KEY)) || {}; }
  catch { return {}; }
}

function saveNotified(notified) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified));
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hasNotifiedToday(notified, id) {
  return notified[id] === todayKey();
}

function markNotified(notified, id) {
  notified[id] = todayKey();
  saveNotified(notified);
}

function friendlyDate(dateKey) {
  if (!dateKey) return "";
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function diffDays(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

async function requestPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function sendNotification(title, body, id) {
  // Always save to inbox regardless of browser permission
  addToInbox(title, body, id);

  if (Notification.permission === "granted") {
    new Notification(title, { body, tag: id, icon: "/apple-touch-icon.png" });
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Call this after cycle data is computed.
 * @param {object} cycle       - result from computeCyclePhase()
 * @param {object} logsByDate  - all logs keyed by YYYY-MM-DD
 */
export async function triggerNotifications(cycle, logsByDate) {
  if (!cycle) cycle = {};
  if (!logsByDate) logsByDate = {};

  const prefs = getPrefs();

  // Nothing to do if every toggle is off
  if (!prefs.periodReminder && !prefs.reminders && !prefs.fertileAlert) return;

  // Try to get browser permission (won't block inbox saving)
  await requestPermission();

  const notified  = getNotified();
  const today     = todayKey();
  const discreet  = !!(prefs.discreetNotif || prefs.reminders?.discreetCopy);

  // ─── Period Reminder ──────────────────────────────────────────────────────
  if (prefs.periodReminder && cycle.nextPeriodDate) {
    const daysUntil = diffDays(today, cycle.nextPeriodDate);
    const id        = `period-${cycle.nextPeriodDate}`;

    if (daysUntil >= 0 && daysUntil <= 3 && !hasNotifiedToday(notified, id)) {
      const title = discreet ? "Bloom reminder" : "Period coming up";
      const body  = discreet
        ? "You have a reminder in Bloom. Open the app to view details."
        : daysUntil === 0
          ? `Your period may start today (${friendlyDate(cycle.nextPeriodDate)}). Take care of yourself.`
          : `Your period is expected in ${daysUntil} day${daysUntil !== 1 ? "s" : ""} on ${friendlyDate(cycle.nextPeriodDate)}.`;

      sendNotification(title, body, id);
      markNotified(notified, id);
    }
  }

  // ─── Daily Logging Reminder ───────────────────────────────────────────────
  if (prefs.reminders) {
    const id             = `log-${today}`;
    const hasLoggedToday = !!(logsByDate[today]?.flow || logsByDate[today]?.symptoms?.length);

    if (!hasLoggedToday && !hasNotifiedToday(notified, id)) {
      const title = discreet ? "Bloom reminder" : "Don't forget to log today";
      const body  = discreet
        ? "You have a reminder in Bloom. Open the app to view details."
        : "Take a moment to record your flow and symptoms in Bloom.";

      sendNotification(title, body, id);
      markNotified(notified, id);
    }
  }

  // ─── Period Started? Log it ───────────────────────────────────────────────
  // Fires when the expected period date has arrived or just passed and no flow logged
  if (prefs.periodReminder && cycle.nextPeriodDate) {
    const daysOverdue = diffDays(cycle.nextPeriodDate, today);
    const hasLoggedToday = !!(logsByDate[today]?.flow && logsByDate[today].flow !== "none");
    const id = `log-period-${cycle.nextPeriodDate}`;

    if (daysOverdue >= 0 && daysOverdue <= 5 && !hasLoggedToday && !hasNotifiedToday(notified, id)) {
      const title = discreet ? "Bloom reminder" : "Did your period start?";
      const body  = discreet
        ? "You have a reminder in Bloom. Open the app to view details."
        : daysOverdue === 0
          ? "Your period is expected today. Open Bloom to log your flow."
          : `Your period was expected ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} ago. Don't forget to log it in Bloom.`;

      sendNotification(title, body, id);
      markNotified(notified, id);
    }
  }

  // ─── Fertile Window Alert ─────────────────────────────────────────────────
  if (prefs.fertileAlert && cycle.fertileStart && cycle.fertileEnd) {
    const daysToFertile = diffDays(today, cycle.fertileStart);
    const id            = `fertile-${cycle.fertileStart}`;

    if (daysToFertile >= 0 && daysToFertile <= 1 && !hasNotifiedToday(notified, id)) {
      const title = discreet ? "Bloom reminder" : "Fertile window";
      const body  = discreet
        ? "You have a reminder in Bloom. Open the app to view details."
        : daysToFertile === 0
          ? `Your fertile window starts today! It runs until ${friendlyDate(cycle.fertileEnd)}.`
          : `Your fertile window begins tomorrow (${friendlyDate(cycle.fertileStart)}).`;

      sendNotification(title, body, id);
      markNotified(notified, id);
    }
  }

  // ─── Late / Missed Period Alert ───────────────────────────────────────────
  // Fires independently of prefs (health-relevant) once the period is overdue > 5 days
  if (cycle.nextPeriodDate) {
    const daysLate = diffDays(cycle.nextPeriodDate, today);
    const hasFlowSinceExpected = Object.entries(logsByDate).some(([dk, l]) =>
      dk >= cycle.nextPeriodDate && l?.flow && l.flow !== "none"
    );

    if (!hasFlowSinceExpected) {
      if (daysLate >= 7 && daysLate < 14) {
        const id = `late-period-${cycle.nextPeriodDate}`;
        if (!hasNotifiedToday(notified, id)) {
          const title = discreet ? "Bloom reminder" : "Period is late";
          const body  = discreet
            ? "You have a health reminder in Bloom. Open the app to view details."
            : `Your period is ${daysLate} days late. Open Bloom to log your flow or check your cycle details.`;
          sendNotification(title, body, id);
          markNotified(notified, id);
        }
      } else if (daysLate >= 14) {
        const id = `missed-period-${cycle.nextPeriodDate}`;
        if (!hasNotifiedToday(notified, id)) {
          const title = discreet ? "Bloom reminder" : "Missed period";
          const body  = discreet
            ? "You have a health reminder in Bloom. Open the app to view details."
            : `Your period appears to be ${daysLate} days late. Consider logging any changes and speaking with a healthcare provider if needed.`;
          sendNotification(title, body, id);
          markNotified(notified, id);
        }
      }
    }
  }
}
