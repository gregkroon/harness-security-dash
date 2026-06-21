/**
 * Component-centric reconciliation engine
 * Groups by SBOM component → vulnerabilities → services
 */

import type {
  HarnessArtifact,
  HarnessVulnerability,
  HarnessDeployment,
  HarnessService,
  HarnessExemption,
} from '@/types';

export interface ComponentExposure {
  // Component identity
  packageName: string; // e.g., "org.apache.logging.log4j:log4j-core"
  version: string;

  // Vulnerabilities
  vulnerabilities: {
    cveId: string;
    severity: string;
    cvssScore?: number;
    description: string;
    hasExemption: boolean;
    exemptionStatus?: string;
  }[];

  // Where it's deployed
  artifacts: {
    id: string;
    name: string;
    sourceId?: string;
  }[];

  services: {
    id: string;
    name: string;
    environments: {
      id: string;
      name: string;
      type: 'Production' | 'PreProduction';
      deploymentCount: number;
    }[];
  }[];

  // Aggregate metrics
  totalDeployments: number;
  hasProduction: boolean;
  highestSeverity: string;
  criticalCount: number;
  highCount: number;
}

export class ComponentReconciliationEngine {
  reconcileComponents(params: {
    artifacts: HarnessArtifact[];
    vulnerabilities: HarnessVulnerability[];
    deployments: HarnessDeployment[];
    services: HarnessService[];
    exemptions: HarnessExemption[];
  }): ComponentExposure[] {
    const { artifacts, vulnerabilities, deployments, services, exemptions } = params;

    // Build lookup maps
    const artifactMap = new Map(artifacts.map(a => [a.id, a]));
    const serviceMap = new Map(services.map(s => [s.identifier, s]));
    const exemptionsByCve = new Map(exemptions.map(e => [e.cveId || '', e]));

    // Group vulnerabilities by component
    const componentMap = new Map<string, {
      packageName: string;
      version: string;
      vulnerabilities: Map<string, any>; // CVE ID -> vuln details
      artifacts: Set<string>; // artifact IDs
      deployments: HarnessDeployment[];
    }>();

    // Step 1: Build component map from vulnerabilities
    for (const vuln of vulnerabilities) {
      if (!vuln.artifactId) continue;

      const artifact = artifactMap.get(vuln.artifactId);
      if (!artifact) continue;

      // Extract package name and version from vulnerability
      // componentName is like "org.apache.logging.log4j:log4j-core"
      const packageName = vuln.componentName || 'unknown';
      const version = vuln.componentVersion || 'unknown';
      const key = `${packageName}@${version}`;

      if (!componentMap.has(key)) {
        componentMap.set(key, {
          packageName,
          version,
          vulnerabilities: new Map(),
          artifacts: new Set(),
          deployments: [],
        });
      }

      const component = componentMap.get(key)!;

      // Add vulnerability (deduplicated by CVE ID)
      if (!component.vulnerabilities.has(vuln.cveId)) {
        const exemption = exemptionsByCve.get(vuln.cveId);
        component.vulnerabilities.set(vuln.cveId, {
          cveId: vuln.cveId,
          severity: vuln.severity,
          cvssScore: vuln.cvssScore,
          description: vuln.description,
          hasExemption: !!exemption,
          exemptionStatus: exemption?.status,
        });
      }

      // Add artifact
      component.artifacts.add(vuln.artifactId);
    }

    // Step 2: Filter to latest deployment per service+environment
    const latestDeployments = new Map<string, HarnessDeployment>();
    for (const deployment of deployments) {
      const key = `${deployment.serviceId}:${deployment.envId}`;
      const existing = latestDeployments.get(key);

      // Keep only the latest deployment (highest deployedAt timestamp)
      if (!existing || deployment.deployedAt > existing.deployedAt) {
        latestDeployments.set(key, deployment);
      }
    }

    // Debug: Show sample of unique environments
    const uniqueEnvs = new Set(Array.from(latestDeployments.values()).map(d => d.envId));
    console.log(`📊 Reduced from ${deployments.length} total deployments to ${latestDeployments.size} current deployments`);
    console.log(`📍 Unique environments: ${Array.from(uniqueEnvs).join(', ')}`);

    // Step 3: Link latest deployments to components
    for (const deployment of latestDeployments.values()) {
      const artifact = artifactMap.get(deployment.artifactId);
      if (!artifact) continue;

      // Find all components in this artifact
      for (const [key, component] of componentMap) {
        if (component.artifacts.has(artifact.id)) {
          component.deployments.push(deployment);
        }
      }
    }

    // Step 4: Build final component exposures
    const exposures: ComponentExposure[] = [];

    for (const [key, component] of componentMap) {
      // Group deployments by service
      const serviceDeployments = new Map<string, HarnessDeployment[]>();
      for (const dep of component.deployments) {
        if (!serviceDeployments.has(dep.serviceId)) {
          serviceDeployments.set(dep.serviceId, []);
        }
        serviceDeployments.get(dep.serviceId)!.push(dep);
      }

      // Build service list with environments
      const servicesWithEnvs = Array.from(serviceDeployments.entries()).map(([serviceId, deps]) => {
        const service = serviceMap.get(serviceId);

        // Group by environment
        const envMap = new Map<string, HarnessDeployment[]>();
        for (const dep of deps) {
          if (!envMap.has(dep.envId)) {
            envMap.set(dep.envId, []);
          }
          envMap.get(dep.envId)!.push(dep);
        }

        return {
          id: serviceId,
          name: service?.name || serviceId,
          environments: Array.from(envMap.entries()).map(([envId, envDeps]) => ({
            id: envId,
            name: envDeps[0].envName,
            type: envDeps[0].envType,
            deploymentCount: envDeps.length,
          })),
        };
      });

      // Calculate aggregate metrics
      const vulnArray = Array.from(component.vulnerabilities.values());
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0, unknown: -1 };
      const highestSeverity = vulnArray.reduce((max, v) => {
        const current = severityOrder[v.severity as keyof typeof severityOrder] || -1;
        const maxVal = severityOrder[max as keyof typeof severityOrder] || -1;
        return current > maxVal ? v.severity : max;
      }, 'unknown');

      const hasProduction = component.deployments.some(d => d.envType === 'Production');

      exposures.push({
        packageName: component.packageName,
        version: component.version,
        vulnerabilities: vulnArray,
        artifacts: Array.from(component.artifacts).map(artId => {
          const art = artifactMap.get(artId);
          return {
            id: artId,
            name: art?.name || artId,
            sourceId: (art as any)?.sourceId,
          };
        }),
        services: servicesWithEnvs,
        totalDeployments: component.deployments.length,
        hasProduction,
        highestSeverity,
        criticalCount: vulnArray.filter(v => v.severity === 'critical').length,
        highCount: vulnArray.filter(v => v.severity === 'high').length,
      });
    }

    return exposures;
  }
}

export const componentReconciliation = new ComponentReconciliationEngine();
