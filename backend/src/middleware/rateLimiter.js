/**
 * src/middleware/rateLimiter.js
 *
 * Three-tier rate limiting:
 *   1. globalLimiter     - baseline for all routes
 *   2. authLimiter       - strict, for /auth routes
 *   3. consentLimiter    - strict, for /consent/request
 *   4. adminLimiter      - moderate, for /admin routes
 *
 * Uses express-rate-limit (in-memory store).
 * For multi-instance production deployments, swap the store for
 * rate-limit-redis or rate-limit-firestore.
 */

import rateLimit from "express-rate-limit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Standard JSON error response for rate limit hits.
 * Never leaks internal details.
 */
function rateLimitHandler(req, res) {
  return res.status(429).json({
    error: "Too many requests. Please wait a moment and try again.",
    retryAfter: Math.ceil(req.rateLimit?.resetTime
      ? (req.rateLimit.resetTime - Date.now()) / 1000
      : 60),
  });
}

// ─── 1. Global limiter ────────────────────────────────────────────────────────
// Applied to every route in index.js via app.use(globalLimiter)
// Generous enough not to affect normal usage.
export const globalLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              200,             // 200 requests per IP per window
  standardHeaders:  true,           // Return RateLimit-* headers
  legacyHeaders:    false,
  handler:          rateLimitHandler,
  message:          "Too many requests from this IP.",
  skip: (req) => req.method === "OPTIONS", // never block preflight requests
});

// ─── 2. Auth limiter ─────────────────────────────────────────────────────────
// Applied to: POST /auth/*
// Prevents brute force and credential stuffing.
export const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              10,              // 10 attempts per IP per window
  standardHeaders:  true,
  legacyHeaders:    false,
  handler:          rateLimitHandler,
  skipFailedRequests: false, // count everything     
});

// ─── 3. Consent request limiter ──────────────────────────────────────────────
// Applied to: POST /consent/request
// Prevents spam consent requests to arbitrary emails.
export const consentLimiter = rateLimit({
  windowMs:         60 * 60 * 1000, // 1 hour
  max:              5,               // 5 consent requests per IP per hour
  standardHeaders:  true,
  legacyHeaders:    false,
  handler:          rateLimitHandler,
});

// ─── 4. Admin limiter ────────────────────────────────────────────────────────
// Applied to all /admin routes.
// Admin actions should be deliberate - low volume expected.
export const adminLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              60,              // 60 requests per IP per window
  standardHeaders:  true,
  legacyHeaders:    false,
  handler:          rateLimitHandler,
});