import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("docs/diagrams");
const outFile = path.join(outDir, "Bloom_Activity_Diagrams.xml");

const pink = "#c2187a";
const fill = "#fff0f7";
const laneFill = "#fdf2f8";
const dbFill = "#eefcf7";
const dbStroke = "#178f69";

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const lanes = {
  user: { id: "userLane", label: "User", x: 30, w: 340 },
  system: { id: "systemLane", label: "System (Bloom)", x: 430, w: 340 },
  db: { id: "dbLane", label: "Database (Firestore)", x: 830, w: 340 },
};

function nodeStyle(type, lane) {
  if (type === "start") return "ellipse;html=1;aspect=fixed;fillColor=#ec008c;strokeColor=#ec008c;";
  if (type === "end") return "ellipse;html=1;shape=doubleEllipse;aspect=fixed;fillColor=#ffffff;strokeColor=#ec008c;strokeWidth=3;";
  if (type === "fork" || type === "join") return "shape=line;html=1;strokeWidth=8;strokeColor=#111111;verticalLabelPosition=bottom;verticalAlign=top;";
  if (type === "decision") return `rhombus;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${pink};fontSize=12;`;
  if (lane === "db") return `rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=${dbFill};strokeColor=${dbStroke};fontSize=12;`;
  return `rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=${fill};strokeColor=${pink};fontSize=12;`;
}

function geom(type, y, xOverride) {
  if (type === "start" || type === "end") return { x: xOverride ?? 158, y, w: 24, h: 24 };
  if (type === "fork" || type === "join") return { x: xOverride ?? 105, y, w: 130, h: 10 };
  if (type === "decision") return { x: xOverride ?? 110, y, w: 120, h: 74 };
  return { x: xOverride ?? 40, y, w: 260, h: 50 };
}

function diagramXml(page) {
  const pageHeight = Math.max(980, page.height ?? 0);
  const cells = [
    '<mxCell id="0" />',
    '<mxCell id="1" parent="0" />',
    ...Object.values(lanes).map((lane) => {
      const style = lane.id === "dbLane"
        ? `swimlane;horizontal=1;startSize=30;rounded=0;fillColor=${dbFill};strokeColor=${dbStroke};fontStyle=1;`
        : `swimlane;horizontal=1;startSize=30;rounded=0;fillColor=${laneFill};strokeColor=${pink};fontStyle=1;`;
      return `<mxCell id="${lane.id}" value="${esc(lane.label)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${lane.x}" y="30" width="${lane.w}" height="${pageHeight - 60}" as="geometry" /></mxCell>`;
    }),
  ];

  for (const n of page.nodes) {
    const g = geom(n.type, n.y, n.x);
    cells.push(`<mxCell id="${n.id}" value="${esc(n.label ?? "")}" style="${nodeStyle(n.type, n.lane)}" vertex="1" parent="${lanes[n.lane].id}"><mxGeometry x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" as="geometry" /></mxCell>`);
  }

  for (const e of page.edges) {
    const label = e.label ? ` value="${esc(e.label)}"` : "";
    cells.push(`<mxCell id="${e.id}"${label} style="orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;strokeColor=${pink};strokeWidth=2;fontSize=11;" edge="1" parent="1" source="${e.from}" target="${e.to}"><mxGeometry relative="1" as="geometry" /></mxCell>`);
  }

  return `<diagram id="${esc(page.id)}" name="${esc(page.name)}"><mxGraphModel dx="1600" dy="1100" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1200" pageHeight="${pageHeight}" math="0" shadow="0"><root>${cells.join("")}</root></mxGraphModel></diagram>`;
}

function buildPage(id, name, steps, edges) {
  let counter = 0;
  const nodes = [];
  const byKey = {};
  for (const [lane, label, y, type = "action", key = null, x = undefined] of steps) {
    const node = { id: `${id}_n${++counter}`, lane, label, y, type, x };
    nodes.push(node);
    if (key) byKey[key] = node.id;
  }
  const edgeCells = edges.map(([from, to, label = ""], index) => {
    if (!byKey[from] || !byKey[to]) throw new Error(`${name}: missing edge key ${from} -> ${to}`);
    return { id: `${id}_e${index + 1}`, from: byKey[from], to: byKey[to], label };
  });
  return { id, name, nodes, edges: edgeCells, height: Math.max(...nodes.map((n) => n.y)) + 150 };
}

const pages = [
  buildPage("uc001", "001 Sign Up", [
    ["user", "", 45, "start", "start"],
    ["user", "Navigate to Create Account", 100, "action", "open"],
    ["system", "Display registration form", 100, "action", "form"],
    ["user", "Cancel and return to login?", 190, "decision", "cancel"],
    ["user", "View login page", 290, "action", "loginEnd"],
    ["user", "", 360, "end", "endCancel"],
    ["user", "Enter name, email, password, date of birth", 290, "action", "enter"],
    ["system", "Validate required fields, email format, password strength, date of birth", 390, "action", "validate"],
    ["system", "Details valid?", 490, "decision", "valid"],
    ["system", "Display field errors", 590, "action", "errors"],
    ["user", "Abandon sign up?", 690, "decision", "abandonInvalid"],
    ["user", "Exit registration", 790, "action", "exitInvalid"],
    ["user", "", 860, "end", "endInvalid"],
    ["user", "Correct details and resubmit", 790, "action", "correctDetails"],
    ["system", "Revalidate corrected details", 890, "action", "revalidate"],
    ["db", "Check Firebase Auth/users for duplicate email", 990, "action", "dupCheck"],
    ["system", "Email already registered?", 1090, "decision", "dup"],
    ["system", "Show duplicate email options", 1190, "action", "dupMsg"],
    ["user", "Choose sign in/reset or use different email", 1290, "decision", "dupChoice"],
    ["user", "Go to sign in / password reset", 1390, "action", "signinReset"],
    ["user", "", 1460, "end", "endDuplicate"],
    ["user", "Enter different email", 1390, "action", "newEmail"],
    ["system", "Accept new email for account checks", 1490, "action", "acceptEmail"],
    ["system", "Calculate age from date of birth", 1590, "action", "age"],
    ["system", "Age under 13?", 1690, "decision", "under13"],
    ["system", "Block account creation and explain minimum age requirement", 1790, "action", "deny"],
    ["db", "No user account is created; store only non-identifying blocked signup audit if required", 1890, "action", "auditDeny"],
    ["user", "View account creation denied message", 1990, "action", "denyView"],
    ["user", "", 2060, "end", "endUnder13"],
    ["system", "Age 13 to 17?", 1990, "decision", "teen"],
    ["user", "Enter guardian email for consent", 2090, "action", "guardian"],
    ["system", "Validate guardian email and teen consent eligibility", 2190, "action", "guardVal"],
    ["system", "Guardian email valid?", 2290, "decision", "guardOk"],
    ["system", "Show guardian email error", 2390, "action", "guardErr"],
    ["user", "Cancel teen registration?", 2490, "decision", "cancelTeen"],
    ["user", "Exit without account", 2590, "action", "teenExit"],
    ["user", "", 2660, "end", "endTeenCancel"],
    ["user", "Enter corrected guardian email", 2590, "action", "guardianRetry"],
    ["system", "Create limited pending teen account and consent token", 2690, "action", "pending"],
    ["db", "Store users/{uid} status=pendingConsent and consents/{token}", 2790, "action", "storePending"],
    ["system", "Send guardian consent email", 2890, "action", "sendConsent"],
    ["user", "View pending guardian approval page", 2990, "action", "pendingView"],
    ["user", "", 3060, "end", "endPending"],
    ["system", "Create active Firebase Auth account", 2090, "action", "createAdult"],
    ["system", "", 2180, "fork", "adultFork"],
    ["db", "Store users/{uid}, profile defaults, preferences defaults", 2250, "action", "storeAdult"],
    ["system", "Send verification email", 2250, "action", "verifyEmail"],
    ["system", "", 2350, "join", "adultJoin"],
    ["system", "Email sent successfully?", 2440, "decision", "emailSent"],
    ["system", "Show email sending error / retry later", 2540, "action", "emailError"],
    ["user", "", 2610, "end", "endEmailError"],
    ["user", "View verify email / next step message", 2540, "action", "successView"],
    ["user", "", 2610, "end", "endSuccess"],
  ], [
    ["start", "open"], ["open", "form"], ["form", "cancel"], ["cancel", "loginEnd", "Yes"], ["loginEnd", "endCancel"], ["cancel", "enter", "No"],
    ["enter", "validate"], ["validate", "valid"], ["valid", "errors", "No"], ["errors", "abandonInvalid"], ["abandonInvalid", "exitInvalid", "Yes"], ["exitInvalid", "endInvalid"], ["abandonInvalid", "correctDetails", "No"], ["correctDetails", "revalidate"], ["valid", "dupCheck", "Yes"], ["revalidate", "dupCheck"],
    ["dupCheck", "dup"], ["dup", "dupMsg", "Yes"], ["dupMsg", "dupChoice"], ["dupChoice", "signinReset", "Sign in/reset"], ["signinReset", "endDuplicate"], ["dupChoice", "newEmail", "Different email"], ["newEmail", "acceptEmail"], ["acceptEmail", "age"], ["dup", "age", "No"],
    ["age", "under13"], ["under13", "deny", "Yes"], ["deny", "auditDeny"], ["auditDeny", "denyView"], ["denyView", "endUnder13"], ["under13", "teen", "No"],
    ["teen", "guardian", "Yes"], ["guardian", "guardVal"], ["guardVal", "guardOk"], ["guardOk", "guardErr", "No"], ["guardErr", "cancelTeen"], ["cancelTeen", "teenExit", "Yes"], ["teenExit", "endTeenCancel"], ["cancelTeen", "guardianRetry", "No"], ["guardianRetry", "pending"], ["guardOk", "pending", "Yes"],
    ["pending", "storePending"], ["storePending", "sendConsent"], ["sendConsent", "pendingView"], ["pendingView", "endPending"], ["teen", "createAdult", "No"], ["createAdult", "adultFork"], ["adultFork", "storeAdult"], ["adultFork", "verifyEmail"], ["storeAdult", "adultJoin"], ["verifyEmail", "adultJoin"], ["adultJoin", "emailSent"], ["emailSent", "emailError", "No"], ["emailError", "endEmailError"], ["emailSent", "successView", "Yes"], ["successView", "endSuccess"],
  ]),

  buildPage("uc003", "003 Sign In", [
    ["user", "", 45, "start", "start"], ["user", "Navigate to Log In", 100, "action", "open"], ["system", "Display login form", 100, "action", "form"],
    ["user", "Cancel / close login?", 185, "decision", "cancel"], ["user", "Return to landing page", 280, "action", "cancelView"], ["user", "", 350, "end", "endCancel"],
    ["user", "Enter email and password", 280, "action", "enter"], ["user", "Forgot password?", 370, "decision", "forgot"], ["user", "Enter recovery email", 470, "action", "recovery"], ["system", "Validate recovery email and request reset", 470, "action", "resetReq"], ["db", "Look up auth account without revealing whether it exists", 470, "action", "resetDb"], ["system", "Send reset email or generic confirmation", 570, "action", "resetSend"], ["user", "View reset email confirmation", 670, "action", "resetView"], ["user", "", 740, "end", "endReset"],
    ["user", "Click Log In", 470, "action", "submit"], ["system", "Validate input format", 470, "action", "validate"], ["system", "Input valid?", 570, "decision", "valid"], ["system", "Show missing/invalid input message", 670, "action", "inputErr"],
    ["system", "Authenticate with Firebase", 670, "action", "auth"], ["db", "Verify credentials, token, email verification, disabled status", 670, "action", "authDb"], ["system", "Credentials accepted?", 770, "decision", "accepted"],
    ["system", "Increment failed attempt / rate limit if needed", 870, "action", "attempt"], ["system", "Too many attempts?", 970, "decision", "locked"], ["system", "Show temporary lockout message", 1070, "action", "lockMsg"], ["user", "", 1140, "end", "endLocked"],
    ["system", "Show login failed message", 1070, "action", "failMsg"], ["system", "", 870, "fork", "signinFork"], ["db", "Read users/{uid}", 970, "action", "readUser", 20], ["db", "Read preferences/{uid}", 970, "action", "readPrefs", 60], ["db", "Read consent status", 970, "action", "readConsent", 100], ["system", "", 1070, "join", "signinJoin"], ["system", "Email verified and account active?", 1170, "decision", "active"],
    ["system", "Route to verification/pending/denied consent page", 1270, "action", "pendingPage"], ["user", "", 1340, "end", "endPending"], ["system", "Create session and load dashboard", 1270, "action", "dashboard"], ["user", "", 1340, "end", "endSuccess"],
  ], [
    ["start", "open"], ["open", "form"], ["form", "cancel"], ["cancel", "cancelView", "Yes"], ["cancelView", "endCancel"], ["cancel", "enter", "No"],
    ["enter", "forgot"], ["forgot", "recovery", "Yes"], ["recovery", "resetReq"], ["resetReq", "resetDb"], ["resetDb", "resetSend"], ["resetSend", "resetView"], ["resetView", "endReset"],
    ["forgot", "submit", "No"], ["submit", "validate"], ["validate", "valid"], ["valid", "inputErr", "No"], ["inputErr", "enter"], ["valid", "auth", "Yes"], ["auth", "authDb"], ["authDb", "accepted"],
    ["accepted", "attempt", "No"], ["attempt", "locked"], ["locked", "lockMsg", "Yes"], ["lockMsg", "endLocked"], ["locked", "failMsg", "No"], ["failMsg", "enter"],
    ["accepted", "signinFork", "Yes"], ["signinFork", "readUser"], ["signinFork", "readPrefs"], ["signinFork", "readConsent"], ["readUser", "signinJoin"], ["readPrefs", "signinJoin"], ["readConsent", "signinJoin"], ["signinJoin", "active"], ["active", "pendingPage", "No"], ["pendingPage", "endPending"], ["active", "dashboard", "Yes"], ["dashboard", "endSuccess"],
  ]),

  buildPage("uc020", "020 Complete Survey", [
    ["user", "", 45, "start", "start"], ["user", "Open onboarding survey", 100, "action", "open"], ["system", "Verify session and onboarding status", 100, "action", "session"], ["db", "Read users/{uid}, preferences, saved survey draft", 100, "action", "read"],
    ["system", "Onboarding already complete?", 195, "decision", "complete"], ["system", "Route to dashboard; survey not required", 300, "action", "already"], ["user", "", 370, "end", "endAlready"],
    ["system", "Display age-appropriate survey sections", 300, "action", "display"], ["user", "Answer health details, goals, cycle history, preferences", 400, "action", "answer"], ["user", "Leave survey?", 500, "decision", "leave"],
    ["system", "Save draft before leaving?", 600, "decision", "saveDraftQ"], ["db", "Store partial survey draft", 700, "action", "storeDraft"], ["user", "Exit with draft saved", 800, "action", "draftEnd"], ["user", "", 870, "end", "endDraft"],
    ["user", "Exit without saving changes", 700, "action", "discardEnd"], ["user", "", 770, "end", "endDiscard"], ["user", "Submit survey", 600, "action", "submit"],
    ["system", "Validate completeness, allowed values, date ranges, age restrictions", 700, "action", "validate"], ["system", "Survey valid?", 800, "decision", "valid"], ["system", "Show section errors and focus first invalid field", 900, "action", "errors"],
    ["system", "", 900, "fork", "surveyFork"], ["db", "Save survey responses", 1000, "action", "saveResponses"], ["db", "Update users/{uid}.profile and onboardingComplete=true", 1000, "action", "saveProfile", 20], ["db", "Save preferences selected during survey", 1000, "action", "savePrefs", 60],
    ["system", "", 1100, "join", "surveyJoin"], ["system", "Generate initial cycle/phase insight if enough data", 1200, "action", "insight"], ["db", "Store phaseEstimation and timestamps", 1200, "action", "saveInsight"], ["system", "Route to dashboard", 1300, "action", "dashboard"], ["user", "", 1370, "end", "endSuccess"],
  ], [
    ["start", "open"], ["open", "session"], ["session", "read"], ["read", "complete"], ["complete", "already", "Yes"], ["already", "endAlready"], ["complete", "display", "No"], ["display", "answer"],
    ["answer", "leave"], ["leave", "saveDraftQ", "Yes"], ["saveDraftQ", "storeDraft", "Yes"], ["storeDraft", "draftEnd"], ["draftEnd", "endDraft"], ["saveDraftQ", "discardEnd", "No"], ["discardEnd", "endDiscard"],
    ["leave", "submit", "No"], ["submit", "validate"], ["validate", "valid"], ["valid", "errors", "No"], ["errors", "answer"], ["valid", "surveyFork", "Yes"], ["surveyFork", "saveResponses"], ["surveyFork", "saveProfile"], ["surveyFork", "savePrefs"], ["saveResponses", "surveyJoin"], ["saveProfile", "surveyJoin"], ["savePrefs", "surveyJoin"], ["surveyJoin", "insight"], ["insight", "saveInsight"], ["saveInsight", "dashboard"], ["dashboard", "endSuccess"],
  ]),

  buildPage("uc021", "021 Manage Profile & Preferences", [
    ["user", "", 45, "start", "start"], ["user", "Open Profile / Preferences", 100, "action", "open"], ["system", "Verify authenticated session", 100, "action", "session"], ["system", "Session valid?", 195, "decision", "sessionOk"],
    ["system", "Redirect to sign in", 300, "action", "signin"], ["user", "", 370, "end", "endSignin"], ["db", "Read users/{uid}/profile and preferences/{uid}", 300, "action", "read"], ["system", "Display editable fields and privacy controls", 400, "action", "display"],
    ["user", "Choose edit, cancel, or delete data option", 500, "action", "choose"], ["user", "Cancel without saving?", 600, "decision", "cancel"], ["user", "Return to previous page with no changes", 700, "action", "cancelView"], ["user", "", 770, "end", "endCancel"],
    ["system", "Minor account?", 700, "decision", "minor"], ["system", "Lock pregnancy/sensitive options and force hideSensitive=true", 800, "action", "minorLock"], ["user", "Edit nickname, goals, reminders, theme, privacy", 800, "action", "edit"],
    ["user", "No changes made?", 900, "decision", "noChanges"], ["system", "Show no changes to save", 1000, "action", "noChangeView"], ["user", "", 1070, "end", "endNoChange"],
    ["user", "Click Save", 1000, "action", "saveClick"], ["system", "Validate values, quiet hours, reminder types, consent requirement", 1100, "action", "validate"], ["system", "Changes valid?", 1200, "decision", "valid"],
    ["system", "Show validation errors", 1300, "action", "errors"], ["system", "", 1300, "fork", "profileFork"], ["db", "Merge users/{uid}.profile changes", 1400, "action", "writeProfile", 20], ["db", "Merge preferences/{uid} changes", 1400, "action", "writePrefs", 60], ["db", "Write audit log for changed fields", 1400, "action", "writeAudit", 100], ["system", "", 1500, "join", "profileJoin"], ["system", "Apply updated settings and show success", 1600, "action", "success"], ["user", "", 1670, "end", "endSuccess"],
  ], [
    ["start", "open"], ["open", "session"], ["session", "sessionOk"], ["sessionOk", "signin", "No"], ["signin", "endSignin"], ["sessionOk", "read", "Yes"], ["read", "display"], ["display", "choose"],
    ["choose", "cancel"], ["cancel", "cancelView", "Yes"], ["cancelView", "endCancel"], ["cancel", "minor", "No"], ["minor", "minorLock", "Yes"], ["minorLock", "edit"], ["minor", "edit", "No"],
    ["edit", "noChanges"], ["noChanges", "noChangeView", "Yes"], ["noChangeView", "endNoChange"], ["noChanges", "saveClick", "No"], ["saveClick", "validate"], ["validate", "valid"], ["valid", "errors", "No"], ["errors", "edit"], ["valid", "profileFork", "Yes"], ["profileFork", "writeProfile"], ["profileFork", "writePrefs"], ["profileFork", "writeAudit"], ["writeProfile", "profileJoin"], ["writePrefs", "profileJoin"], ["writeAudit", "profileJoin"], ["profileJoin", "success"], ["success", "endSuccess"],
  ]),

  buildPage("uc022", "022 View Dashboard", [
    ["user", "", 45, "start", "start"], ["user", "Open Dashboard", 100, "action", "open"], ["system", "Verify session, account status, and consent", 100, "action", "verify"], ["system", "User allowed?", 195, "decision", "allowed"],
    ["system", "Redirect to login / consent pending / denied page", 300, "action", "blocked"], ["user", "", 370, "end", "endBlocked"], ["system", "", 300, "fork", "dashLoadFork"], ["db", "Read profile and preferences", 400, "action", "readProfile", 20], ["db", "Read recent cycle logs", 400, "action", "readLogs", 60], ["db", "Read phase feedback and game progress", 400, "action", "readExtras", 100], ["system", "", 500, "join", "dashLoadJoin"],
    ["system", "Required profile/onboarding data exists?", 600, "decision", "profile"], ["system", "Show onboarding prompt and limited dashboard", 700, "action", "onboarding"], ["user", "", 770, "end", "endOnboarding"],
    ["system", "Calculate phase, predictions, insights, alerts, dashboard cards", 700, "action", "calc"], ["system", "Enough cycle log data?", 800, "decision", "enough"], ["system", "Show starter dashboard with log-cycle CTA", 900, "action", "starter"], ["user", "", 970, "end", "endStarter"],
    ["system", "Show personalized dashboard", 900, "action", "personal"], ["user", "Select card: calendar, learn, clinics, chat, feedback, settings", 1000, "action", "select"], ["system", "Route to selected feature", 1100, "action", "route"], ["user", "", 1170, "end", "endRouted"],
    ["user", "Close dashboard after viewing", 1100, "action", "close"], ["user", "", 1170, "end", "endViewed"],
  ], [
    ["start", "open"], ["open", "verify"], ["verify", "allowed"], ["allowed", "blocked", "No"], ["blocked", "endBlocked"], ["allowed", "dashLoadFork", "Yes"], ["dashLoadFork", "readProfile"], ["dashLoadFork", "readLogs"], ["dashLoadFork", "readExtras"], ["readProfile", "dashLoadJoin"], ["readLogs", "dashLoadJoin"], ["readExtras", "dashLoadJoin"], ["dashLoadJoin", "profile"],
    ["profile", "onboarding", "No"], ["onboarding", "endOnboarding"], ["profile", "calc", "Yes"], ["calc", "enough"], ["enough", "starter", "No"], ["starter", "endStarter"],
    ["enough", "personal", "Yes"], ["personal", "select"], ["select", "route"], ["route", "endRouted"], ["personal", "close"], ["close", "endViewed"],
  ]),

  buildPage("uc023", "023 View Calendar", [
    ["user", "", 45, "start", "start"], ["user", "Open cycle calendar", 100, "action", "open"], ["system", "Verify session and load month range", 100, "action", "load"], ["system", "", 190, "fork", "calendarFork"], ["db", "Read users/{uid}/cycleLogs for visible range", 290, "action", "readLogs", 20], ["db", "Read user phase profile and preferences", 290, "action", "readProfile", 60], ["system", "", 390, "join", "calendarJoin"],
    ["system", "Existing logs found?", 490, "decision", "logs"], ["system", "Render empty calendar with first-log prompt", 590, "action", "empty"], ["system", "Calculate cycle phase, period estimate, fertile window overlay", 590, "action", "calc"],
    ["system", "Display calendar", 690, "action", "display"], ["user", "View only or select date?", 790, "decision", "select"], ["user", "Close calendar after viewing", 890, "action", "viewEnd"], ["user", "", 960, "end", "endView"],
    ["db", "Read selected date log", 890, "action", "readDate"], ["system", "Log exists?", 990, "decision", "exists"], ["system", "Pre-fill edit form", 1090, "action", "prefill"], ["system", "Open blank log form", 1090, "action", "blank"],
    ["user", "Choose Save, Delete, or Cancel", 1190, "action", "choose"], ["user", "Cancel log edit", 1290, "action", "cancelEdit"], ["user", "", 1360, "end", "endCancel"],
    ["system", "Validate log details", 1290, "action", "validate"], ["system", "Log valid?", 1390, "decision", "valid"], ["system", "Show log error message", 1490, "action", "error"],
    ["system", "", 1490, "fork", "logWriteFork"], ["db", "Write/update/delete cycle log and mirror legacy path", 1590, "action", "write"], ["db", "Update users/{uid}.lastPeriodStart when period day is logged", 1590, "action", "updateUser", 60], ["system", "", 1690, "join", "logWriteJoin"], ["system", "Recalculate predictions and refresh calendar", 1790, "action", "refresh"], ["user", "", 1860, "end", "endSaved"],
  ], [
    ["start", "open"], ["open", "load"], ["load", "calendarFork"], ["calendarFork", "readLogs"], ["calendarFork", "readProfile"], ["readLogs", "calendarJoin"], ["readProfile", "calendarJoin"], ["calendarJoin", "logs"], ["logs", "empty", "No"], ["logs", "calc", "Yes"], ["empty", "display"], ["calc", "display"], ["display", "select"],
    ["select", "viewEnd", "View only"], ["viewEnd", "endView"], ["select", "readDate", "Select date"], ["readDate", "exists"], ["exists", "prefill", "Yes"], ["exists", "blank", "No"], ["prefill", "choose"], ["blank", "choose"],
    ["choose", "cancelEdit", "Cancel"], ["cancelEdit", "endCancel"], ["choose", "validate", "Save/Delete"], ["validate", "valid"], ["valid", "error", "No"], ["error", "choose"], ["valid", "logWriteFork", "Yes"], ["logWriteFork", "write"], ["logWriteFork", "updateUser"], ["write", "logWriteJoin"], ["updateUser", "logWriteJoin"], ["logWriteJoin", "refresh"], ["refresh", "endSaved"],
  ]),

  buildPage("uc024", "024 View Educational Content", [
    ["user", "", 45, "start", "start"], ["user", "Open Learn / Educational Content", 100, "action", "open"], ["system", "Request published pamphlets/resources", 100, "action", "request"], ["system", "", 190, "fork", "learnFork"], ["db", "Read pamphlets collection", 290, "action", "read"], ["db", "Read user age band when signed in", 290, "action", "readAge", 60], ["system", "", 390, "join", "learnJoin"],
    ["system", "Apply status, age-band, sensitive-content filters", 490, "action", "filter"], ["system", "Any content available?", 590, "decision", "any"], ["system", "Show no educational content available message", 690, "action", "noneAll"], ["user", "", 760, "end", "endNone"],
    ["system", "Display categories, list, and search controls", 690, "action", "display"], ["user", "Search/filter, open item, or leave?", 790, "decision", "choice"], ["user", "Leave Learn page", 890, "action", "leave"], ["user", "", 960, "end", "endLeave"],
    ["user", "Enter keyword/category", 890, "action", "keyword"], ["system", "Filter title, summary, category", 990, "action", "search"], ["system", "Results found?", 1090, "decision", "results"], ["system", "Show no-results message and refine option", 1190, "action", "noResults"], ["user", "", 1260, "end", "endNoResults"],
    ["user", "Select pamphlet/resource", 1190, "action", "select"], ["db", "Read pamphlets/{id}", 1190, "action", "readOne"], ["system", "Resource published and allowed?", 1290, "decision", "allowed"], ["system", "Show locked/unavailable message", 1390, "action", "locked"], ["user", "", 1460, "end", "endLocked"],
    ["system", "Display full content and PDF/resource link", 1390, "action", "show"], ["user", "Open/download PDF or close content", 1490, "action", "download"], ["user", "", 1560, "end", "endViewed"],
  ], [
    ["start", "open"], ["open", "request"], ["request", "learnFork"], ["learnFork", "read"], ["learnFork", "readAge"], ["read", "learnJoin"], ["readAge", "learnJoin"], ["learnJoin", "filter"], ["filter", "any"], ["any", "noneAll", "No"], ["noneAll", "endNone"], ["any", "display", "Yes"],
    ["display", "choice"], ["choice", "leave", "Leave"], ["leave", "endLeave"], ["choice", "keyword", "Search"], ["keyword", "search"], ["search", "results"], ["results", "noResults", "No"], ["noResults", "endNoResults"],
    ["results", "select", "Yes"], ["choice", "select", "Open item"], ["select", "readOne"], ["readOne", "allowed"], ["allowed", "locked", "No"], ["locked", "endLocked"], ["allowed", "show", "Yes"], ["show", "download"], ["download", "endViewed"],
  ]),

  buildPage("uc025", "025 Search Clinics", [
    ["user", "", 45, "start", "start"], ["user", "Open Clinics page", 100, "action", "open"], ["system", "Request active clinic directory", 100, "action", "request"], ["db", "Read clinicDirectory where status=active", 100, "action", "read"],
    ["system", "Directory loaded?", 200, "decision", "loaded"], ["system", "Show clinic directory error", 300, "action", "loadErr"], ["user", "", 370, "end", "endError"],
    ["system", "Display search, parish/type/service filters, clinic list", 300, "action", "display"], ["user", "Enter search, choose filters, clear filters, select clinic, or leave", 400, "action", "choose"],
    ["system", "Apply filters/search", 500, "action", "apply"], ["system", "Clinics found?", 600, "decision", "found"], ["system", "Show no clinics found and refine/clear option", 700, "action", "none"], ["user", "", 770, "end", "endNone"],
    ["system", "Display matching clinics sorted by parish/name", 700, "action", "matches"], ["user", "Select clinic card?", 800, "decision", "select"], ["user", "Leave after browsing list", 900, "action", "leave"], ["user", "", 970, "end", "endBrowse"],
    ["system", "Open View Clinic Details flow", 900, "action", "details"], ["user", "", 970, "end", "endDetails"],
  ], [
    ["start", "open"], ["open", "request"], ["request", "read"], ["read", "loaded"], ["loaded", "loadErr", "No"], ["loadErr", "endError"], ["loaded", "display", "Yes"],
    ["display", "choose"], ["choose", "apply"], ["apply", "found"], ["found", "none", "No"], ["none", "endNone"], ["found", "matches", "Yes"], ["matches", "select"], ["select", "leave", "No"], ["leave", "endBrowse"], ["select", "details", "Yes"], ["details", "endDetails"],
  ]),

  buildPage("uc026", "026 View Clinic Details", [
    ["user", "", 45, "start", "start"], ["user", "Tap clinic from results", 100, "action", "tap"], ["system", "Request clinic details by id", 100, "action", "request"], ["db", "Read clinicDirectory/{clinicId}", 100, "action", "read"],
    ["system", "Clinic exists and active?", 200, "decision", "active"], ["system", "Show clinic unavailable message", 300, "action", "unavailable"], ["user", "", 370, "end", "endUnavailable"],
    ["system", "Display address, parish, phones, services, hours, map link", 300, "action", "display"], ["user", "Choose Call, Directions, Back, or Save/share", 400, "action", "choose"],
    ["user", "Back to results?", 500, "decision", "back"], ["user", "Return to clinic search results", 600, "action", "backView"], ["user", "", 670, "end", "endBack"],
    ["system", "User chose call?", 600, "decision", "call"], ["system", "Open phone dialer with clinic phone number", 700, "action", "dial"], ["user", "", 770, "end", "endCall"],
    ["system", "User chose directions?", 700, "decision", "directions"], ["user", "Allow location access?", 800, "decision", "allow"], ["system", "Use address/map link fallback", 900, "action", "mapFallback"], ["user", "", 970, "end", "endFallback"],
    ["system", "Request route from directions API proxy", 900, "action", "route"], ["system", "Route available?", 1000, "decision", "routeOk"], ["system", "Show distance, travel time, and route", 1100, "action", "routeView"], ["user", "", 1170, "end", "endRoute"],
    ["system", "Copy/share clinic information", 800, "action", "share"], ["user", "", 870, "end", "endShare"],
  ], [
    ["start", "tap"], ["tap", "request"], ["request", "read"], ["read", "active"], ["active", "unavailable", "No"], ["unavailable", "endUnavailable"], ["active", "display", "Yes"], ["display", "choose"],
    ["choose", "back"], ["back", "backView", "Yes"], ["backView", "endBack"], ["back", "call", "No"], ["call", "dial", "Yes"], ["dial", "endCall"], ["call", "directions", "No"],
    ["directions", "allow", "Yes"], ["allow", "mapFallback", "No"], ["mapFallback", "endFallback"], ["allow", "route", "Yes"], ["route", "routeOk"], ["routeOk", "routeView", "Yes"], ["routeView", "endRoute"], ["routeOk", "mapFallback", "No"],
    ["directions", "share", "No"], ["share", "endShare"],
  ]),

  buildPage("uc035", "035 Chat with Bloomie", [
    ["user", "", 45, "start", "start"], ["user", "Open Bloomie chat", 100, "action", "open"], ["system", "Load session and safe user context", 100, "action", "load"], ["system", "", 190, "fork", "chatLoadFork"], ["db", "Read profile and preferences", 290, "action", "readProfile", 20], ["db", "Read recent logs and cycle context", 290, "action", "readLogs", 60], ["db", "Read allowed Bloomie memory and safety limits", 290, "action", "readMemory", 100], ["system", "", 390, "join", "chatLoadJoin"],
    ["system", "Chat allowed for account state?", 490, "decision", "allowed"], ["system", "Show login/consent required message", 590, "action", "blocked"], ["user", "", 660, "end", "endBlocked"],
    ["system", "Display greeting", 590, "action", "greet"], ["user", "Type message or leave chat", 690, "action", "message"], ["user", "Leave chat?", 790, "decision", "leave"], ["user", "", 860, "end", "endLeave"],
    ["system", "Normalize message; detect out-of-scope, red flags, repair intent", 890, "action", "normalize"], ["system", "Urgent red flag?", 990, "decision", "red"], ["system", "Show urgent-care/safety resources and avoid diagnosis", 1090, "action", "urgent"], ["db", "Write safety log if permitted", 1090, "action", "safetyLog"], ["user", "", 1160, "end", "endUrgent"],
    ["system", "Out of scope?", 1090, "decision", "oos"], ["system", "Give boundary response and supported-topic choices", 1190, "action", "boundary"], ["db", "Store analytics only if permitted", 1190, "action", "analyticsOnly"], ["user", "", 1260, "end", "endBoundary"],
    ["system", "Classify intent/tone with rules", 1190, "action", "rules"], ["system", "Low confidence?", 1290, "decision", "low"], ["system", "Call AI proxy for intent/tone/extraction", 1390, "action", "ai"], ["system", "AI available and valid?", 1490, "decision", "aiOk"],
    ["system", "Use deterministic fallback / clarifying question", 1590, "action", "fallback"], ["system", "Resolve content node and build Bloomie response", 1590, "action", "respond"], ["system", "", 1690, "fork", "chatWriteFork"], ["db", "Store allowed Bloomie memory", 1790, "action", "writeMemory", 20], ["db", "Store chat analytics/safety metadata", 1790, "action", "writeAnalytics", 60], ["system", "", 1890, "join", "chatWriteJoin"], ["system", "Display response/resources or follow-up question", 1990, "action", "display"], ["user", "", 2060, "end", "endResponse"],
  ], [
    ["start", "open"], ["open", "load"], ["load", "chatLoadFork"], ["chatLoadFork", "readProfile"], ["chatLoadFork", "readLogs"], ["chatLoadFork", "readMemory"], ["readProfile", "chatLoadJoin"], ["readLogs", "chatLoadJoin"], ["readMemory", "chatLoadJoin"], ["chatLoadJoin", "allowed"], ["allowed", "blocked", "No"], ["blocked", "endBlocked"], ["allowed", "greet", "Yes"], ["greet", "message"],
    ["message", "leave"], ["leave", "endLeave", "Yes"], ["leave", "normalize", "No"], ["normalize", "red"], ["red", "urgent", "Yes"], ["urgent", "safetyLog"], ["safetyLog", "endUrgent"], ["red", "oos", "No"],
    ["oos", "boundary", "Yes"], ["boundary", "analyticsOnly"], ["analyticsOnly", "endBoundary"], ["oos", "rules", "No"], ["rules", "low"], ["low", "ai", "Yes"], ["ai", "aiOk"], ["aiOk", "fallback", "No"], ["fallback", "respond"], ["aiOk", "respond", "Yes"], ["low", "respond", "No"], ["respond", "chatWriteFork"], ["chatWriteFork", "writeMemory"], ["chatWriteFork", "writeAnalytics"], ["writeMemory", "chatWriteJoin"], ["writeAnalytics", "chatWriteJoin"], ["chatWriteJoin", "display"], ["display", "endResponse"],
  ]),

  buildPage("uc047", "047 Play Facts/Myths Game", [
    ["user", "", 45, "start", "start"], ["user", "Open Facts/Myths game", 100, "action", "open"], ["system", "Load question set and saved progress", 100, "action", "load"], ["db", "Read myth/fact questions and users/{uid}/gameProgress", 100, "action", "read"],
    ["system", "Questions available?", 200, "decision", "available"], ["system", "Show game unavailable message", 300, "action", "unavailable"], ["user", "", 370, "end", "endUnavailable"],
    ["system", "Saved progress exists?", 300, "decision", "progress"], ["system", "Resume saved game", 400, "action", "resume"], ["system", "Start new game session", 400, "action", "new"],
    ["system", "Display fact/myth statement", 500, "action", "display"], ["user", "Choose Fact, Myth, Skip, Restart, or Exit", 600, "action", "choose"], ["user", "Exit game?", 700, "decision", "exit"], ["db", "Save current progress", 800, "action", "saveExit"], ["user", "", 870, "end", "endExit"],
    ["system", "Restart requested?", 800, "decision", "restart"], ["db", "Clear saved progress and reset score", 900, "action", "clear"], ["system", "Start new session", 1000, "action", "restartNew"],
    ["system", "Skip question?", 900, "decision", "skip"], ["db", "Store skipped question", 1000, "action", "storeSkip"], ["system", "Check Fact/Myth answer", 1000, "action", "check"], ["system", "Answer correct?", 1100, "decision", "correct"],
    ["system", "Show correction and explanation", 1200, "action", "wrong"], ["system", "Show correct feedback and explanation", 1200, "action", "right"], ["db", "Store score, answered question, timestamp", 1300, "action", "write"], ["system", "More questions?", 1400, "decision", "more"], ["system", "Advance to next statement", 1500, "action", "next"], ["system", "Show final score and restart option", 1500, "action", "final"], ["user", "", 1570, "end", "endFinal"],
  ], [
    ["start", "open"], ["open", "load"], ["load", "read"], ["read", "available"], ["available", "unavailable", "No"], ["unavailable", "endUnavailable"], ["available", "progress", "Yes"], ["progress", "resume", "Yes"], ["progress", "new", "No"], ["resume", "display"], ["new", "display"],
    ["display", "choose"], ["choose", "exit"], ["exit", "saveExit", "Yes"], ["saveExit", "endExit"], ["exit", "restart", "No"], ["restart", "clear", "Yes"], ["clear", "restartNew"], ["restartNew", "display"], ["restart", "skip", "No"], ["skip", "storeSkip", "Yes"], ["storeSkip", "write"], ["skip", "check", "No"], ["check", "correct"], ["correct", "wrong", "No"], ["correct", "right", "Yes"], ["wrong", "write"], ["right", "write"], ["write", "more"], ["more", "next", "Yes"], ["next", "display"], ["more", "final", "No"], ["final", "endFinal"],
  ]),

  buildPage("uc048", "048 View Help & Resources", [
    ["user", "", 45, "start", "start"], ["user", "Open Help & Resources", 100, "action", "open"], ["system", "Load help topics, policies, contact, safety resources", 100, "action", "load"], ["db", "Read managed help/resources content if available", 100, "action", "read"],
    ["system", "Resources loaded?", 200, "decision", "loaded"], ["system", "Show basic offline help links", 300, "action", "offline"], ["user", "", 370, "end", "endOffline"],
    ["system", "Display FAQ, privacy, contact, urgent resources", 300, "action", "display"], ["user", "Search, choose topic, contact support, or leave", 400, "action", "choose"], ["user", "Leave help page?", 500, "decision", "leave"], ["user", "", 570, "end", "endLeave"],
    ["system", "Search term entered?", 600, "decision", "search"], ["system", "Filter help resources", 700, "action", "filter"], ["system", "Results found?", 800, "decision", "found"], ["system", "Show no-results and contact option", 900, "action", "noResults"], ["user", "", 970, "end", "endNoResults"],
    ["system", "Display selected resource details", 900, "action", "details"], ["user", "Submit contact/help request?", 1000, "decision", "contact"], ["user", "Finish after viewing resource", 1100, "action", "viewed"], ["user", "", 1170, "end", "endViewed"],
    ["system", "Validate contact name/email/message", 1100, "action", "validate"], ["system", "Message valid?", 1200, "decision", "valid"], ["system", "Show contact form error", 1300, "action", "error"], ["db", "Store contact request / feedback entry", 1300, "action", "write"], ["system", "Show confirmation", 1400, "action", "confirm"], ["user", "", 1470, "end", "endConfirm"],
  ], [
    ["start", "open"], ["open", "load"], ["load", "read"], ["read", "loaded"], ["loaded", "offline", "No"], ["offline", "endOffline"], ["loaded", "display", "Yes"], ["display", "choose"], ["choose", "leave"], ["leave", "endLeave", "Yes"],
    ["leave", "search", "No"], ["search", "filter", "Yes"], ["filter", "found"], ["found", "noResults", "No"], ["noResults", "endNoResults"], ["found", "details", "Yes"], ["search", "details", "No"], ["details", "contact"], ["contact", "viewed", "No"], ["viewed", "endViewed"], ["contact", "validate", "Yes"], ["validate", "valid"], ["valid", "error", "No"], ["error", "choose"], ["valid", "write", "Yes"], ["write", "confirm"], ["confirm", "endConfirm"],
  ]),

  buildPage("uc049", "049 Give Phase Feedback", [
    ["user", "", 45, "start", "start"], ["user", "Open dashboard phase feedback prompt", 100, "action", "open"], ["system", "Verify session and load current predicted phase", 100, "action", "load"], ["db", "Read users/{uid}.phaseEstimation and recent cycle logs", 100, "action", "read"],
    ["system", "Prediction available?", 200, "decision", "available"], ["system", "Show no phase prediction to review", 300, "action", "noPred"], ["user", "", 370, "end", "endNoPred"],
    ["system", "Display Was this phase right?", 300, "action", "display"], ["user", "Dismiss feedback prompt?", 400, "decision", "dismiss"], ["db", "Optionally store dismissed timestamp", 500, "action", "dismissStore"], ["user", "", 570, "end", "endDismiss"],
    ["user", "Choose Yes, Not sure, or No", 500, "action", "choose"], ["system", "Response is No?", 600, "decision", "isNo"], ["user", "Select corrected phase; confirm bleeding if relevant; add optional notes", 700, "action", "correct"],
    ["system", "Validate response, correctedPhase, bleedingConfirmed, notes length", 800, "action", "validate"], ["system", "Feedback valid?", 900, "decision", "valid"], ["system", "Show validation error", 1000, "action", "error"],
    ["system", "", 1000, "fork", "feedbackFork"], ["db", "Store users/{uid}/phaseFeedback/{id}", 1100, "action", "writeFeedback", 20], ["db", "Mirror legacy phaseFeedback/{uid}/entries/{id}", 1100, "action", "legacy", 60], ["system", "", 1200, "join", "feedbackJoin"], ["system", "Phase update needed?", 1300, "decision", "update"],
    ["db", "Merge corrected phaseEstimation / lastPeriodStart into users/{uid}", 1400, "action", "writePhase"], ["system", "Recalculate dashboard phase cards", 1500, "action", "recalc"], ["system", "Show thanks and updated insight", 1600, "action", "thanksUpdated"], ["user", "", 1670, "end", "endUpdated"],
    ["system", "Show thanks without changing phase", 1400, "action", "thanks"], ["user", "", 1470, "end", "endThanks"],
  ], [
    ["start", "open"], ["open", "load"], ["load", "read"], ["read", "available"], ["available", "noPred", "No"], ["noPred", "endNoPred"], ["available", "display", "Yes"], ["display", "dismiss"],
    ["dismiss", "dismissStore", "Yes"], ["dismissStore", "endDismiss"], ["dismiss", "choose", "No"], ["choose", "isNo"], ["isNo", "correct", "Yes"], ["correct", "validate"], ["isNo", "validate", "No"],
    ["validate", "valid"], ["valid", "error", "No"], ["error", "choose"], ["valid", "feedbackFork", "Yes"], ["feedbackFork", "writeFeedback"], ["feedbackFork", "legacy"], ["writeFeedback", "feedbackJoin"], ["legacy", "feedbackJoin"], ["feedbackJoin", "update"], ["update", "writePhase", "Yes"], ["writePhase", "recalc"], ["recalc", "thanksUpdated"], ["thanksUpdated", "endUpdated"], ["update", "thanks", "No"], ["thanks", "endThanks"],
  ]),
];

const mxfile = `<mxfile host="app.diagrams.net" modified="2026-05-09T00:00:00.000Z" agent="Codex" version="24.7.17" type="device">${pages.map(diagramXml).join("")}</mxfile>\n`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, mxfile, "utf8");
console.log(outFile);
