# BIOSPHERECONSULT — Vercel deployment candidate

This is a separate copy of your working application. It has NOT been deployed or tested with live Vercel credentials. Keep your original project.

## Architecture

Vercel serves the built Vite dashboard and routes /api/* to api/index.py (FastAPI). The frontend uses the current website origin in production. Google Earth Engine still supplies calculations and tile URLs. Supabase is not required.

## Project settings

Import this folder into a new Vercel project (do not replace another working Vercel site).
Framework: Vite. Build command: npm run build. Output: dist. Python: 3.12. Enable Fluid Compute. The Python function has a 300-second maximum. Existing client timeouts still apply.

## Required environment variables

VITE_MAPBOX_TOKEN: your public pk. token. This is intentionally visible in browser code; restrict allowed URLs to your deployed domains and local development as needed.
EE_PROJECT_ID: coral-core-430522-f4
EE_SERVICE_ACCOUNT_JSON: the complete Google service-account JSON credential, stored ONLY in Vercel's private server environment settings. Never name it with VITE_, add it to source, upload it to GitHub, or paste it into chat. Initially configure Production only; preview APIs will not work until separately authorized.

Leave VITE_EE_API_URL unset so the browser calls the same website.

## Google access needed before live APIs work

Use a dedicated service account in the existing Earth Engine registered Google project. It needs Earth Engine Resource Viewer and Service Usage Consumer on that project, and the Earth Engine API must be enabled. Creating its JSON key is a security decision: anyone possessing that key may use its granted permissions. Enter it directly into Vercel; do not share it here. Use OIDC Workload Identity Federation instead if avoiding long-lived keys is required (not implemented in this candidate).

The hosting change avoids Cloud Run resources. It does not remove Google project registration, Earth Engine authorization, quotas or eligibility requirements. Noncommercial Earth Engine access and Vercel Hobby eligibility must match actual usage. Business/client use requires reviewing the relevant plans.

## Verification after deployment

Check /api/health, then each indicator, Heat LGA selection, monthly trends and report exports. Confirm frontend requests go to your Vercel domain, not localhost. First calculations may be slow. Function memory caches are temporary and not shared across instances. The project has no user login or per-user rate limiter; treat this as a small public research demo, not a high-traffic client service.

No Google billing setup, cloud permissions, credentials or deployments have been changed by preparing this package.
