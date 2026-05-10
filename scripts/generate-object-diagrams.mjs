import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("docs/diagrams");
const outFile = path.join(outDir, "Bloom_Object_Diagrams.xml");

const pink = "#D4187A";
const dark = "#3D1530";
const objectFill = "#FFF7FA";
const headerFill = "#F7D6EA";
const noteFill = "#FFFFFF";

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function objectValue(name, className, slots) {
  const slotHtml = slots.map((slot) => `${esc(slot)}`).join("<br>");
  return [
    `<div style="background:${headerFill};padding:4px;"><u><b>${esc(name)} : ${esc(className)}</b></u></div>`,
    `<div align="left" style="padding:8px;">${slotHtml}</div>`,
  ].join("");
}

function diagramXml(page) {
  const cells = [
    '<mxCell id="0"/>',
    '<mxCell id="1" parent="0"/>',
    `<mxCell id="${page.id}_title" value="${esc(page.name)}" style="rounded=1;whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fontFamily=Nunito,Segoe UI,sans-serif;fontSize=18;fontStyle=1;fontColor=${dark};strokeColor=${pink};fillColor=${headerFill}" vertex="1" parent="1"><mxGeometry x="40" y="30" width="640" height="48" as="geometry"/></mxCell>`,
    `<mxCell id="${page.id}_note" value="${esc(page.note)}" style="rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=8;fontFamily=Nunito,Segoe UI,sans-serif;fontSize=11;fontColor=${dark};strokeColor=#EAB8D6;fillColor=${noteFill}" vertex="1" parent="1"><mxGeometry x="720" y="30" width="760" height="62" as="geometry"/></mxCell>`,
  ];

  for (const o of page.objects) {
    cells.push(`<mxCell id="${page.id}_${o.id}" value="${esc(objectValue(o.name, o.className, o.slots))}" style="rounded=0;whiteSpace=wrap;html=1;align=center;verticalAlign=top;spacing=0;fontFamily=Nunito,Segoe UI,sans-serif;fontSize=12;fontColor=${dark};strokeColor=${pink};fillColor=${objectFill}" vertex="1" parent="1"><mxGeometry x="${o.x}" y="${o.y}" width="${o.w ?? 280}" height="${o.h ?? 150}" as="geometry"/></mxCell>`);
  }

  for (const [index, link] of page.links.entries()) {
    const dashed = link.dashed ? "dashed=1;" : "";
    const diamond = link.composition ? "startArrow=diamond;startFill=1;" : "startArrow=none;";
    cells.push(`<mxCell id="${page.id}_l${index + 1}" value="${esc(link.label ?? "")}" style="html=1;rounded=0;strokeColor=${pink};fontColor=${dark};fontFamily=Nunito,Segoe UI,sans-serif;fontSize=11;edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jettySize=auto;${dashed}${diamond}endArrow=none;" edge="1" parent="1" source="${page.id}_${link.from}" target="${page.id}_${link.to}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  }

  return `<diagram id="${esc(page.id)}" name="${esc(page.name)}"><mxGraphModel dx="1500" dy="950" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${page.width ?? 1600}" pageHeight="${page.height ?? 1100}" math="0" shadow="0"><root>${cells.join("")}</root></mxGraphModel></diagram>`;
}

function page(id, name, note, objects, links, width = 1600, height = 1100) {
  return { id, name, note, objects, links, width, height };
}

function obj(id, name, className, x, y, slots, w = 280, h = 150) {
  return { id, name, className, x, y, slots, w, h };
}

const pages = [
  page(
    "obj001",
    "Object Diagram - User Account Snapshot",
    "Runtime objects for one signed-in Bloom user. Class names match the Model, View, and Controller class diagrams.",
    [
      obj("u1", "currentUser", "User", 650, 150, [
        'uid = "usr_001"',
        'email = "jane@example.com"',
        'role = "user"',
        'createdAt = "2026-04-12T10:00:00Z"',
        'updatedAt = "2026-05-09T14:10:00Z"',
      ], 300, 160),
      obj("p1", "janeProfile", "UserProfile", 250, 390, [
        'nickname = "Jane"',
        'avatar = "bloom"',
        'goal = "Track my period"',
        'mode = "cycle"',
        'yearOfBirth = 2007',
        'ageBand = "18+"',
        'consentSensitive = true',
      ], 300, 185),
      obj("pref1", "janePreference", "Preference", 650, 390, [
        'theme = "light"',
        'hideSensitive = false',
        'periodReminder = true',
        'fertileAlert = true',
        'compact = false',
        'discreetNotif = true',
        'updatedAt = "2026-05-09T14:10:00Z"',
      ], 300, 185),
      obj("token1", "phoneToken", "NotificationToken", 1050, 390, [
        'token = "fcm_92ab..."',
        'platform = "web"',
        'isActive = true',
        'updatedAt = "2026-05-09T14:11:00Z"',
      ], 280, 135),
      obj("settingsView", "settingsPage", "SettingsView", 250, 690, [
        'preferences = janePreference',
      ], 280, 95),
      obj("settingsController", "settingsController", "SettingsController", 650, 690, [
        'preferences = janePreference',
      ], 300, 95),
      obj("api", "apiClient", "ApiClient", 1050, 690, [
        'BLOOM_API_BASE = "/api"',
        'idToken = "firebase-id-token"',
        'cache = { profile: currentUser }',
      ], 300, 125),
    ],
    [
      { from: "u1", to: "p1", label: "owns", composition: true },
      { from: "u1", to: "pref1", label: "has" },
      { from: "u1", to: "token1", label: "has active token" },
      { from: "settingsView", to: "pref1", label: "displays" },
      { from: "settingsController", to: "settingsView", label: "controls" },
      { from: "settingsController", to: "api", label: "uses", dashed: true },
      { from: "api", to: "u1", label: "loads/saves", dashed: true },
    ]
  ),

  page(
    "obj002",
    "Object Diagram - Dashboard and Cycle State",
    "Dashboard snapshot showing objects instantiated from DashboardView, DashboardCard, Prediction/CycleState, FutureCycle, and log model classes.",
    [
      obj("user", "currentUser", "User", 90, 140, [
        'uid = "usr_001"',
        'email = "jane@example.com"',
        'role = "user"',
        'createdAt = "2026-04-12T10:00:00Z"',
        'updatedAt = "2026-05-09T14:10:00Z"',
      ]),
      obj("dashView", "dashboardPage", "DashboardView", 610, 140, [
        'goal = "Track my period"',
        'cycleState = currentPrediction',
        'logsByDate = { "2026-05-01": may1Log }',
      ], 320, 125),
      obj("dashController", "dashboardController", "DashboardController", 1050, 140, [
        'cycleState = currentPrediction',
        'logs = { "2026-05-01": may1Log }',
      ], 300, 105),
      obj("prediction", "currentPrediction", "Prediction / CycleState", 600, 390, [
        'phase = "Ovulatory Phase"',
        'dayInCycle = 14',
        'predictedCycleLength = 28',
        'nextPeriodDate = "2026-05-22"',
        'fertileStart = "2026-05-09"',
        'fertileEnd = "2026-05-14"',
        'ovulationDate = "2026-05-12"',
        'confidence = "medium"',
      ], 340, 210),
      obj("future", "nextCycle", "FutureCycle", 1030, 390, [
        'periodStart = "2026-05-22"',
        'periodEnd = "2026-05-27"',
        'fertileStart = "2026-06-05"',
        'fertileEnd = "2026-06-10"',
        'ovulationDate = "2026-06-08"',
      ], 300, 150),
      obj("log", "may1Log", "CycleLogEntry", 90, 430, [
        'dateKey = "2026-05-01"',
        'flowLevel = 2',
        'periodDay = 1',
        'sleepScore = 6',
        'stressLevel = 2',
        'activityLevel = 3',
        'notes = "mild cramps"',
      ], 300, 180),
      obj("phaseCard", "phaseCard", "DashboardCard", 200, 750, [
        'title = "Current phase"',
        'value = "Ovulatory"',
        'caption = "Based on cycle history"',
        'status = "medium confidence"',
      ], 300, 130),
      obj("periodCard", "periodCard", "DashboardCard", 610, 750, [
        'title = "Next period"',
        'value = "May 22"',
        'caption = "Expected in 13 days"',
        'status = "forecast"',
      ], 300, 130),
      obj("insightCard", "insightCard", "DashboardCard", 1020, 750, [
        'title = "Today\'s insight"',
        'value = "Log changes today"',
        'caption = "Cycle education"',
        'status = "informational"',
      ], 300, 130),
    ],
    [
      { from: "user", to: "dashView", label: "views" },
      { from: "dashController", to: "dashView", label: "loads data for" },
      { from: "dashView", to: "phaseCard", label: "contains", composition: true },
      { from: "dashView", to: "periodCard", label: "contains", composition: true },
      { from: "dashView", to: "insightCard", label: "contains", composition: true },
      { from: "dashView", to: "prediction", label: "presents" },
      { from: "prediction", to: "future", label: "projects", composition: true },
      { from: "prediction", to: "log", label: "computed from", dashed: true },
      { from: "user", to: "log", label: "records", composition: true },
    ]
  ),

  page(
    "obj003",
    "Object Diagram - Calendar Log Snapshot",
    "Calendar object snapshot aligned to CalendarView, CalendarGrid, CalendarDayCell, CycleLogModal, CycleLogEntry, SymptomLogEntry, SymptomItem, and BiometricLogEntry.",
    [
      obj("calendarView", "calendarPage", "CalendarView", 620, 120, [
        'month = 5',
        'year = 2026',
        'viewMode = "month"',
      ], 280, 105),
      obj("calendarController", "calendarController", "CalendarController", 1030, 120, [
        'month = 5',
        'year = 2026',
        'logs = { "2026-05-01": may1Log }',
      ], 300, 115),
      obj("grid", "mayGrid", "CalendarGrid", 620, 330, [
        'cells = [may1Cell, may12Cell, may22Cell]',
      ], 300, 90),
      obj("may1Cell", "may1Cell", "CalendarDayCell", 120, 570, [
        'dateKey = "2026-05-01"',
        'isToday = false',
        'stateClass = "period-logged"',
      ], 280, 115),
      obj("may12Cell", "may12Cell", "CalendarDayCell", 620, 570, [
        'dateKey = "2026-05-12"',
        'isToday = false',
        'stateClass = "ovulation-predicted"',
      ], 280, 115),
      obj("may22Cell", "may22Cell", "CalendarDayCell", 1120, 570, [
        'dateKey = "2026-05-22"',
        'isToday = false',
        'stateClass = "period-predicted"',
      ], 280, 115),
      obj("modal", "logModal", "CycleLogModal", 620, 800, [
        'selectedDate = "2026-05-01"',
        'flow = "medium"',
        'symptoms = ["cramps", "fatigue"]',
        'notes = "mild cramps"',
      ], 300, 135),
      obj("cycleLog", "may1Log", "CycleLogEntry", 100, 820, [
        'dateKey = "2026-05-01"',
        'flowLevel = 2',
        'periodDay = 1',
        'sleepScore = 6',
        'stressLevel = 2',
        'activityLevel = 3',
        'notes = "mild cramps"',
      ], 300, 180),
      obj("symptomLog", "may1Symptoms", "SymptomLogEntry", 1030, 800, [
        'dateKey = "2026-05-01"',
        'items = [crampsItem, fatigueItem]',
        'createdAt = "2026-05-01T20:15:00Z"',
        'updatedAt = "2026-05-01T20:15:00Z"',
      ], 330, 135),
      obj("cramps", "crampsItem", "SymptomItem", 1030, 1010, [
        'code = "cramps"',
        'label = "Cramps"',
        'category = "pain"',
        'severity = 2',
        'sensitive = false',
      ], 280, 140),
      obj("biometric", "may1Biometrics", "BiometricLogEntry", 100, 1040, [
        'dateKey = "2026-05-01"',
        'sleepScore = 6',
        'stressLevel = 2',
        'activityLevel = 3',
        'createdAt = "2026-05-01T20:15:00Z"',
      ], 300, 140),
    ],
    [
      { from: "calendarController", to: "calendarView", label: "controls" },
      { from: "calendarView", to: "grid", label: "contains", composition: true },
      { from: "grid", to: "may1Cell", label: "contains", composition: true },
      { from: "grid", to: "may12Cell", label: "contains", composition: true },
      { from: "grid", to: "may22Cell", label: "contains", composition: true },
      { from: "calendarView", to: "modal", label: "opens" },
      { from: "modal", to: "cycleLog", label: "edits" },
      { from: "cycleLog", to: "biometric", label: "same date" },
      { from: "symptomLog", to: "cramps", label: "contains", composition: true },
      { from: "modal", to: "symptomLog", label: "captures symptoms" },
    ],
    1600,
    1250
  ),

  page(
    "obj004",
    "Object Diagram - Educational Content Snapshot",
    "Learn page object snapshot using LearnView, PamphletCard, Pamphlet, CatalogController, ApiClient, CatalogRouteController, and FirestoreRepository.",
    [
      obj("learnView", "learnPage", "LearnView", 600, 130, [
        'pamphlets = [pcosPamphlet, hygienePamphlet, ovulationPamphlet]',
        'activeCategory = "All"',
        'query = "cycle"',
      ], 350, 125),
      obj("catalogController", "catalogController", "CatalogController", 190, 130, [
        'pamphlets = [pcosPamphlet, hygienePamphlet, ovulationPamphlet]',
        'clinics = []',
      ], 320, 105),
      obj("api", "apiClient", "ApiClient", 1040, 130, [
        'BLOOM_API_BASE = "/api"',
        'idToken = "firebase-id-token"',
        'cache = { pamphlets: 3 }',
      ], 310, 125),
      obj("route", "catalogRoute", "CatalogRouteController", 1040, 360, [
        'route = "/catalog"',
      ], 290, 80),
      obj("repo", "firestoreRepo", "FirestoreRepository", 1040, 570, [
        'db = Firestore',
        'collections = ["pamphlets", "clinicDirectory"]',
      ], 310, 100),
      obj("pcos", "pcosPamphlet", "Pamphlet", 100, 600, [
        'id = "res_pcos_101"',
        'title = "PCOS 101"',
        'category = "PCOS"',
        'summary = "What PCOS is and why it matters"',
        'content = "..."',
        'sensitive = false',
        'pdf = { file: "PCOS 101 What It Is and Why It Matters.pdf" }',
        'status = "published"',
      ], 330, 220),
      obj("hygiene", "hygienePamphlet", "Pamphlet", 560, 600, [
        'id = "res_hygiene"',
        'title = "Healthy Habits: Menstrual Hygiene"',
        'category = "Period basics"',
        'summary = "Safe hygiene tips"',
        'content = "..."',
        'sensitive = false',
        'pdf = { file: "HEALTHY HABITS MENSTRUAL HYGIENE.pdf" }',
        'status = "published"',
      ], 350, 220),
      obj("ovulation", "ovulationPamphlet", "Pamphlet", 1030, 820, [
        'id = "res_ovulation"',
        'title = "Ovulation and Fertile Window"',
        'category = "Fertility"',
        'summary = "Understanding ovulation timing"',
        'content = "..."',
        'sensitive = true',
        'pdf = { file: "ovulation fertile window.pdf" }',
        'status = "published"',
      ], 340, 220),
      obj("card1", "pcosCard", "PamphletCard", 100, 900, [
        'title = "PCOS 101"',
        'category = "PCOS"',
        'sensitive = false',
      ], 280, 105),
      obj("card2", "hygieneCard", "PamphletCard", 560, 900, [
        'title = "Healthy Habits"',
        'category = "Period basics"',
        'sensitive = false',
      ], 280, 105),
    ],
    [
      { from: "catalogController", to: "learnView", label: "loads data for" },
      { from: "catalogController", to: "api", label: "uses", dashed: true },
      { from: "api", to: "route", label: "HTTPS request", dashed: true },
      { from: "route", to: "repo", label: "read catalog", dashed: true },
      { from: "learnView", to: "card1", label: "contains", composition: true },
      { from: "learnView", to: "card2", label: "contains", composition: true },
      { from: "card1", to: "pcos", label: "represents" },
      { from: "card2", to: "hygiene", label: "represents" },
      { from: "repo", to: "ovulation", label: "returns" },
    ],
    1600,
    1120
  ),

  page(
    "obj005",
    "Object Diagram - Clinic Search Snapshot",
    "Clinic search object diagram using the exact view/model/controller class names from the class diagrams.",
    [
      obj("clinicsView", "clinicsPage", "ClinicsView", 610, 120, [
        'clinics = [andrewClinic, annottClinic, blackRiverClinic]',
        'filters = { parish: "Kingston", service: "Maternity" }',
        'userLocation = { lat: 18.0179, lng: -76.8099 }',
      ], 370, 135),
      obj("catalogController", "clinicCatalogController", "CatalogController", 120, 120, [
        'pamphlets = []',
        'clinics = [andrewClinic, annottClinic, blackRiverClinic]',
      ], 350, 105),
      obj("map", "clinicMap", "ClinicMap", 1040, 120, [
        'map = "LeafletMap"',
        'markers = [andrewMarker, annottMarker, blackRiverMarker]',
        'routeLayer = null',
      ], 330, 125),
      obj("route", "catalogRoute", "CatalogRouteController", 120, 380, [
        'route = "/catalog"',
      ], 280, 80),
      obj("adapter", "orsAdapter", "ExternalServiceAdapter", 1040, 380, [
        'FirebaseAuth = configured',
        'FCM = configured',
        'OpenRouteService = configured',
        'SMTP = configured',
      ], 330, 130),
      obj("repo", "firestoreRepo", "FirestoreRepository", 560, 380, [
        'db = Firestore',
        'collections = ["clinicDirectory"]',
      ], 320, 95),
      obj("clinic1", "andrewClinic", "ClinicDirectoryEntry", 80, 650, [
        'id = "cln_001"',
        'name = "Andrews Memorial Hospital"',
        'parish = "Kingston"',
        'address = "27 Hope Road"',
        'type = "hospital"',
        'phone = "876-926-7401"',
        'services = ["OB/GYN", "Maternity", "Emergency"]',
        'latitude = 18.0231',
        'longitude = -76.7899',
      ], 360, 230),
      obj("clinic2", "annottClinic", "ClinicDirectoryEntry", 560, 650, [
        'id = "cln_002"',
        'name = "Annotto Bay Hospital"',
        'parish = "St. Mary"',
        'address = "Annotto Bay"',
        'type = "hospital"',
        'phone = "876-613-8300"',
        'services = ["OB/GYN", "Maternity", "Paediatrics"]',
        'latitude = 18.2717',
        'longitude = -76.7677',
      ], 360, 230),
      obj("clinic3", "blackRiverClinic", "ClinicDirectoryEntry", 1040, 650, [
        'id = "cln_004"',
        'name = "Black River Health Centre"',
        'parish = "St. Elizabeth"',
        'address = "Black River"',
        'type = "health centre"',
        'phone = "876-965-2212"',
        'services = ["Family Planning", "Maternity"]',
        'latitude = 18.0260',
        'longitude = -77.8486',
      ], 360, 215),
      obj("card", "andrewCard", "ClinicCard", 560, 980, [
        'clinicId = "cln_001"',
        'name = "Andrews Memorial Hospital"',
        'services = ["OB/GYN", "Maternity", "Emergency"]',
      ], 330, 115),
    ],
    [
      { from: "catalogController", to: "clinicsView", label: "loads clinics for" },
      { from: "catalogController", to: "route", label: "calls", dashed: true },
      { from: "route", to: "repo", label: "read clinicDirectory", dashed: true },
      { from: "route", to: "adapter", label: "route lookup", dashed: true },
      { from: "clinicsView", to: "map", label: "renders" },
      { from: "clinicsView", to: "card", label: "contains", composition: true },
      { from: "card", to: "clinic1", label: "represents" },
      { from: "repo", to: "clinic1", label: "returns" },
      { from: "repo", to: "clinic2", label: "returns" },
      { from: "repo", to: "clinic3", label: "returns" },
      { from: "map", to: "clinic1", label: "marker for" },
      { from: "map", to: "clinic2", label: "marker for" },
    ],
    1600,
    1200
  ),

  page(
    "obj006",
    "Object Diagram - Bloomie Chat Snapshot",
    "Bloomie chat runtime objects from AssistantView, BloomieController, BloomieRouteController, BloomieMemory, ApiClient, FirestoreRepository, and ExternalServiceAdapter.",
    [
      obj("assistant", "assistantPage", "AssistantView", 590, 120, [
        'messages = [userMessage, bloomieReply]',
        'sessionId = "chat_2026_05_09_usr_001"',
      ], 330, 105),
      obj("controller", "bloomieController", "BloomieController", 170, 120, [
        'sessionId = "chat_2026_05_09_usr_001"',
        'context = { phase: "ovulatory", goal: "Track my period" }',
      ], 340, 105),
      obj("api", "apiClient", "ApiClient", 1020, 120, [
        'BLOOM_API_BASE = "/api"',
        'idToken = "firebase-id-token"',
        'cache = { bloomieContext: "fresh" }',
      ], 320, 125),
      obj("route", "bloomieRoute", "BloomieRouteController", 170, 390, [
        'routes = "/api/bloomie-*"',
      ], 300, 80),
      obj("repo", "firestoreRepo", "FirestoreRepository", 590, 390, [
        'db = Firestore',
        'collections = ["users", "bloomieMemory", "bloomieAnalytics"]',
      ], 360, 105),
      obj("adapter", "aiAdapter", "ExternalServiceAdapter", 1020, 390, [
        'FirebaseAuth = configured',
        'FCM = configured',
        'OpenRouteService = configured',
        'SMTP = configured',
      ], 320, 130),
      obj("memory", "janeBloomieMemory", "BloomieMemory", 170, 650, [
        'lastIntent = "cycle_phase"',
        'lastSymptoms = ["cramps", "fatigue"]',
        'recentTopics = ["ovulation", "fertile window"]',
        'lastSessionDate = "2026-05-09"',
      ], 340, 135),
      obj("profile", "janeProfile", "UserProfile", 590, 650, [
        'nickname = "Jane"',
        'avatar = "bloom"',
        'goal = "Track my period"',
        'mode = "cycle"',
        'yearOfBirth = 2007',
        'ageBand = "18+"',
        'consentSensitive = true',
      ], 330, 175),
      obj("prediction", "currentPrediction", "Prediction / CycleState", 1020, 650, [
        'phase = "Ovulatory Phase"',
        'dayInCycle = 14',
        'predictedCycleLength = 28',
        'nextPeriodDate = "2026-05-22"',
        'fertileStart = "2026-05-09"',
        'fertileEnd = "2026-05-14"',
        'ovulationDate = "2026-05-12"',
        'confidence = "medium"',
      ], 340, 210),
    ],
    [
      { from: "controller", to: "assistant", label: "controls" },
      { from: "controller", to: "api", label: "uses", dashed: true },
      { from: "api", to: "route", label: "HTTPS request", dashed: true },
      { from: "route", to: "repo", label: "memory/analytics", dashed: true },
      { from: "route", to: "adapter", label: "external AI/mail auth services", dashed: true },
      { from: "repo", to: "memory", label: "reads/writes" },
      { from: "repo", to: "profile", label: "reads context" },
      { from: "assistant", to: "memory", label: "uses allowed memory" },
      { from: "assistant", to: "prediction", label: "uses safe cycle context" },
    ]
  ),

  page(
    "obj007",
    "Object Diagram - Phase Feedback Snapshot",
    "Snapshot of phase feedback objects. This matches the Model class diagram where PhaseFeedback reviews a Prediction and belongs to a User.",
    [
      obj("user", "currentUser", "User", 120, 140, [
        'uid = "usr_001"',
        'email = "jane@example.com"',
        'role = "user"',
        'createdAt = "2026-04-12T10:00:00Z"',
        'updatedAt = "2026-05-09T14:10:00Z"',
      ]),
      obj("dashController", "dashboardController", "DashboardController", 560, 140, [
        'cycleState = currentPrediction',
        'logs = { "2026-05-01": may1Log }',
      ], 310, 105),
      obj("cycleRoute", "cycleRoute", "CycleRouteController", 990, 140, [
        'route = "/api/cycles"',
      ], 280, 80),
      obj("prediction", "currentPrediction", "Prediction / CycleState", 120, 420, [
        'phase = "Luteal Phase"',
        'dayInCycle = 22',
        'predictedCycleLength = 28',
        'nextPeriodDate = "2026-05-22"',
        'fertileStart = "2026-05-09"',
        'fertileEnd = "2026-05-14"',
        'ovulationDate = "2026-05-12"',
        'confidence = "low"',
      ], 330, 210),
      obj("feedback", "phaseFeedbackEntry", "PhaseFeedback", 560, 420, [
        'feedbackId = "fb_009"',
        'predictedPhase = "luteal"',
        'response = "no"',
        'correctedPhase = "ovulation"',
        'cycleDay = 14',
        'createdAt = "2026-05-09T14:22:00Z"',
      ], 330, 160),
      obj("repo", "firestoreRepo", "FirestoreRepository", 990, 420, [
        'db = Firestore',
        'collections = ["users", "phaseFeedback"]',
      ], 310, 95),
      obj("engine", "phaseEngine", "PredictionEngine", 560, 720, [
        'cycleHistory = [28, 27, 29, 28]',
        'symptomSignals = { ovulationPain: true }',
      ], 330, 105),
    ],
    [
      { from: "user", to: "feedback", label: "submits" },
      { from: "feedback", to: "prediction", label: "reviews" },
      { from: "dashController", to: "cycleRoute", label: "submits feedback to", dashed: true },
      { from: "cycleRoute", to: "repo", label: "writes feedback", dashed: true },
      { from: "cycleRoute", to: "engine", label: "updates prediction", dashed: true },
      { from: "engine", to: "prediction", label: "recomputes" },
      { from: "repo", to: "feedback", label: "stores" },
    ],
    1500,
    980
  ),

  page(
    "obj008",
    "Object Diagram - Game and Help Resources",
    "Two smaller user-facing object snapshots: Facts/Myths game progress and Help/Contact support request. All classes come from the model/controller/view class diagrams.",
    [
      obj("user", "currentUser", "User", 110, 140, [
        'uid = "usr_001"',
        'email = "jane@example.com"',
        'role = "user"',
        'createdAt = "2026-04-12T10:00:00Z"',
        'updatedAt = "2026-05-09T14:10:00Z"',
      ]),
      obj("game", "factsMythsProgress", "MythGameState", 520, 140, [
        'score = 8',
        'streak = 3',
        'answeredIds = ["myth_001", "fact_004", "myth_009"]',
        'lastPlayedAt = "2026-05-09T13:40:00Z"',
      ], 350, 125),
      obj("userRoute", "userRoute", "UserRouteController", 990, 140, [
        'route = "/api/user"',
      ], 280, 80),
      obj("adminView", "adminSupportPage", "AdminView", 110, 520, [
        'activeTab = "support"',
        'stats = { openRequests: 1 }',
        'supportRequests = [helpRequest]',
      ], 330, 125),
      obj("support", "helpRequest", "SupportRequest / ContactMessage", 520, 520, [
        'requestId = "sup_018"',
        'subject = "Cannot save cycle log"',
        'message = "The save button keeps failing."',
        'replyTo = "jane@example.com"',
        'status = "open"',
        'createdAt = "2026-05-09T12:05:00Z"',
      ], 350, 165),
      obj("adminController", "adminController", "AdminController", 990, 520, [
        'activeTab = "support"',
        'stats = { openRequests: 1 }',
      ], 300, 95),
      obj("repo", "firestoreRepo", "FirestoreRepository", 520, 820, [
        'db = Firestore',
        'collections = ["users", "supportRequests"]',
      ], 330, 95),
      obj("adapter", "mailAdapter", "ExternalServiceAdapter", 990, 820, [
        'FirebaseAuth = configured',
        'FCM = configured',
        'OpenRouteService = configured',
        'SMTP = configured',
      ], 320, 130),
    ],
    [
      { from: "user", to: "game", label: "has progress" },
      { from: "userRoute", to: "game", label: "saves/loads" },
      { from: "userRoute", to: "repo", label: "read/write users", dashed: true },
      { from: "adminView", to: "support", label: "lists" },
      { from: "adminController", to: "adminView", label: "controls" },
      { from: "adminController", to: "repo", label: "admin queries", dashed: true },
      { from: "adminController", to: "adapter", label: "contact email", dashed: true },
      { from: "repo", to: "support", label: "stores" },
    ],
    1500,
    1050
  ),
];

const mxfile = `<mxfile host="app.diagrams.net" modified="2026-05-09T00:00:00.000Z" agent="Codex" version="24.7.17" type="device">${pages.map(diagramXml).join("")}</mxfile>\n`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, mxfile, "utf8");
console.log(outFile);
