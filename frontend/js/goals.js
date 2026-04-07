// frontend/js/goals.js

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
    id: "no_period",
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