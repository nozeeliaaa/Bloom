# Appendix — UI Notes, Design Considerations & Supporting Materials

**Project:** Bloom — Menstrual Health Companion
**Section Author:** Jahzara Rose, Frontend Developer / UI & UX Designer
**Document Type:** Software Design Specification (SDS) Appendix

---

## A.1 Overview of the User Interface

Bloom is a web-based menstrual health application built for users aged 13 and older. The UI is designed to feel warm, approachable, and safe — particularly important for an application handling sensitive personal health data. The frontend is built with vanilla JavaScript (no framework), Vite for bundling, and modular ES6+ files.

The design system applies consistently across all pages using shared CSS custom properties defined in `frontend/css/theme.css` and component-level styles in `frontend/css/components.css`.

---

## A.2 Design Principles

### A.2.1 Warmth and Safety First
Menstrual health is a sensitive domain. Every design decision — from color choice to copy tone — was made with the user's emotional comfort in mind. This means:
- Soft, muted color palettes (rose, lavender, cream) rather than clinical whites and blues.
- Conversational, first-person copy throughout the Bloomie assistant.
- Non-alarmist language even when surfacing health concerns (e.g., "You might want to check in with a doctor" rather than "WARNING").

### A.2.2 Accessibility
Bloom is designed to meet WCAG 2.1 AA standards:
- Semantic HTML5 elements (`<nav>`, `<main>`, `<section>`, `<header>`, `<footer>`) are used throughout.
- All interactive elements carry accessible labels (`aria-label`, `role`, `aria-live`).
- Color is never the sole indicator of state — icons and text labels accompany all color-coded information (e.g., cycle phase badges include both color and text).
- Focus management is handled explicitly on modal open/close.
- The app supports both light and dark mode via `theme-manager.js` and CSS custom property switching.

### A.2.3 Progressive Disclosure
Complex health information is surfaced gradually:
- The Dashboard shows a high-level snapshot (current phase, cycle day, upcoming period).
- Deep insights (symptom trends, advanced cycle statistics) are accessible one level down via "Advanced Insights."
- Bloomie (the AI assistant) asks follow-up questions rather than front-loading all information at once.

### A.2.4 Age-Appropriate Adaptation
The UI adapts to user age group at registration:
- Users aged 13–17 see guardian consent prompts and age-appropriate language.
- All users see a consistent, non-clinical design, but adult-mode users have access to TTC (Trying to Conceive) and fertility tracking modules.

---

## A.3 UI Component Inventory

| Component | File | Purpose |
|-----------|------|---------|
| Navigation Bar | `utils.js` + inline HTML | Persistent top nav across all authenticated pages |
| Toast Notifications | `notifications.js` | Non-blocking feedback messages (success, error, info) |
| Modal Dialog | `utils.js` | Confirmation dialogs, detail overlays |
| Cycle Calendar | `calendar.js` | Interactive monthly calendar with log/predict overlays |
| Dashboard Snapshot | `dashboard.js` | Cycle phase card, day counter, upcoming events |
| Plotly Charts | `dashboard.js` | Cycle length trend line, dot matrix history |
| Bloomie Chat | `assistant.js` | AI conversation interface with bubble layout |
| PDF Export | `pdf-generator.js` | jsPDF-powered report download |
| Survey Flow | `survey.js` | Multi-step onboarding questionnaire |
| Clinic Search | `clinics.html` + JS | Filterable list of healthcare providers |
| Pamphlets/Resources | `frontend/data/pamphlets.json` | Educational health resource cards |
| Settings Panel | `settings.js` | User preferences, account, notification toggles |
| Admin Dashboard | `admin.js`, `admin-safety.js` | Safety log review, flagged user review (admin only) |

---

## A.4 Color & Theme System

Bloom uses a CSS custom property (variable) design token system. All colors are defined in `frontend/css/theme.css` and switched via `.dark-mode` class toggle.

**Primary Palette (Light Mode):**
- `--color-primary`: Rose/Mauve (primary actions, phase badges)
- `--color-secondary`: Lavender (accents, hover states)
- `--color-background`: Cream/Off-white
- `--color-surface`: White (cards, modals)
- `--color-text`: Dark charcoal
- `--color-text-muted`: Medium grey (secondary labels)
- `--color-danger`: Warm red (errors, urgency alerts)
- `--color-success`: Muted green (confirmations)

**Cycle Phase Colors:**
| Phase | Color Token | Meaning |
|-------|------------|---------|
| Menstrual | `--phase-menstrual` | Soft red/rose |
| Follicular | `--phase-follicular` | Light lavender |
| Ovulation | `--phase-ovulation` | Warm pink |
| Luteal | `--phase-luteal` | Muted purple |

**Dark Mode:** All tokens have dark-mode overrides. Dark mode reduces eye strain during nighttime use — important for a health app used in private, often late-night moments.

---

## A.5 Typography

- **Primary Font:** Nunito (Google Fonts) — rounded, friendly, highly legible at small sizes
- **Base Size:** 16px (1rem)
- **Scale:** 0.75rem (small labels) → 1rem (body) → 1.25rem (subheadings) → 1.5–2rem (headings)
- **Line Height:** 1.6 for body text to aid readability
- **Weight Usage:**
  - 400 — body text
  - 600 — labels, secondary headings
  - 700 — primary headings, CTAs

---

## A.6 Responsive Design

Bloom targets the following breakpoints:
| Breakpoint | Target |
|------------|--------|
| `< 480px` | Small mobile (iPhone SE, compact Android) |
| `480–768px` | Standard mobile |
| `768–1024px` | Tablet / iPad |
| `1024px+` | Desktop |

All layouts use CSS Grid and Flexbox. The calendar grid adapts from a 7-column desktop layout to a scrollable monthly view on mobile. The dashboard shifts from a 3-column card grid to a single-column stack on small screens.

---

## A.7 Navigation Structure

```
Home (Unauthenticated)
├── Login
├── Register
│   └── Guardian Consent Flow (ages 13-17)
│       ├── Consent Pending
│       ├── Consent Approved
│       ├── Consent Denied
│       └── Consent Expired
└── Survey (Onboarding)

Main App (Authenticated)
├── Dashboard (/)
├── Calendar (/calendar.html)
├── Bloomie Assistant (/assistant.html)
├── Fertility (/fertility.html) [TTC goal only]
├── Report (/report.html)
├── Clinics (/clinics.html)
├── Settings (/settings.html)
├── Profile (/profile.html)
├── Help (/help.html)
├── About (/about.html)
├── Privacy Policy (/privacy.html)
├── Terms of Service (/terms.html)
├── Accessibility (/accessibility.html)
└── Admin (admin-only)
    ├── /admin.html
    └── /admin-safety.html
```

---

## A.8 Form Design Conventions

All forms in Bloom follow these UI patterns:
- **Inline validation**: errors appear below the relevant field, not at the top of the form.
- **Password strength indicator**: visual meter shown during registration.
- **Required field markers**: asterisk (*) used for required fields, accompanied by a legend.
- **Submit state**: buttons show a loading spinner during async operations and are disabled to prevent double submission.
- **Error recovery**: field-level error messages are specific (e.g., "Password must contain at least one uppercase letter") rather than generic ("Invalid input").

---

## A.9 AI Assistant (Bloomie) UI Design Notes

The Bloomie chat interface (`assistant.html`) follows a messaging app metaphor:
- **Bubble layout**: Bloomie's messages appear left-aligned in soft lavender bubbles; user messages are right-aligned in a rose accent bubble.
- **Typing indicator**: animated dots shown while Bloomie is "processing."
- **Quick-reply chips**: suggested response buttons appear below Bloomie messages to reduce friction for common choices.
- **Safety banner**: a persistent "Bloom is not a medical diagnostic tool" disclaimer is pinned above the chat input.
- **Session memory indicator**: a subtle badge shows when Bloomie is referencing a prior session.

---

## A.10 Age Gating & Guardian Consent UI

The registration flow (`register.html`) includes:
1. Date of birth input with age calculation.
2. If age < 13: registration blocked with a clear, non-shaming message ("Bloom is for users 13 and older. Please ask a parent or guardian to help you find age-appropriate resources.").
3. If age 13–17: a guardian email field is revealed. The user is told that their account is pending guardian approval.
4. Dedicated consent pages (`consent-pending.html`, `consent-approved.html`, `consent-denied.html`, `consent-expired.html`) are served to the guardian link recipient.

---

## A.11 PDF Report UI Notes

The PDF report (generated by `pdf-generator.js` using jsPDF and jsPDF-autotable) is designed to be shareable with healthcare providers:
- Header includes the Bloom logo, user first name, and report date range.
- Sections: Cycle Summary, Logged Symptoms, Predictions, AI Chat Summary.
- All health disclaimers appear in the footer of every page.
- Font size is optimized for A4 / Letter paper sizes.

---

## A.12 Third-Party UI Dependencies

| Library | Version | Usage |
|---------|---------|-------|
| Plotly.js | Latest CDN | Cycle length trend charts, dot matrix history |
| jsPDF | 2.x | PDF report generation |
| jsPDF-autotable | 3.x | Tabular data in PDF exports |
| Google Fonts (Nunito) | — | Primary typeface |
| Firebase JS SDK | 9.x (modular) | Auth, Firestore real-time sync |

---

## A.13 Known UI Limitations & Technical Debt

1. **No dedicated state management**: Each page manages its own state in module-scoped globals. A future refactor could benefit from a lightweight reactive store.
2. **Plotly.js bundle size**: Plotly adds ~3MB to the bundle. Consider replacing with a lighter charting library (Chart.js) for non-critical charts.
3. **IndexedDB schema versioning**: The local sync layer (`db.js`) uses a fixed schema version; migration scripts are not yet implemented for schema changes.
4. **Safari compatibility**: Some CSS Grid features used on the calendar may have edge cases in older Safari versions.
5. **Offline mode**: IndexedDB provides local persistence, but full offline-first PWA behavior (service worker, background sync) is not yet implemented.

---

## A.14 Supporting Materials

- **Figma Design Files**: Available upon request from the design team.
- **Accessibility Audit Report**: Pending — to be completed before v1.0 public release.
- **User Research Notes**: Collected during beta testing with 12 users aged 16–35.
- **Copy Tone Guide**: Maintained by the UX writing contributor; defines tone, vocabulary restrictions (no clinical jargon without plain-English companion), and crisis communication protocols.

---

*End of Appendix*
