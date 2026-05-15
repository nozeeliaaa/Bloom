/**
 * admin.js - Bloom Admin API Routes
 * All endpoints require role="admin" (set via Firebase Custom Claims).
 */
import express from "express";
import admin from "firebase-admin";
import { db, auth } from "../firebaseAdmin.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLog.js";
import { deleteBloomUserData } from "../utils/deleteUserData.js";
import { sendMailTo } from "../mailer.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadClinicsJSON() {
  try {
    return JSON.parse(readFileSync(join(__dirname, "../../data/clinics.json"), "utf8"));
  } catch {
    return [];
  }
}

const router = express.Router();

router.use(requireAuth);
router.use(requireRole("admin"));

async function listAllAuthUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

function includesSearch(...values) {
  const needle = String(values.pop() || "").trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(needle));
}

function normalizeRole(role) {
  return String(role || "user").trim().toLowerCase() === "admin" ? "admin" : "user";
}

function normalizeSupportStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "new" || value === "not_started" || value === "not-started") return "not_started";
  if (value === "open" || value === "in_progress" || value === "in-progress") return "in_progress";
  if (value === "resolved") return "resolved";
  return "not_started";
}

function supportStatusLabel(status) {
  return {
    not_started: "Not started",
    in_progress: "In progress",
    resolved: "Resolved",
  }[normalizeSupportStatus(status)] || "Not started";
}

function firestoreDateToIso(value) {
  return value?.toDate?.()?.toISOString?.() || value || null;
}

function isResolvedHidden(message, now = Date.now()) {
  if (normalizeSupportStatus(message?.status) !== "resolved") return false;
  const resolvedAt = message?.resolvedAt?.toDate?.() || (message?.resolvedAt ? new Date(message.resolvedAt) : null);
  if (!resolvedAt || Number.isNaN(resolvedAt.getTime())) return false;
  return now - resolvedAt.getTime() >= 10 * 60 * 1000;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ─────────────────────────────────────────
// STATS
// ─────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const authUsersPromise = listAllAuthUsers();
    const clinicsCountPromise = db.collection("clinicDirectory").count().get();
    const pamphletsCountPromise = db.collection("pamphlets").count().get();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      authUsers,
      clinicsSnap,
      pamphletsSnap,
    ] = await Promise.all([
      authUsersPromise,
      clinicsCountPromise,
      pamphletsCountPromise,
    ]);

    const totalUsers = authUsers.length;
    const totalClinics = clinicsSnap.data().count;
    const totalPamphlets = pamphletsSnap.data().count;
    const newUsersThisWeek = authUsers.filter((u) => {
      const created = new Date(u.metadata.creationTime);
      return !Number.isNaN(created.getTime()) && created >= sevenDaysAgo;
    }).length;

    res.json({
      ok: true,
      stats: {
        totalUsers,
        newUsersThisWeek,
        totalPamphlets,
        totalClinics,
      },
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// USERS - List, search, view
// ─────────────────────────────────────────
router.get("/users", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const pageToken = req.query.pageToken || undefined;
    const search = String(req.query.search || "").trim().toLowerCase();

    const listResult = search
      ? { users: await listAllAuthUsers(), pageToken: null }
      : await auth.listUsers(limit, pageToken);
    const uids = listResult.users.map((u) => u.uid);
    const profileDocs = await Promise.all(
      uids.map((uid) => db.collection("users").doc(uid).get())
    );
    const profileMap = {};
    profileDocs.forEach((doc, i) => {
      profileMap[uids[i]] = {
        exists: doc.exists,
        data: doc.exists ? doc.data() : null,
      };
    });

    let users = listResult.users.map((u) => {
      const profileDoc = profileMap[u.uid] || { exists: false, data: null };
      return {
        uid: u.uid,
        email: u.email || null,
        emailVerified: u.emailVerified,
        disabled: u.disabled,
        createdAt: u.metadata.creationTime,
        lastSignIn: u.metadata.lastSignInTime,
        role: u.customClaims?.role || profileDoc.data?.role || "user",
        profile: profileDoc.data?.profile || profileDoc.data || null,
        profileStatus: profileDoc.exists ? "synced" : "auth_only",
      };
    });

    if (search) {
      users = users
        .filter((u) => includesSearch(
          u.email,
          u.uid,
          u.role,
          u.profile?.name,
          u.profile?.displayName,
          search
        ))
        .slice(0, limit);
    }

    res.json({ ok: true, users, nextPageToken: listResult.pageToken || null });
  } catch (err) {
    console.error("Admin list users error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/users", async (req, res) => {
  let createdUid = null;
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const displayName = String(req.body?.displayName || "").trim().slice(0, 80);
    const role = normalizeRole(req.body?.role || "admin");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and temporary password are required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Temporary password must be at least 8 characters." });
    }

    const userRecord = await auth.createUser({
      email,
      password,
      displayName: displayName || undefined,
      emailVerified: false,
      disabled: false,
    });
    createdUid = userRecord.uid;

    await auth.setCustomUserClaims(userRecord.uid, { role });

    const userDoc = {
      email,
      role,
      disabled: false,
      createdBy: req.user.uid,
      createdByAdmin: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      setupRequired: true,
      profile: {
        email,
        displayName: displayName || "",
      },
    };

    await db.collection("users").doc(userRecord.uid).set(userDoc, { merge: true });

    if (role === "admin") {
      await db.collection("adminUsers").doc(userRecord.uid).set({
        email,
        grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        grantedBy: req.user.uid,
      });
    }

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     "ACCOUNT_CREATED",
      entityType: "user",
      entityId:   userRecord.uid,
      targetUid:  userRecord.uid,
      meta:       { changedFields: ["email", "role"], reasonCode: "admin_created" },
    });

    res.status(201).json({
      ok: true,
      user: {
        uid: userRecord.uid,
        email,
        role,
        disabled: false,
        createdAt: userRecord.metadata.creationTime,
      },
    });
  } catch (err) {
    console.error("Admin create user error:", err);
    if (createdUid) {
      await auth.deleteUser(createdUid).catch((cleanupErr) => {
        console.warn("Admin create user cleanup failed:", cleanupErr?.message || cleanupErr);
      });
    }
    if (err?.code === "auth/email-already-exists") {
      return res.status(409).json({ error: "A Firebase account with this email already exists." });
    }
    if (err?.code === "auth/invalid-email") {
      return res.status(400).json({ error: "Invalid email address." });
    }
    if (err?.code === "auth/weak-password") {
      return res.status(400).json({ error: "Temporary password is too weak." });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const [authUser, profileDoc] = await Promise.all([
      auth.getUser(uid),
      db.collection("users").doc(uid).get(),
    ]);

    const [cycleCount, symptomCount] = await Promise.all([
      db.collection("cycleLogs").doc(uid).collection("entries").count().get(),
      db.collection("symptomLogs").doc(uid).collection("entries").count().get(),
    ]);

    // Audit: admin viewed a user's detail page
    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.ADMIN_VIEWED_USER,
      entityType: "user",
      entityId:   uid,
      targetUid:  uid,
    });

    res.json({
      ok: true,
      user: {
        uid: authUser.uid,
        email: authUser.email || null,
        emailVerified: authUser.emailVerified,
        disabled: authUser.disabled,
        createdAt: authUser.metadata.creationTime,
        lastSignIn: authUser.metadata.lastSignInTime,
        role: authUser.customClaims?.role || "user",
        profile: profileDoc.exists ? profileDoc.data() : null,
        cycleLogs: cycleCount.data().count,
        symptomLogs: symptomCount.data().count,
      },
    });
  } catch (err) {
    res.status(404).json({ error: "User not found" });
  }
});

// ─────────────────────────────────────────
// USER ACTIONS - Disable, enable, promote
// ─────────────────────────────────────────
router.post("/users/:uid/disable", async (req, res) => {
  try {
    const { uid } = req.params;
    if (uid === req.user.uid) {
      return res.status(400).json({ error: "Cannot disable your own account" });
    }
    await auth.updateUser(uid, { disabled: true });
    await db.collection("users").doc(uid).set(
      {
        disabled: true,
        disabledAt: admin.firestore.FieldValue.serverTimestamp(),
        disabledBy: req.user.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.ACCOUNT_DISABLED,
      entityType: "user",
      entityId:   uid,
      targetUid:  uid,
    });

    res.json({ ok: true, message: "User disabled" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/users/:uid/enable", async (req, res) => {
  try {
    const { uid } = req.params;
    await auth.updateUser(uid, { disabled: false });
    await db.collection("users").doc(uid).set(
      {
        disabled: false,
        enabledAt: admin.firestore.FieldValue.serverTimestamp(),
        enabledBy: req.user.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.ACCOUNT_ENABLED,
      entityType: "user",
      entityId:   uid,
      targetUid:  uid,
    });

    res.json({ ok: true, message: "User enabled" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/users/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    if (uid === req.user.uid) {
      return res.status(400).json({ error: "Cannot delete your own admin account" });
    }

    const stats = await deleteBloomUserData(uid);

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.ACCOUNT_DELETED,
      entityType: "user",
      entityId:   uid,
      targetUid:  uid,
      meta:       { reasonCode: "admin_delete" },
    });

    res.json({ ok: true, message: "User deleted", stats });
  } catch (err) {
    console.error("Admin delete user error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/users/:uid/promote", async (req, res) => {
  try {
    const { uid } = req.params;
    const { role } = req.body;
    const allowed = ["admin", "user"];
    if (!allowed.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    if (uid === req.user.uid && role !== "admin") {
      return res.status(400).json({ error: "Cannot demote your own admin account" });
    }

    // 1. Set Firebase custom claims
    await auth.setCustomUserClaims(uid, { role });

    // 2. Sync role to Firestore users doc
    await db.collection("users").doc(uid).set(
      { role, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    // 3. Sync adminUsers collection to match Firestore rules isAdmin() check
    const adminRef = db.collection("adminUsers").doc(uid);
    if (role === "admin") {
      await adminRef.set({ grantedAt: admin.firestore.FieldValue.serverTimestamp(), grantedBy: req.user.uid });
    } else {
      await adminRef.delete();
    }

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.ROLE_CHANGED,
      entityType: "user",
      entityId:   uid,
      targetUid:  uid,
      meta:       { changedFields: ["role"], reasonCode: role },
    });

    res.json({ ok: true, message: `User role set to ${role}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// SETUP (disabled)
// ─────────────────────────────────────────
router.post("/setup/first-admin", async (_req, res) => {
  res.status(410).json({ error: "Setup route disabled. Use Firebase Console to set admin claim." });
});

// ─────────────────────────────────────────
// RECENT ACTIVITY
// ─────────────────────────────────────────
router.get("/activity", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const snap = await db
      .collectionGroup("entries")
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();

    const items = snap.docs.map((d) => {
      const data = d.data();
      const uid = d.ref.parent.parent?.id || "unknown";
      return {
        uid,
        dateKey: data.dateKey,
        flow: data.flow || null,
        hasSymptoms: !!(data.symptoms?.length || data.items?.length),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    res.json({ ok: true, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// PAMPHLETS - Full CRUD
// ─────────────────────────────────────────
router.get("/pamphlets", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    // No orderBy = avoids Firestore silently excluding docs that lack the field
    const snap = await db.collection("pamphlets").get();
    let pamphlets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (search) {
      pamphlets = pamphlets.filter((p) => includesSearch(
        p.title,
        p.category,
        p.summary,
        p.content,
        p.id,
        search
      ));
    }
    // Sort by updatedAt descending, then title ascending as tiebreaker
    pamphlets.sort((a, b) => {
      const at = a.updatedAt?.toDate?.()?.getTime() ?? a.createdAt?.toDate?.()?.getTime() ?? 0;
      const bt = b.updatedAt?.toDate?.()?.getTime() ?? b.createdAt?.toDate?.()?.getTime() ?? 0;
      return bt - at || (a.title ?? "").localeCompare(b.title ?? "");
    });
    res.json({ ok: true, pamphlets });
  } catch (err) {
    console.error("Admin GET /pamphlets error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /pamphlets/upload-pdf ───────────────────────────────
// Accepts base64-encoded PDF, stores in Firebase Storage, returns public URL.
// Body: { filename: string, mimeType: "application/pdf", data: base64string }
router.post("/pamphlets/upload-pdf", async (req, res) => {
  try {
    const { filename, mimeType, data } = req.body;
    if (!data || mimeType !== "application/pdf") {
      return res.status(400).json({ error: "Only PDF files are allowed." });
    }
    const buffer = Buffer.from(data, "base64");
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `pamphlets/${Date.now()}_${safeName}`;

    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    await file.save(buffer, { contentType: "application/pdf", resumable: false });
    await file.makePublic();

    const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    console.log(`[admin] PDF uploaded: ${storagePath}`);
    return res.json({ ok: true, url });
  } catch (err) {
    console.error("[admin] PDF upload error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.post("/pamphlets", async (req, res) => {
  try {
    const { title, category, summary, content, readTime, sensitive, pdf } = req.body;
    if (!title || !category || !content) {
      return res.status(400).json({ error: "title, category, and content are required" });
    }
    const doc = await db.collection("pamphlets").add({
      title,
      category,
      summary: summary || "",
      content,
      readTime: readTime || "",
      sensitive: sensitive === true,
      pdf: pdf || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid,
    });

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.PAMPHLET_ADDED,
      entityType: "pamphlet",
      entityId:   doc.id,
      meta:       { changedFields: ["title", "category", "content"] },
    });

    res.json({ ok: true, id: doc.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/pamphlets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, summary, content, readTime, sensitive, pdf } = req.body;
    const updates = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.uid,
    };
    if (title     !== undefined) updates.title     = title;
    if (category  !== undefined) updates.category  = category;
    if (summary   !== undefined) updates.summary   = summary;
    if (content   !== undefined) updates.content   = content;
    if (readTime  !== undefined) updates.readTime  = readTime;
    if (sensitive !== undefined) updates.sensitive = sensitive === true;
    if (pdf       !== undefined) updates.pdf       = pdf || null;

    await db.collection("pamphlets").doc(id).update(updates);

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.PAMPHLET_UPDATED,
      entityType: "pamphlet",
      entityId:   id,
      meta:       { changedFields: Object.keys(req.body) },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/pamphlets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection("pamphlets").doc(id).delete();

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.PAMPHLET_DELETED,
      entityType: "pamphlet",
      entityId:   id,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// CLINICS - Full CRUD
// ─────────────────────────────────────────
router.get("/clinics", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const snap = await db.collection("clinicDirectory").orderBy("name").get();
    let clinics = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (!clinics.length) {
      const jsonClinics = loadClinicsJSON();
      const batch = db.batch();
      clinics = jsonClinics.map((c) => {
        const ref = db.collection("clinicDirectory").doc();
        const doc = {
          name:      c.name || "",
          country:   c.country || "Jamaica",
          parish:    c.parish || "",
          address:   c.address || "",
          phone:     Array.isArray(c.phones) ? c.phones[0] || "" : (c.phone || ""),
          hours:     c.hours || "",
          services:  Array.isArray(c.services) ? c.services : [],
          type:      c.type || "",
          status:    c.status || "active",
          region:    c.region || "",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        batch.set(ref, doc);
        return { id: ref.id, ...doc };
      });
      await batch.commit();
    }

    if (search) {
      clinics = clinics.filter((c) => includesSearch(
        c.name,
        c.country,
        c.parish,
        c.address,
        c.phone,
        c.type,
        Array.isArray(c.services) ? c.services.join(" ") : "",
        c.id,
        search
      ));
    }

    res.json({ ok: true, clinics });
  } catch (err) {
    console.error("Admin GET /clinics error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/clinics", async (req, res) => {
  try {
    const { name, country, parish, address, type, phone, hours, services } = req.body;
    if (!name || !country) {
      return res.status(400).json({ error: "name and country are required" });
    }
    const doc = await db.collection("clinicDirectory").add({
      name,
      country,
      parish:    parish    || "",
      address:   address   || "",
      type:      type      || "",
      phone:     phone     || "",
      hours:     hours     || "",
      services:  Array.isArray(services) ? services : [],
      status:    "active",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid,
    });

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.CLINIC_ADDED,
      entityType: "clinic",
      entityId:   doc.id,
      meta:       { changedFields: ["name", "parish", "type"] },
    });

    res.json({ ok: true, id: doc.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/clinics/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, country, parish, address, type, phone, hours, services } = req.body;
    const updates = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.uid,
    };
    if (name     !== undefined) updates.name     = name;
    if (country  !== undefined) updates.country  = country;
    if (parish   !== undefined) updates.parish   = parish;
    if (address  !== undefined) updates.address  = address;
    if (type     !== undefined) updates.type     = type;
    if (phone    !== undefined) updates.phone    = phone;
    if (hours    !== undefined) updates.hours    = hours;
    if (services !== undefined) updates.services = Array.isArray(services) ? services : [];

    await db.collection("clinicDirectory").doc(id).update(updates);

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.CLINIC_UPDATED,
      entityType: "clinic",
      entityId:   id,
      meta:       { changedFields: Object.keys(req.body) },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/clinics/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection("clinicDirectory").doc(id).delete();

    await logAudit({
      actorUid:   req.user.uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.CLINIC_DELETED,
      entityType: "clinic",
      entityId:   id,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// SAFETY LOGS - Read & mark reviewed
// ─────────────────────────────────────────
router.get("/safety-logs", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const includeReviewed = req.query.reviewed === "true";

    // Avoid compound query (reviewed + orderBy) which needs a composite index.
    // Fetch unreviewed first; fall back to simple get if that also fails.
    let snap;
    try {
      snap = await db.collection("bloomieSafetyLogs")
        .where("reviewed", "==", false)
        .get();
    } catch (_) {
      snap = await db.collection("bloomieSafetyLogs").get();
    }

    let logs = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      ts: d.data().ts?.toDate?.()?.toISOString() ?? null,
    }));

    if (!includeReviewed) logs = logs.filter((l) => l.reviewed === false);

    // Drop low-signal oos_fallback rows: no health keywords AND no elevated risk.
    // urgent_trigger and escalation events are always kept.
    const noiseFilter = req.query.noise !== "include";
    if (noiseFilter) {
      logs = logs.filter((l) => {
        if (l.type !== "oos_fallback") return true;
        return l.containsHealthKeywords === true
          || (l.riskLevel && l.riskLevel !== "low");
      });
    }

    // Sort by ts descending in JS
    logs.sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
    logs = logs.slice(0, limit);

    res.json({ ok: true, logs });
  } catch (err) {
    console.error("Admin GET /safety-logs error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/safety-logs/:id/reviewed", async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection("bloomieSafetyLogs").doc(id).update({
      reviewed: true,
      reviewedBy: req.user.uid,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Admin PATCH /safety-logs/:id/reviewed error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// CONTACT MESSAGES - support inbox
// ─────────────────────────────────────────

router.get("/contact-messages", async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const status = req.query.status ? normalizeSupportStatus(req.query.status) : null;
    const search = String(req.query.search || "").trim();
    const includeHiddenResolved = req.query.includeHiddenResolved === "true";

    const snap = await db.collection("contactMessages").get();
    let messages = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      status: normalizeSupportStatus(d.data().status),
      createdAt: firestoreDateToIso(d.data().createdAt),
      updatedAt: firestoreDateToIso(d.data().updatedAt),
      resolvedAt: firestoreDateToIso(d.data().resolvedAt),
      respondedAt: firestoreDateToIso(d.data().respondedAt),
    }));

    if (status) messages = messages.filter(m => m.status === status);
    if (!includeHiddenResolved) messages = messages.filter((m) => !isResolvedHidden(m));
    if (search) {
      messages = messages.filter((m) => includesSearch(
        m.requestId,
        m.subject,
        m.message,
        m.replyEmail,
        m.name,
        m.userId,
        m.status,
        search
      ));
    }
    messages.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    messages = messages.slice(0, limit);

    res.json({ ok: true, messages });
  } catch (err) {
    console.error("Admin GET /contact-messages error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/contact-messages/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const status = normalizeSupportStatus(req.body?.status);
    const VALID = new Set(["not_started", "in_progress", "resolved"]);
    if (!VALID.has(status)) return res.status(400).json({ error: "Invalid status." });

    const updates = {
      status,
      statusLabel: supportStatusLabel(status),
      statusUpdatedBy: req.user.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (status === "resolved") {
      updates.resolvedAt = admin.firestore.FieldValue.serverTimestamp();
      updates.resolvedBy = req.user.uid;
    } else {
      updates.resolvedAt = admin.firestore.FieldValue.delete();
      updates.resolvedBy = admin.firestore.FieldValue.delete();
    }

    await db.collection("contactMessages").doc(id).update(updates);
    res.json({ ok: true });
  } catch (err) {
    console.error("Admin PATCH /contact-messages/:id/status error:", err);
    res.status(500).json({ error: err.message });
  }
});

function publicEmailError(err) {
  const raw = String(err?.message || err || "Email could not be sent.");
  const normalized = raw.toLowerCase();
  if (
    normalized.includes("smtpclientauthentication is disabled") ||
    normalized.includes("authentication unsuccessful") ||
    normalized.includes("535 5.7.139")
  ) {
    return "Bloom saved the response, but the Outlook helpdesk mailbox is not enabled for SMTP sending yet.";
  }
  if (normalized.includes("invalid login") || normalized.includes("authentication failed")) {
    return "Bloom saved the response, but the helpdesk email login is not configured correctly.";
  }
  return raw.slice(0, 300);
}

router.post("/contact-messages/:id/response", async (req, res) => {
  try {
    const { id } = req.params;
    const message = String(req.body?.message || "").trim().slice(0, 2000);
    const sendEmail = req.body?.sendEmail !== false;
    if (!message) return res.status(400).json({ error: "Response message is required." });

    const ref = db.collection("contactMessages").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Support request not found." });
    const data = snap.data() || {};
    const nowIso = new Date().toISOString();
    const response = {
      message,
      createdAt: nowIso,
      createdBy: req.user.uid,
      sentByEmail: false,
    };

    let emailSent = false;
    let emailError = null;
    if (sendEmail && data.replyEmail) {
      try {
        emailSent = await sendMailTo({
          to: data.replyEmail,
          subject: `Re: Bloom support ${data.requestId || ""}`.trim(),
          html: `
            <div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#2f0f25;">
              <p>Hello${data.name ? ` ${escapeHtml(data.name)}` : ""},</p>
              <p>${escapeHtml(message).replaceAll("\n", "<br>")}</p>
              <p style="color:#8a5b75;">Bloom Support</p>
              ${data.requestId ? `<p style="font-size:12px;color:#999;">Request ID: ${escapeHtml(data.requestId)}</p>` : ""}
            </div>
          `,
        });
        response.sentByEmail = emailSent;
      } catch (mailErr) {
        console.warn("Admin support response email failed:", mailErr?.message || mailErr);
        emailError = publicEmailError(mailErr);
        response.emailError = emailError;
      }
    }

    const status = normalizeSupportStatus(data.status) === "not_started" ? "in_progress" : normalizeSupportStatus(data.status);
    await ref.update({
      responses: admin.firestore.FieldValue.arrayUnion(response),
      latestResponse: message,
      respondedAt: admin.firestore.FieldValue.serverTimestamp(),
      respondedBy: req.user.uid,
      status,
      statusLabel: supportStatusLabel(status),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ ok: true, emailSent, emailError });
  } catch (err) {
    console.error("Admin POST /contact-messages/:id/response error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// PHASE FEEDBACK REVIEW - dashboard phase accuracy feedback
// ─────────────────────────────────────────
router.get("/phase-feedback-review", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const search = String(req.query.search || "").trim();
    const byKey = new Map();

    const addFeedbackDoc = (doc, source, uidOverride = null) => {
      const data = doc.data() || {};
      if (!data.response && !data.predictedPhase && !data.createdAt && !data.timestamp) return;
      const uid = data.uid || uidOverride || doc.ref.parent.parent?.id || null;
      const item = {
        id: doc.id,
        source,
        uid,
        ...data,
        createdAt: firestoreDateToIso(data.createdAt),
        updatedAt: firestoreDateToIso(data.updatedAt),
      };
      byKey.set(`${uid || "unknown"}:${doc.id}`, item);
    };

    const canonicalSnap = await db.collectionGroup("phaseFeedback").get();
    canonicalSnap.docs.forEach((doc) => addFeedbackDoc(doc, "user_phase_feedback"));

    const legacyUserRefs = await db.collection("phaseFeedback").listDocuments();
    const legacySnaps = await Promise.all(
      legacyUserRefs.map((userRef) => userRef.collection("entries").get())
    );
    legacySnaps.forEach((snap, index) => {
      const uid = legacyUserRefs[index].id;
      snap.docs.forEach((doc) => addFeedbackDoc(doc, "legacy_phase_feedback", uid));
    });

    let feedback = [...byKey.values()];
    if (search) {
      feedback = feedback.filter((d) => includesSearch(
        d.uid,
        d.response,
        d.correctedPhase,
        d.predictedPhase,
        d.prediction?.phase,
        d.userFeedback?.response,
        d.userFeedback?.correctedPhase,
        d.confidence?.level,
        d.confidence,
        d.notes,
        d.id,
        search
      ));
    }

    feedback.sort((a, b) => {
      const at = new Date(a.createdAt || a.timestamp || 0).getTime() || 0;
      const bt = new Date(b.createdAt || b.timestamp || 0).getTime() || 0;
      return bt - at;
    });
    feedback = feedback.slice(0, limit);

    res.json({ ok: true, feedback });
  } catch (err) {
    console.error("Admin GET /phase-feedback-review error:", err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FEEDBACK REVIEW - Bloomie user ratings
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get("/feedback-review", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const search = String(req.query.search || "").trim();
    const snap = await db.collection("bloomieFeedback").get();

    let feedback = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      createdAt: firestoreDateToIso(d.data().createdAt),
    }));

    if (search) {
      feedback = feedback.filter((d) => includesSearch(
        d.feedbackType,
        d.messageText,
        d.userId,
        d.route,
        d.id,
        Array.isArray(d.conversationPreview)
          ? d.conversationPreview.map((m) => `${m.from || ""}: ${m.text || ""}`).join(" ")
          : "",
        search
      ));
    }

    // Sort newest first in JS = avoids needing a Firestore index
    feedback.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    feedback = feedback.slice(0, limit);

    res.json({ ok: true, feedback });
  } catch (err) {
    console.error("Admin GET /feedback-review error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOOMIE ANALYTICS SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
router.get("/bloomie-analytics/summary", async (_req, res) => {
  try {
    const snap = await db.collection("bloomie_analytics").get();

    const confidenceTierDistribution = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const routeDistribution = {};
    const toneDistribution = {};
    const emotionSourceDistribution = {};
    const noMatchPhraseCounts = {};

    let fallbackCount = 0;
    let noMatchCount = 0;
    let urgencyEscalationCount = 0;
    let oosEventCount = 0;
    let sessionDepthSum = 0;
    let sessionDepthN = 0;

    const inc = (bucket, key) => {
      if (!key) return;
      bucket[key] = (bucket[key] || 0) + 1;
    };

    snap.forEach((doc) => {
      const d = doc.data() || {};
      const eventType = String(d.eventType || "").toLowerCase();

      if (eventType === "route_fallback") fallbackCount++;
      if (eventType === "route_no_match") noMatchCount++;
      if (eventType === "urgency_escalation") urgencyEscalationCount++;
      if (eventType === "oos_event") oosEventCount++;

      const depth =
        Number.isFinite(d.sessionDepth) ? d.sessionDepth :
        Number.isFinite(d.meta_sessionDepth) ? d.meta_sessionDepth :
        null;
      if (Number.isFinite(depth)) {
        sessionDepthSum += depth;
        sessionDepthN++;
      }

      if (typeof d.route === "string" && d.route) inc(routeDistribution, d.route);

      const confidenceTier = String(d.meta_confidenceTier || "").toUpperCase();
      if (confidenceTier in confidenceTierDistribution) {
        confidenceTierDistribution[confidenceTier]++;
      }

      const tone = typeof d.tone === "string" && d.tone ? d.tone : d.meta_tone;
      if (typeof tone === "string" && tone) inc(toneDistribution, tone);

      const source = typeof d.source === "string" && d.source ? d.source : d.meta_toneSource;
      if (typeof source === "string" && source) inc(emotionSourceDistribution, source);

      if (eventType === "route_no_match" && typeof d.input === "string" && d.input.trim()) {
        inc(noMatchPhraseCounts, d.input.trim().toLowerCase());
      }
    });

    const topNoMatchPhrases = Object.entries(noMatchPhraseCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([phrase, count]) => ({ phrase, count }));

    const avgSessionDepth = sessionDepthN > 0
      ? Number((sessionDepthSum / sessionDepthN).toFixed(2))
      : 0;

    return res.json({
      ok: true,
      summary: {
        fallbackCount,
        noMatchCount,
        urgencyEscalationCount,
        oosEventCount,
        avgSessionDepth,
        confidenceTierDistribution,
        routeDistribution,
        toneDistribution,
        emotionSourceDistribution,
        topNoMatchPhrases,
      },
    });
  } catch (err) {
    console.error("Admin GET /bloomie-analytics/summary error:", err);
    return res.status(500).json({ error: "Failed to load Bloomie analytics summary" });
  }
});

export default router;
