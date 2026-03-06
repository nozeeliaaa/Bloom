/**
 * admin.js — Bloom Admin API Routes
 * All endpoints require role="admin" (set via Firebase Custom Claims).
 * Use setAdminClaim(uid) from auth.js middleware to promote a user.
 */
import express from "express";
import admin from "firebase-admin";
import { db, auth } from "../firebaseAdmin.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// All admin routes require auth + admin role
router.use(requireAuth);
router.use(requireRole("admin"));

// ─────────────────────────────────────────
// STATS — Overview numbers for dashboard
// ─────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const [usersSnap, cycleSnap, symptomSnap] = await Promise.all([
      db.collection("users").count().get(),
      db.collectionGroup("entries").where("flow", "!=", "none").count().get(),
      db.collectionGroup("entries").where("items", "!=", null).count().get(),
    ]);

    const totalUsers = usersSnap.data().count;
    const totalCycleLogs = cycleSnap.data().count;
    const totalSymptomLogs = symptomSnap.data().count;

    // New users in last 7 days (by createdAt)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const newUsersSnap = await db
      .collection("users")
      .where("createdAt", ">=", sevenDaysAgo)
      .count()
      .get();
    const newUsersThisWeek = newUsersSnap.data().count;

    // Goal distribution
    const allUsers = await db.collection("users").select("profile").get();
    const goalCounts = {};
    allUsers.docs.forEach((d) => {
      const goal = d.data()?.profile?.goal || "unknown";
      goalCounts[goal] = (goalCounts[goal] || 0) + 1;
    });

    res.json({
      ok: true,
      stats: {
        totalUsers,
        newUsersThisWeek,
        totalCycleLogs,
        totalSymptomLogs,
        goalDistribution: goalCounts,
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

    // Firebase Auth list (has email, createdAt, disabled, etc.)
    const listResult = await auth.listUsers(limit, pageToken);

    // Batch fetch Firestore profiles for these UIDs
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

    res.json({
      ok: true,
      users,
      nextPageToken: listResult.pageToken || null,
    });
  } catch (err) {
    console.error("Admin list users error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get one user with full details
router.get("/users/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const [authUser, profileDoc] = await Promise.all([
      auth.getUser(uid),
      db.collection("users").doc(uid).get(),
    ]);

    // Count their logs
    const [cycleCount, symptomCount] = await Promise.all([
      db.collection("cycleLogs").doc(uid).collection("entries").count().get(),
      db.collection("symptomLogs").doc(uid).collection("entries").count().get(),
    ]);

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
    if (uid === req.user.uid) return res.status(400).json({ error: "Cannot disable your own account" });
    await auth.updateUser(uid, { disabled: true });
    res.json({ ok: true, message: "User disabled" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/users/:uid/enable", async (req, res) => {
  try {
    const { uid } = req.params;
    await auth.updateUser(uid, { disabled: false });
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
    if (!allowed.includes(role)) return res.status(400).json({ error: "Invalid role" });
    await auth.setCustomUserClaims(uid, { role });
    res.json({ ok: true, message: `User role set to ${role}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// SELF-PROMOTE SETUP ROUTE (one-time only)
// Restricted to first admin setup — blocks if any admin already exists
// ─────────────────────────────────────────
router.post("/setup/first-admin", async (_req, res) => {
  // NOTE: This endpoint temporarily bypasses the admin role check
  // It should be removed after first admin is created
  res.status(410).json({ error: "Setup route disabled. Use Firebase Console to set admin claim." });
});

// ─────────────────────────────────────────
// RECENT ACTIVITY — Last N logs across all users
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
      // Parent path: cycleLogs/{uid}/entries/{dateKey}
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
    if (title !== undefined) updates.title = title;
    if (category !== undefined) updates.category = category;
    if (summary !== undefined) updates.summary = summary;
    if (content !== undefined) updates.content = content;
    if (readTime !== undefined) updates.readTime = readTime;
    if (sensitive !== undefined) updates.sensitive = sensitive === true;
    await db.collection("pamphlets").doc(id).update(updates);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/pamphlets/:id", async (req, res) => {
  try {
    await db.collection("pamphlets").doc(req.params.id).delete();
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
    const snap = await db.collection("clinics").orderBy("name").get();
    const clinics = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, clinics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/clinics", async (req, res) => {
  try {
    const { name, country, parish, address, phone, hours, services } = req.body;
    if (!name || !country) {
      return res.status(400).json({ error: "name and country are required" });
    }
    const doc = await db.collection("clinics").add({
      name,
      country,
      parish: parish || "",
      address: address || "",
      phone: phone || "",
      hours: hours || "",
      services: Array.isArray(services) ? services : [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid,
    });
    res.json({ ok: true, id: doc.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/clinics/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, country, parish, address, phone, hours, services } = req.body;
    const updates = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.uid,
    };
    if (name !== undefined) updates.name = name;
    if (country !== undefined) updates.country = country;
    if (parish !== undefined) updates.parish = parish;
    if (address !== undefined) updates.address = address;
    if (phone !== undefined) updates.phone = phone;
    if (hours !== undefined) updates.hours = hours;
    if (services !== undefined) updates.services = Array.isArray(services) ? services : [];
    await db.collection("clinics").doc(id).update(updates);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/clinics/:id", async (req, res) => {
  try {
    await db.collection("clinics").doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;