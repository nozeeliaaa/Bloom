/**
 * Mode management: Anonymous vs Account
 * Anon = localStorage only, limited features
 * Account = Firebase Auth + Firestore, full features
 */

const MODE_KEY = 'bloom_mode';

export function getMode() {
  return localStorage.getItem(MODE_KEY) || 'anon';
}

export function setMode(mode) {
  if (mode !== 'anon' && mode !== 'account') {
    throw new Error('Invalid mode: must be "anon" or "account"');
  }
  localStorage.setItem(MODE_KEY, mode);
}

export function isAccountMode() {
  return getMode() === 'account';
}

export function isAnonMode() {
  return getMode() === 'anon';
}

/**
 * Feature access control
 * Anonymous mode has limited features
 */
const ACCOUNT_ONLY_FEATURES = [
  'advanced-insights',
  'pattern-flags',
  'pdf-export',
  'cloud-backup',
  'assistant-history',
  'data-export'
];

export function checkFeatureAccess(feature) {
  if (isAccountMode()) return true;
  return !ACCOUNT_ONLY_FEATURES.includes(feature);
}

export function getFeatureList() {
  return {
    'period-tracking': { anon: true, account: true, label: 'Period & flow tracking' },
    'symptom-logging': { anon: true, account: true, label: 'Symptom logging' },
    'calendar-view': { anon: true, account: true, label: 'Calendar view' },
    'pamphlets': { anon: true, account: true, label: 'Educational pamphlets' },
    'clinic-finder': { anon: true, account: true, label: 'Clinic directory' },
    'basic-assistant': { anon: true, account: true, label: 'Bloomie assistant (basic)' },
    'advanced-insights': { anon: false, account: true, label: 'Advanced insights & pattern flags' },
    'pattern-flags': { anon: false, account: true, label: 'Unusual pattern alerts' },
    'cloud-backup': { anon: false, account: true, label: 'Cloud backup & sync' },
    'assistant-history': { anon: false, account: true, label: 'Assistant history saving' },
    'data-export': { anon: false, account: true, label: 'Data export (PDF)' }
  };
}
