import admin from "firebase-admin";
import { db } from "../src/firebaseAdmin.js";

const { FieldValue } = admin.firestore;

function normalizeBiometricLevel(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

async function migrateUsers() {
  console.log("Starting full user migration...");
  const snap = await db.collection("users").get();
  let updated = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const profile = data.profile || {};
    const healthProfile = data.healthProfile || {};
    const biometricProfile = data.biometricProfile || {};

    const cleanProfile = {
      nickname: profile.nickname ?? null,
      avatar: profile.avatar ?? "👤",
      yearOfBirth: profile.yearOfBirth ?? null,
      goal:
        profile.goal === "track_cycle" ? "period"
        : profile.goal === "no_period" ? "track_symptoms"
        : (profile.goal ?? "period"),
      mode: profile.mode ?? "account",
      consentSensitive: profile.consentSensitive ?? false,
      remindersEnabled: profile.remindersEnabled ?? false,
      reminderTime: profile.reminderTime ?? "09:00",
      ageBand: profile.ageBand ?? null,
    };

    const cleanHealthProfile = {
      avgCycleLength: healthProfile.avgCycleLength ?? profile.avgCycleLength ?? null,
      periodDuration: healthProfile.periodDuration ?? profile.periodDuration ?? null,
      weightKg: healthProfile.weightKg ?? profile.weightKg ?? null,
      heightCm: healthProfile.heightCm ?? profile.heightCm ?? null,
      lmpDate: healthProfile.lmpDate ?? healthProfile.lmp ?? profile.lmpDate ?? profile.lmp ?? null,
    };

    const cleanBiometricProfile = {
      activityLevel: normalizeBiometricLevel(
        biometricProfile.activityLevel ?? profile.activityLevel
      ),
      sleepScore: biometricProfile.sleepScore ?? healthProfile.sleepScore ?? profile.sleepScore ?? null,
      stressLevel: normalizeBiometricLevel(
        biometricProfile.stressLevel ?? profile.stressLevel
      ),
    };

    await doc.ref.set({
      role: data.role || "user",
      email: data.email || null,
      profile: {
        ...cleanProfile,
        role: FieldValue.delete(),
        avgCycleLength: FieldValue.delete(),
        periodDuration: FieldValue.delete(),
        sleepScore: FieldValue.delete(),
        activityLevel: FieldValue.delete(),
        stressLevel: FieldValue.delete(),
        weightKg: FieldValue.delete(),
        heightCm: FieldValue.delete(),
        lmpDate: FieldValue.delete(),
        lmp: FieldValue.delete(),
      },
      healthProfile: {
        ...cleanHealthProfile,
        lmp: FieldValue.delete(),
        sleepScore: FieldValue.delete(),
      },
      biometricProfile: cleanBiometricProfile,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: data.createdAt ?? FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`✓ Migrated: ${doc.id}`);
    updated++;
  }

  console.log(`Done. ${updated} user(s) migrated.`);
  process.exit(0);
}

migrateUsers().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
