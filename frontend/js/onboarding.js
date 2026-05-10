const ONBOARDING_KEY = "bloom_onboarded";

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  return true;
}

export function isOnboardingCompleteLocal() {
  return localStorage.getItem(ONBOARDING_KEY) === "1";
}

export function markOnboardingCompleteLocal() {
  localStorage.setItem(ONBOARDING_KEY, "1");
}

export function isOnboardingCompleteFromProfileData(data) {
  if (!data || typeof data !== "object" || data.degraded) return false;

  const profile = data.profile && typeof data.profile === "object" ? data.profile : {};
  const health = data.healthProfile && typeof data.healthProfile === "object" ? data.healthProfile : {};
  const phase = data.phaseProfile && typeof data.phaseProfile === "object" ? data.phaseProfile : {};

  if (data.onboardingCompleted === true || profile.onboardingCompleted === true) return true;
  if (
    hasValue(data.onboardingCompletedAt) ||
    hasValue(data.onboardedAt) ||
    hasValue(profile.onboardingCompletedAt) ||
    hasValue(profile.onboardedAt)
  ) {
    return true;
  }

  // Backward compatibility for accounts that completed setup before the
  // explicit onboarding flag existed. Default profile-only fields such as
  // goal/mode/avatar are not enough to count as completed setup.
  return Boolean(
    hasValue(profile.yearOfBirth) ||
    hasValue(health.avgCycleLength) ||
    hasValue(health.periodDuration) ||
    hasValue(health.weightKg) ||
    hasValue(health.heightCm) ||
    hasValue(data.lastPeriodStart) ||
    hasValue(phase.lastPeriodStart)
  );
}
