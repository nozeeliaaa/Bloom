// src/jobs/sendDailyReminders.js
import admin from "firebase-admin";
import { db } from "../firebaseAdmin.js";

const TODAY = () => new Date().toISOString().split("T")[0]; // YYYY-MM-DD

/**
 * Sends a FCM notification to all tokens for a user.
 * Cleans up invalid tokens automatically.
 */
async function sendToUser(uid, fcmTokens, title, body) {
  if (!fcmTokens || fcmTokens.length === 0) return;

  const invalidTokens = [];

  for (const token of fcmTokens) {
    try {
      await admin.messaging().send({
        token,
        notification: { title, body },
        android: { priority: "normal" },
        apns: { payload: { aps: { sound: "default" } } },
      });
    } catch (err) {
      // Token is invalid/expired - mark for removal
      if (
        err.code === "messaging/invalid-registration-token" ||
        err.code === "messaging/registration-token-not-registered"
      ) {
        invalidTokens.push(token);
      } else {
        console.warn(`[sendDailyReminders] Failed to send to uid ${uid}:`, err.message);
      }
    }
  }

  // Clean up invalid tokens
  if (invalidTokens.length > 0) {
    await db.collection("users").doc(uid).update({
      fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens),
    });
  }
}

/**
 * Checks if a notification type was already sent today for this user.
 * Prevents duplicate sends if the cron fires more than once.
 */
async function alreadySentToday(uid, type) {
  const today = TODAY();
  const doc = await db
    .collection("notificationLog")
    .doc(`${uid}_${type}_${today}`)
    .get();
  return doc.exists;
}

async function markSentToday(uid, type) {
  const today = TODAY();
  await db
    .collection("notificationLog")
    .doc(`${uid}_${type}_${today}`)
    .set({ uid, type, sentAt: admin.firestore.FieldValue.serverTimestamp() });
}

/**
 * Main job - runs daily.
 * Reads all users with reminders enabled and sends appropriate notifications.
 */
export async function runDailyRemindersJob() {
  console.log("[sendDailyReminders] Running daily reminders job...");

  try {
    // Get all users who have reminders enabled
    const prefsSnap = await db
      .collection("preferences")
      .where("reminders.enabled", "==", true)
      .get();

    if (prefsSnap.empty) {
      console.log("[sendDailyReminders] No users with reminders enabled.");
      return;
    }

    console.log(`[sendDailyReminders] Processing ${prefsSnap.size} user(s)...`);

    for (const prefDoc of prefsSnap.docs) {
      const uid = prefDoc.id;
      const prefs = prefDoc.data();
      const types = prefs.reminders?.types || [];

      if (types.length === 0) continue;

      // Get user's FCM tokens
      const userDoc = await db.collection("users").doc(uid).get();
      if (!userDoc.exists) continue;

      const fcmTokens = userDoc.data()?.fcmTokens || [];
      if (fcmTokens.length === 0) continue;

      // ── LOG_REMINDER - daily log nudge ──────────────────
      if (types.includes("LOG_REMINDER")) {
        const today = TODAY();
        const alreadyLogged = await db
          .collection("cycleLogs")
          .doc(uid)
          .collection("entries")
          .doc(today)
          .get();

        if (!alreadyLogged.exists && !(await alreadySentToday(uid, "LOG_REMINDER"))) {
          await sendToUser(uid, fcmTokens, "Bloom 🌸", "Don't forget to log today.");
          await markSentToday(uid, "LOG_REMINDER");
        }
      }

      // ── PERIOD_SOON - predict next period ───────────────
      if (types.includes("PERIOD_SOON")) {
        if (!(await alreadySentToday(uid, "PERIOD_SOON"))) {
          // Get last cycle logs to estimate next period
          const logsSnap = await db
            .collection("cycleLogs")
            .doc(uid)
            .collection("entries")
            .where("periodDay", "==", 1)
            .orderBy("dateKey", "desc")
            .limit(3)
            .get();

          if (!logsSnap.empty) {
            const lastPeriodDate = new Date(logsSnap.docs[0].data().dateKey);
            const userDoc = await db.collection("users").doc(uid).get();
            const userData = userDoc.data();
            const avgCycle = userData?.healthProfile?.avgCycleLength || 28;

            const nextPeriod = new Date(lastPeriodDate);
            nextPeriod.setDate(nextPeriod.getDate() + avgCycle);

            const daysUntil = Math.ceil(
              (nextPeriod - new Date()) / (1000 * 60 * 60 * 24)
            );

            if (daysUntil === 2 || daysUntil === 1) {
              const msg = daysUntil === 1
                ? "Your period may be due tomorrow."
                : "Your period may be due in 2 days.";
              await sendToUser(uid, fcmTokens, "Bloom 🌸", msg);
              await markSentToday(uid, "PERIOD_SOON");
            }
          }
        }
      }

      // ── FERTILE_WINDOW - estimate fertile window ─────────
      if (types.includes("FERTILE_WINDOW")) {
        if (!(await alreadySentToday(uid, "FERTILE_WINDOW"))) {
          const logsSnap = await db
            .collection("cycleLogs")
            .doc(uid)
            .collection("entries")
            .where("periodDay", "==", 1)
            .orderBy("dateKey", "desc")
            .limit(1)
            .get();

          if (!logsSnap.empty) {
            const lastPeriodDate = new Date(logsSnap.docs[0].data().dateKey);
            const userDoc = await db.collection("users").doc(uid).get();
            const userData = userDoc.data();
            const avgCycle = userData?.healthProfile?.avgCycleLength || 28;

            // Fertile window estimate: ovulation around day 14, fertile days 12-16
            const ovulationDay = new Date(lastPeriodDate);
            ovulationDay.setDate(ovulationDay.getDate() + avgCycle - 14);

            const fertileStart = new Date(ovulationDay);
            fertileStart.setDate(fertileStart.getDate() - 2);
            const fertileEnd = new Date(ovulationDay);
            fertileEnd.setDate(fertileEnd.getDate() + 2);

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (today >= fertileStart && today <= fertileEnd) {
              await sendToUser(
                uid, fcmTokens,
                "Bloom 🌸",
                "You may be in your fertile window today."
              );
              await markSentToday(uid, "FERTILE_WINDOW");
            }
          }
        }
      }

      // ── CHECK_IN - general wellness check ───────────────
      if (types.includes("CHECK_IN")) {
        if (!(await alreadySentToday(uid, "CHECK_IN"))) {
          await sendToUser(uid, fcmTokens, "Bloom 🌸", "How are you feeling today?");
          await markSentToday(uid, "CHECK_IN");
        }
      }
    }

    console.log("[sendDailyReminders] Done.");
  } catch (err) {
    console.error("[sendDailyReminders] Job failed:", err.message);
  }
}