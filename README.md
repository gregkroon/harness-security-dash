# Harness Security Dashboard

Zero-day vulnerability response dashboard for Harness. Answer "Where is {library} deployed?" in under 1 second.

## Quick Start

```bash
# 1. Configure credentials
cp .env.example .env
# Edit .env with your Harness API key

# 2. Start the dashboard
docker-compose up -d

# 3. Access
open http://localhost:8080

# 4. Trigger sync
curl -X POST http://localhost:8080/api/sync
```

## What It Does

- **Component Search:** Find any library across all orgs/projects instantly
- **Coverage View:** See which services have SBOM visibility  
- **Exposures:** Track critical/high vulnerabilities in production

**Current State:** Tracking 953 components across 8 orgs and 273 projects.

## Documentation

📖 **See [ARCHITECTURE.md](./ARCHITECTURE.md)** for complete technical documentation including:
- System architecture and data flow
- SBOM-first reconciliation algorithm
- API reference
- Deployment guide
- Troubleshooting

## Key Features

✅ **SBOM-First:** Tracks ALL libraries (not just vulnerable ones)  
✅ **Production-Ready:** Sub-second search, auto-sync every 5 minutes  
✅ **Complete Coverage:** 8 orgs, 273 projects, 953 components  
✅ **Deep Links:** Direct links to Harness SSCA component details  
✅ **Container Filtering:** Hide Docker images, show only libraries  

## Requirements

- Docker & Docker Compose
- Harness account with SSCA enabled
- API key with permissions:
  - SSCA (read artifacts, SBOMs)
  - STO (read security findings)
  - CD (read pipeline executions)

## Environment Variables

```bash
HARNESS_ACCOUNT_ID=...
HARNESS_API_KEY=pat....
HARNESS_BASE_URL=https://app.harness.io
ENABLE_AUTO_SYNC=true
SYNC_ON_STARTUP=true
```

## Status

✅ **Production-ready** as of June 19, 2026

- Search latency: <500ms
- Sync duration: ~6 minutes
- SBOM success rate: 50-100% per project
- Zero-day ready: Can search any library

## Support

For issues or questions, see the Troubleshooting section in [ARCHITECTURE.md](./ARCHITECTURE.md).
