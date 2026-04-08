// frontend/js/goals.js

// Goals restricted to users 18 and older
export const AGE_LOCKED_GOALS = ["ttc", "pregnancy", "perimenopause"];

/**
 * Returns the user's age derived from year-of-birth in their profile.
 * Returns null if no DOB is stored.
 */
export function getUserAge() {
  try {
    const profile = JSON.parse(localStorage.getItem("bloom_profile") || "{}");
    if (!profile.yob) return null;
    return new Date().getFullYear() - Number(profile.yob);
  } catch { return null; }
}

/**
 * Returns true if the goal is age-restricted and the user is under 18.
 * Returns false when no age data is available (never blocks by default).
 */
export function isGoalAgeLocked(goalId) {
  if (!AGE_LOCKED_GOALS.includes(goalId)) return false;
  const age = getUserAge();
  if (age === null) return false; // no age on file → don't block
  return age < 18;
}

export const GOALS = [
  {
    id: "period",
    title: "Track my period",
    desc: "Predict cycles, phases, and period timing.",
  },
  {
    id: "ttc",
    title: "Try to conceive",
    desc: "See conception timing tools and fertility insights.",
  },
  {
    id: "track_symptoms",
    title: "Track symptoms",
    desc: "Log symptoms and patterns without bleeding-based predictions.",
  },
  {
    id: "pregnancy",
    title: "Track my pregnancy",
    desc: "Due date (EDD), trimester milestones, and pregnancy logs.",
  },
  {
    id: "perimenopause",
    title: "Track perimenopause",
    desc: "Understand cycle changes, symptoms, and transitions.",
  },
];

const LS_GOAL = "bloom_goal";

export function getUserGoal() {
  return localStorage.getItem(LS_GOAL) || "period";
}

export function setUserGoal(goalId) {
  localStorage.setItem(LS_GOAL, goalId);
}

export function goalLabel(goalId) {
  const g = GOALS.find((x) => x.id === goalId);
  return g ? g.title : "Track my period";
}

export function goalDesc(goalId) {
  const g = GOALS.find((x) => x.id === goalId);
  return g ? g.desc : "";
}