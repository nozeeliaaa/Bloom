import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve("backend/.env") });

const { db, admin } = await import("../backend/src/firebaseAdmin.js");

const JAMAICA_BOUNDS = {
  minLat: 17.65,
  maxLat: 18.65,
  minLng: -78.55,
  maxLng: -76.1,
};

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "bay", "by", "centre", "center", "clinic", "county",
  "dr", "doctor", "for", "health", "hospital", "jamaica", "limited", "ltd",
  "main", "medical", "memorial", "of", "office", "public", "regional", "road",
  "saint", "st", "street", "the", "toll", "west", "wi", "line",
]);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function argValue(name, fallback = null) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const WRITE = process.argv.includes("--write");
const FORCE = process.argv.includes("--force");
const LIMIT = Number(argValue("--limit", "0"));
const MATCH = String(argValue("--match", "")).trim().toLowerCase();
const MIN_SCORE = Number(argValue("--min-score", "0.62"));
const INCLUDE_LOW = process.argv.includes("--include-low-confidence");
const MARK_REVIEW = process.argv.includes("--mark-review");

const MANUAL_COORDINATES = {
  "NERHA Toll Free Line": {
    lat: 18.4073,
    lng: -77.1056,
    label: "Ocean Village Shopping Centre, Ocho Rios, Jamaica",
    provider: "manual-web-check",
    layer: "manual:shopping-centre-address",
    query: "Ocean Village Shopping Centre, Ocho Rios",
    confidence: 0.95,
    score: 1,
    reason: "manual-verified-address",
  },
};

function hasCoords(clinic) {
  const candidates = [
    [clinic.lat, clinic.lng],
    [clinic.latitude, clinic.longitude],
    [clinic.location?.lat, clinic.location?.lng],
    [clinic.location?.latitude, clinic.location?.longitude],
    [clinic.coordinates?.lat, clinic.coordinates?.lng],
    [clinic.coordinates?.latitude, clinic.coordinates?.longitude],
  ];
  return candidates.some(([lat, lng]) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)));
}

function inJamaica(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= JAMAICA_BOUNDS.minLat &&
    lat <= JAMAICA_BOUNDS.maxLat &&
    lng >= JAMAICA_BOUNDS.minLng &&
    lng <= JAMAICA_BOUNDS.maxLng
  );
}

function compact(parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bst[.]?\b/g, " saint ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function uniqueTokens(text) {
  return [...new Set(tokenize(text))];
}

function hitRatio(sourceTokens, labelTokens) {
  if (!sourceTokens.length) return 0;
  const labelSet = new Set(labelTokens);
  const hits = sourceTokens.filter((token) => labelSet.has(token)).length;
  return hits / sourceTokens.length;
}

function keyAddressPart(address = "") {
  const parts = String(address)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[0] || address;
}

function buildQueries(clinic) {
  const parish = clinic.parish ? `${clinic.parish}, Jamaica` : "Jamaica";
  const addressPart = keyAddressPart(clinic.address);
  const queries = [
    compact([clinic.name, clinic.address, parish]),
    compact([clinic.name, addressPart, "Jamaica"]),
    compact([clinic.name, parish]),
    compact([clinic.name, "Jamaica"]),
    compact([clinic.address, parish]),
    compact([addressPart, parish]),
  ];

  return queries.filter((query, index, arr) => query && arr.indexOf(query) === index);
}

function scoreCandidate(candidate, clinic) {
  const labelTokens = uniqueTokens(candidate.label);
  const nameTokens = uniqueTokens(clinic.name);
  const addressTokens = uniqueTokens(clinic.address);
  const nameRatio = hitRatio(nameTokens, labelTokens);
  const addressRatio = hitRatio(addressTokens, labelTokens);
  const label = String(candidate.label || "").toLowerCase();
  const address = String(clinic.address || "").toLowerCase();
  const hasMedicalPlaceWord = /\b(hospital|clinic|health|medical|centre|center|institute)\b/.test(label);
  const hasRejectedPlaceWord = /\b(cemetery|transport|civic|hardware|airport|church|mart|catholic|pastoral)\b/.test(label);
  const hasHealthCenterMatch =
    /\b(health|clinic|medical)\b/.test(label) &&
    !hasRejectedPlaceWord;
  const hasPlaceTypeForClinic = clinic.type === "health_center" ? hasHealthCenterMatch : hasMedicalPlaceWord;
  const hasSpecificAddress =
    /\d/.test(address) ||
    /\b(avenue|boulevard|brumalia|burke|caledonia|complex|deanery|drive|hope|lane|lyssons|mona|naylors?|north|place|road|seville|shopping|street|tangerine|windward)\b/.test(address);
  const genericLabel =
    /^jamaica$/i.test(candidate.label) ||
    /^(kingston|saint|st\.|clarendon|manchester|portland|st\.? ann|st\.? mary|st\.? thomas|st\.? catherine|st\.? elizabeth),?\s*(jamaica)?$/i.test(candidate.label);

  let score = 0;
  const reasons = [];

  if (nameRatio >= 0.66) {
    score += 0.42;
    reasons.push("name");
  } else if (nameRatio >= 0.34) {
    score += 0.22;
    reasons.push("partial-name");
  }

  if (addressRatio >= 0.5) {
    score += 0.38;
    reasons.push("address");
  } else if (addressRatio >= 0.25) {
    score += 0.18;
    reasons.push("partial-address");
  }

  if (candidate.source === "nominatim" && nameRatio >= 0.34) {
    score += 0.18;
    reasons.push("osm-name");
  }

  if (candidate.source === "openrouteservice" && addressRatio >= 0.5) {
    score += 0.12;
    reasons.push("ors-address");
  }

  if (hasPlaceTypeForClinic) {
    score += 0.1;
    reasons.push("place-type");
  }

  if (Number.isFinite(candidate.confidence)) {
    score += Math.min(Math.max(candidate.confidence, 0), 1) * 0.1;
  }

  if (genericLabel) {
    score -= 0.4;
    reasons.push("generic-label");
  }

  const isGenericPrivate =
    clinic.type === "private" &&
    nameRatio < 0.66 &&
    addressTokens.length <= 2 &&
    /kingston|jamaica/i.test(String(clinic.address || ""));
  if (isGenericPrivate) {
    score -= 0.8;
    reasons.push("generic-private-address");
  }

  if (["hospital", "health_center"].includes(clinic.type) && !hasMedicalPlaceWord && !hasSpecificAddress) {
    score -= 0.45;
    reasons.push("town-not-clinic-pin");
  }

  if (clinic.type === "health_center" && !hasHealthCenterMatch && !hasSpecificAddress) {
    score -= 0.65;
    reasons.push("not-health-centre-pin");
  }

  if (hasRejectedPlaceWord) {
    score -= 0.55;
    reasons.push("wrong-place-type");
  }

  return {
    ...candidate,
    score: Math.max(0, Math.min(1, score)),
    reason: reasons.join("+") || "weak-match",
  };
}

function chooseBestCandidate(candidates, clinic) {
  const scored = candidates
    .filter((item) => inJamaica(item.lat, item.lng))
    .map((item) => scoreCandidate(item, clinic))
    .sort((a, b) => b.score - a.score || (b.confidence || 0) - (a.confidence || 0));

  return scored[0] || null;
}

function toOrsCandidates(features = [], query) {
  return features.map((feature) => {
    const [lng, lat] = feature?.geometry?.coordinates || [];
    const props = feature?.properties || {};
    const confidence = Number(props.confidence ?? props.confidence_score ?? 0);
    return {
      lat: Number(lat),
      lng: Number(lng),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      label: props.label || props.name || "",
      layer: props.layer || "",
      provider: "openrouteservice",
      source: "openrouteservice",
      query,
    };
  });
}

function toNominatimCandidates(results = [], query) {
  return results.map((result) => ({
    lat: Number(result.lat),
    lng: Number(result.lon),
    confidence: Number(result.importance ?? 0.7),
    label: result.display_name || result.name || "",
    layer: [result.class, result.type].filter(Boolean).join(":"),
    provider: "nominatim",
    source: "nominatim",
    query,
  }));
}

async function geocodeOpenRouteService(query) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) throw new Error("ORS_API_KEY is not configured in backend/.env");

  const url = new URL("https://api.openrouteservice.org/geocode/search");
  url.searchParams.set("text", query);
  url.searchParams.set("boundary.country", "JM");
  url.searchParams.set("size", "5");

  const res = await fetch(url, {
    headers: {
      Authorization: apiKey,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ORS geocode ${res.status}: ${text.slice(0, 160)}`);
  }

  const data = await res.json();
  return toOrsCandidates(data.features || [], query);
}

async function geocodeNominatim(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "jm");
  url.searchParams.set("q", query);

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Bloom clinic coordinate verifier (local project script)",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Nominatim ${res.status}: ${text.slice(0, 160)}`);
  }

  const data = await res.json();
  await sleep(1100);
  return toNominatimCandidates(data || [], query);
}

async function geocodeClinic(clinic) {
  const manual = MANUAL_COORDINATES[clinic.name];
  if (manual) return { ...manual, source: manual.provider };

  const queries = buildQueries(clinic);
  const candidates = [];

  for (const query of queries) {
    candidates.push(...await geocodeNominatim(query));
    const best = chooseBestCandidate(candidates, clinic);
    if (best?.score >= MIN_SCORE) return best;
  }

  for (const query of queries) {
    candidates.push(...await geocodeOpenRouteService(query));
    await sleep(250);
    const best = chooseBestCandidate(candidates, clinic);
    if (best?.score >= MIN_SCORE) return best;
  }

  return chooseBestCandidate(candidates, clinic);
}

async function markNeedsReview(ref, result, reason) {
  if (!WRITE || !MARK_REVIEW) return;
  await ref.set(
    {
      coordinateStatus: "needs_review",
      geocoding: {
        provider: result?.provider || "none",
        confidence: result?.confidence ?? null,
        score: result?.score ?? 0,
        label: result?.label || "",
        layer: result?.layer || "",
        query: result?.query || "",
        rejectionReason: reason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function main() {
  const snap = await db.collection("clinicDirectory").get();
  let docs = snap.docs.map((doc) => ({ ref: doc.ref, id: doc.id, data: doc.data() || {} }));

  if (!FORCE) docs = docs.filter(({ data }) => !hasCoords(data));
  if (MATCH) {
    docs = docs.filter(({ id, data }) => `${id} ${data.name || ""}`.toLowerCase().includes(MATCH));
  }
  if (LIMIT > 0) docs = docs.slice(0, LIMIT);

  console.log(`[geocode-clinics] ${WRITE ? "WRITE" : "DRY RUN"} mode`);
  console.log(`[geocode-clinics] Clinics to check: ${docs.length}`);

  let matched = 0;
  let written = 0;
  let skippedLow = 0;
  let failed = 0;

  for (const { ref, id, data } of docs) {
    const name = data.name || id;
    try {
      const result = await geocodeClinic(data);
      if (!result) {
        failed++;
        console.log(`[miss] ${name} -> no Jamaica result`);
        await markNeedsReview(ref, null, "no-match");
        continue;
      }

      matched++;
      const lowConfidence = result.score < MIN_SCORE;
      const status = lowConfidence ? "needs_review" : "geocoded";
      console.log(
        `[${status}] ${name} -> ${result.lat.toFixed(6)}, ${result.lng.toFixed(6)} ` +
        `(score=${result.score.toFixed(2)}, conf=${result.confidence.toFixed(2)}, ` +
        `provider=${result.provider}, reason=${result.reason}, label="${result.label}")`
      );

      if (lowConfidence && !INCLUDE_LOW) {
        skippedLow++;
        await markNeedsReview(ref, result, "low-score");
        continue;
      }

      if (WRITE) {
        await ref.set(
          {
            lat: result.lat,
            lng: result.lng,
            latitude: result.lat,
            longitude: result.lng,
            coordinateStatus: status,
            geocoding: {
              provider: result.provider,
              confidence: result.confidence,
              score: result.score,
              label: result.label,
              layer: result.layer,
              query: result.query,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        written++;
      }
    } catch (err) {
      failed++;
      console.log(`[error] ${name} -> ${err.message}`);
      await sleep(500);
    }
  }

  console.log(
    `[geocode-clinics] matched=${matched} written=${written} skippedLow=${skippedLow} failed=${failed}`
  );
  if (!WRITE) console.log("[geocode-clinics] Re-run with --write to update Firestore.");
}

await main();
