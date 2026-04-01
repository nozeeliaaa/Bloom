/**
 * admin.js — Bloom Admin API Routes
 * All endpoints require role="admin" (set via Firebase Custom Claims).
 */
import express from "express";
import admin from "firebase-admin";
import { db, auth } from "../firebaseAdmin.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLog.js";
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

// ─────────────────────────────────────────
// STATS
// ─────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const usersCountPromise = db.collection("users").count().get();
    const clinicsCountPromise = db.collection("clinicDirectory").count().get();
    const pamphletsCountPromise = db.collection("pamphlets").count().get();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const newUsersPromise = db
      .collection("users")
      .where("createdAt", ">=", sevenDaysAgo)
      .count()
      .get();

    const goalsPromise = db.collection("users").select("profile").get();

    const [
      usersSnap,
      clinicsSnap,
      pamphletsSnap,
      newUsersSnap,
      allUsers,
    ] = await Promise.all([
      usersCountPromise,
      clinicsCountPromise,
      pamphletsCountPromise,
      newUsersPromise,
      goalsPromise,
    ]);

    const totalUsers = usersSnap.data().count;
    const totalClinics = clinicsSnap.data().count;
    const totalPamphlets = pamphletsSnap.data().count;
    const newUsersThisWeek = newUsersSnap.data().count;

    let totalCycleLogs = 0;
    let totalSymptomLogs = 0;

    try {
      const entriesSnap = await db.collectionGroup("entries").get();

      entriesSnap.forEach((doc) => {
        const data = doc.data();

        if (data.flow && data.flow !== "none") {
          totalCycleLogs++;
        }

        if (Array.isArray(data.items) && data.items.length > 0) {
          totalSymptomLogs++;
        }
      });
    } catch (err) {
      console.warn("Entries aggregation failed:", err.message);
    }

    const goalDistribution = {};
    allUsers.forEach((doc) => {
      const data = doc.data();
      const goal = data?.profile?.goal || "unknown";
      goalDistribution[goal] = (goalDistribution[goal] || 0) + 1;
    });

    res.json({
      ok: true,
      stats: {
        totalUsers,
        newUsersThisWeek,
        totalCycleLogs,
        totalSymptomLogs,
        totalPamphlets,
        totalClinics,
        goalDistribution,
      },
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// USERS — List, search, view
// ─────────────────────────────────────────
router.get("/users", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const pageToken = req.query.pageToken || undefined;

    const listResult = await auth.listUsers(limit, pageToken);
    const uids = listResult.users.map((u) => u.uid);
    const profileDocs = await Promise.all(
      uids.map((uid) => db.collection("users").doc(uid).get())
    );
    const profileMap = {};
    profileDocs.forEach((doc, i) => {
      profileMap[uids[i]] = doc.exists ? doc.data()?.profile : null;
    });

    const users = listResult.users.map((u) => ({
      uid: u.uid,
      email: u.email || null,
      emailVerified: u.emailVerified,
      disabled: u.disabled,
      createdAt: u.metadata.creationTime,
      lastSignIn: u.metadata.lastSignInTime,
      role: u.customClaims?.role || "user",
      profile: profileMap[u.uid] || null,
    }));

    res.json({ ok: true, users, nextPageToken: listResult.pageToken || null });
  } catch (err) {
    console.error("Admin list users error:", err);
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
// USER ACTIONS — Disable, enable, promote
// ─────────────────────────────────────────
router.post("/users/:uid/disable", async (req, res) => {
  try {
    const { uid } = req.params;
    if (uid === req.user.uid) {
      return res.status(400).json({ error: "Cannot disable your own account" });
    }
    await auth.updateUser(uid, { disabled: true });

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

router.post("/users/:uid/promote", async (req, res) => {
  try {
    const { uid } = req.params;
    const { role } = req.body;
    const allowed = ["admin", "user"];
    if (!allowed.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    await auth.setCustomUserClaims(uid, { role });

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
// PAMPHLETS — Full CRUD
// ─────────────────────────────────────────
router.get("/pamphlets", async (req, res) => {
  try {
    const snap = await db.collection("pamphlets").orderBy("createdAt", "desc").get();
    const pamphlets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, pamphlets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/pamphlets", async (req, res) => {
  try {
    const { title, category, summary, content, readTime, sensitive } = req.body;
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
    const { title, category, summary, content, readTime, sensitive } = req.body;
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
// CLINICS — Full CRUD
// ─────────────────────────────────────────
router.get("/clinics", async (req, res) => {
  try {
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

export default router;