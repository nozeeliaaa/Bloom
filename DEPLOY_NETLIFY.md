# Bloom Deployment (Netlify Free Plan)

This setup deploys:

1. Frontend static pages via Vite (`dist`)
2. Backend API as a Netlify Function (`netlify/functions/api.mjs`)

## How routing works

- Frontend calls `/api/*` and `/catalog/*`
- `netlify.toml` rewrites those paths to `/.netlify/functions/api/*`
- The Express app from `backend/src/app.js` handles the request

## One-time setup in Netlify

1. Connect this repo to Netlify (Git deploy, not drag/drop).
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Node version: `20` (already set in `netlify.toml`)

## Required environment variables (Netlify UI)

Set these in **Site configuration -> Environment variables**:

- `FIREBASE_SERVICE_ACCOUNT` (full JSON on one line)

Optional but recommended:

- `ALLOWED_ORIGINS` (comma-separated, e.g. `https://your-site.netlify.app`)
- `HELPDESK_EMAIL`
- `HELPDESK_EMAIL_PASS`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `ORS_API_KEY`
- `FIREBASE_STORAGE_BUCKET` (if different from default)

## Verify after deploy

1. Open: `https://<your-site>.netlify.app/health`
2. Confirm it returns JSON like `{ "ok": true, ... }`
3. Login and verify data sync from backend
4. Check Functions logs in Netlify if any API request fails

## Notes

- `window.BLOOM_API_BASE` can stay empty on Netlify because API is same-origin.
- This avoids Firebase Cloud Functions billing requirements for the backend.
