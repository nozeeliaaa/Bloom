import { Survey, mountSurvey } from "./survey.js";

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  if (!root) return;

  root.innerHTML = Survey();
  mountSurvey();
});
