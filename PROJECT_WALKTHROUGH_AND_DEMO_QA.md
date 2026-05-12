# Bloom Project Walkthrough and Demo Question Bank

This document explains how Bloom is structured, how the main flows work, what each major file/folder does, and what a lecturer might ask during a demo. It is based on the current code in this workspace.

## 1. Big Picture

Bloom is a reproductive-health support web application. It combines:

- A Vite/static frontend in `frontend/`
- A Node/Express backend in `backend/`
- Firebase Authentication and Firestore persistence
- A hybrid local/cloud storage model
- Cycle phase prediction and symptom insight algorithms
- Python ML artifacts for cycle length and biometric phase prediction
- A rule-based plus optional AI-assisted assistant called Bloomie
- Clinic and pamphlet discovery
- Admin tools, consent workflows, notifications, reports, and tests

The system is deliberately safety-aware. It avoids diagnosis, uses educational disclaimers, gates some teen/sensitive access behind consent, validates inputs, and separates frontend UI code from backend secrets.

## 2. Runtime Architecture

### Frontend

The frontend is a static/Vite app served from `frontend/`. Pages live in `frontend/pages/`, shared JavaScript lives in `frontend/js/`, styles live in `frontend/css/`, static datasets live in `frontend/data/`, and PDFs/images live in `frontend/assets/`.

The root page `frontend/index.html` redirects to `pages/home.html`. Most real app pages import shared helpers from `frontend/js/utils.js`, render the common nav/footer, then mount page-specific behavior.

### Backend

The backend is an Express API in `backend/src/`. `backend/src/server.js` is the actual server startup file. It:

- Configures CORS
- Serves the frontend statically
- Adds JSON parsing and rate limiting
- Mounts all API route modules
- Starts cron jobs
- Listens on `PORT` or `4000`

`backend/src/app.js` is a cleaner app factory used by tests. It mounts the same main routes but does not start cron jobs or listen by itself.

### Firebase

Firebase is used for:

- Authentication on the frontend
- ID-token verification on the backend
- Firestore storage for users, logs, consents, clinics, pamphlets, analytics, admin records, etc.
- Firebase Cloud Messaging support through `frontend/firebaseMessaging-sw.js`

Backend Firebase Admin setup is in `backend/src/firebaseAdmin.js`.

## 3. Main Data Flow

### Anonymous Mode

If a user is not signed in, Bloom stores most personal data locally in `localStorage`. This is handled mainly by `frontend/js/db.js` and `frontend/js/mode.js`.

Anonymous mode can still use many UI features, but advanced cloud sync and some account-only features are limited or hidden.

### Account Mode

When signed in:

1. `frontend/js/auth.js` gets a Firebase ID token.
2. API calls include `Authorization: Bearer <token>`.
3. Backend `requireAuth` verifies the token.
4. Backend reads/writes Firestore under `users/{uid}/...`.
5. Frontend still writes localStorage first so the UI remains responsive.
6. Cloud results are merged back into local state.

The most important hybrid persistence file is `frontend/js/db.js`.

## 4. Key Frontend Files

### Entry and Shared Infrastructure

- `frontend/index.html`: root redirect and legal clean-route redirects.
- `frontend/js/firebase.js`: initializes Firebase browser SDK modules.
- `frontend/js/firebaseConfig.js`: frontend Firebase config and API base values.
- `frontend/js/api-base.js`: chooses API base URL from local override, Vite env, local host, window config, or deployed Cloud Run default.
- `frontend/js/auth.js`: Firebase login/register/logout, email verification, password reset, role caching, ID token helper, local-session cleanup.
- `frontend/js/mode.js`: stores whether the user is in anonymous or account mode.
- `frontend/js/db.js`: localStorage/cloud sync for daily logs, symptom logs, Bloomie memory, profile nickname, and local data deletion.
- `frontend/js/utils.js`: shared nav/footer, icons, date helpers, symptom catalog loading, toasts, modal helpers, layout utilities.
- `frontend/js/goals.js`: user goal definitions and 18+ goal locking.
- `frontend/js/theme-manager.js`: theme initialization.
- `frontend/js/session-timeout.js`: account session inactivity guard.
- `frontend/js/sync-status.js`: UI banner for cloud sync issues.

### Core User Pages

- `frontend/pages/home.html`: public home screen.
- `frontend/pages/register.html`: account creation UI.
- `frontend/pages/login.html`: login and verification flow.
- `frontend/pages/survey.html`: onboarding survey shell.
- `frontend/js/survey.js` and `frontend/js/survey-page.js`: onboarding/profile collection logic.
- `frontend/pages/profile.html`: profile editing.
- `frontend/pages/profile-view.html`: profile display.
- `frontend/pages/settings.html` and `frontend/js/settings.js`: settings and preferences.
- `frontend/pages/dashboard.html` and `frontend/js/dashboard.js`: personalized dashboard, cycle snapshot, phase card, goal tools, charts, advanced insights, PDF export.
- `frontend/pages/calendar.html` and `frontend/js/calendar.js`: cycle calendar, logging modal, symptoms, severity, biometrics, predicted period/fertile overlays.
- `frontend/pages/log.html`: logging page.
- `frontend/pages/cycle-history.html`: cycle history.
- `frontend/pages/cycle-detail.html`: detailed cycle view.
- `frontend/pages/report.html` and `frontend/js/report.js`: reports.
- `frontend/js/pdf-generator.js` and `frontend/js/pdf-report-data.js`: generate downloadable PDF health report.

### Education, Clinics, Help

- `frontend/pages/pamphlets.html`: educational pamphlet browser.
- `frontend/data/pamphlets.json`: static pamphlet metadata fallback/source.
- `frontend/assets/*.pdf`: health education PDFs.
- `frontend/pages/clinics.html`: clinic finder UI.
- `frontend/data/clinics.json`: static clinic data fallback.
- `frontend/js/phase-education.js`: phase-specific educational text.
- `frontend/pages/help.html`, `about.html`, `about-us.html`, legal pages: informational/static content.

### Notifications and Engagement

- `frontend/js/notifications.js`: notification scheduling/inbox logic.
- `frontend/firebaseMessaging-sw.js`: service worker for FCM.
- `frontend/js/mythFab.js`: floating educational/myth UI.
- `frontend/js/loadingOverlay.js`: loading UI.

## 5. Cycle and Symptom Algorithms

Algorithm files exist in two places:

- `frontend/js/algorithms/`: used by the app UI and tests.
- `algorithms/`: standalone/root copies for algorithm work or evaluation.

Important files:

- `bloom-date-utils.js`: parsing and validating dates.
- `bloom-utils.js`: numeric/stat helpers and signal object helpers.
- `bloom-cycle-engine.js`: advanced cycle insights such as unusual cycle length, amenorrhea-style patterns, period duration/flow patterns.
- `bloom-anomaly-engine.js`: anomaly detection from actual vs predicted cycle lengths.
- `bloom-symptom-engine.js`: symptom signals, forecast signals, integrated cycle+symptom signals, advanced symptom insights.
- `pregnancyAlgorithm.js`: conception likelihood window, pregnancy-test timing, estimated due date, fertility confidence.

The frontend intentionally keeps reproductive calculations inside approved engine files. `dashboard.js`, `calendar.js`, and `cycle-state.js` are mostly integration/rendering layers.

## 6. Cycle Prediction Flow

The main frontend entry is `frontend/js/cycle-state.js`.

Flow:

1. Calendar/dashboard gather `logsByDate` from `getAllLogs()`.
2. `fetchCycleState(logs)` builds a cache key from mode, last period day, period count, and today.
3. If signed in, it posts trimmed logs to `/api/cycles/state`.
4. Backend route `backend/src/routes/cyclesML.js` computes full state.
5. If backend is unavailable, anonymous mode can import and run `backend/ml/inference/cyclePhaseEngine.js` locally.
6. Returned state is cached in `sessionStorage` for 6 hours.
7. Logged period days take precedence over predictions. If today is logged as a period day, phase becomes menstrual.

Backend `/api/cycles/state`:

- Reads request logs and Firestore logs
- Fetches user profile
- Builds period clusters and cycle lengths
- Predicts cycle length with Python ML when possible
- Falls back to weighted average when not enough history or ML fails
- Computes phase, next period, ovulation, fertile window, future cycles
- Scores recent symptoms and biometrics
- Fuses signals into `phaseEstimation`
- Persists `cycleState/current` and summary fields back to the user doc

## 7. ML Components

### Cycle Length Model

- `backend/ml/training/bloom_cycle_make_dataset.py`: reads Kaggle menstrual cycle data, cleans it, engineers features, creates train/test CSVs.
- `backend/ml/training/bloom_cycle_train.py`: trains weighted OLS linear regression and saves `cycle_model.pkl`.
- `backend/ml/training/bloom_cycle_evaluate.py`: evaluates model performance.
- `backend/ml/inference/cycle_predict.py`: loads `cycle_model.pkl`, accepts 9 numeric features from Node, outputs JSON predicted cycle length.
- `backend/ml/artifacts/cycle_model.pkl`: trained model artifact.

Features include current cycle length, mean cycle length, luteal phase length, variability, cycle number, age, BMI, unusual bleeding, and reproductive category.

### Phase Engine

- `backend/ml/inference/cyclePhaseEngine.js`: deterministic JS engine that calculates current phase from period logs and optional ML-predicted length.
- It groups period days into clusters, calculates cycle lengths, estimates typical period duration, scales phase boundaries, predicts next period/ovulation/fertile window, and assigns confidence from cycle stability.

### Biometric Phase Model

- `backend/ml/inference/biometric_phase.py`: loads a random forest-style artifact set and predicts phase from symptoms/steps/biometrics.
- `backend/ml/artifacts/biometric_phase_model.pkl`, `phase_label_encoder.pkl`, `phase_imputer.pkl`, `phase_features.pkl`: saved model components.
- `backend/ml/inference/phaseFusionEngine.js`: combines model probabilities with rules such as cramps/day 1-5 supporting menstrual, mood/cravings supporting luteal, day 12-16 supporting ovulation.

In the current Express route, `cyclesML.js` mostly uses heuristic biometric scoring from recent sleep/stress/activity, while the Python biometric predictor exists as an inference component/artifact path.

## 8. Bloomie Assistant

Bloomie is the chat assistant in `frontend/js/assistant.js`.

It is not a free-form chatbot. It is mostly a deterministic, safety-gated conversation engine with optional AI assistance for classification only.

Main parts:

- `assistant.js`: mounts chat UI, loads memory/profile, creates context, handles messages, routing, persistence, safety, PDF summary.
- `bloomie-nodes.js`: combines all node groups.
- `bloomie-nodes-core.js`: start menus, safety, app help, summaries, diagnosis redirects, close/resolution flow.
- `bloomie-nodes-period.js`: late/missed/heavy/spotting period pathways.
- `bloomie-nodes-pregnancy.js`: pregnancy concern, test timing, due date.
- `bloomie-nodes-pelvic.js`: pelvic pain/cramps.
- `bloomie-nodes-mood.js`: mood/energy/sleep.
- `bloomie-nodes-perimenopause.js`: perimenopause.
- `bloomie-nodes-education.js`: education topics.
- `bloomie-nodes-general.js`: general and fallback topics.
- `bloomie-routing.js`: rule-based intent scoring, out-of-scope detection, condition detection, route confidence.
- `bloomie-inference.js`: entity/signal extraction helpers.
- `bloomie-intent.js`: optional AI-assisted intent classification for low-confidence health messages.
- `bloomie-extract.js`: optional AI structured signal extraction.
- `bloomie-tone.js` and `bloomie-patois.js`: tone adaptation and Jamaican/Patois-aware normalization.
- `bloomie-safety.js`: input sanitization, prompt injection blocking, diagnostic leak checks, HTML payload authorization.
- `bloomie-policy.js`: minor/consent safety policy.
- `bloomie-reasoning.js`: signal boards and response strategy scoring.
- `bloomie-clarifier.js`, `bloomie-clarification-resolver.js`, `bloomie-repair.js`: ambiguity and repair handling.
- `bloomie-response-layers.js`: follow-up layers and response composition.
- `bloomie-session.js`: context/session object creation.
- `bloomie-logger.js`: diagnostics, analytics, safety logging.
- `bloom-storage.js`: versioned local Bloomie memory storage.

Bloomie backend routes:

- `backend/src/routes/bloomieAI.js`: secure Anthropic proxy for intent, tone, extraction, and symptom-catalog matching. It sends only the current message and strict hints, not full history.
- `backend/src/routes/bloomieMemory.js`: cloud Bloomie memory.
- `backend/src/routes/bloomieSafetyLog.js`: safety event logging.
- `backend/src/routes/bloomieAnalytics.js`: analytics events.
- `backend/src/routes/bloomieContext.js`: safe context for Bloomie.
- `backend/src/routes/bloomieContentMatch.js`: content recommendation matching.

## 9. Backend Routes

Mounted in `backend/src/server.js` and `backend/src/app.js`:

- `/api/auth`: token verification and minor registration support.
- `/api/user`: profile create/update/get, game data, account deletion.
- `/api/admin`: admin stats, user management, pamphlet management, clinic management, safety logs, contact messages, feedback review, analytics summary.
- `/api/logs`, `/api/cycle`, `/api/cycle-logs`: cycle log CRUD.
- `/api/symptoms`, `/api/symptom-logs`: symptom log CRUD.
- `/api/biometric-logs`: daily biometric log CRUD.
- `/api/cycles`: ML cycle prediction/state/phase/feedback.
- `/api/phase-feedback`: user feedback on predicted phase.
- `/api/preferences`: notification/user preferences.
- `/api/notifications`: push notification token registration/deletion.
- `/api/consent`: guardian consent request/approve/deny/resend/revoke/status.
- `/api/catalog`: clinics, symptoms, route proxy, pamphlets.
- `/catalog`: public alias for catalog routes.
- `/api/clinics`: active clinic directory with filters.
- `/api/contact`: contact/helpdesk messages.
- `/api/feedback`: general app feedback.
- `/api/bloomie-*`: Bloomie memory, safety, context, analytics, content matching.
- `/health`: backend health check.

## 10. Consent, Minors, and Safety

`backend/src/middleware/auth.js`:

- Verifies Firebase ID tokens
- Creates default user docs when missing
- Blocks unverified emails unless guardian consent was approved
- Blocks disabled accounts
- Derives age band from year of birth
- Backfills old profile schema fields
- Adds `req.user`

`backend/src/middleware/requireConsent.js`:

- Blocks teen access to sensitive features unless approved guardian consent exists.
- Also has a pregnancy-specific consent helper.

`backend/src/routes/consent.js`:

- Handles consent status, request creation, token validation, guardian approve/deny links, resend, pending list, revocation.
- Uses token utilities in `backend/src/utils/consentToken.js`.

Frontend consent pages include:

- `guardian-consent.html`
- `consent-pending.html`
- `consent-approved.html`
- `consent-denied.html`
- `consent-expired.html`
- `consent-result.html`

## 11. Clinic System and External Sources

Clinic data exists in:

- `frontend/data/clinics.json`
- `backend/data/clinics.json`
- Firestore collection `clinicDirectory`

Seeding/geocoding:

- `backend/scripts/seedClinics.js`
- `scripts/geocode-clinics.mjs`

Clinic API:

- `backend/src/routes/clinics.js`: gets active clinics from Firestore and filters by parish, type, service, and search query.
- `backend/src/routes/catalog.js`: also exposes clinic catalog and a route proxy.

External routing:

- `GET /catalog/route` calls OpenRouteService using server-side `ORS_API_KEY`.
- Coordinates are validated before proxying.
- ORS GeoJSON `[lng, lat]` coordinates are flipped for Leaflet-style `[lat, lng]`.

Trusted educational sources:

- `backend/src/utils/trustedExternalSources.js`
- `backend/src/utils/bloomie/routing/trustedExternalSources.js`

These map topic names to trusted external URLs. Bloomie/content matching can suggest internal pamphlets and external sources.

## 12. Admin System

Frontend:

- `frontend/pages/admin.html`
- `frontend/js/admin.js`
- `frontend/pages/admin-safety.html`
- `frontend/js/admin-safety.js`

Backend:

- `backend/src/routes/admin.js`
- `backend/src/utils/auditLog.js`

Admin features include:

- Dashboard stats
- User listing/detail/create/disable/enable/delete/promote
- First-admin setup
- Activity/audit logs
- Pamphlet CRUD and PDF upload metadata
- Clinic CRUD
- Safety log review
- Contact message review/respond
- Phase feedback review
- General feedback review
- Bloomie analytics summary

Admin access is both UI-gated by cached role and backend-enforced by route middleware/Firestore checks.

## 13. Storage Shape

Common localStorage keys:

- `bloom_daily_logs`: merged daily cycle/symptom logs
- `bloom_profile`: local profile cache
- `bloom_goal`: selected user goal
- `bloom_user_name`: nickname
- `bloom_preferences`: preferences
- `bloom_notification_inbox`: notifications
- `bloom_bloomie_memory` / `bloomie_state_v2`: Bloomie memory/session
- `bloom_user_role`, `bloom_is_admin`: cached role
- `bloom_consent_status`: consent status cache

Typical Firestore structure:

- `users/{uid}`
- `users/{uid}/cycleLogs/{dateKey}`
- `users/{uid}/symptomLogs/{dateKey}`
- `users/{uid}/biometricLogs/{dateKey}`
- `users/{uid}/phaseFeedback/{id}`
- `users/{uid}/cycleState/current`
- `users/{uid}/bloomieMemory/current` or route-specific memory document
- `clinicDirectory/{clinicId}`
- `pamphlets/{pamphletId}`
- `symptomCatalog/{symptomCode}`
- `consents/{consentId}`
- `adminUsers/{uid}`
- `auditLogs/{id}`
- `contactMessages/{id}`
- `feedback/{id}`
- `bloomieSafetyLogs/{id}`
- `bloomieAnalytics/{id}`

## 14. Testing and Evaluation

Root scripts:

- `npm test`: runs Vitest
- `npm run test:coverage`: coverage
- `npm run build`: Vite build plus static asset copy
- `npm run eval`: Bloomie/eval harness

Test locations:

- `frontend/__tests__/`: frontend integration/static tests.
- `frontend/js/__tests__/`: Bloomie, algorithm, Firebase config, custom symptom, routing, tone, confidence tests.
- `frontend/test/`: setup, helpers, mocks.
- `backend/src/__tests__/`: backend security, clinics, Bloomie context, content matching, memory normalization tests.
- `eval/`: diagnostic/evaluation harness and cases.

## 15. Important Demo Flows to Show

### Flow A: New User

1. Open home.
2. Register or continue anonymously.
3. Pick a goal.
4. Fill profile details.
5. Land on dashboard.

### Flow B: Log Cycle Data

1. Open calendar.
2. Select a date.
3. Add flow, symptoms, severity, notes, sleep/stress/activity.
4. Save.
5. Calendar updates immediately.
6. Backend sync happens in background for account users.
7. Prediction panel refreshes.

### Flow C: Cycle Prediction

1. Add period starts across multiple cycles.
2. Dashboard shows day in cycle, phase, confidence, next period, fertile window.
3. Calendar shows predicted period days, ovulation, fertile days.
4. Explain backend ML/fallback and confidence.

### Flow D: Bloomie

1. Open Bloomie.
2. Ask a simple issue like "my period is late".
3. Show routing to late-period pathway.
4. Ask an unsafe/diagnosis question and show safe redirect.
5. Ask a vague phrase and explain clarifier/AI-assist fallback.

### Flow E: Clinics

1. Open clinics.
2. Filter/search by parish/type/service.
3. Use location/autolocate if available.
4. Explain Firestore source, local fallback, ORS route proxy.

### Flow F: Admin

1. Login as admin.
2. Show stats/users/pamphlets/clinics/safety logs.
3. Explain backend still enforces access.

## 16. Lecturer Questions: Easy

1. What is Bloom?
2. What problem does Bloom solve?
3. Who are the intended users?
4. What technologies did you use?
5. Is Bloom a medical diagnosis tool?
6. What is the difference between anonymous mode and account mode?
7. Why did you use Firebase?
8. What data can a user log?
9. What are the main pages in the app?
10. What does the dashboard show?
11. What does the calendar do?
12. What is Bloomie?
13. What are pamphlets used for?
14. What is the clinic finder?
15. What is the admin panel for?
16. What happens when the user logs out?
17. What is stored locally?
18. What is stored in Firestore?
19. How does the app know whether a user is admin?
20. What happens if the backend is offline?

## 17. Lecturer Questions: Medium

1. Walk through what happens when a user saves a daily log.
2. Why does `db.js` write to localStorage before sending to the backend?
3. How do cycle logs and symptom logs differ?
4. Why are symptoms stored separately from cycle logs?
5. How do you convert frontend symptom labels to backend symptom codes?
6. How is the symptom catalog loaded?
7. What is the purpose of `cycle-state.js`?
8. Why is phase logic not inside `dashboard.js` or `calendar.js`?
9. How is current cycle phase calculated?
10. How do you detect a new cycle start?
11. Why is a gap greater than 3 days treated as a new period cluster?
12. How is average cycle length calculated?
13. How is prediction confidence calculated?
14. What does "logged period takes precedence" mean?
15. How does the app avoid stale predictions?
16. Why cache cycle state in sessionStorage?
17. What is the role of `cyclesML.js`?
18. How does the backend merge request logs and Firestore logs?
19. How are symptoms and biometrics used in phase estimation?
20. What happens if the Python model fails?
21. How does the clinic search filter work?
22. How does the OpenRouteService proxy protect the API key?
23. How does Bloomie route a user message?
24. How does Bloomie handle out-of-scope input?
25. How does Bloomie avoid giving diagnoses?
26. How is prompt injection handled?
27. Why is Anthropic called only through the backend?
28. What does the AI endpoint return?
29. Why is AI restricted to classification/extraction instead of free advice?
30. How do guardian consent pages connect to backend consent routes?

## 18. Lecturer Questions: Hard

1. Explain the complete `/api/cycles/state` computation pipeline.
2. How does the system handle conflicting cycle, symptom, and biometric signals?
3. What is the difference between cycle timing confidence and fused phase confidence?
4. How does `fuseSignals` weight cycle history, symptoms, and biometrics?
5. Why lower cycle weight when history is low or irregular?
6. What are possible weaknesses of using weighted OLS for cycle length?
7. What features train the cycle model, and why?
8. How would model bias affect users with irregular cycles?
9. What are the privacy risks of reproductive health data?
10. How does the project reduce risk for minors?
11. What is the difference between authentication, authorization, and consent in this app?
12. What backend routes require auth and why?
13. How does `requireAuth` backfill older user documents safely?
14. Why does the backend verify admin status instead of trusting localStorage?
15. What happens if an email is unverified but guardian consent has been approved?
16. How do you prevent a frontend user from changing their role?
17. How do you protect API keys?
18. What happens if Firestore is unavailable during authentication?
19. How does the app degrade gracefully under network failure?
20. Why does `cycle-state.js` allow local fallback in anonymous mode but not account mode?
21. What is the risk of importing backend engine code into frontend fallback?
22. How does Bloomie distinguish "I have PCOS" from "Do I have PCOS?"
23. Why is that distinction important?
24. How does Bloomie detect urgent symptoms?
25. Why must urgent routing be deterministic?
26. How are AI outputs validated before the client uses them?
27. What would happen if Anthropic returned an invalid symptom code?
28. How do you avoid sending PII to AI?
29. How would you audit Bloomie's safety logs?
30. What data would you use to improve prediction accuracy over time?
31. How do you test edge cases for late periods, sparse logs, and current bleeding?
32. How do you handle users with no period goal?
33. How does perimenopause affect prediction assumptions?
34. How would pregnancy mode differ from period tracking?
35. What is the ethical issue with showing fertile windows?
36. How would you explain confidence to a non-technical user?
37. How would you validate clinic data accuracy?
38. What if a clinic closes or changes phone number?
39. How do you handle sensitive pamphlets for teens?
40. How would you deploy this safely in production?

## 19. Demo Answers You Should Be Ready To Say

### Why is Bloom safe?

Bloom is educational, not diagnostic. It uses explicit disclaimers, deterministic urgent-symptom rules, input/output safety filters, minor consent checks, protected backend routes, and server-side API key handling. Bloomie can classify or route, but it does not diagnose.

### Why use both localStorage and Firestore?

LocalStorage gives fast offline-friendly UX and supports anonymous users. Firestore gives cross-device persistence for accounts. The app writes locally first, then syncs cloud in the background.

### Why separate cycle logs and symptom logs?

Cycle logs contain period flow, period day, notes, and biometrics. Symptom logs contain catalog symptom items with severity and custom symptoms. Separating them keeps validation cleaner and lets the symptom catalog evolve independently.

### How does prediction work?

The app detects period starts from logged bleeding clusters, calculates cycle intervals, predicts next cycle length with ML when enough data exists, falls back to weighted averages otherwise, computes phase boundaries, and returns future period/ovulation/fertile windows with confidence.

### What is the ML model?

The cycle model is a weighted linear regression trained on cleaned menstrual cycle data. It predicts next cycle length from cycle history and user/profile features. The backend uses it only when enough cycle history exists and falls back safely if it fails.

### What does Bloomie use AI for?

AI is optional and narrow. It classifies intent, tone, or symptom keys when rules are low-confidence. It does not generate medical advice. Outputs are allowlisted and validated by the backend.

### How do clinics work?

Clinics are stored in Firestore and seeded from data files. The API filters active clinics by parish/type/service/search. Route calculation uses OpenRouteService through the backend so the API key is never exposed.

### How is admin secured?

The frontend hides admin links based on cached role, but that is only convenience. Backend routes must still verify the token and admin status before allowing admin operations.

## 20. Known Things To Mention Carefully

- The project has both `server.js` and `app.js`; `server.js` starts the live server, `app.js` is a reusable app factory for tests.
- There are duplicate/root algorithm copies in `algorithms/` and frontend copies in `frontend/js/algorithms/`.
- Some console/document text has encoding artifacts in comments or UI strings, likely from copied emoji/Unicode text.
- The Python cycle training paths are Kaggle-style absolute paths; they are training scripts, not normal local app runtime scripts.
- The biometric Python model artifacts exist, but the main cycle state route currently uses JS heuristic biometric scoring in its fusion path.
- Health and cycle predictions are estimates, not medical claims.

## 21. Answer Key: Easy Questions

1. What is Bloom?
Bloom is a reproductive-health support web app that helps users track periods, symptoms, cycle phases, pregnancy-related information, educational resources, and nearby clinics.

2. What problem does Bloom solve?
It helps users understand cycle patterns, record symptoms consistently, access reproductive-health education, and find care resources without treating the app as a diagnosis tool.

3. Who are the intended users?
People who want to track their menstrual cycle, symptoms, fertility-related timing, pregnancy information, or perimenopause changes. It also supports teens with safety and consent controls.

4. What technologies did you use?
Frontend: HTML, CSS, JavaScript, Vite, Firebase browser SDK. Backend: Node.js, Express, Firebase Admin, Firestore. ML: Python, scikit-learn/joblib artifacts. Testing: Vitest, jsdom, Supertest-style backend tests.

5. Is Bloom a medical diagnosis tool?
No. Bloom is educational and supportive. It gives estimates, pattern insights, and care-seeking guidance, but it does not diagnose or replace a clinician.

6. What is the difference between anonymous mode and account mode?
Anonymous mode stores data locally on the device. Account mode uses Firebase Auth and syncs data to Firestore through the backend while still keeping a local cache for responsiveness.

7. Why did you use Firebase?
Firebase provides authentication, ID tokens for secure backend calls, Firestore cloud storage, and notification support. It fits a student project because it reduces infrastructure complexity.

8. What data can a user log?
A user can log period flow, period day, symptoms, symptom severity, custom symptoms, notes, sleep score, stress level, and activity level.

9. What are the main pages in the app?
Home, login/register, onboarding/survey, dashboard, calendar, Bloomie assistant, pamphlets, clinics, profile, settings, reports, cycle history, and admin pages.

10. What does the dashboard show?
It shows the user's selected goal, cycle day, estimated phase, confidence, next period/fertile-window information, insights, charts, tools, and report export options.

11. What does the calendar do?
It lets users add/edit/delete daily logs and displays logged period days, symptoms, predicted period days, fertile windows, ovulation markers, and prediction summaries.

12. What is Bloomie?
Bloomie is the app's guided reproductive-health assistant. It uses rule-based routing, safety checks, memory, tone handling, and optional AI classification for ambiguous inputs.

13. What are pamphlets used for?
Pamphlets provide educational PDF resources on topics like cycle phases, PMS, PCOS, contraception, pregnancy, perimenopause, menstrual hygiene, and warning signs.

14. What is the clinic finder?
The clinic finder lists active clinics and lets users filter/search by parish, type, services, or text. It can also route users to clinics using OpenRouteService through the backend.

15. What is the admin panel for?
Admins can manage users, clinics, pamphlets, safety logs, feedback, contact messages, phase feedback, and analytics summaries.

16. What happens when the user logs out?
The app clears account-specific localStorage/sessionStorage keys, removes cached role data, switches back to anonymous mode, and signs out through Firebase Auth.

17. What is stored locally?
Daily logs, profile cache, goal, Bloomie memory, notification inbox, preferences, role cache, consent status cache, and session/cycle-state caches.

18. What is stored in Firestore?
Users, profiles, health data, cycle logs, symptom logs, biometric logs, phase feedback, consent records, clinic directory, pamphlets, admin users, audit logs, Bloomie memory, safety logs, analytics, contact messages, and feedback.

19. How does the app know whether a user is admin?
The frontend caches an admin flag for UI display, but the backend verifies the user's role/admin status before allowing admin operations.

20. What happens if the backend is offline?
The app keeps local data available, shows sync warnings, and in anonymous mode can fall back to local cycle estimation. Account mode avoids using local prediction as authoritative when backend sync is expected.

## 22. Answer Key: Medium Questions

1. Walk through what happens when a user saves a daily log.
The calendar collects the selected date, flow, symptoms, severities, biometrics, and notes. `saveDailyLog()` writes to localStorage first, then account users send cycle data to `/api/logs/:dateKey` and symptom data to `/api/symptoms/:dateKey`. The UI updates immediately and predictions refresh afterward.

2. Why does `db.js` write to localStorage before sending to the backend?
It keeps the app fast and resilient. The user sees their entry immediately even if the network or backend is slow, and a sync warning appears if cloud save fails.

3. How do cycle logs and symptom logs differ?
Cycle logs store period-related and biometric information such as flow level, period day, notes, sleep, stress, and activity. Symptom logs store symptom catalog items, severity, notes, and custom symptoms.

4. Why are symptoms stored separately from cycle logs?
It keeps validation and schemas cleaner. Symptoms depend on a catalog and severity model, while cycle logs depend on period timing/flow. Separating them also makes it easier to evolve symptom tracking independently.

5. How do you convert frontend symptom labels to backend symptom codes?
`db.js` loads the symptom catalog, indexes labels and codes, then maps labels like "Back pain" to canonical uppercase codes like `BACK_PAIN`. If no catalog match exists, it creates a fallback code from the label.

6. How is the symptom catalog loaded?
Frontend `utils.js` can load `frontend/data/symptoms.json` for static UI use, while `db.js` fetches `/catalog/symptoms?teenSafe=true&excludeSensitive=true` in account mode to use the backend/Firestore catalog.

7. What is the purpose of `cycle-state.js`?
It is the frontend adapter for cycle prediction. It calls `/api/cycles/state`, handles caching, applies logged-data precedence, resolves stale/future predictions, and provides a consistent state object to dashboard/calendar.

8. Why is phase logic not inside `dashboard.js` or `calendar.js`?
Those files should be integration and rendering layers. Keeping reproductive-health calculations inside engine files makes the logic reusable, testable, and less likely to diverge between pages.

9. How is current cycle phase calculated?
The engine finds the latest period start, estimates cycle length and period duration, calculates the user's day in cycle, then maps that day into menstrual, follicular, ovulatory, luteal, or late luteal phase.

10. How do you detect a new cycle start?
Period days are sorted into clusters. If the gap between bleeding days is more than 3 days, the next bleeding day is treated as the start of a new cycle.

11. Why is a gap greater than 3 days treated as a new period cluster?
It prevents consecutive bleeding days from being counted as separate cycles while still separating periods that are far enough apart to represent a new cycle.

12. How is average cycle length calculated?
The engine subtracts each period start date from the next period start date, producing cycle intervals, then averages those intervals.

13. How is prediction confidence calculated?
Confidence depends on history amount and stability. In the JS phase engine, low history gives low/medium confidence, while multiple cycles with low standard deviation and small range can become high confidence.

14. What does "logged period takes precedence" mean?
If the user logs today as a period day, the app overrides predicted phase and marks the phase as menstrual, because actual logged data is stronger than a model estimate.

15. How does the app avoid stale predictions?
It uses cache keys based on mode, last period day, period count, and today. It also resolves overdue predictions and recalculates after saves/deletes.

16. Why cache cycle state in sessionStorage?
To reduce repeated backend calls during one browsing session, especially because dashboard, notifications, and calendar may request the same state.

17. What is the role of `cyclesML.js`?
It exposes backend cycle prediction routes, runs Python ML when available, builds full cycle state, fuses symptoms/biometrics/feedback, caches results, and persists state to Firestore.

18. How does the backend merge request logs and Firestore logs?
`cyclesML.js` can use request-provided logs as an override for cycle data, then also reads symptom, biometric, and feedback records from Firestore. It normalizes everything by date key.

19. How are symptoms and biometrics used in phase estimation?
Recent symptom logs are scored against phase-support maps. Biometrics like sleep, stress, and activity add heuristic support. These are fused with cycle timing to produce a phase estimate and confidence.

20. What happens if the Python model fails?
The backend catches the error and uses the weighted-average fallback. The app still returns an educational prediction instead of failing the whole flow.

21. How does the clinic search filter work?
The backend reads active clinics from `clinicDirectory`, then filters by parish, type, service, and text search over name, address, parish, region, type, services, and phone numbers.

22. How does the OpenRouteService proxy protect the API key?
The browser calls the backend route. The backend validates coordinates and sends the request to OpenRouteService using `ORS_API_KEY` from server environment variables, so the key is never exposed to frontend code.

23. How does Bloomie route a user message?
It sanitizes and normalizes input, extracts signals, scores intents, checks urgent/safety conditions, resolves route confidence, and transitions to a node such as late period, heavy bleeding, mood, pelvic pain, pregnancy, or discharge.

24. How does Bloomie handle out-of-scope input?
`detectOutOfScope()` identifies topics outside reproductive health, but health signals override OOS. Bloomie either redirects gently, asks a clarifying follow-up, or returns to supported topic buttons.

25. How does Bloomie avoid giving diagnoses?
It has diagnosis redirect nodes, safety filters, output guards against diagnostic claims, and condition logic that distinguishes reported diagnoses from requests for diagnosis.

26. How is prompt injection handled?
`bloomie-safety.js` removes HTML/control characters and blocks patterns like "ignore previous instructions", "act as a doctor", "system:", jailbreak wording, and unsafe instruction requests.

27. Why is Anthropic called only through the backend?
The API key must stay secret. The backend proxy also rate-limits calls, validates input length, restricts prompts, and validates model outputs before returning them.

28. What does the AI endpoint return?
Depending on endpoint, it returns a strict JSON classification: intent, tone, structured extracted signals, or symptom catalog matches. It does not return free-form medical advice.

29. Why is AI restricted to classification/extraction instead of free advice?
Because medical advice is high-risk. Deterministic reviewed nodes and safety rules are easier to test and control, while AI helps only where language understanding is ambiguous.

30. How do guardian consent pages connect to backend consent routes?
Frontend consent pages call `/api/consent` routes for status/request/resend/respond. Guardian approve/deny links contain tokens, and the backend validates those tokens before updating consent records.

## 23. Answer Key: Hard Questions

1. Explain the complete `/api/cycles/state` computation pipeline.
The route verifies auth, reads request logs, ensures the user document exists, checks cache, fetches user/profile/log/feedback data, builds period clusters and cycle lengths, predicts cycle length using ML or fallback, computes phase and future cycle overlays, scores symptoms and biometrics, fuses all signals, builds display/explanation data, caches it, persists it, and returns the state.

2. How does the system handle conflicting cycle, symptom, and biometric signals?
It creates support scores for each phase, fuses them using weights, calculates agreement between top scores, and lowers confidence or uses softer wording when signals conflict.

3. What is the difference between cycle timing confidence and fused phase confidence?
Cycle timing confidence comes from cycle-history stability. Fused phase confidence combines cycle timing, symptoms, biometrics, and data-quality penalties into one confidence score.

4. How does `fuseSignals` weight cycle history, symptoms, and biometrics?
It gives cycle timing the main weight, symptom support a secondary weight, and biometrics a smaller optional weight when biometric patterns are detected. Low history and irregular cycles reduce cycle dominance.

5. Why lower cycle weight when history is low or irregular?
If cycle history is sparse or unstable, timing alone is less reliable. Lowering cycle weight lets recent symptoms and biometrics influence the estimate more fairly.

6. What are possible weaknesses of using weighted OLS for cycle length?
Linear regression may miss nonlinear hormonal/cycle patterns, may not generalize to irregular cycles, depends on training-data quality, and can be biased toward users similar to the dataset.

7. What features train the cycle model, and why?
Features include current cycle length, mean cycle length, luteal phase length, variability, cycle number, age, BMI, unusual bleeding, and reproductive category. They represent timing history and biological/contextual factors that may influence next cycle length.

8. How would model bias affect users with irregular cycles?
The model may overfit to typical-cycle patterns and underperform for PCOS, perimenopause, postpartum, stress-related disruption, or other irregular-cycle contexts. That is why confidence and fallback messaging matter.

9. What are the privacy risks of reproductive health data?
The data can reveal periods, pregnancy concerns, sexual health, symptoms, age, location/clinics, and possibly sensitive teen information. Unauthorized access could cause stigma, harm, or privacy violations.

10. How does the project reduce risk for minors?
It derives age bands, gates sensitive modules with guardian consent, restricts age-locked goals, filters sensitive pamphlets, applies minor-safe policy in Bloomie, and avoids unsafe/diagnostic responses.

11. What is the difference between authentication, authorization, and consent in this app?
Authentication proves who the user is using Firebase ID tokens. Authorization checks what role/access they have, such as admin. Consent checks whether a teen has guardian approval for sensitive features.

12. What backend routes require auth and why?
User data routes like logs, symptoms, profile, preferences, notifications, phase feedback, Bloomie memory, cycle state, and admin routes require auth because they read/write private data.

13. How does `requireAuth` backfill older user documents safely?
It checks for missing/old fields, builds a merged schema with defaults and delete-field markers for moved fields, writes with merge, and updates the in-memory data used for the request.

14. Why does the backend verify admin status instead of trusting localStorage?
LocalStorage can be changed by the user. Backend verification prevents a malicious user from simply setting `bloom_is_admin=1` and accessing admin APIs.

15. What happens if an email is unverified but guardian consent has been approved?
`requireAuth` allows the request if an approved consent exists, then updates Firebase Auth email verification in the background to smooth the transition.

16. How do you prevent a frontend user from changing their role?
The backend reads role/admin status from Firestore/admin records after verifying the Firebase token. Client-provided role values are not trusted for protected operations.

17. How do you protect API keys?
Secret keys like Anthropic and ORS are used only on the backend through environment variables. The frontend calls backend proxy routes instead of calling external APIs directly.

18. What happens if Firestore is unavailable during authentication?
`requireAuth` detects transient backend errors and returns a 503-style authentication-unavailable response instead of misclassifying the token as invalid.

19. How does the app degrade gracefully under network failure?
It keeps local logs, shows sync banners/toasts, reuses cache where appropriate, falls back in anonymous mode, and avoids wiping local data just because cloud data is temporarily empty.

20. Why does `cycle-state.js` allow local fallback in anonymous mode but not account mode?
Anonymous users only have local data, so fallback is expected. Account users expect backend-authoritative state; using local fallback could cause phase flips or inconsistency with cloud data.

21. What is the risk of importing backend engine code into frontend fallback?
It couples frontend and backend paths and may expose logic intended for server reuse. However, this engine is deterministic and not secret; the bigger risk is maintainability and bundle assumptions.

22. How does Bloomie distinguish "I have PCOS" from "Do I have PCOS?"
Reported-condition detection looks for phrases like "I was diagnosed with" or "my doctor told me." Diagnosis-seeking patterns like "Do I have" route to a diagnosis redirect instead of storing the condition.

23. Why is that distinction important?
If the user is reporting a known diagnosis, Bloomie can remember it for context. If the user is asking for diagnosis, Bloomie must not confirm or deny it and should encourage appropriate care.

24. How does Bloomie detect urgent symptoms?
It uses deterministic regex and entity rules for severe pain, heavy bleeding, dizziness/fainting, large clots, infection signs, pregnancy-related red flags, and downplaying language paired with serious symptoms.

25. Why must urgent routing be deterministic?
Urgent safety should not depend on probabilistic AI. Deterministic rules are testable, predictable, and safer for high-risk symptoms.

26. How are AI outputs validated before the client uses them?
Backend routes check that returned intents, tones, symptom codes, timing codes, red flags, and confidence values are in strict allowlists. Unknown values are dropped or rejected.

27. What would happen if Anthropic returned an invalid symptom code?
The backend filters it out or rejects the response, so the frontend does not receive unapproved codes.

28. How do you avoid sending PII to AI?
AI calls send only the current message and limited hints such as rule tier, phase, or recent symptom keys. They do not send full conversation history, profile, email, UID, or Firestore records.

29. How would you audit Bloomie's safety logs?
Use admin safety pages/routes to review safety events by category, timestamp, status, and reviewed flag. The admin can mark logs reviewed and identify patterns needing rule/template updates.

30. What data would you use to improve prediction accuracy over time?
Cycle starts, confirmed period durations, user feedback on phase, symptom timing/severity, biometric trends, and model error between predicted and actual next period dates.

31. How do you test edge cases for late periods, sparse logs, and current bleeding?
Use unit tests around `cycle-state.js`, `cyclePhaseEngine.js`, and calendar/dashboard flows. Cases should include one cycle only, no logs, period logged today, overdue predicted period, irregular lengths, and deleted logs.

32. How do you handle users with no period goal?
Goals like `no_period` or symptom tracking can hide or reduce bleeding-based predictions while still supporting symptom logs, education, and Bloomie guidance.

33. How does perimenopause affect prediction assumptions?
Perimenopause can make cycles irregular, so the app should reduce confidence, use softer wording, rely more on symptom patterns, and avoid overpromising precise cycle timing.

34. How would pregnancy mode differ from period tracking?
Pregnancy mode focuses on LMP-based due date, trimester milestones, pregnancy symptoms, safe/unsafe symptom education, and pregnancy-relevant Bloomie paths instead of period/fertile-window prediction.

35. What is the ethical issue with showing fertile windows?
Fertile windows are estimates and can be wrong, so users could misunderstand them as contraception or conception guarantees. The app must present them as educational estimates with disclaimers.

36. How would you explain confidence to a non-technical user?
Confidence means how much Bloom trusts the estimate based on how much history exists and how consistent the cycle data is. More consistent logged cycles usually means higher confidence.

37. How would you validate clinic data accuracy?
Cross-check clinic names, phone numbers, addresses, services, and status against official sources or direct contact, then update Firestore and mark inactive clinics appropriately.

38. What if a clinic closes or changes phone number?
Admin users can update or delete/deactivate clinic records. The app should also have a process for periodic verification or user/admin reporting.

39. How do you handle sensitive pamphlets for teens?
The catalog route checks the user's age band. Sensitive pamphlets are only shown when `sensitive=true` is requested and the user is 18+.

40. How would you deploy this safely in production?
Use proper environment variables, locked CORS origins, Firebase security rules, HTTPS, least-privilege service accounts, monitoring/logging, rate limits, tested consent/admin routes, reviewed medical copy, and a data retention/privacy policy.
