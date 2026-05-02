import express from "express";
import { db } from "../firebaseAdmin.js";

const router = express.Router();

const COLLECTION = "clinicDirectory";

function normalise(value) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesSearch(clinic, query) {
  if (!query) return true;

  const haystack = [
    clinic.name,
    clinic.address,
    clinic.parish,
    clinic.region,
    clinic.type,
    ...(clinic.services || []),
    ...(clinic.phones || []),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function applyClinicFilters(clinics, { parish, type, service, q }) {
  const parishFilter = normalise(parish);
  const typeFilter = normalise(type);
  const serviceFilter = normalise(service);
  const query = normalise(q);

  return clinics.filter((clinic) => {
    if (parishFilter && parishFilter !== "all" && normalise(clinic.parish) !== parishFilter) {
      return false;
    }

    if (typeFilter && typeFilter !== "all" && normalise(clinic.type) !== typeFilter) {
      return false;
    }

    if (
      serviceFilter &&
      serviceFilter !== "all" &&
      !(clinic.services || []).some((serviceName) => normalise(serviceName) === serviceFilter)
    ) {
      return false;
    }

    return matchesSearch(clinic, query);
  });
}

export async function listClinics(query = {}) {
  const snap = await db.collection(COLLECTION).get();
  const clinics = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((clinic) => clinic.status === "active");

  return applyClinicFilters(clinics, query).sort((a, b) => {
    const parishOrder = String(a.parish ?? "").localeCompare(String(b.parish ?? ""));
    return parishOrder || String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
}

router.get("/", async (req, res) => {
  try {
    const clinics = await listClinics(req.query);
    return res.json({ ok: true, clinics });
  } catch (err) {
    console.error("GET /api/clinics error:", err);
    return res.status(500).json({ error: "Failed to fetch clinics" });
  }
});

export default router;
