# Harness Security Dashboard - Architecture

## Overview

A zero-day vulnerability response dashboard that provides complete software component inventory across all Harness organizations, projects, and services. Built to answer: "Where is Log4j deployed?" in under 1 second.

**Live Dashboard:** http://localhost:8080  
**Status:** Production-ready, June 2026

---

## System Architecture

### High-Level Flow

```
┌─────────────────┐
│  Harness APIs   │
│  - SSCA (SBOMs) │
│  - STO (Vulns)  │
│  - CD (Deploy)  │
└────────┬────────┘
         │
         │ Node.js Backend
         │ (Every 5min sync)
         ▼
┌─────────────────┐
│   SQLite DB     │
│ - 953 components│
│ - Deployments   │
│ - Vulnerabilities│
└────────┬────────┘
         │
         │ REST API
         ▼
┌─────────────────┐
│  React Frontend │
│  - Component Search│
│  - Coverage View│
│  - Exposures   │
└─────────────────┘
```

### Technology Stack

**Backend:**
- Node.js 20 (Alpine Linux)
- SQLite (better-sqlite3)
- Express.js REST API
- Port: 3001

**Frontend:**
- React 18 + TypeScript
- Vite 5 build system
- TanStack Query (data fetching)
- Tailwind CSS
- Served via Nginx on port 80

**Deployment:**
- Docker multi-stage build
- Nginx reverse proxy
- Volume-mounted SQLite database
- Health checks + auto-restart

---

## Core Data Model

### Component (Library/Package)

```javascript
{
  package: "flask",           // Package name
  version: "2.3.3",          // Version
  purl: "pkg:pypi/flask@2.3.3", // Canonical PURL from SBOM
  
  // Where it exists
  inArtifacts: [{
    artifactId: "6a338d...",
    artifactName: "demo-banking-api",
    sourceId: "69ebfa..."
  }],
  
  // Current deployments (latest per service+env)
  currentDeployments: [{
    serviceId: "banking_api",
    serviceName: "Banking API",
    envId: "prod_us",
    envName: "Production US",
    envType: "Production",
    deployedAt: 1718844953000,
    orgId: "default",
    orgName: "Default Org",
    projectId: "apac_ai_demo",
    projectName: "APAC AI Demo"
  }],
  
  // Known vulnerabilities
  vulnerabilities: [{
    cveId: "CVE-2024-1234",
    severity: "critical",
    cvssScore: 9.8,
    description: "..."
  }],
  
  // Aggregates
  uniqueServices: 2,
  uniqueEnvironments: 3,
  hasProduction: true,
  highestSeverity: "critical",
  isContainer: false  // Filters out Docker images
}
```

---

## Backend Sync Process

### 1. Data Collection (Parallel)

**Rate Limiting Strategy:**
- Batch processing: 10 projects at a time
- 200ms delay between SBOM requests (5 req/sec)
- Exponential backoff on 429 errors (1s, 2s, 4s)
- Only fetches SBOMs for deployed artifacts

**API Endpoints Used:**
```
GET  /ng/api/organizations                           → List all orgs
GET  /ng/api/projects?orgIdentifier={org}           → List projects per org
POST /gateway/ssca-manager/v1/.../artifact-sources  → List artifact sources
POST /gateway/ssca-manager/v1/.../artifacts         → List artifacts per source
POST /gateway/ssca-manager/v1/.../artifacts/{id}/components → SBOM components ✨
GET  /gateway/sto/api/v2/.../issues                 → SCA vulnerabilities
GET  /pipeline/api/pipelines/execution/v2/{id}      → Deployment data
```

### 2. SBOM-First Reconciliation

**Algorithm:**
```javascript
1. Build component map from SBOM data (ALL libraries, not just vulnerable ones)
   - Extract: package name, version, PURL
   - Map: component → artifacts containing it
   
2. Merge vulnerability data
   - Filter: SCA findings only (skip SAST/DAST)
   - Filter: Exclude OS metadata, container images
   - Match: vulnerabilities → components
   
3. Match deployments to artifacts
   - Build: image:tag → artifact ID mapping
   - Keep: Latest deployment per service+environment
   - Link: components → current deployments
   
4. Compute aggregates
   - Unique services, environments, orgs, projects
   - Production flag
   - Highest severity
   - Container detection flag
```

**Key Innovation:** Uses SBOM components as the source of truth, not vulnerabilities. This enables zero-day response (search any library, not just vulnerable ones).

### 3. Database Schema

```sql
CREATE TABLE components (
  id INTEGER PRIMARY KEY,
  package TEXT NOT NULL,
  version TEXT NOT NULL,
  highest_severity TEXT,
  vulnerability_count INTEGER,
  critical_count INTEGER,
  high_count INTEGER,
  in_production BOOLEAN,
  unique_services INTEGER,
  unique_environments INTEGER,
  unique_orgs INTEGER,
  unique_projects INTEGER,
  is_container BOOLEAN,     -- NEW: Filters Docker images
  data JSON,                -- Full component object
  updated_at DATETIME,
  UNIQUE(package, version)
);

CREATE INDEX idx_package ON components(package);
CREATE INDEX idx_severity ON components(highest_severity);
CREATE INDEX idx_production ON components(in_production);
CREATE INDEX idx_container ON components(is_container);
```

**Sync Performance:**
- Duration: ~6 minutes
- Coverage: 8 orgs, 273 projects, 97 artifacts with SBOMs
- Results: 953 unique components, 374 in production

---

## Frontend Architecture

### Pages

**1. Component Search (`/`)**
- Search across all libraries
- Filters: Deployed, Vulnerable, Environment, Container Images
- Deep links to Harness SSCA component details
- Pagination: 50 per page

**2. Coverage (`/coverage`)**
- Service instrumentation status
- Org/Project breakdown with names
- Blind spots detection
- Core principle: "Never show safe when data is missing"

**3. Exposures (`/exposures`)**
- Critical/High vulnerabilities only
- Deployed components focus
- CVE details

### Key Features

**PURL Deep Linking:**
- Uses canonical PURL from SBOM (not generated)
- Double-encodes special characters for Harness UI:
  - `+` → `%252B` (e.g., `bash@5.2.37-2+b9`)
  - `@` in npm scopes → `%2540` (e.g., `@colors/colors`)
- URL format: `/ng/account/{id}/module/ssca/orgs/{org}/projects/{proj}/artifact-sources/{src}/artifacts/{art}/details/dependencies?purl={encodedPurl}`

**Container Filtering:**
- Checkbox: "Hide Container Images" (default: checked)
- Detection: Registry URLs (docker.pkg.dev, gcr.io) or sha256 versions
- Keeps component list focused on actual libraries

---

## Deployment

### Docker Setup

**Build:**
```bash
docker-compose build --no-cache
docker-compose up -d
```

**Multi-stage Dockerfile:**
1. Frontend build stage (Vite)
2. Backend build stage (npm + node-gyp for SQLite)
3. Final stage: Nginx + Node.js backend

**Nginx Config:**
- Port 80: Serves React SPA
- `/api/*`: Proxies to backend (localhost:3001)
- Health checks: `GET /api/health`

**Volumes:**
```yaml
volumes:
  - ./data:/app/data  # SQLite database persists
```

### Environment Variables

**Required:**
```bash
HARNESS_ACCOUNT_ID=...
HARNESS_API_KEY=pat....
HARNESS_BASE_URL=https://app.harness.io

ENABLE_AUTO_SYNC=true      # Auto-sync every 5 minutes
SYNC_ON_STARTUP=true       # Sync immediately on start
DB_PATH=/app/data/components.db
```

**Security:**
- Secrets in `.env` files (gitignored)
- Not committed to version control
- Loaded into Docker at runtime only

---

## API Reference

### Backend REST API

**GET `/api/health`**
```json
{
  "status": "ok",
  "database": "connected",
  "lastSync": "2026-06-19 04:17:25",
  "syncStatus": "success",
  "accountId": "EeRjnXTnS4GrLG5VNNJZUw"
}
```

**GET `/api/stats`**
```json
{
  "total_components": 953,
  "vulnerable_components": 41,
  "in_production": 374,
  "total_services": 4,
  "total_orgs": 3,
  "total_projects": 4
}
```

**GET `/api/components?search=flask&deployed_only=true&hide_containers=true&page=1&page_size=50`**
```json
{
  "components": [...],
  "pagination": {
    "page": 1,
    "page_size": 50,
    "total": 953,
    "total_pages": 20
  }
}
```

**POST `/api/sync`**
Triggers immediate sync (idempotent, safe to call while running).

**GET `/api/coverage`**
Service instrumentation coverage data.

---

## Key Design Decisions

### 1. SBOM-First, Not Vulnerability-First
**Why:** Zero-day response requires searching ALL libraries, not just those with known CVEs.

**How:** SBOM components API provides complete package list per artifact. Vulnerabilities are merged in as additional metadata.

### 2. SQLite, Not PostgreSQL
**Why:** 
- Simple deployment (no separate database server)
- Fast (<1ms queries for component search)
- Perfect for read-heavy workloads with periodic writes
- Easy backups (single file)

**Trade-offs:** 
- Single-writer (fine, only one sync process)
- Not web-scale (but 1000s of components is small)

### 3. Docker, Not Kubernetes
**Why:**
- Single container, no orchestration needed
- Easy deployment with docker-compose
- Volume-mounted database for persistence
- Nginx + backend in one container (simpler than sidecar)

### 4. Canonical PURLs from SBOM
**Why:** Package type detection by name patterns is error-prone.

**Example:** `itsdangerous` was misdetected as Debian package instead of PyPI.

**Solution:** Use the PURL field from Harness SBOM API directly.

### 5. Container Image Filtering
**Why:** Container images (Docker/OCI artifacts) appeared in component lists alongside libraries.

**Example:** `europe-west2-docker.pkg.dev/.../angular@sha256:...` is an artifact, not a library.

**Solution:** 
- Detect by registry URL or sha256 digest
- Store in `is_container` boolean field
- Filter with "Hide Container Images" checkbox (default: checked)

---

## Performance Characteristics

**Sync:**
- Full account scan: ~6 minutes
- API calls: ~500 (batched, rate-limited)
- Database writes: <1 second (SQLite transaction)

**Search:**
- Query time: <10ms (indexed search)
- Page load: <500ms (client-side)

**Scalability:**
- Current: 953 components across 8 orgs
- Capacity: 10K+ components (SQLite scales well for reads)
- Bottleneck: Harness API rate limits (5 SBOM req/sec)

---

## Troubleshooting

### Sync Failures

**429 Too Many Requests:**
- Backend already has rate limiting (200ms delays)
- If still failing: Increase delay or reduce batch size

**404 Not Found (SBOM Components):**
- Artifact doesn't have SBOM data in Harness
- Normal - not all artifacts are scanned
- Logged but doesn't fail sync

**401 Unauthorized:**
- Check `HARNESS_API_KEY` in `.env`
- Verify API key has SSCA permissions

### Empty Component List

**Causes:**
1. Sync still running (check `/api/health`)
2. All components filtered out (uncheck "Hide Container Images")
3. Database file corrupted (delete and re-sync)

**Fix:**
```bash
docker exec harness-security-dash rm /app/data/components.db
curl -X POST http://localhost:8080/api/sync
```

### Database Corruption

**Symptom:** `SqliteError: database disk image is malformed`

**Fix:**
```bash
docker-compose down
rm /Users/gregkroon/harness-security-dash/data/components.db
docker-compose up -d
curl -X POST http://localhost:8080/api/sync
```

---

## Future Enhancements

**Potential Additions:**
- Historical tracking (component versions over time)
- Alert webhooks (Slack/email on new critical CVEs)
- Dependency graphs (visualize component relationships)
- SLA tracking (time to patch critical CVEs)
- Multi-account support (multiple Harness accounts)

**Not Needed:**
- Real-time updates (5-minute refresh is sufficient)
- Complex query language (simple search works)
- User authentication (internal tool)

---

## Success Metrics

**Core Requirement:** Answer "Where is {library} deployed?" in <1 second ✅

**Current Performance:**
- Search latency: <500ms
- Coverage: 8 orgs, 273 projects, 953 components
- SBOM success rate: 50-100% per project
- Zero-day readiness: Can search any library, not just vulnerable ones

**Use Cases Enabled:**
1. **Zero-day response:** Search any library instantly
2. **Vulnerability triage:** See which CVEs affect production
3. **Blind spot detection:** Identify services without SBOM visibility
4. **Compliance:** Component inventory for audits
5. **Supply chain security:** Track library provenance via PURLs
