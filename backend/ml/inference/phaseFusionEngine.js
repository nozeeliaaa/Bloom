export function phaseFusionEngine({
  modelOutput,
  userInput
}) {
  const { probabilities } = modelOutput;

  // Copy model probabilities
  let scores = { ...probabilities };

  const day = userInput.day_in_study || 0;
  const cramps = userInput.cramps || 0;
  const mood = userInput.moodswing || 0;
  const cravings = userInput.foodcravings || 0;

  // -------------------------
  // Rule-based adjustments
  // -------------------------

  // Menstrual support
  if (cramps >= 3) {
    scores.Menstrual += 0.2;
  }

  if (day >= 1 && day <= 5) {
    scores.Menstrual += 0.2;
  }

  // Luteal support
  if (mood >= 3 && cravings >= 3) {
    scores.Luteal += 0.2;
  }

  // Ovulation timing
  if (day >= 12 && day <= 16) {
    scores.Ovulation += 0.3;
  }

  // -------------------------
  // Normalize
  // -------------------------
  const total = Object.values(scores).reduce((a, b) => a + b, 0);

  Object.keys(scores).forEach(key => {
    scores[key] = scores[key] / total;
  });

  // -------------------------
  // Final decision
  // -------------------------
  let finalPhase = null;
  let maxScore = -1;

  for (const phase in scores) {
    if (scores[phase] > maxScore) {
      maxScore = scores[phase];
      finalPhase = phase;
    }
  }

  return {
    finalPhase,
    confidence: maxScore,
    scores
  };
}
