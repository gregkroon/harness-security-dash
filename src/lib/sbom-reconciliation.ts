/**
 * SBOM-first reconciliation
 * Start with: "What libraries do we have?"
 * Then: "Where are they deployed?"
 */

import type {
  HarnessArtifact,
  HarnessSBOMComponent,
  HarnessVulnerability,
  HarnessDeployment,
  HarnessService,
} from '@/types';

export interface SBOMComponent {
  // Component identity
  package: string; // e.g., "org.apache.logging.log4j:log4j-core"
  version: string; // e.g., "2.14.1"

  // Where it lives
  inArtifacts: {
    artifactId: string;
    artifactName: string;
    sourceId?: string;
  }[];

  // Current deployments (latest per service+environment)
  currentDeployments: {
    serviceId: string;
    serviceName: string;
    envId: string;
    envName: string;
    envType: 'Production' | 'PreProduction';
    deployedAt: number;
    artifactId: string; // which artifact is deployed here
    orgId?: string;
    orgName?: string;
    projectId?: string;
    projectName?: string;
  }[];

  // Known issues
  vulnerabilities: {
    cveId: string;
    severity: string;
    cvssScore?: number;
    description: string;
    findingType?: string; // SAST, SCA, DAST, etc.
  }[];

  // Aggregates
  totalCurrentDeployments: number; // unique service+env combinations
  uniqueServices: number;
  uniqueEnvironments: number;
  hasProduction: boolean;
  highestSeverity: string;
}

export class SBOMReconciliation {
  /**
   * Reconcile with ALL SBOM components (not just vulnerable ones)
   * Used for zero-day component search
   */
  async reconcileWithSBOM(params: {
    artifacts: HarnessArtifact[];
    vulnerabilities: HarnessVulnerability[];
    deployments: HarnessDeployment[];
    sbomComponents: Map<string, HarnessSBOMComponent[]>; // artifactId -> components
  }): Promise<SBOMComponent[]> {
    const { artifacts, vulnerabilities, deployments, sbomComponents } = params;

    console.log('🔍 Starting SBOM reconciliation with full component inventory...');
    console.log(`   Artifacts: ${artifacts.length}`);
    console.log(`   SBOM components available for: ${sbomComponents.size} artifacts`);
    console.log(`   Vulnerabilities: ${vulnerabilities.length}`);
    console.log(`   Total deployments: ${deployments.length}`);

    // Step 1: Keep only LATEST deployment per service+environment
    const latestDeployments = this.getLatestDeployments(deployments);

    // Step 2: Build component map from SBOM data
    const componentMap = new Map<string, {
      package: string;
      version: string;
      artifactIds: Set<string>;
      vulnerabilities: Map<string, any>;
    }>();

    // Add all SBOM components
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
          });
        }

        componentMap.get(key)!.artifactIds.add(artifactId);
      }
    }

    console.log(`✓ Found ${componentMap.size} unique package@version combinations from SBOMs`);

    // Step 3: Merge vulnerability data
    for (const vuln of vulnerabilities) {
      if (!vuln.componentName || !vuln.artifactId) continue;

      const pkg = vuln.componentName;
      const ver = vuln.componentVersion || 'unknown';
      const key = `${pkg}@${ver}`;

      // Find existing component or create new one
      if (!componentMap.has(key)) {
        componentMap.set(key, {
          package: pkg,
          version: ver,
          artifactIds: new Set(),
          vulnerabilities: new Map(),
        });
      }

      const comp = componentMap.get(key)!;
      comp.artifactIds.add(vuln.artifactId);

      // Dedupe vulnerabilities by CVE
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

    // Step 4: Build final components with deployment info
    const artifactMap = new Map(artifacts.map(a => [a.id, a]));
    const components: SBOMComponent[] = [];

    for (const [key, comp] of componentMap) {
      // Get artifacts containing this component
      const inArtifacts = Array.from(comp.artifactIds)
        .map(artId => {
          const art = artifactMap.get(artId);
          return art ? {
            artifactId: art.id,
            artifactName: art.name,
            sourceId: (art as any).sourceId,
          } : null;
        })
        .filter(Boolean) as any[];

      // Find current deployments of these artifacts
      const currentDeployments = latestDeployments
        .filter(dep => comp.artifactIds.has(dep.artifactId))
        .map(dep => ({
          serviceId: dep.serviceId,
          serviceName: dep.serviceName,
          envId: dep.envId,
          envName: dep.envName,
          envType: dep.envType,
          deployedAt: dep.deployedAt,
          artifactId: dep.artifactId,
          orgId: (dep as any).orgId,
          orgName: (dep as any).orgName,
          projectId: (dep as any).projectId,
          projectName: (dep as any).projectName,
        }));

      // Calculate aggregates
      const uniqueServices = new Set(currentDeployments.map(d => d.serviceId)).size;
      const uniqueEnvironments = new Set(currentDeployments.map(d => d.envId)).size;
      const hasProduction = currentDeployments.some(d => d.envType === 'Production');

      const vulnArray = Array.from(comp.vulnerabilities.values());
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0, unknown: -1 };
      const highestSeverity = vulnArray.length > 0
        ? vulnArray.reduce((max, v) => {
            const current = (Object.hasOwn(severityOrder, v.severity) ? severityOrder[v.severity as keyof typeof severityOrder] : -1);
            const maxVal = (Object.hasOwn(severityOrder, max) ? severityOrder[max as keyof typeof severityOrder] : -1);
            return current > maxVal ? v.severity : max;
          }, 'unknown')
        : 'none';

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

    console.log(`✓ Built ${components.length} SBOM components with deployment info`);
    return components;
  }

  /**
   * Reconcile with vulnerability data only (faster, for Exposures page)
   */
  reconcile(params: {
    artifacts: HarnessArtifact[];
    vulnerabilities: HarnessVulnerability[];
    deployments: HarnessDeployment[];
  }): SBOMComponent[] {
    const { artifacts, vulnerabilities, deployments } = params;

    console.log('🔍 Starting SBOM reconciliation...');
    console.log(`   Artifacts: ${artifacts.length}`);
    console.log(`   Vulnerabilities: ${vulnerabilities.length}`);
    console.log(`   Total deployments: ${deployments.length}`);

    // Step 1: Keep only LATEST deployment per service+environment
    const latestDeployments = this.getLatestDeployments(deployments);

    // Step 2: Build component map from vulnerabilities
    // (Each vulnerability tells us: package X version Y exists in artifact Z)
    const componentMap = new Map<string, {
      package: string;
      version: string;
      artifactIds: Set<string>;
      vulnerabilities: Map<string, any>;
    }>();

    for (const vuln of vulnerabilities) {
      if (!vuln.componentName || !vuln.artifactId) continue;

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

      const comp = componentMap.get(key)!;
      comp.artifactIds.add(vuln.artifactId);

      // Dedupe vulnerabilities by CVE
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

    console.log(`✓ Found ${componentMap.size} unique package@version combinations`);

    // Step 3: For each component, find current deployments
    const artifactMap = new Map(artifacts.map(a => [a.id, a]));
    const components: SBOMComponent[] = [];

    for (const [key, comp] of componentMap) {
      // Get artifacts containing this component
      const inArtifacts = Array.from(comp.artifactIds)
        .map(artId => {
          const art = artifactMap.get(artId);
          return art ? {
            artifactId: art.id,
            artifactName: art.name,
            sourceId: (art as any).sourceId,
          } : null;
        })
        .filter(Boolean) as any[];

      // Find current deployments of these artifacts
      const currentDeployments = latestDeployments
        .filter(dep => comp.artifactIds.has(dep.artifactId))
        .map(dep => ({
          serviceId: dep.serviceId,
          serviceName: dep.serviceName,
          envId: dep.envId,
          envName: dep.envName,
          envType: dep.envType,
          deployedAt: dep.deployedAt,
          artifactId: dep.artifactId,
          orgId: (dep as any).orgId,
          orgName: (dep as any).orgName,
          projectId: (dep as any).projectId,
          projectName: (dep as any).projectName,
        }));

      // Calculate aggregates
      const uniqueServices = new Set(currentDeployments.map(d => d.serviceId)).size;
      const uniqueEnvironments = new Set(currentDeployments.map(d => d.envId)).size;
      const hasProduction = currentDeployments.some(d => d.envType === 'Production');

      const vulnArray = Array.from(comp.vulnerabilities.values());
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0, unknown: -1 };
      const highestSeverity = vulnArray.reduce((max, v) => {
        const current = (Object.hasOwn(severityOrder, v.severity) ? severityOrder[v.severity as keyof typeof severityOrder] : -1);
        const maxVal = (Object.hasOwn(severityOrder, max) ? severityOrder[max as keyof typeof severityOrder] : -1);
        return current > maxVal ? v.severity : max;
      }, 'unknown');

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

    console.log(`✓ Built ${components.length} SBOM components with deployment info`);

    // Debug: Show sample component
    if (components.length > 0) {
      const sample = components[0];
      console.log(`📦 Sample component: ${sample.package}@${sample.version}`);
      console.log(`   Current deployments: ${sample.totalCurrentDeployments} (${sample.uniqueServices} services, ${sample.uniqueEnvironments} environments)`);
    }

    return components;
  }

  private getLatestDeployments(deployments: HarnessDeployment[]): HarnessDeployment[] {
    const latestMap = new Map<string, HarnessDeployment>();

    for (const dep of deployments) {
      const key = `${dep.serviceId}:${dep.envId}`;
      const existing = latestMap.get(key);

      if (!existing || dep.deployedAt > existing.deployedAt) {
        latestMap.set(key, dep);
      }
    }

    const latest = Array.from(latestMap.values());
    console.log(`📊 Deployments: ${deployments.length} total → ${latest.length} current (latest per service+environment)`);
    console.log(`📍 Unique environments: ${new Set(latest.map(d => d.envName)).size}`);

    return latest;
  }
}

export const sbomReconciliation = new SBOMReconciliation();
