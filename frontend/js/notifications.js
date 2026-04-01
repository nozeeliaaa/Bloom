/**
 * notifications.js - Browser notification system + FCM token management
 *
 * Browser notifications (when app is open):
 *   - Period reminder: fires 0-3 days before predicted next period
 *   - Daily logging reminder: fires if today has no log entry
 *   - Fertile window alert: fires when fertile window starts or starts tomorrow
 *
 * FCM (when app is closed):
 *   - registerFCMToken()   — requests permission, gets FCM token, saves to backend
 *   - unregisterFCMToken() — removes FCM token from backend
 *
 * In-app inbox: persistent notification history in localStorage
 */
 
import { getFirebaseMessaging } from "./firebase.js";
import { getToken, onMessage }  from "firebase/messaging";
import { getIdToken }           from "./auth.js";
 
const PREFS_KEY    = "bloom_preferences";
const NOTIFIED_KEY = "bloom_notified";
const INBOX_KEY    = "bloom_notification_inbox";
const INBOX_MAX    = 50;
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
      console.warn("[Bloom FCM] Notification permission denied.");
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
      await fetch(`${API_BASE}/notifications/token`, {
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
 
    await fetch(`${API_BASE}/notifications/token`, {
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
 
  if (!prefs.periodReminder && !prefs.reminders && !prefs.fertileAlert) return;
 
  await requestPermission();
 
  const notified = getNotified();
  const today    = todayKey();
 
  // ─── Period Reminder ────────────────────────────────────────────────────────
  if (prefs.periodReminder && cycle.nextPeriodDate) {
    const daysUntil = diffDays(today, cycle.nextPeriodDate);
    const id        = `period-${cycle.nextPeriodDate}`;
 
    if (daysUntil >= 0 && daysUntil <= 3 && !hasNotifiedToday(notified, id)) {
      const body = daysUntil === 0
        ? `Your period may start today (${friendlyDate(cycle.nextPeriodDate)}). Take care of yourself.`
        : `Your period is expected in ${daysUntil} day${daysUntil !== 1 ? "s" : ""} on ${friendlyDate(cycle.nextPeriodDate)}.`;
      sendNotification("Period coming up", body, id);
      markNotified(notified, id);
    }
  }
 
  // ─── Daily Logging Reminder ─────────────────────────────────────────────────
  if (prefs.reminders) {
    const id             = `log-${today}`;
    const hasLoggedToday = !!(logsByDate[today]?.flow || logsByDate[today]?.symptoms?.length);
 
    if (!hasLoggedToday && !hasNotifiedToday(notified, id)) {
      sendNotification(
        "Don't forget to log today",
        "Take a moment to record your flow and symptoms in Bloom.",
        id
      );
      markNotified(notified, id);
    }
  }
 
  // ─── Fertile Window Alert ───────────────────────────────────────────────────
  if (prefs.fertileAlert && cycle.fertileStart && cycle.fertileEnd) {
    const daysToFertile = diffDays(today, cycle.fertileStart);
    const id            = `fertile-${cycle.fertileStart}`;
 
    if (daysToFertile >= 0 && daysToFertile <= 1 && !hasNotifiedToday(notified, id)) {
      const body = daysToFertile === 0
        ? `Your fertile window starts today! It runs until ${friendlyDate(cycle.fertileEnd)}.`
        : `Your fertile window begins tomorrow (${friendlyDate(cycle.fertileStart)}).`;
      sendNotification("Fertile window", body, id);
      markNotified(notified, id);
    }
  }
}