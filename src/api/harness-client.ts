/**
 * Browser-compatible Harness API client
 * Calls Harness APIs directly (via Vite proxy in dev)
 */

import { config } from '@/lib/config';
import { mockClient } from './mock-client';
import type {
  HarnessArtifact,
  HarnessSBOM,
  HarnessSBOMComponent,
  HarnessVulnerability,
  HarnessDeployment,
  HarnessService,
  HarnessEnvironment,
  HarnessExemption,
} from '@/types';

interface HarnessPageResponse<T> {
  content: T[];
  totalPages: number;
  totalElements: number;
  number: number;
  size: number;
  empty: boolean;
}

export class HarnessAPIClient {
  private baseUrl: string;

  constructor() {
    // In dev: use Vite proxy to avoid CORS
    // In prod: call Harness directly (requires CORS or proxy setup)
    this.baseUrl = config.harness.useProxy
      ? '/api/harness'
      : config.harness.baseUrl;
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      params?: Record<string, string | number | boolean>;
      body?: any;
    } = {}
  ): Promise<T> {
    const { method = 'GET', params, body } = options;

    const url = new URL(`${this.baseUrl}${path}`, window.location.origin);

    // Add params as query string
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add auth headers if not using proxy
    if (!config.harness.useProxy) {
      headers['x-api-key'] = config.harness.apiKey;
      headers['Harness-Account'] = config.harness.accountId; // Capitalized!
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    // Only add body for POST/PUT/PATCH methods
    // Browser fetch API doesn't allow GET with body
    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      let errorMessage = `Harness API error: ${response.status} ${response.statusText}`;
      let errorDetails = '';

      // Only log non-404 errors (404s on pipeline executions are expected for expired/deleted runs)
      const isPipelineExecution404 = response.status === 404 && path.includes('/pipeline/api/pipelines/execution/');
      if (!isPipelineExecution404) {
        // Log full URL for debugging
        console.error(`❌ Failed request: ${method} ${url.toString()}`);
        console.error(`   Status: ${response.status} ${response.statusText}`);
      }

      try {
        const errorBody = await response.json();

        // Handle Harness-specific error formats
        if (errorBody.status === 'FAILURE') {
          errorDetails = errorBody.message || errorBody.code || '';
        } else if (errorBody.error) {
          errorDetails = errorBody.error;
        } else if (errorBody.message) {
          errorDetails = errorBody.message;
        }

        if (errorDetails) {
          errorMessage += `\n\nEndpoint: ${path}\nDetails: ${errorDetails}`;
        }

        if (!isPipelineExecution404) {
          console.error(`   Error body:`, errorBody);
        }

        // Add context for common errors
        if (response.status === 404) {
          errorMessage += '\n\nPossible causes:\n- Resource does not exist\n- Module (SCS/SSCA) not enabled for this account\n- Invalid org/project scope';
        } else if (response.status === 403) {
          errorMessage += '\n\nPossible causes:\n- API key lacks required permissions\n- Account/org/project scope mismatch';
        } else if (response.status === 401) {
          errorMessage += '\n\nPossible causes:\n- Invalid or expired API key\n- Check VITE_HARNESS_API_KEY in .env file';
        }
      } catch {
        // If we can't parse the error body, use the basic error message
      }

      throw new Error(errorMessage);
    }

    return response.json();
  }

  private async *paginate<T>(
    path: string,
    params: Record<string, string | number | boolean> = {}
  ): AsyncGenerator<T[], void, undefined> {
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request<any>(path, {
        params: { ...params, page, size: 100 },
      });

      // Handle both response formats:
      // 1. {data: {content: [...], ...}} - NG API (services, environments)
      // 2. {content: [...], ...} - Some other endpoints
      const pageData = response.data || response;
      const content = pageData.content || [];

      yield content;

      const empty = pageData.empty ?? (content.length === 0);
      const totalPages = pageData.totalPages || 1;
      hasMore = !empty && page < totalPages - 1;
      page++;
    }
  }

  // ============================================================================
  // SCS APIs
  // ============================================================================

  async listArtifacts(
    orgId: string,
    projectId: string
  ): Promise<HarnessArtifact[]> {
    // SCS uses the ssca-manager gateway API with a two-step flow:
    // 1. List artifact sources (registries) - POST with query params + body
    // 2. List artifacts from each source - POST with query params + body
    // Body must include: component_filter, search_term, artifact_type

    const allArtifacts: HarnessArtifact[] = [];

    // Step 1: Get all artifact sources
    // Note: API returns array directly, not {data: [...]}
    const sourcesResponse = await this.request<Array<{ source_id: string; name: string; artifact_type: any }>>(
      `/gateway/ssca-manager/v1/orgs/${orgId}/projects/${projectId}/artifact-sources`,
      {
        method: 'POST',
        params: { limit: 100, page: 0, sort: 'updated', order: 'DESC' },
        body: {},
      }
    );

    if (!sourcesResponse || sourcesResponse.length === 0) {
      console.warn('No artifact sources found in project');
      return [];
    }

    console.log(`Found ${sourcesResponse.length} artifact sources - fetching in parallel...`);

    // Step 2: Get artifacts from each source IN PARALLEL
    const artifactPromises = sourcesResponse.map(async (source) => {
      try {
        const artifactsResponse = await this.request<HarnessArtifact[]>(
          `/gateway/ssca-manager/v1/orgs/${orgId}/projects/${projectId}/artifact-sources/${source.source_id}/artifacts`,
          {
            method: 'POST',
            params: { limit: 100, page: 0, sort: 'updated', order: 'DESC' },
            body: { component_filter: [], search_term: '', artifact_type: [] },
          }
        );

        if (artifactsResponse && artifactsResponse.length > 0) {
          console.log(`✓ Fetched ${artifactsResponse.length} artifacts from source ${source.name}`);
          // Add source ID to each artifact for URL generation
          return artifactsResponse.map(a => ({ ...a, sourceId: source.source_id }));
        }
        return [];
      } catch (error) {
        console.warn('Failed to fetch artifacts from source %s:', source.name, error);
        return [];
      }
    });

    // Wait for all artifact requests to complete
    const artifactResults = await Promise.all(artifactPromises);

    // Flatten results into single array
    artifactResults.forEach(artifacts => {
      allArtifacts.push(...artifacts);
    });

    console.log(`✓ Total artifacts fetched: ${allArtifacts.length}`);
    return allArtifacts;
  }

  async listSBOMs(
    orgId: string,
    projectId: string,
    artifactId?: string
  ): Promise<HarnessSBOM[]> {
    // SBOM data is embedded in artifact responses from the gateway
    // The legacy /ng/api/sbom/list endpoint doesn't work with API keys
    // For now, derive SBOM presence from artifacts (count field indicates SBOM exists)
    console.log('ℹ️  SBOM data derived from artifacts (legacy endpoint not available)');
    return [];
  }

  async getArtifactComponents(
    orgId: string,
    projectId: string,
    sourceId: string,
    artifactId: string
  ): Promise<HarnessSBOMComponent[]> {
    try {
      // Fetch SBOM components (dependencies) for a specific artifact
      const response = await this.request<any>(
        `/gateway/ssca-manager/v1/orgs/${orgId}/projects/${projectId}/artifact-sources/${sourceId}/artifacts/${artifactId}/components`,
        {
          method: 'POST',
          params: { limit: 1000, page: 0 },
          body: { component_filter: [], search_term: '' },
        }
      );

      // API returns array of components directly
      if (!response || !Array.isArray(response)) {
        return [];
      }

      return response.map((comp: any) => ({
        name: comp.name || comp.component_name || 'unknown',
        version: comp.version || comp.component_version || 'unknown',
        purl: comp.purl,
        cpe: comp.cpe,
        license: comp.license || comp.licenses?.[0],
        type: comp.type || comp.component_type || 'library',
      }));
    } catch (error) {
      console.warn('Failed to fetch components for artifact %s:', artifactId, error);
      return [];
    }
  }

  async listVulnerabilities(
    orgId: string,
    projectId: string,
    params?: { artifactId?: string; severity?: string }
  ): Promise<HarnessVulnerability[]> {
    console.log('📡 Fetching vulnerabilities from STO API...');

    try {
      // Get all artifacts to find their execution IDs
      const artifacts = await this.listArtifacts(orgId, projectId);

      // Get unique execution IDs from artifacts with pipeline executions
      const executionIds = new Set(
        artifacts
          .filter(a => (a as any).orchestration?.pipeline_execution_id)
          .map(a => (a as any).orchestration.pipeline_execution_id)
      );

      console.log(`Found ${executionIds.size} unique executions with potential vulnerabilities`);

      const allVulnerabilities: HarnessVulnerability[] = [];
      const artifactIdByExecution = new Map<string, string>();

      // Build execution -> artifact ID map
      artifacts.forEach(a => {
        const execId = (a as any).orchestration?.pipeline_execution_id;
        if (execId) {
          artifactIdByExecution.set(execId, a.id);
        }
      });

      // Fetch vulnerabilities for each execution in parallel
      const vulnPromises = Array.from(executionIds).map(async (executionId) => {
        try {
          const response = await this.request<any>(
            `/gateway/sto/api/v2/frontend/pipeline-security/issues`,
            {
              params: {
                accountId: config.harness.accountId,
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

          // Combine existing and new issues
          const existingIssues = response?.existing?.issues || [];
          const newIssues = response?.new?.issues || [];
          const issues = [...existingIssues, ...newIssues];
          const artifactId = artifactIdByExecution.get(executionId) || executionId;

          // Debug: Log first issue to see structure and count by type
          if (issues.length > 0 && !window.__stoIssueLogged) {
            const byType = issues.reduce((acc: Map<string, number>, i: any) => {
              const key = String(i.type);
              acc.set(key, (acc.get(key) || 0) + 1);
              return acc;
            }, new Map<string, number>());
            console.log('🔍 STO findings by type:', Object.fromEntries(byType));

            // Log sample of each type
            const samplesByType = new Map<string, any>();
            for (const issue of issues) {
              const key = String(issue.type);
              if (!samplesByType.has(key)) {
                samplesByType.set(key, issue);
              }
            }
            console.log('🔍 Sample STO issues by type:', JSON.stringify(Object.fromEntries(samplesByType), null, 2));
            window.__stoIssueLogged = true;
          }

          // Map to our vulnerability format
          return issues.map((issue: any) => {
            // For SCA vulnerabilities, extract library name from various possible fields
            // For SAST/DAST, use the artifact name
            let componentName = 'unknown';
            let componentVersion = '';

            if (issue.type === 'SCA') {
              // SCA findings - extract library name from key field
              // Format is typically: "packageName//version" or "packageName/version"
              if (issue.key) {
                const parts = issue.key.split('//');
                if (parts.length === 2) {
                  componentName = parts[0];
                  componentVersion = parts[1];
                } else {
                  // Try single slash
                  const altParts = issue.key.split('/');
                  if (altParts.length >= 2) {
                    componentName = altParts.at(-2) ?? 'unknown';
                    componentVersion = altParts.at(-1) ?? '';
                  } else {
                    componentName = issue.key;
                  }
                }
              }

              // Fallback: try to extract from title (format: "packageName@version: description")
              if (componentName === 'unknown' && issue.title) {
                const titleMatch = issue.title.match(/^([^@:]+)@([^:]+)/);
                if (titleMatch) {
                  componentName = titleMatch[1];
                  componentVersion = titleMatch[2];
                }
              }
            } else {
              // SAST/DAST/other - use artifact name as component
              componentName = issue.targetVariantName || issue.reference || 'unknown';
            }

            return {
              id: issue.id || `${executionId}-${issue.key}`,
              cveId: issue.key || issue.title || 'UNKNOWN', // key is like "CVE-2021-1234" or "Web:S5148"
              severity: (issue.severityCode || 'unknown').toLowerCase(), // severityCode is "Critical", "High", etc.
              cvssScore: issue.severity, // severity is the numeric score like 9.5
              cvssVector: issue.vector,
              epssScore: undefined,
              epssPercentile: undefined,
              description: issue.title || '',
              publishedDate: issue.detectedAt || Date.now(),
              componentName,
              componentVersion,
              artifactId,
              // Capture STO finding type (SAST, SCA, DAST, etc.)
              findingType: issue.type || 'unknown',
            };
          });
        } catch (error) {
          // Silently skip - execution may not have STO scan results
          return [];
        }
      });

      const vulnResults = await Promise.all(vulnPromises);

      vulnResults.forEach(vulns => {
        if (vulns && vulns.length > 0) {
          allVulnerabilities.push(...vulns);
        }
      });

      console.log(`✓ Fetched ${allVulnerabilities.length} vulnerabilities from ${executionIds.size} executions`);
      return allVulnerabilities;
    } catch (error) {
      console.error('❌ Failed to fetch vulnerabilities:', error);
      return [];
    }
  }

  async listDeployments(
    orgId: string,
    projectId: string,
    params?: { serviceId?: string; envId?: string }
  ): Promise<HarnessDeployment[]> {
    console.log('📡 Fetching deployments via Pipeline Execution API (v2)...');

    try {
      // Get artifacts to find their pipeline_execution_ids
      const artifacts = await this.listArtifacts(orgId, projectId);

      // Extract unique execution IDs
      const executionIds = new Set(
        artifacts
          .filter(a => a.orchestration?.pipeline_execution_id)
          .map(a => a.orchestration.pipeline_execution_id)
      );

      console.log(`Found ${executionIds.size} unique pipeline executions from artifacts`);

      const deployments: HarnessDeployment[] = [];
      const processedDeployments = new Set<string>(); // Dedupe by service+env+artifact

      // Fetch each execution to extract deployment details
      for (const executionId of Array.from(executionIds)) {
        try {
          const response = await this.request<any>(
            `/pipeline/api/pipelines/execution/v2/${executionId}`,
            {
              params: {
                accountIdentifier: config.harness.accountId,
                orgIdentifier: orgId,
                projectIdentifier: projectId,
              },
            }
          );

          const layoutNodeMap = response.data?.pipelineExecutionSummary?.layoutNodeMap || {};

          // Find deployment stages
          for (const [nodeId, node] of Object.entries(layoutNodeMap)) {
            const stageNode = node as any;

            if (stageNode.nodeType === 'Deployment' && stageNode.module === 'cd' && stageNode.moduleInfo?.cd) {
              const cdInfo = stageNode.moduleInfo.cd;
              const serviceInfo = cdInfo.serviceInfo;
              const infraInfo = cdInfo.infraExecutionSummary;
              const artifact = serviceInfo?.artifacts?.primary;

              if (serviceInfo && infraInfo && artifact) {
                const serviceId = serviceInfo.identifier;
                const envId = infraInfo.identifier;

                // Skip if filtering
                if (params?.serviceId && serviceId !== params.serviceId) continue;
                if (params?.envId && envId !== params.envId) continue;

                // Dedupe key
                const deployKey = `${serviceId}:${envId}:${artifact.imagePath}:${artifact.tag}`;
                if (processedDeployments.has(deployKey)) continue;
                processedDeployments.add(deployKey);

                deployments.push({
                  artifactId: `${artifact.imagePath}:${artifact.tag}`, // Will match to real artifact later
                  digest: artifact.digest || '',
                  serviceId,
                  serviceName: serviceInfo.displayName || serviceId,
                  envId,
                  envName: infraInfo.name || envId,
                  envType: infraInfo.type === 'Production' ? 'Production' : 'PreProduction',
                  executionId,
                  deployedAt: stageNode.startTs || Date.now(),
                  status: stageNode.status?.toLowerCase() || 'success',
                });
              }
            }
          }
        } catch (err) {
          // Silently skip expired/deleted executions (404s are expected)
          // Only log if it's not a 404
          const is404 = err instanceof Error && err.message.includes('404');
          if (!is404) {
            console.warn('Failed to fetch execution %s:', executionId, err);
          }
        }
      }

      console.log(`✓ Fetched ${deployments.length} deployments from ${executionIds.size} pipeline executions`);
      return deployments;
    } catch (error) {
      console.error('❌ Failed to fetch deployments:', error);
      return [];
    }
  }

  // ============================================================================
  // Account/Org/Project APIs
  // ============================================================================

  async listOrganizations(): Promise<Array<{ identifier: string; name: string }>> {
    try {
      const allOrgs: Array<{ identifier: string; name: string }> = [];

      for await (const orgWrappers of this.paginate<any>(
        '/ng/api/organizations',
        {
          accountIdentifier: config.harness.accountId,
        }
      )) {
        // API returns {organization: {...}} - extract the organization object
        const orgs = orgWrappers.map((wrapper: any) => ({
          identifier: wrapper.organization?.identifier || wrapper.identifier,
          name: wrapper.organization?.name || wrapper.name,
        }));
        allOrgs.push(...orgs);
      }

      console.log(`✓ Fetched ${allOrgs.length} organizations`);
      return allOrgs;
    } catch (error) {
      console.warn('Failed to fetch organizations:', error);
      return [];
    }
  }

  async listProjects(orgId: string): Promise<Array<{ identifier: string; name: string; orgIdentifier: string }>> {
    try {
      const allProjects: Array<{ identifier: string; name: string; orgIdentifier: string }> = [];

      for await (const projectWrappers of this.paginate<any>(
        '/ng/api/projects',
        {
          accountIdentifier: config.harness.accountId,
          orgIdentifier: orgId,
        }
      )) {
        // API returns {project: {...}} - extract the project object
        const projects = projectWrappers.map((wrapper: any) => ({
          identifier: wrapper.project?.identifier || wrapper.identifier,
          name: wrapper.project?.name || wrapper.name,
          orgIdentifier: orgId,
        }));
        allProjects.push(...projects);
      }

      console.log(`✓ Fetched ${allProjects.length} projects for org ${orgId}`);
      return allProjects;
    } catch (error) {
      console.warn('Failed to fetch projects for org %s:', orgId, error);
      return [];
    }
  }

  // ============================================================================
  // CD APIs
  // ============================================================================

  async listServices(
    orgId: string,
    projectId: string
  ): Promise<HarnessService[]> {
    const allServices: HarnessService[] = [];

    for await (const serviceWrappers of this.paginate<any>(
      '/ng/api/servicesV2',
      {
        accountIdentifier: config.harness.accountId,
        orgIdentifier: orgId,
        projectIdentifier: projectId,
      }
    )) {
      // API returns {service: {...}, createdAt: ..., ...} - extract the service object
      const services = serviceWrappers.map((wrapper: any) => wrapper.service);
      allServices.push(...services);
    }

    console.log(`✓ Fetched ${allServices.length} services`);
    return allServices;
  }

  async listEnvironments(
    orgId: string,
    projectId: string
  ): Promise<HarnessEnvironment[]> {
    const allEnvironments: HarnessEnvironment[] = [];

    for await (const environments of this.paginate<HarnessEnvironment>(
      '/ng/api/environmentsV2',
      {
        accountIdentifier: config.harness.accountId,
        orgIdentifier: orgId,
        projectIdentifier: projectId,
      }
    )) {
      allEnvironments.push(...environments);
    }

    return allEnvironments;
  }

  // ============================================================================
  // STO APIs
  // ============================================================================

  async listExemptions(
    orgId: string,
    projectId: string
  ): Promise<HarnessExemption[]> {
    try {
      // STO v2 API - returns {results: [...], pagination: {...}}
      const response = await this.request<{ results: HarnessExemption[]; pagination: any }>(
        `/sto/api/v2/exemptions`,
        {
          params: {
            accountId: config.harness.accountId,
            orgId: orgId,
            projectId: projectId,
            page: 1,
            pageSize: 100,
          }
        }
      );
      const exemptions = response?.results || [];
      console.log(`✓ Fetched ${exemptions.length} exemptions`);
      return exemptions;
    } catch (error) {
      console.warn('Failed to fetch exemptions (STO module may not be enabled):', error);
      return [];
    }
  }
}

// Singleton instance - use mock client in demo mode
export const harnessClient = config.app.demoMode
  ? mockClient
  : new HarnessAPIClient();
