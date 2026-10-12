/**
 * Harness API sync module
 * Fetches data from Harness and reconciles components
 * Reuses logic from frontend but optimized for server-side
 */

const fetch = require('node-fetch');

class HarnessSync {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.accountId = config.accountId;
    this.apiKey = config.apiKey;
  }

  async request(path, options = {}) {
    const { method = 'GET', params, body } = options;

    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'Harness-Account': this.accountId,
    };

    const fetchOptions = {
      method,
      headers,
    };

    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      throw new Error(`Harness API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async *paginate(path, params = {}) {
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request(path, {
        params: { ...params, page, size: 100 },
      });

      const pageData = response.data || response;
      const content = pageData.content || [];

      yield content;

      const empty = pageData.empty ?? (content.length === 0);
      const totalPages = pageData.totalPages || 1;
      hasMore = !empty && page < totalPages - 1;
      page++;
    }
  }

  async fetchAndReconcile() {
    console.log('📡 Fetching from Harness...');

    // Step 1: Get all orgs
    const orgs = await this.listOrganizations();
    console.log(`✓ Found ${orgs.length} organizations`);

    const orgNameMap = new Map(orgs.map(o => [o.identifier, o.name]));

    // Step 2: Get all projects
    const projectPromises = orgs.map(org => this.listProjects(org.identifier));
    const projectResults = await Promise.all(projectPromises);
    const allProjects = projectResults.flat();
    console.log(`✓ Found ${allProjects.length} projects`);

    // Step 3: Fetch data from each project in batches to avoid rate limits
    console.log(`⏳ Processing ${allProjects.length} projects in batches of 10...`);

    const validProjectData = [];
    const BATCH_SIZE = 10;

    for (let i = 0; i < allProjects.length; i += BATCH_SIZE) {
      const batch = allProjects.slice(i, i + BATCH_SIZE);
      console.log(`   Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allProjects.length / BATCH_SIZE)} (${batch.length} projects)...`);

      const batchPromises = batch.map(async (project) => {
      try {
        const [artifacts, vulnerabilities, deployments] = await Promise.all([
          this.listArtifacts(project.orgIdentifier, project.identifier).catch(() => []),
          this.listVulnerabilities(project.orgIdentifier, project.identifier).catch(() => []),
          this.listDeployments(project.orgIdentifier, project.identifier).catch(() => []),
        ]);

        // Step 3.1: Build artifact ID map for matching deployments
        const artifactImageTagMap = new Map();
        for (const art of artifacts) {
          const fullName = art.name || '';
          const tags = art.tags || (art.tag ? [art.tag] : []);

          if (fullName && tags.length > 0) {
            for (const tag of tags) {
              artifactImageTagMap.set(`${fullName}:${tag}`, art.id);
              const shortName = fullName.split('/').pop();
              artifactImageTagMap.set(`${shortName}:${tag}`, art.id);
              const parts = fullName.split('/');
              if (parts.length >= 2) {
                const mediumName = parts.slice(-2).join('/');
                artifactImageTagMap.set(`${mediumName}:${tag}`, art.id);
              }
            }
          }
        }

        // Step 3.2: Find which artifacts are actually deployed
        const deployedArtifactIds = new Set();
        for (const dep of deployments) {
          const artifactId = artifactImageTagMap.get(dep.artifactId);
          if (artifactId) {
            deployedArtifactIds.add(artifactId);
          }
        }

        // Step 3.3: Only fetch SBOMs for deployed artifacts (to avoid rate limits)
        const sbomComponents = new Map(); // artifactId -> components[]
        let sbomFetchErrors = 0;

        // Debug: Log strategy on first project
        if (!this._sbomStrategyLogged && artifacts.length > 0) {
          console.log(`   📊 SBOM fetch strategy: Only fetching for deployed artifacts to avoid rate limits`);
          console.log(`      Total artifacts: ${artifacts.length}, Deployed: ${deployedArtifactIds.size}`);
          this._sbomStrategyLogged = true;
        }

        const deployedArtifacts = artifacts.filter(a => deployedArtifactIds.has(a.id));

        for (const artifact of deployedArtifacts) {
          if (artifact.id) {
            // Add delay between requests to respect rate limits
            // 200ms = max 5 requests/second
            await new Promise(resolve => setTimeout(resolve, 200));

            const components = await this.getArtifactComponents(
              project.orgIdentifier,
              project.identifier,
              artifact.id
            ).catch((err) => {
              sbomFetchErrors++;
              if (sbomFetchErrors <= 5) {
                console.warn(`   ⚠️  SBOM fetch failed for ${artifact.name || artifact.id}: ${err.message}`);
              }
              return [];
            });

            if (components.length > 0) {
              sbomComponents.set(artifact.id, components);
            }
          }
        }

        if (deployedArtifacts.length > 0) {
          const successRate = deployedArtifacts.length > 0 ? Math.round((sbomComponents.size / deployedArtifacts.length) * 100) : 0;
          console.log(`   ${project.orgIdentifier}/${project.identifier}: ${deployedArtifacts.length} deployed artifacts, ${sbomComponents.size} with SBOMs (${successRate}%)${sbomFetchErrors > 0 ? `, ${sbomFetchErrors} errors` : ''}`);
        }

        // Match deployments to artifacts
        const deploymentsWithContext = deployments.map(dep => ({
          ...dep,
          orgId: project.orgIdentifier,
          orgName: orgNameMap.get(project.orgIdentifier) || project.orgIdentifier,
          projectId: project.identifier,
          projectName: project.name,
        }));

        return {
          project,
          artifacts,
          vulnerabilities,
          deployments: deploymentsWithContext,
          sbomComponents,
        };
      } catch (error) {
        console.warn('Failed %s/%s:', project.orgIdentifier, project.identifier, error.message);
        return null;
      }
    });

      const batchResults = await Promise.all(batchPromises);
      validProjectData.push(...batchResults.filter(Boolean));

      // Small delay between batches
      if (i + BATCH_SIZE < allProjects.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`✓ Successfully fetched ${validProjectData.length} projects`);

    // Step 4: Aggregate all data
    const allArtifacts = validProjectData.flatMap(pd => pd.artifacts);
    const allVulnerabilities = validProjectData.flatMap(pd => pd.vulnerabilities);
    const allDeployments = validProjectData.flatMap(pd => pd.deployments);

    // Merge all SBOM components into a single map
    const allSbomComponents = new Map();
    for (const pd of validProjectData) {
      if (pd.sbomComponents) {
        for (const [artifactId, components] of pd.sbomComponents) {
          allSbomComponents.set(artifactId, components);
        }
      }
    }

    console.log(`✓ Total: ${allArtifacts.length} artifacts, ${allVulnerabilities.length} vulnerabilities, ${allDeployments.length} deployments`);
    console.log(`✓ SBOM data available for ${allSbomComponents.size} artifacts`);

    // Step 5: Reconcile with SBOM data
    const components = this.reconcileWithSBOM({
      artifacts: allArtifacts,
      vulnerabilities: allVulnerabilities,
      deployments: allDeployments,
      sbomComponents: allSbomComponents,
    });

    console.log(`✓ Built ${components.length} components`);

    return components;
  }

  async listOrganizations() {
    const allOrgs = [];
    for await (const orgWrappers of this.paginate('/ng/api/organizations', {
      accountIdentifier: this.accountId,
    })) {
      const orgs = orgWrappers.map((wrapper) => ({
        identifier: wrapper.organization?.identifier || wrapper.identifier,
        name: wrapper.organization?.name || wrapper.name,
      }));
      allOrgs.push(...orgs);
    }
    return allOrgs;
  }

  async listProjects(orgId) {
    const allProjects = [];
    for await (const projectWrappers of this.paginate('/ng/api/projects', {
      accountIdentifier: this.accountId,
      orgIdentifier: orgId,
    })) {
      const projects = projectWrappers.map((wrapper) => ({
        identifier: wrapper.project?.identifier || wrapper.identifier,
        name: wrapper.project?.name || wrapper.name,
        orgIdentifier: orgId,
      }));
      allProjects.push(...projects);
    }
    return allProjects;
  }

  async listArtifacts(orgId, projectId) {
    const allArtifacts = [];

    const sourcesResponse = await this.request(
      `/gateway/ssca-manager/v1/orgs/${orgId}/projects/${projectId}/artifact-sources`,
      {
        method: 'POST',
        params: { limit: 100, page: 0, sort: 'updated', order: 'DESC' },
        body: {},
      }
    );

    if (!sourcesResponse || sourcesResponse.length === 0) {
      return [];
    }

    const artifactPromises = sourcesResponse.map(async (source) => {
      try {
        const artifactsResponse = await this.request(
          `/gateway/ssca-manager/v1/orgs/${orgId}/projects/${projectId}/artifact-sources/${source.source_id}/artifacts`,
          {
            method: 'POST',
            params: { limit: 100, page: 0, sort: 'updated', order: 'DESC' },
            body: { component_filter: [], search_term: '', artifact_type: [] },
          }
        );

        if (artifactsResponse && artifactsResponse.length > 0) {
          return artifactsResponse.map(a => ({ ...a, sourceId: source.source_id }));
        }
        return [];
      } catch (error) {
        return [];
      }
    });

    const artifactResults = await Promise.all(artifactPromises);
    artifactResults.forEach(artifacts => allArtifacts.push(...artifacts));

    return allArtifacts;
  }

  async getArtifactComponents(orgId, projectId, artifactId, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await this.request(
          `/gateway/ssca-manager/v1/orgs/${orgId}/projects/${projectId}/artifacts/${artifactId}/components`,
          {
            method: 'POST',
            params: { limit: 1000, page: 0, sort: 'package_name', order: 'ASC' },
            body: { component_filter: [] },
          }
        );

        if (!response || !Array.isArray(response)) {
          return [];
        }

        return response.map((comp) => ({
          name: comp.name || comp.package_name || comp.component_name || 'unknown',
          version: comp.version || comp.package_version || comp.component_version || 'unknown',
          purl: comp.purl,
          cpe: comp.cpe,
          license: comp.license || comp.licenses?.[0],
          type: comp.type || comp.component_type || 'library',
        }));
      } catch (error) {
        // If 429 rate limit, wait and retry with exponential backoff
        if (error.message.includes('429') && attempt < retries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        // If 404, the artifact doesn't have SBOM data - not an error
        if (error.message.includes('404')) {
          return [];
        }

        throw new Error(`SBOM fetch failed: ${error.message}`);
      }
    }
    return [];
  }

  async listVulnerabilities(orgId, projectId) {
    const artifacts = await this.listArtifacts(orgId, projectId);

    const executionIds = new Set(
      artifacts
        .filter(a => a.orchestration?.pipeline_execution_id)
        .map(a => a.orchestration.pipeline_execution_id)
    );

    if (executionIds.size === 0) return [];

    const allVulnerabilities = [];
    const artifactIdByExecution = new Map();

    artifacts.forEach(a => {
      const execId = a.orchestration?.pipeline_execution_id;
      if (execId) {
        artifactIdByExecution.set(execId, a.id);
      }
    });

    const vulnPromises = Array.from(executionIds).map(async (executionId) => {
      try {
        const response = await this.request(
          `/gateway/sto/api/v2/frontend/pipeline-security/issues`,
          {
            params: {
              accountId: this.accountId,
              orgId,
              projectId,
              executionId,
              severityCodes: 'Critical,High,Medium,Low',
              includeExempted: false,
              pageNew: 0,
              pageExisting: 0,
              pageSizeNew: 100,
              pageSizeExisting: 100,
            },
          }
        );

        const existingIssues = response?.existing?.issues || [];
        const newIssues = response?.new?.issues || [];
        const issues = [...existingIssues, ...newIssues];
        const artifactId = artifactIdByExecution.get(executionId) || executionId;

        return issues.map((issue) => {
          let componentName = 'unknown';
          let componentVersion = '';

          if (issue.type === 'SCA') {
            if (issue.key) {
              const parts = issue.key.split('//');
              if (parts.length === 2) {
                // Decode URL-encoded characters (e.g., %2B -> +, %3A -> :)
                componentName = decodeURIComponent(parts[0]);
                componentVersion = decodeURIComponent(parts[1]);
              }
            }
          } else {
            componentName = issue.targetVariantName || issue.reference || 'unknown';
          }

          return {
            id: issue.id || `${executionId}-${issue.key}`,
            cveId: issue.key || issue.title || 'UNKNOWN',
            severity: (issue.severityCode || 'unknown').toLowerCase(),
            cvssScore: issue.severity,
            description: issue.title || '',
            publishedDate: issue.detectedAt || Date.now(),
            componentName,
            componentVersion,
            artifactId,
            findingType: issue.type || 'unknown',
          };
        }).filter(vuln => {
          // Filter out invalid vulnerabilities:
          // Precedence: 1) Library in artifacts (SCA only), 2) Deployed, 3) CVEs

          // Only include SCA (Software Composition Analysis) findings
          // Skip SAST, DAST, etc. as they are not library vulnerabilities
          if (vuln.findingType !== 'SCA') {
            return false;
          }

          const cveId = vuln.cveId || '';

          // Skip if CVE ID is just the component name repeated (OS metadata)
          if (cveId === `${vuln.componentName}//${vuln.componentVersion}`) {
            return false;
          }

          // Skip OS base layer metadata (not actual libraries)
          if (vuln.componentName === 'Linux Ubuntu' ||
              vuln.componentName === 'Windows' ||
              vuln.componentName === 'Alpine Linux') {
            return false;
          }

          // Skip if version is unknown (usually means parsing failed)
          if (vuln.componentVersion === 'unknown' || !vuln.componentVersion) {
            return false;
          }

          return true;
        });
      } catch (error) {
        return [];
      }
    });

    const vulnResults = await Promise.all(vulnPromises);
    vulnResults.forEach(vulns => {
      if (vulns && vulns.length > 0) {
        allVulnerabilities.push(...vulns);
      }
    });

    return allVulnerabilities;
  }

  async listDeployments(orgId, projectId) {
    const artifacts = await this.listArtifacts(orgId, projectId);

    const executionIds = new Set(
      artifacts
        .filter(a => a.orchestration?.pipeline_execution_id)
        .map(a => a.orchestration.pipeline_execution_id)
    );

    if (executionIds.size === 0) return [];

    const deployments = [];

    for (const executionId of Array.from(executionIds)) {
      try {
        const response = await this.request(
          `/pipeline/api/pipelines/execution/v2/${executionId}`,
          {
            params: {
              accountIdentifier: this.accountId,
              orgIdentifier: orgId,
              projectIdentifier: projectId,
            },
          }
        );

        const layoutNodeMap = response.data?.pipelineExecutionSummary?.layoutNodeMap || {};

        for (const [nodeId, node] of Object.entries(layoutNodeMap)) {
          const stageNode = node;

          if (stageNode.nodeType === 'Deployment' && stageNode.module === 'cd' && stageNode.moduleInfo?.cd) {
            const cdInfo = stageNode.moduleInfo.cd;
            const serviceInfo = cdInfo.serviceInfo;
            const infraInfo = cdInfo.infraExecutionSummary;
            const artifact = serviceInfo?.artifacts?.primary;

            if (serviceInfo && infraInfo && artifact) {
              deployments.push({
                artifactId: `${artifact.imagePath}:${artifact.tag}`,
                digest: artifact.digest || '',
                serviceId: serviceInfo.identifier,
                serviceName: serviceInfo.displayName || serviceInfo.identifier,
                envId: infraInfo.identifier,
                envName: infraInfo.name || infraInfo.identifier,
                envType: infraInfo.type === 'Production' ? 'Production' : 'PreProduction',
                executionId,
                deployedAt: stageNode.startTs || Date.now(),
                status: stageNode.status?.toLowerCase() || 'success',
              });
            }
          }
        }
      } catch (err) {
        // Skip failed executions
      }
    }

    return deployments;
  }

  // Helper: Detect if a component is a container image vs a library
  isContainerImage(componentName, componentVersion) {
    // Container images have registry URLs or sha256 digests
    return componentName.includes('docker.pkg.dev') ||
           componentName.includes('docker.io') ||
           componentName.includes('pkg.harness.io') ||
           componentName.includes('gcr.io') ||
           componentName.includes('azurecr.io') ||
           componentName.includes('ecr.aws') ||
           componentName.includes('amazonaws.com') ||
           componentVersion.startsWith('sha256:');
  }

  reconcileWithSBOM({ artifacts, vulnerabilities, deployments, sbomComponents }) {
    console.log('🔧 SBOM-first reconciliation:');
    console.log(`   - ${artifacts.length} artifacts`);
    console.log(`   - ${sbomComponents.size} artifacts with SBOM data`);
    console.log(`   - ${vulnerabilities.length} vulnerabilities`);
    console.log(`   - ${deployments.length} deployments`);

    // Get latest deployments per service+env
    const latestMap = new Map();
    for (const dep of deployments) {
      const key = `${dep.serviceId}:${dep.envId}`;
      const existing = latestMap.get(key);
      if (!existing || dep.deployedAt > existing.deployedAt) {
        latestMap.set(key, dep);
      }
    }
    const latestDeployments = Array.from(latestMap.values());
    console.log(`   - ${latestDeployments.length} unique deployments (latest per service+env)`);

    // Build component map from SBOM data FIRST
    const componentMap = new Map();

    for (const [artifactId, components] of sbomComponents) {
      for (const comp of components) {
        const pkg = comp.name;
        const ver = comp.version;
        const key = `${pkg}@${ver}`;

        if (!componentMap.has(key)) {
          componentMap.set(key, {
            package: pkg,
            version: ver,
            artifactIds: new Set(),
            vulnerabilities: new Map(),
            purl: comp.purl, // Store the PURL from SBOM
          });
        }

        componentMap.get(key).artifactIds.add(artifactId);
      }
    }

    console.log(`   - ${componentMap.size} unique components from SBOMs`);

    // Now merge vulnerability data
    for (const vuln of vulnerabilities) {
      if (!vuln.componentName || !vuln.artifactId) continue;

      const pkg = vuln.componentName;
      const ver = vuln.componentVersion || 'unknown';
      const key = `${pkg}@${ver}`;

      // Find existing component or create new one (without PURL since this is from vulnerabilities)
      if (!componentMap.has(key)) {
        componentMap.set(key, {
          package: pkg,
          version: ver,
          artifactIds: new Set(),
          vulnerabilities: new Map(),
          purl: null, // No PURL from vulnerability data
        });
      }

      const comp = componentMap.get(key);
      comp.artifactIds.add(vuln.artifactId);

      if (!comp.vulnerabilities.has(vuln.cveId)) {
        comp.vulnerabilities.set(vuln.cveId, {
          cveId: vuln.cveId,
          severity: vuln.severity,
          cvssScore: vuln.cvssScore,
          description: vuln.description,
          findingType: vuln.findingType,
        });
      }
    }

    console.log(`   - Final: ${componentMap.size} unique components (with vulnerability data merged)`);

    // Build artifact image:tag to ID mapping
    const imageTagToArtifactId = new Map();
    for (const art of artifacts) {
      const fullName = art.name || '';
      const tags = art.tags || (art.tag ? [art.tag] : []);

      if (fullName && tags.length > 0) {
        for (const tag of tags) {
          imageTagToArtifactId.set(`${fullName}:${tag}`, art.id);
          const shortName = fullName.split('/').pop();
          imageTagToArtifactId.set(`${shortName}:${tag}`, art.id);
          const parts = fullName.split('/');
          if (parts.length >= 2) {
            const mediumName = parts.slice(-2).join('/');
            imageTagToArtifactId.set(`${mediumName}:${tag}`, art.id);
          }
        }
      }
    }

    // Map deployments to artifact GUIDs
    const deploymentsWithGuid = latestDeployments.map(dep => {
      const artifactGuid = imageTagToArtifactId.get(dep.artifactId);
      return {
        ...dep,
        artifactGuid: artifactGuid || dep.artifactId,
      };
    });

    const mappedCount = deploymentsWithGuid.filter(d => d.artifactGuid !== d.artifactId).length;
    console.log(`   - ${mappedCount}/${latestDeployments.length} deployments mapped to artifact GUIDs`);

    // Build final components
    const artifactMap = new Map(artifacts.map(a => [a.id, a]));
    const components = [];

    let componentsWithDeployments = 0;
    let componentsWithoutDeployments = 0;

    for (const [key, comp] of componentMap) {
      const inArtifacts = Array.from(comp.artifactIds)
        .map(artId => {
          const art = artifactMap.get(artId);
          return art ? {
            artifactId: art.id,
            artifactName: art.name,
            sourceId: art.sourceId,
          } : null;
        })
        .filter(Boolean);

      const currentDeployments = deploymentsWithGuid
        .filter(dep => comp.artifactIds.has(dep.artifactGuid))
        .map(dep => ({
          serviceId: dep.serviceId,
          serviceName: dep.serviceName,
          envId: dep.envId,
          envName: dep.envName,
          envType: dep.envType,
          deployedAt: dep.deployedAt,
          artifactId: dep.artifactId,
          orgId: dep.orgId,
          orgName: dep.orgName,
          projectId: dep.projectId,
          projectName: dep.projectName,
        }));

      const uniqueServices = new Set(currentDeployments.map(d => d.serviceId)).size;
      const uniqueEnvironments = new Set(currentDeployments.map(d => d.envId)).size;
      const uniqueOrgs = new Set(currentDeployments.map(d => d.orgId)).size;
      const uniqueProjects = new Set(currentDeployments.map(d => d.projectId)).size;
      const hasProduction = currentDeployments.some(d => d.envType === 'Production');

      const vulnArray = Array.from(comp.vulnerabilities.values());
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0, unknown: -1 };
      const highestSeverity = vulnArray.length > 0
        ? vulnArray.reduce((max, v) => {
            const current = (Object.hasOwn(severityOrder, v.severity) ? severityOrder[v.severity] : -1);
            const maxVal = (Object.hasOwn(severityOrder, max) ? severityOrder[max] : -1);
            return current > maxVal ? v.severity : max;
          }, 'unknown')
        : 'none';

      const criticalCount = vulnArray.filter(v => v.severity === 'critical').length;
      const highCount = vulnArray.filter(v => v.severity === 'high').length;

      if (currentDeployments.length > 0) {
        componentsWithDeployments++;
      } else {
        componentsWithoutDeployments++;
      }

      const isContainer = this.isContainerImage(comp.package, comp.version);

      components.push({
        package: comp.package,
        version: comp.version,
        purl: comp.purl || null, // Include PURL from SBOM if available
        inArtifacts,
        currentDeployments,
        vulnerabilities: vulnArray,
        totalCurrentDeployments: currentDeployments.length,
        uniqueServices,
        uniqueEnvironments,
        uniqueOrgs,
        uniqueProjects,
        hasProduction,
        inProduction: hasProduction,
        highestSeverity,
        vulnerabilityCount: vulnArray.length,
        criticalCount,
        highCount,
        isContainer,
      });
    }

    console.log(`   ✓ ${componentsWithDeployments} components with deployments`);
    console.log(`   ℹ️  ${componentsWithoutDeployments} components without deployments (not yet deployed)`);

    return components;
  }

  reconcile({ artifacts, vulnerabilities, deployments }) {
    console.log('🔧 Reconciliation debug:');
    console.log(`   - ${artifacts.length} artifacts`);
    console.log(`   - ${vulnerabilities.length} vulnerabilities`);
    console.log(`   - ${deployments.length} deployments`);

    // Get latest deployments per service+env
    const latestMap = new Map();
    for (const dep of deployments) {
      const key = `${dep.serviceId}:${dep.envId}`;
      const existing = latestMap.get(key);
      if (!existing || dep.deployedAt > existing.deployedAt) {
        latestMap.set(key, dep);
      }
    }
    const latestDeployments = Array.from(latestMap.values());
    console.log(`   - ${latestDeployments.length} unique deployments (latest per service+env)`);

    // Build artifact image:tag to ID mapping (try multiple strategies)
    const imageTagToArtifactId = new Map();
    for (const art of artifacts) {
      // Extract image name and tag from artifact name
      // Artifacts can have: art.name, art.tag, art.tags[], art.id
      const fullName = art.name || '';
      const tags = art.tags || (art.tag ? [art.tag] : []);

      if (fullName && tags.length > 0) {
        for (const tag of tags) {
          // Strategy 1: Full name with tag (e.g., "sales-209522/devx-demo/backend:latest")
          imageTagToArtifactId.set(`${fullName}:${tag}`, art.id);

          // Strategy 2: Last segment only (e.g., "backend:latest")
          const shortName = fullName.split('/').pop();
          imageTagToArtifactId.set(`${shortName}:${tag}`, art.id);

          // Strategy 3: Last two segments (e.g., "devx-demo/backend:latest")
          const parts = fullName.split('/');
          if (parts.length >= 2) {
            const mediumName = parts.slice(-2).join('/');
            imageTagToArtifactId.set(`${mediumName}:${tag}`, art.id);
          }
        }
      }
    }

    console.log(`📍 Built mapping for ${imageTagToArtifactId.size} image:tag combinations`);

    // Map deployment artifactIds (image:tag) to actual artifact GUIDs
    const deploymentsWithGuid = latestDeployments.map(dep => {
      const artifactGuid = imageTagToArtifactId.get(dep.artifactId);
      if (!artifactGuid) {
        console.log(`   ⚠️  No artifact GUID for deployment: ${dep.artifactId}`);
      }
      return {
        ...dep,
        artifactGuid: artifactGuid || dep.artifactId,
      };
    });

    const mappedCount = deploymentsWithGuid.filter(d => d.artifactGuid !== d.artifactId).length;
    console.log(`   - ${mappedCount}/${latestDeployments.length} deployments mapped to artifact GUIDs`);

    // Build component map from vulnerabilities
    const componentMap = new Map();
    const uniqueVulnArtifactIds = new Set();

    for (const vuln of vulnerabilities) {
      if (!vuln.componentName || !vuln.artifactId) continue;

      uniqueVulnArtifactIds.add(vuln.artifactId);

      const pkg = vuln.componentName;
      const ver = vuln.componentVersion || 'unknown';
      const key = `${pkg}@${ver}`;

      if (!componentMap.has(key)) {
        componentMap.set(key, {
          package: pkg,
          version: ver,
          artifactIds: new Set(),
          vulnerabilities: new Map(),
        });
      }

      const comp = componentMap.get(key);
      comp.artifactIds.add(vuln.artifactId);

      if (!comp.vulnerabilities.has(vuln.cveId)) {
        comp.vulnerabilities.set(vuln.cveId, {
          cveId: vuln.cveId,
          severity: vuln.severity,
          cvssScore: vuln.cvssScore,
          description: vuln.description,
          findingType: vuln.findingType,
        });
      }
    }

    console.log(`   - ${componentMap.size} unique components from vulnerabilities`);
    console.log(`   - ${uniqueVulnArtifactIds.size} unique artifact IDs referenced by vulnerabilities`);

    // Build final components
    const artifactMap = new Map(artifacts.map(a => [a.id, a]));
    const components = [];

    const deployedArtifactIds = new Set(deploymentsWithGuid.map(d => d.artifactGuid));
    console.log(`   - ${deployedArtifactIds.size} unique artifact IDs in deployments`);

    // Check overlap
    let componentsWithDeployments = 0;
    let componentsWithoutDeployments = 0;

    for (const [key, comp] of componentMap) {
      const inArtifacts = Array.from(comp.artifactIds)
        .map(artId => {
          const art = artifactMap.get(artId);
          return art ? {
            artifactId: art.id,
            artifactName: art.name,
            sourceId: art.sourceId,
          } : null;
        })
        .filter(Boolean);

      const currentDeployments = deploymentsWithGuid
        .filter(dep => comp.artifactIds.has(dep.artifactGuid))
        .map(dep => ({
          serviceId: dep.serviceId,
          serviceName: dep.serviceName,
          envId: dep.envId,
          envName: dep.envName,
          envType: dep.envType,
          deployedAt: dep.deployedAt,
          artifactId: dep.artifactId,
          orgId: dep.orgId,
          orgName: dep.orgName,
          projectId: dep.projectId,
          projectName: dep.projectName,
        }));

      const uniqueServices = new Set(currentDeployments.map(d => d.serviceId)).size;
      const uniqueEnvironments = new Set(currentDeployments.map(d => d.envId)).size;
      const hasProduction = currentDeployments.some(d => d.envType === 'Production');

      const vulnArray = Array.from(comp.vulnerabilities.values());
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0, unknown: -1 };
      const highestSeverity = vulnArray.length > 0
        ? vulnArray.reduce((max, v) => {
            const current = (Object.hasOwn(severityOrder, v.severity) ? severityOrder[v.severity] : -1);
            const maxVal = (Object.hasOwn(severityOrder, max) ? severityOrder[max] : -1);
            return current > maxVal ? v.severity : max;
          }, 'unknown')
        : 'none';

      if (currentDeployments.length > 0) {
        componentsWithDeployments++;
      } else {
        componentsWithoutDeployments++;
        // Log first 5 examples of components without deployments
        if (componentsWithoutDeployments <= 5) {
          console.log(`   ⚠️  No deployments for ${comp.package}@${comp.version} (artifacts: ${Array.from(comp.artifactIds).slice(0, 2).join(', ')})`);
        }
      }

      components.push({
        package: comp.package,
        version: comp.version,
        inArtifacts,
        currentDeployments,
        vulnerabilities: vulnArray,
        totalCurrentDeployments: currentDeployments.length,
        uniqueServices,
        uniqueEnvironments,
        hasProduction,
        highestSeverity,
      });
    }

    console.log(`   ✓ ${componentsWithDeployments} components with deployments`);
    console.log(`   ⚠️  ${componentsWithoutDeployments} components without deployments`);

    return components;
  }
}

module.exports = HarnessSync;
