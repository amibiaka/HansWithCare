# Dehna (ደህና), by Han's With Care · health access platform, build v0.2

Dehna ("well / safe" in Amharic) is the health access platform of Han's With Care Manufacturing, Ethiopia: a
low-bandwidth, six-language, installable and offline-capable progressive web application built to the
*Han's With Care health access platform* Terms of Reference (v0.9, 1 September 2026). The platform, its code,
data and brand are the property of Han's With Care. It implements the
patient, practitioner, pharmacy, wellbeing and administration journeys end to end on a single, pluggable data
layer, so the platform can be demonstrated today and connected to an Ethiopia-hosted backend without
rewriting the interface.

Stack: plain HTML, CSS and JavaScript, no build step, no framework; Supabase (Postgres, Auth, Storage) as the pilot backend. Deploys as static files on Netlify,
GitHub Pages or any web server. Critical shell is about 370 KB uncompressed (roughly 100 KB gzipped),
under the ToR target of 500 KB compressed.

## Run it

Local: `npx serve .` (or any static server) and open `http://localhost:3000`. A plain `file://` open also
works for browsing (the service worker only registers over http/https).

Netlify: push this folder to a GitHub repository, create a Netlify site from it, publish directory `.`.
`netlify.toml` already sets the security headers and the content-security policy. No environment
variables are needed for the demonstration build.

Tests: `npm i playwright && node tools/smoke.js` walks every route in all six languages and exercises the
request, prescription, order, referral, four-eyes verification, offline-queue and audit-chain flows.

## Cloud mode (Supabase) and demo mode

`config.js` holds the Supabase project URL and the public (publishable) key. With both set, the app runs in cloud
mode: the on-device store becomes the offline cache, writes go through an outbox to Supabase, and a pull-sync
refreshes every 20 s. With `supabaseUrl` empty, the app runs fully on-device (demo mode) with the accounts below.

Backend files in `supabase/`: `schema.sql` (tables, triggers, row-level security, server-side audit chain,
private attachments bucket), `seed.sql` (generated from `js/seed.js` by `node tools/gen-seed-sql.js`) and
`profiles.sql` (maps Auth users to roles). Patients are identified by a device token header, professionals and
staff by Supabase Auth (email + password, sign-ups disabled, accounts created by an administrator).

Cloud demo accounts (project `dehna`, organisation `hans-with-care`): `dr.selam@dehna.demo`, `dr.yonas@dehna.demo`,
`sr.hiwot@dehna.demo`, `dr.abdi@dehna.demo`, `dr.chaltu@dehna.demo`, `ph.bole@dehna.demo`, `ph.hawassa@dehna.demo`,
`wb.mimi@dehna.demo`, `admin1@dehna.demo`, `admin2@dehna.demo`, `safety@dehna.demo`, `privacy@dehna.demo`.
Passwords are held by Han's With Care and must be rotated before any real use.

## Demo-mode accounts (Menu → Professional and partner sign-in, only when `supabaseUrl` is empty)

| Role | Account | Auth |
|---|---|---|
| Doctor (Addis, GP) | Dr. Selamawit Bekele | none (demo) |
| Doctor (Jigjiga, Somali) | Dr. Abdirahman Mohamed | none |
| Doctor (Adama, Afaan Oromo) | Dr. Chaltu Gemechu | none |
| Midwife (home visits) | Sr. Hiwot Alemu | none |
| Pharmacist (Bole) | Ph. Bethlehem Worku | none |
| Wellbeing provider | Mimi Home Massage | none |
| Operations admin 1 / 2 | PIN 2468 / 1357 | four-eyes approvals need both |
| Verifier / Clinical safety / Privacy (DPO) / Finance | PIN 1111 / 2222 / 3333 / 4444 | role-limited tabs |

Patients never sign in. Phone OTP is simulated (any 4 digits).

All practitioners, pharmacies and wellbeing providers are fictional. Public hospitals are real names with
approximate coordinates and no phone numbers (numbers are shown only after owner verification).

## What is implemented against Annex A

| ID | Requirement | Where |
|---|---|---|
| PAT-01 | Anonymous emergency and directory access | Home, `#/emergency`, `#/find`, no account anywhere on the public side |
| PAT-02 | Six-language choice, persists locally | `js/i18n.js` (398 keys × 6 languages), language button on every screen |
| PAT-03 | Search by GPS, hierarchy, kebele, landmark and filters | `#/find`: GPS, cascading area picker, free-text incl. aliases, specialty, language, gender, mode, availability, list/map |
| PAT-04 | Minimal phone/consent/location only when submitting | Request, prescription, order and booking wizards; consent record per purpose and language |
| PAT-05 | Text, structured, voice, photo, document options | Request wizard: structured need/urgency, text, MediaRecorder voice note (Opus), image downscale + metadata strip, PDF |
| PAT-06 | Status, notifications, cancellation, complaint | `#/cases`, timeline per case/order, in-app notifications, cancel, complaint linked to case |
| EMR-01 | Persistent one-tap emergency action | Fixed red button on every public screen, home tile, PWA shortcut |
| EMR-02 | Verified locality-specific directory with tap-to-call and freshness | Jurisdiction-scoped records, `tel:` links, status (verified / source-checked / pending), review-due flags |
| EMR-03 | Red-flag escalation before AI or matching | `SEED.redFlags` evaluated on every guide message and on intake text, in all six languages |
| EMR-04 | Location share, manual kebele, nearest capable facility | GPS or area picker, copy/share/SMS location summary, nearest emergency-capable verified facilities |
| PRO-01 | Identity, licence, scope, facility, expiry verification | Practitioner records, verification state machine, expiry warnings, suspension |
| PRO-02 | Availability and service-mode management | Practitioner dashboard availability toggles |
| PRO-03 | Accept, decline, clarify, schedule, respond, refer, close | `#/pro/case/:id` with scope-of-practice gate and patient-consented referral handoff |
| PRO-04 | Attachments, notes, voice replies, audit | Attachment viewer, message thread, voice reply, every read/message audited |
| PHA-01 | Facility and responsible pharmacist verification | Facility records with licence, responsible pharmacist, four-eyes verification |
| PHA-02 | Standardised product list with timestamped stock | Generic/brand/strength/form/pack/Rx status, six stock states, staleness flag after 72 h |
| PHA-03 | Secure prescription request and response | `#/rx` upload → routing to chosen or nearest verified pharmacies → full/partial/unavailable/clarify/refer |
| PHA-04 | Collection/delivery choice and order status | Fulfilment choice, order created when patient picks a pharmacy, order state machine |
| PHA-05 | Prescription-only and substitution controls | Rx badge, pharmacist-only validity decision, no substitution or advice text anywhere |
| HWC-01 | Han's catalogue, education, variants, orders, fulfilment | `#/products`, education text with listen button, variants, basket, guest checkout, admin order handling |
| WEL-01 / 02 | Vetted wellbeing listings, booking, non-clinical labels | `#/find?type=wellbeing`, booking with safeguards, address released only after confirmation |
| ADM-01 | Role-based admin, four-eyes verification, audit | Six admin roles with tab visibility, two-approver rule, tamper-evident hash-chained audit log |
| ADM-02 | No-code content, geography, emergency, fee and flag management | Admin tabs: geography editor, emergency directory, knowledge base, translations status, fees, feature flags |
| ADM-03 | Bulk import/export, validation, rollback, data-quality dashboard | CSV import with validation counts, CSV/GeoJSON/JSON export, unit change history, overview KPIs |
| MSG-01 / 02 / 03 | WhatsApp / Telegram companions, sensitive payload blocking | Channel detection (`APP.channel`), Telegram WebApp init, generic notification text only; gateway design in the architecture note below |
| OFF-01 | Installable PWA and offline shell | `manifest.webmanifest`, `sw.js` app-shell cache, install prompt |
| OFF-02 | Offline emergency/directory region packs, click-to-call | `data/packs/*.json` per region cached on request, Menu → Offline region packs |
| OFF-03 | Explicit unsent state and duplicate-safe sync | `queued_offline` state, NOT SENT banner, Send now, auto-sync on reconnect, idempotency key per draft |
| AI-01 | Guide with disclosure and human handoff | `#/guide`: disclosure, quick actions, "Talk to a person", summary handoff into a request |
| AI-02 | No autonomous diagnosis, prescription or dispatch | Rules-based guide only routes, retrieves approved knowledge and summarises; practitioner drafts must be reviewed |
| AI-03 | Curated knowledge, versioning, logs, kill switch | Versioned knowledge base with source and approval, guide log (counts only), `guide` feature flag |
| GEO-01 / 02 | National flexible hierarchy, official sources, scripts, geometry, version | `js/seed.js` gazetteer (14 top-level units, Annex B hubs, sample sub-cities/woredas/kebeles) with source, version, confidence and verification fields |
| SEC-01..03 | Residency, encryption, MFA, DPIA, SDLC, pen test | Not demonstrable in a static build; see "Production hardening" |
| ACC-01 | WCAG 2.2 AA | 48 px targets, contrast, labels, focus styles, skip link, one question per screen, listen buttons, no colour-only meaning |
| PER-01 | Critical path transfer and latency | No framework, list-first, map and Leaflet loaded only on demand |
| PAY-01, MOB-01, INT-01, INT-02 | Later / should | Telebirr flag off; API-first data layer ready for native wrappers; FHIR and MOH/MFR integration in the architecture note |

## Architecture

```
index.html            shell (topbar, main, SOS button, bottom nav)
css/app.css           design system (Han's pink #E36D9F, near-black #1A1819, emergency red)
js/i18n.js            translation keys, six languages, versioned
js/seed.js            seed data: gazetteer, emergency, facilities, practitioners, products, wellbeing, KB, red flags, users, flags
js/store.js           data layer (DB): collections, audit chain, sessions, consent, IndexedDB attachments, CSV tools
js/geo.js             hierarchy, distance, GPS, location summary, region packs
js/ui.js              rendering helpers, area picker, badges, recorder, file validation, TTS listen
js/guide.js           red-flag layer, intent routing, knowledge retrieval, practitioner draft
js/patient.js         public journeys and the case/order state machine (CASES)
js/pro.js             practitioner, pharmacy and wellbeing dashboards
js/admin.js           administration
js/app.js             router, network state, install prompt, channel detection, service worker
sw.js                 app-shell cache + region pack cache
data/packs/*.json     offline region packs (generated from seed)
tools/smoke.js        headless end-to-end test
```

Connecting a backend: `DB` in `js/store.js` is the only place that touches storage. Implement the same
adapter interface (`load`/`save` per collection and `files.put/get/del`) against the Ethiopia-hosted REST
API and swap it in `DB.init()`. Every write already carries `updatedAt`, an idempotency key on cases and
orders, and an audit entry, so the server contract is straightforward: one resource per collection,
OpenAPI-documented, with FHIR R4 mappings for Patient, Practitioner, Organization, Location,
ServiceRequest, Appointment, MedicationRequest and referral where exchange with MOH systems is approved.

Channel gateway (MSG-01..03): the PWA is the system of record. WhatsApp (official Business Platform) and
Telegram (bot + Mini App) send only generic templates ("A verified provider has responded to your secure
request") with a deep link that requires the device token or OTP to open the case. `APP.channel()`
detects whether the app was opened inside Telegram's WebApp or WhatsApp's in-app browser and records the
channel on each case for analytics. No clinical content, prescription image, medicine name or exact
location is ever placed in a notification.

## Production hardening (not covered by a static demonstration)

Ethiopia-hosted database, object storage, keys and backups; MFA and device binding for professional and
administrative accounts; server-side OTP; malware scanning of uploads; encrypted queued drafts on device;
DPIA, controller registration and retention schedule (Proclamation 1321/2024); OWASP ASVS L2, SBOM,
independent penetration test; official WhatsApp templates and Telegram bot; MOH HRL and Master Facility
Registry checks with manual fallback; EFDA product identifiers; Telebirr in the approved payment phase;
pre-recorded audio prompts replacing browser TTS; professional translation review of every string in
`js/i18n.js` and every knowledge item (the current Amharic, Tigrinya, Afaan Oromo, Somali and French
strings are drafts).

## Data provenance

Emergency numbers 911, 991, 907 and 939 come from public sources cited in Annex F (S7, S8) and are marked
"source-checked, owner confirmation pending". Regional hospital emergency lines are left blank until the
owning facility confirms them. Administrative names and centroids are approximate and must be replaced by
the authority-validated gazetteer (deliverable D3) through the admin CSV import. Product prices are
indicative placeholders.
