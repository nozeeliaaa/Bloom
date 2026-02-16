/**
 * insights.js - Phase-Based Insights Module
 *
 * Returns educational health insights based on the current cycle phase.
 * Provides different detail levels for anonymous vs account modes.
 *
 * COMP3901: All content is educational and non-diagnostic.
 */

/**
 * Get phase-based insights for the dashboard.
 * @param {string} phase - 'menstrual' | 'follicular' | 'ovulation' | 'luteal' | 'unknown'
 * @param {string} mode  - 'anon' | 'account'
 * @returns {Array<{title: string, text: string}>}
 */
export function getPhaseInsights(phase, mode) {
  const isAccount = mode === 'account';

  switch (phase) {
    case 'menstrual':
      return getMenstrualInsights(isAccount);
    case 'follicular':
      return getFollicularInsights(isAccount);
    case 'ovulation':
      return getOvulationInsights(isAccount);
    case 'luteal':
      return getLutealInsights(isAccount);
    default:
      return getDefaultInsights(isAccount);
  }
}

/* ===== Phase-specific insight generators ===== */

function getMenstrualInsights(isAccount) {
  const insights = [
    { title: 'Rest & recover', text: 'Your body is shedding the uterine lining. Prioritize rest and gentle movement like stretching or walking.' },
    { title: 'Stay hydrated', text: 'Drinking plenty of water can help reduce cramps and bloating during menstruation.' },
    { title: 'Iron-rich foods', text: 'Consider iron-rich foods like leafy greens, beans, and fortified cereals to replenish what is lost during bleeding.' },
  ];
  if (isAccount) {
    insights.push(
      { title: 'Heat therapy', text: 'Applying a warm compress to your lower abdomen can ease menstrual cramps by relaxing uterine muscles.' },
      { title: 'Track your flow', text: 'Logging your flow intensity each day helps identify patterns. Consistently heavy flow over many days could be worth discussing with a provider.' }
    );
  }
  return insights;
}

function getFollicularInsights(isAccount) {
  const insights = [
    { title: 'Energy rising', text: 'Estrogen levels are increasing. Many people notice improved energy, mood, and focus during this phase.' },
    { title: 'Gentle movement', text: 'This is a good time for moderate exercise like yoga, swimming, or brisk walks as your body recovers.' },
  ];
  if (isAccount) {
    insights.push(
      { title: 'Skin & hair', text: 'Rising estrogen often improves skin clarity. This is a natural part of your cycle, not a coincidence.' },
      { title: 'Plan ahead', text: 'Your fertile window is approaching. Whether planning for or avoiding pregnancy, awareness of your cycle timing is helpful.' },
      { title: 'Nutrition focus', text: 'Support follicle development with foods rich in B vitamins, zinc, and omega-3 fatty acids.' }
    );
  }
  return insights;
}

function getOvulationInsights(isAccount) {
  const insights = [
    { title: 'Fertile window', text: 'You may be in or near your fertile window. This is when conception is most likely if not using contraception.' },
    { title: 'Body signs', text: 'Some people notice changes in cervical mucus (clear, stretchy), mild pelvic twinges, or a slight temperature rise around ovulation.' },
  ];
  if (isAccount) {
    insights.push(
      { title: 'Peak energy', text: 'Many people experience peak energy and confidence around ovulation due to elevated estrogen and testosterone.' },
      { title: 'Cervical mucus tracking', text: 'Tracking changes in cervical mucus consistency can complement period tracking for better cycle awareness.' },
      { title: 'Disclaimer', text: 'Bloom cycle predictions are educational estimates. They should not be used as a sole method of birth control.' }
    );
  }
  return insights;
}

function getLutealInsights(isAccount) {
  const insights = [
    { title: 'PMS awareness', text: 'Progesterone rises after ovulation. Some people experience mood changes, bloating, or breast tenderness in the luteal phase.' },
    { title: 'Prioritize sleep', text: 'Quality sleep becomes especially important during this phase. Aim for 7-9 hours and maintain a consistent sleep schedule.' },
  ];
  if (isAccount) {
    insights.push(
      { title: 'Mood & cravings', text: 'Increased cravings for carbs and sweets are common. Balanced meals with protein and complex carbs can help stabilize mood.' },
      { title: 'Stress management', text: 'Cortisol sensitivity may increase during the luteal phase. Gentle activities, deep breathing, and journaling can help.' },
      { title: 'Prepare for period', text: 'Your next period may be approaching. Having supplies ready and noting pre-menstrual symptoms helps track patterns over time.' }
    );
  }
  return insights;
}

function getDefaultInsights(isAccount) {
  const insights = [
    { title: 'Hydration reminder', text: 'Drinking enough water supports overall health and can help reduce bloating and cramps during your cycle.' },
    { title: 'Track consistently', text: 'Logging daily, even on non-period days, helps identify patterns more accurately over time.' },
  ];
  if (isAccount) {
    insights.push(
      { title: 'Listen to your body', text: 'Every body is unique. What is normal for someone else may not be your normal, and that is okay.' }
    );
  }
  return insights;
}
