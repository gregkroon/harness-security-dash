/**
 * Harness Security Dashboard - Backend API Server
 *
 * Fetches data from Harness APIs, reconciles components, and caches in SQLite.
 * Provides fast API endpoints for the frontend.
 */

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize SQLite database
const db = new Database(process.env.DB_PATH || './data/components.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package TEXT NOT NULL,
    version TEXT NOT NULL,
    highest_severity TEXT,
    vulnerability_count INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    high_count INTEGER DEFAULT 0,
    in_production BOOLEAN DEFAULT 0,
    unique_services INTEGER DEFAULT 0,
    unique_environments INTEGER DEFAULT 0,
    unique_orgs INTEGER DEFAULT 0,
    unique_projects INTEGER DEFAULT 0,
    is_container BOOLEAN DEFAULT 0,
    data JSON NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(package, version)
  );

  CREATE INDEX IF NOT EXISTS idx_package ON components(package);
  CREATE INDEX IF NOT EXISTS idx_severity ON components(highest_severity);
  CREATE INDEX IF NOT EXISTS idx_production ON components(in_production);
  CREATE INDEX IF NOT EXISTS idx_container ON components(is_container);
  CREATE INDEX IF NOT EXISTS idx_updated ON components(updated_at);

  CREATE TABLE IF NOT EXISTS sync_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_sync_at DATETIME,
    last_sync_duration_ms INTEGER,
    status TEXT,
    error TEXT,
    total_components INTEGER,
    total_orgs INTEGER,
    total_projects INTEGER
  );

  INSERT OR IGNORE INTO sync_status (id, status) VALUES (1, 'pending');
`);

console.log('✓ Database initialized');

// Import Harness client logic (we'll create this next)
const HarnessSync = require('./harness-sync');
const harnessSync = new HarnessSync({
  baseUrl: process.env.HARNESS_BASE_URL || 'https://app.harness.io',
  accountId: process.env.HARNESS_ACCOUNT_ID,
  apiKey: process.env.HARNESS_API_KEY,
});

// === API Endpoints ===

// Health check
app.get('/api/health', (req, res) => {
  const status = db.prepare('SELECT * FROM sync_status WHERE id = 1').get();
  res.json({
    status: 'ok',
    database: 'connected',
    lastSync: status?.last_sync_at || null,
    syncStatus: status?.status || 'unknown',
    accountId: process.env.HARNESS_ACCOUNT_ID || 'not-configured',
  });
});

// Get sync status
app.get('/api/sync-status', (req, res) => {
  const status = db.prepare('SELECT * FROM sync_status WHERE id = 1').get();
  res.json(status || { status: 'unknown' });
});

// Search components
app.get('/api/components', (req, res) => {
  try {
    const {
      search,
      deployed_only = 'true',
      sca_only = 'true',
      vulnerable_only = 'false',
      env_filter = 'all',
      hide_containers = 'true',
      page = '1',
      page_size = '50',
    } = req.query;

    let query = 'SELECT * FROM components WHERE 1=1';
    const params = [];

    // Search filter
    if (search) {
      query += ' AND package LIKE ?';
      params.push(`%${search}%`);
    }

    // Deployed only
    if (deployed_only === 'true') {
      query += ' AND unique_services > 0';
    }

    // Vulnerable only
    if (vulnerable_only === 'true') {
      query += ' AND vulnerability_count > 0';
    }

    // Environment filter
    if (env_filter === 'prod') {
      query += ' AND in_production = 1';
    } else if (env_filter === 'non-prod') {
      query += ' AND in_production = 0';
    }

    // Container filter (default: hide container images)
    if (hide_containers === 'true') {
      query += ' AND is_container = 0';
    }

    // Get total count
    const countQuery = query.replace('SELECT * FROM components', 'SELECT COUNT(*) as total FROM components');
    const { total } = db.prepare(countQuery).get(...params);

    // Pagination
    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(page_size, 10);
    const offset = (pageNum - 1) * pageSizeNum;

    query += ' ORDER BY package LIMIT ? OFFSET ?';
    params.push(pageSizeNum, offset);

    const rows = db.prepare(query).all(...params);

    // Parse JSON data field
    const components = rows.map(row => ({
      ...JSON.parse(row.data),
      _meta: {
        id: row.id,
        updated_at: row.updated_at,
      },
    }));

    res.json({
      components,
      pagination: {
        page: pageNum,
        page_size: pageSizeNum,
        total,
        total_pages: Math.ceil(total / pageSizeNum),
      },
    });
  } catch (error) {
    console.error('Error fetching components:', error);
    res.status(500).json({ error: 'Failed to fetch components' });
  }
});

// Get component stats
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_components,
        SUM(CASE WHEN vulnerability_count > 0 THEN 1 ELSE 0 END) as vulnerable_components,
        SUM(CASE WHEN in_production = 1 THEN 1 ELSE 0 END) as in_production,
        COUNT(DISTINCT CASE WHEN unique_services > 0 THEN package || version END) as components_with_services
      FROM components
    `).get();

    // Calculate unique orgs, projects, services from component data
    const components = db.prepare('SELECT data FROM components').all();
    const allOrgs = new Set();
    const allProjects = new Set();
    const allServices = new Set();

    for (const row of components) {
      const comp = JSON.parse(row.data);
      for (const dep of comp.currentDeployments || []) {
        if (dep.orgId) allOrgs.add(dep.orgId);
        if (dep.projectId) allProjects.add(dep.projectId);
        if (dep.serviceId) allServices.add(dep.serviceId);
      }
    }

    res.json({
      total_components: stats.total_components,
      vulnerable_components: stats.vulnerable_components,
      in_production: stats.in_production,
      total_services: allServices.size,
      total_orgs: allOrgs.size,
      total_projects: allProjects.size,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get exposures (vulnerable components with detailed filtering)
app.get('/api/exposures', (req, res) => {
  try {
    const {
      search,
      severity,
      env_filter = 'all',
      sort_by = 'severity',
      page = '1',
      page_size = '50',
    } = req.query;

    // Parse severity filter (comma-separated)
    const severityFilter = severity ? severity.split(',') : [];

    // Get components
    let components = db.prepare('SELECT data FROM components WHERE vulnerability_count > 0').all()
      .map(row => JSON.parse(row.data));

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      components = components.filter(c =>
        c.package.toLowerCase().includes(searchLower) ||
        c.vulnerabilities.some(v => v.cveId.toLowerCase().includes(searchLower))
      );
    }

    // Severity filter
    if (severityFilter.length > 0) {
      components = components.filter(c =>
        severityFilter.includes(c.highestSeverity)
      );
    }

    // Environment filter
    if (env_filter === 'prod') {
      components = components.filter(c => c.hasProduction);
    } else if (env_filter === 'non-prod') {
      components = components.filter(c => !c.hasProduction && c.currentDeployments.length > 0);
    }

    // Sort
    if (sort_by === 'severity') {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0, unknown: -1 };
      components.sort((a, b) => {
        const aVal = severityOrder[a.highestSeverity] || -1;
        const bVal = severityOrder[b.highestSeverity] || -1;
        return bVal - aVal;
      });
    } else if (sort_by === 'deployments') {
      components.sort((a, b) => b.totalCurrentDeployments - a.totalCurrentDeployments);
    } else if (sort_by === 'services') {
      components.sort((a, b) => b.uniqueServices - a.uniqueServices);
    }

    // Pagination
    const total = components.length;
    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(page_size, 10);
    const offset = (pageNum - 1) * pageSizeNum;
    const paginatedComponents = components.slice(offset, offset + pageSizeNum);

    res.json({
      components: paginatedComponents,
      pagination: {
        page: pageNum,
        page_size: pageSizeNum,
        total,
        total_pages: Math.ceil(total / pageSizeNum),
      },
    });
  } catch (error) {
    console.error('Error fetching exposures:', error);
    res.status(500).json({ error: 'Failed to fetch exposures' });
  }
});

// Get coverage metrics
app.get('/api/coverage', (req, res) => {
  try {
    const { org_id, project_id } = req.query;

    // Get all components
    const components = db.prepare('SELECT data FROM components').all()
      .map(row => JSON.parse(row.data));

    // Filter by org/project if specified
    let filteredComponents = components;
    if (org_id || project_id) {
      filteredComponents = components.filter(comp => {
        return comp.currentDeployments.some(dep => {
          const matchOrg = !org_id || dep.orgId === org_id;
          const matchProject = !project_id || dep.projectId === project_id;
          return matchOrg && matchProject;
        });
      });
    }

    // Build service map
    const serviceMap = new Map();
    for (const comp of filteredComponents) {
      for (const dep of comp.currentDeployments) {
        if (!serviceMap.has(dep.serviceId)) {
          serviceMap.set(dep.serviceId, {
            serviceId: dep.serviceId,
            serviceName: dep.serviceName,
            deploymentCount: 0,
            environments: new Set(),
            hasProduction: false,
          });
        }
        const svc = serviceMap.get(dep.serviceId);
        svc.deploymentCount++;
        svc.environments.add(dep.envId);
        if (dep.envType === 'Production') svc.hasProduction = true;
      }
    }

    const instrumentedServices = Array.from(serviceMap.values()).map(s => ({
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      deploymentCount: s.deploymentCount,
      environmentCount: s.environments.size,
      hasProduction: s.hasProduction,
    }));

    res.json({
      totalServices: instrumentedServices.length,
      servicesWithSbom: instrumentedServices.length,
      servicesWithDeployments: instrumentedServices.length,
      uninstrumentedServices: [],
      instrumentedServices,
      coveragePercentage: 100,
    });
  } catch (error) {
    console.error('Error fetching coverage:', error);
    res.status(500).json({ error: 'Failed to fetch coverage data' });
  }
});

// Get dashboard overview data
app.get('/api/dashboard', (req, res) => {
  try {
    const { org_id, project_id } = req.query;

    // Get all components
    const components = db.prepare('SELECT data FROM components').all()
      .map(row => JSON.parse(row.data));

    // Filter by org/project if specified
    let filteredComponents = components;
    if (org_id || project_id) {
      filteredComponents = components.filter(comp => {
        return comp.currentDeployments.some(dep => {
          const matchOrg = !org_id || dep.orgId === org_id;
          const matchProject = !project_id || dep.projectId === project_id;
          return matchOrg && matchProject;
        });
      });
    }

    // Calculate critical/high in production
    const criticalInProduction = filteredComponents.filter(c =>
      c.hasProduction &&
      c.vulnerabilities.some(v => v.severity === 'critical')
    ).length;

    const highInProduction = filteredComponents.filter(c =>
      c.hasProduction &&
      c.vulnerabilities.some(v => v.severity === 'high') &&
      !c.vulnerabilities.some(v => v.severity === 'critical')
    ).length;

    // Get all services (would need to query Harness services endpoint)
    // For now, derive from deployments
    const serviceMap = new Map();
    for (const comp of filteredComponents) {
      for (const dep of comp.currentDeployments) {
        if (!serviceMap.has(dep.serviceId)) {
          serviceMap.set(dep.serviceId, {
            serviceId: dep.serviceId,
            serviceName: dep.serviceName,
            hasDeployments: true,
            deploymentCount: 0,
            environments: new Set(),
            hasProduction: false,
          });
        }
        const svc = serviceMap.get(dep.serviceId);
        svc.deploymentCount++;
        svc.environments.add(dep.envId);
        if (dep.envType === 'Production') svc.hasProduction = true;
      }
    }

    const instrumentedServices = Array.from(serviceMap.values()).map(s => ({
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      deploymentCount: s.deploymentCount,
      environmentCount: s.environments.size,
      hasProduction: s.hasProduction,
    }));

    const coverage = {
      totalServices: instrumentedServices.length,
      servicesWithSbom: instrumentedServices.length, // All have artifact data
      servicesWithDeployments: instrumentedServices.length,
      uninstrumentedServices: [],
      instrumentedServices,
      coveragePercentage: 100, // We only see deployed services
    };

    // Generate top actions
    const topActions = [];

    // Critical vulnerabilities in production
    const criticalServices = new Set();
    for (const comp of filteredComponents) {
      if (comp.hasProduction && comp.vulnerabilities.some(v => v.severity === 'critical')) {
        for (const dep of comp.currentDeployments.filter(d => d.envType === 'Production')) {
          if (!criticalServices.has(dep.serviceId)) {
            criticalServices.add(dep.serviceId);
            topActions.push({
              priority: 1,
              type: 'critical_low_coverage',
              title: `Critical vulnerability in ${dep.serviceName}`,
              description: `${comp.package}@${comp.version} has critical vulnerabilities in production`,
              serviceId: dep.serviceId,
              serviceName: dep.serviceName,
              cveId: comp.vulnerabilities.find(v => v.severity === 'critical')?.cveId,
            });
          }
        }
      }
    }

    res.json({
      criticalInProduction,
      highInProduction,
      coverage,
      topActions: topActions.slice(0, 10),
      dataFreshness: {
        lastFetchedAt: new Date().toISOString(),
        source: 'cache',
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Trigger manual sync
app.post('/api/sync', async (req, res) => {
  try {
    res.json({ message: 'Sync started', status: 'running' });

    // Run sync in background
    performSync().catch(err => console.error('Background sync error:', err));
  } catch (error) {
    console.error('Error starting sync:', error);
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

// === Background Sync Function ===

async function performSync() {
  const startTime = Date.now();
  console.log('🔄 Starting Harness data sync...');

  try {
    // Update status to running
    db.prepare(`
      UPDATE sync_status
      SET status = 'running', error = NULL, last_sync_at = datetime('now')
      WHERE id = 1
    `).run();

    // Fetch and reconcile data from Harness
    const components = await harnessSync.fetchAndReconcile();

    console.log(`✓ Fetched ${components.length} components`);

    // Clear old data and insert new
    db.prepare('DELETE FROM components').run();

    const insert = db.prepare(`
      INSERT INTO components (
        package, version, highest_severity, vulnerability_count,
        critical_count, high_count, in_production,
        unique_services, unique_environments, unique_orgs, unique_projects,
        is_container, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((components) => {
      for (const comp of components) {
        const criticalCount = comp.vulnerabilities.filter(v => v.severity === 'critical').length;
        const highCount = comp.vulnerabilities.filter(v => v.severity === 'high').length;
        const uniqueOrgs = new Set(comp.currentDeployments.map(d => d.orgId).filter(Boolean)).size;
        const uniqueProjects = new Set(comp.currentDeployments.map(d => d.projectId).filter(Boolean)).size;

        insert.run(
          comp.package,
          comp.version,
          comp.highestSeverity,
          comp.vulnerabilities.length,
          criticalCount,
          highCount,
          comp.hasProduction ? 1 : 0,
          comp.uniqueServices,
          comp.uniqueEnvironments,
          uniqueOrgs,
          uniqueProjects,
          comp.isContainer ? 1 : 0,
          JSON.stringify(comp)
        );
      }
    });

    insertMany(components);

    const duration = Date.now() - startTime;

    // Calculate unique orgs and projects across all components
    const allOrgs = new Set();
    const allProjects = new Set();
    for (const comp of components) {
      for (const dep of comp.currentDeployments || []) {
        if (dep.orgId) allOrgs.add(dep.orgId);
        if (dep.projectId) allProjects.add(dep.projectId);
      }
    }

    // Update sync status
    db.prepare(`
      UPDATE sync_status
      SET status = 'success',
          last_sync_duration_ms = ?,
          total_components = ?,
          total_orgs = ?,
          total_projects = ?
      WHERE id = 1
    `).run(
      duration,
      components.length,
      allOrgs.size,
      allProjects.size
    );

    console.log(`✓ Sync completed in ${(duration / 1000).toFixed(1)}s`);
  } catch (error) {
    console.error('❌ Sync failed:', error);

    db.prepare(`
      UPDATE sync_status
      SET status = 'error', error = ?
      WHERE id = 1
    `).run(error.message);
  }
}

// === Scheduled Sync (every 5 minutes) ===

if (process.env.ENABLE_AUTO_SYNC !== 'false') {
  cron.schedule('*/5 * * * *', () => {
    console.log('⏰ Scheduled sync triggered');
    performSync().catch(err => console.error('Scheduled sync error:', err));
  });

  console.log('✓ Scheduled sync enabled (every 5 minutes)');
}

// Perform initial sync on startup
if (process.env.SYNC_ON_STARTUP !== 'false') {
  setTimeout(() => {
    performSync().catch(err => console.error('Initial sync error:', err));
  }, 2000);
}

// Start server
app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Components: http://localhost:${PORT}/api/components`);
});
