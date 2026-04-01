// src/routes/catalog.js
import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// ─── GET /catalog/clinics ────────────────────────────────────────────────────
// Returns clinic directory, filterable by parish and type
router.get("/clinics", async (req, res) => {
  try {
    const { parish, type } = req.query;

    let q = db.collection("clinicDirectory").where("status", "==", "active");

    if (parish) q = q.where("parish", "==", parish);
    if (type) q = q.where("type", "==", type);

    const snap = await q.get();
    const clinics = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return res.json({ ok: true, clinics });
  } catch (err) {
    console.error("GET /catalog/clinics error:", err);
    return res.status(500).json({ error: "Failed to fetch clinics" });
  }
});

// ─── GET /catalog/symptoms ───────────────────────────────────────────────────
// Returns symptom catalog, filtered by teenSafe and sensitive flags
router.get("/symptoms", requireAuth, async (req, res) => {
  try {
    const { teenSafe, excludeSensitive } = req.query;

    let q = db.collection("symptomCatalog");

    // Filter for teen-safe symptoms if requested
    if (teenSafe === "true") {
      q = q.where("teenSafe", "==", true);
    }

    // Exclude sensitive symptoms if requested
    if (excludeSensitive === "true") {
      q = q.where("sensitive", "==", false);
    }

    const snap = await q.get();
    const symptoms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Sort by category then label client-side (avoids needing extra index)
    symptoms.sort((a, b) =>
      a.category.localeCompare(b.category) || a.label.localeCompare(b.label)
    );

    return res.json({ ok: true, symptoms });
  } catch (err) {
    console.error("GET /catalog/symptoms error:", err);
    return res.status(500).json({ error: "Failed to fetch symptoms" });
  }
});

// ─── GET /catalog/route ──────────────────────────────────────────────────────
// Proxies OpenRouteService Directions API so the API key stays server-side.
// Query: fromLat, fromLng, toLat, toLng, mode (driving-car|foot-walking)
router.get("/route", async (req, res) => {
  const { fromLat, fromLng, toLat, toLng, mode = "driving-car" } = req.query;

  if (!fromLat || !fromLng || !toLat || !toLng) {
    return res.status(400).json({ error: "Missing coordinates" });
  }

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "ORS_API_KEY not configured" });
  }

  try {
    const url = `https://api.openrouteservice.org/v2/directions/${mode}/geojson`;

    const orsRes = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json, application/geo+json",
      },
      body: JSON.stringify({
        coordinates: [[Number(fromLng), Number(fromLat)], [Number(toLng), Number(toLat)]],
        radiuses: [-1, -1],
      }),
    });

    if (!orsRes.ok) {
      const text = await orsRes.text();
      throw new Error(`ORS ${orsRes.status}: ${text.slice(0, 200)}`);
    }

    const orsData = await orsRes.json();
    const feature = orsData.features?.[0];
    if (!feature) throw new Error("No route returned by ORS");

    const { distance, duration } = feature.properties.summary;
    // ORS GeoJSON coords are [lng, lat] — flip to [lat, lng] for Leaflet
    const coords = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

    return res.json({
      ok: true,
      distance_km: +(distance / 1000).toFixed(2),
      duration_min: Math.round(duration / 60),
      coords,
    });
  } catch (err) {
    console.error("GET /catalog/route error:", err.message);
    return res.status(502).json({ error: err.message });
  }
});

export default router;