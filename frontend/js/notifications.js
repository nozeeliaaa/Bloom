/**
 * notifications.js - Browser notification system + FCM token management
 *
 * Browser notifications (when app is open):
 *   - Period reminder: fires 0-3 days before predicted next period
 *   - Daily logging reminder: fires if today has no log entry
 *   - Fertile window alert: fires when fertile window starts or starts tomorrow
 *
 * FCM (when app is closed):
 *   - registerFCMToken()   - requests permission, gets FCM token, saves to backend
 *   - unregisterFCMToken() - removes FCM token from backend
 *
 * In-app inbox: persistent notification history in localStorage
 */
 
import { getFirebaseMessaging } from "./firebase.js";
import { getToken, onMessage }  from "https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging.js";
import { getIdToken }           from "./auth.js";
import { loadBloomPreferencesLocal } from "./bloom-storage.js";
 
const NOTIFIED_KEY = "bloom_notified";
const INBOX_KEY    = "bloom_notification_inbox";
const INBOX_MAX    = 50;
const FCM_DENIED_LOG_KEY = "bloom_fcm_permission_denied_logged";
const VAPID_KEY    = "BCHfN9IVHQe4ZxOkm5O0AuEVI4VYO056HwDvTL65I7HwfeQE7y7Qj5XFO-mkpOg9SvN0yzjVUlba9RDvbzvDH_o";
const API_BASE     = window.BLOOM_API_BASE || "";
 
// ─── Inbox helpers ─────────────────────────────────────────────────────────────
 
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
  if (inbox.some((n) => n.id === id)) return;
  inbox.unshift({ id, title, body, ts: Date.now(), read: false });
  if (inbox.length > INBOX_MAX) inbox.splice(INBOX_MAX);
  saveInbox(inbox);
}
 
// ─── Internal helpers ──────────────────────────────────────────────────────────
 
function getPrefs() {
  return loadBloomPreferencesLocal();
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

function upcomingDate(dateKey, today = todayKey()) {
  return dateKey && dateKey >= today ? dateKey : null;
}

function pickNextPeriodDate(cycle, today) {
  const direct = upcomingDate(cycle.nextPeriodDate, today);
  if (direct) return direct;
  return (Array.isArray(cycle.futureCycles) ? cycle.futureCycles : [])
    .map((c) => c?.periodStart)
    .filter((d) => d && d >= today)
    .sort()[0] || null;
}

function pickRelevantFertileWindow(cycle, today) {
  const windows = [];
  if (cycle.fertileStart && cycle.fertileEnd) {
    windows.push({ start: cycle.fertileStart, end: cycle.fertileEnd });
  }
  for (const c of Array.isArray(cycle.futureCycles) ? cycle.futureCycles : []) {
    if (c?.fertileWindow?.start && c?.fertileWindow?.end) {
      windows.push({ start: c.fertileWindow.start, end: c.fertileWindow.end });
    }
  }
  return windows
    .filter((w) => w.end >= today)
    .sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}

function pickNextOvulationDate(cycle, today) {
  const direct = upcomingDate(cycle.ovulationDate, today);
  if (direct) return direct;
  return (Array.isArray(cycle.futureCycles) ? cycle.futureCycles : [])
    .map((c) => c?.ovulationDay)
    .filter((d) => d && d >= today)
    .sort()[0] || null;
}
 
async function requestPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}
 
function sendNotification(title, body, id) {
  addToInbox(title, body, id);
  if (Notification.permission === "granted") {
    new Notification(title, { body, tag: id, icon: "/apple-touch-icon.png" });
  }
}
 
// ─── FCM Token Management ──────────────────────────────────────────────────────
 
/**
 * Requests notification permission, gets FCM token, saves it to backend.
 * Call this when the user enables any notification toggle.
 */
export async function registerFCMToken() {
  try {
    const granted = await requestPermission();
    if (!granted) {
      if (!sessionStorage.getItem(FCM_DENIED_LOG_KEY)) {
        sessionStorage.setItem(FCM_DENIED_LOG_KEY, "1");
        console.info("[Bloom FCM] Notifications are disabled in browser settings.");
      }
      return null;
    }
 
    // Register service worker
    const registration = await navigator.serviceWorker.register("/firebaseMessaging-sw.js");
 
    const fcmMessaging = getFirebaseMessaging();
    if (!fcmMessaging) {
      console.warn("[Bloom FCM] Messaging not available.");
      return null;
    }
 
    const token = await getToken(fcmMessaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
 
    if (!token) {
      console.warn("[Bloom FCM] No token received.");
      return null;
    }
 
    // Save token to backend
    const idToken = await getIdToken();
    if (idToken) {
      await fetch(`${API_BASE}/api/notifications/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ token }),
      });
    }
 
    // Listen for foreground messages
    onMessage(fcmMessaging, (payload) => {
      const title = payload.notification?.title || "Bloom";
      const body  = payload.notification?.body  || "";
      const id    = payload.data?.tag || `fcm-${Date.now()}`;
      sendNotification(title, body, id);
    });
 
    console.log("[Bloom FCM] Token registered successfully.");
    return token;
  } catch (err) {
    console.error("[Bloom FCM] Registration failed:", err);
    return null;
  }
}
 
/**
 * Removes the FCM token from the backend.
 * Call this when the user disables all notification toggles.
 */
export async function unregisterFCMToken() {
  try {
    const idToken = await getIdToken();
    if (!idToken) return;
 
    await fetch(`${API_BASE}/api/notifications/token`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${idToken}` },
    });
 
    console.log("[Bloom FCM] Token unregistered.");
  } catch (err) {
    console.error("[Bloom FCM] Unregister failed:", err);
  }
}
 
// ─── Browser notification triggers ────────────────────────────────────────────
 
/**
 * Call this after cycle data is computed.
 * @param {object} cycle       - result from computeCyclePhase()
 * @param {object} logsByDate  - all logs keyed by YYYY-MM-DD
 */
export async function triggerNotifications(cycle, logsByDate) {
  if (!cycle) cycle = {};
  if (!logsByDate) logsByDate = {};
 
  const prefs = getPrefs();
 
  const dailyReminderEnabled = !!prefs.reminders;
  const periodReminderEnabled = !!prefs.periodReminder;
  const fertileAlertEnabled = !!prefs.fertileAlert;

  if (!periodReminderEnabled && !dailyReminderEnabled && !fertileAlertEnabled) return;
 
  await requestPermission();

  const notified  = getNotified();
  const today     = todayKey();
  const discreet  = !!prefs.discreetNotif;
  const nextPeriodDate = pickNextPeriodDate(cycle, today);
  const fertileWindow = pickRelevantFertileWindow(cycle, today);
  const ovulationDate = pickNextOvulationDate(cycle, today);

  // ─── Period Reminder ──────────────────────────────────────────────────────
  const todayHasFlow = !!(logsByDate[today]?.flow && logsByDate[today].flow !== "none");
  const todayHasPeriodDay = Number.isFinite(Number(logsByDate[today]?.periodDay)) && Number(logsByDate[today]?.periodDay) > 0;
  const phaseKey = String(cycle.phase || cycle.currentPhase || "").toLowerCase();
  const cycleDay = Number(cycle.dayInCycle);
  if (
    (periodReminderEnabled || dailyReminderEnabled) &&
    phaseKey === "menstrual" &&
    Number.isFinite(cycleDay) &&
    cycleDay >= 2 &&
    cycleDay <= 8 &&
    !todayHasFlow &&
    !todayHasPeriodDay
  ) {
    const id = `period-check-${today}`;
    if (!hasNotifiedToday(notified, id)) {
      const title = discreet ? "Bloom reminder" : "Still seeing your period?";
      const body = discreet
        ? "You have a reminder in Bloom. Open the app to view details."
        : "Bloom is keeping you in menstrual phase based on your recent period start. Open Bloom to log whether flow is still present.";
      sendNotification(title, body, id);
      markNotified(notified, id);
    }
  }

  if (periodReminderEnabled && nextPeriodDate) {
    const daysUntil = diffDays(today, nextPeriodDate);
    const id        = `period-${nextPeriodDate}`;
 
    if (daysUntil >= 0 && daysUntil <= 3 && !hasNotifiedToday(notified, id)) {
      const body = daysUntil === 0
        ? `Your period may start today (${friendlyDate(nextPeriodDate)}). Take care of yourself.`
        : `Your period is expected in ${daysUntil} day${daysUntil !== 1 ? "s" : ""} on ${friendlyDate(nextPeriodDate)}.`;

      sendNotification("Period coming up", body, id);
      markNotified(notified, id);
    }
  }
 
  // ─── Daily Logging Reminder ─────────────────────────────────────────────────
  if (dailyReminderEnabled) {
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
  if (periodReminderEnabled && nextPeriodDate) {
    const daysOverdue = diffDays(nextPeriodDate, today);
    const hasLoggedToday = !!(logsByDate[today]?.flow && logsByDate[today].flow !== "none");
    const id = `log-period-${nextPeriodDate}`;

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
 
  // ─── Fertile Window Alert ───────────────────────────────────────────────────
  if (fertileAlertEnabled && fertileWindow?.start && fertileWindow?.end) {
    const daysToFertile = diffDays(today, fertileWindow.start);
    const id            = `fertile-${fertileWindow.start}`;
 
    if (daysToFertile <= 1 && today <= fertileWindow.end && !hasNotifiedToday(notified, id)) {
      const body = daysToFertile <= 0
        ? `Your fertile window is active. It runs until ${friendlyDate(fertileWindow.end)}.`
        : `Your fertile window begins tomorrow (${friendlyDate(fertileWindow.start)}).`;

      sendNotification("Fertile window", body, id);
      markNotified(notified, id);
    }
  }

  // Ovulation-day alert - paired with fertile alerts because it is part of the same prediction set.
  if (fertileAlertEnabled && ovulationDate) {
    const daysToOvulation = diffDays(today, ovulationDate);
    const id = `ovulation-${ovulationDate}`;

    if (daysToOvulation >= 0 && daysToOvulation <= 1 && !hasNotifiedToday(notified, id)) {
      const body = daysToOvulation === 0
        ? "Estimated ovulation is today. Predictions can shift if your cycle changes."
        : `Estimated ovulation is tomorrow (${friendlyDate(ovulationDate)}).`;

      sendNotification("Ovulation estimate", body, id);
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
