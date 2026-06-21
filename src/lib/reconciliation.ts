/**
 * In-memory reconciliation engine
 * Reconciles Harness API data into meaningful exposures
 */

import type {
  HarnessArtifact,
  HarnessSBOM,
  HarnessVulnerability,
  HarnessDeployment,
  HarnessService,
  HarnessExemption,
  ExposureItem,
  Severity,
  Confidence,
  CoverageSummary,
} from '@/types';

export class ReconciliationEngine {
  /**
   * Reconcile all data into exposure items
   */
  reconcileExposures(params: {
    artifacts: HarnessArtifact[];
    sboms: HarnessSBOM[];
    vulnerabilities: HarnessVulnerability[];
    deployments: HarnessDeployment[];
    services: HarnessService[];
    exemptions: HarnessExemption[];
  }): ExposureItem[] {
    const { artifacts, sboms, vulnerabilities, deployments, exemptions } = params;

    // Build lookup maps for performance
    const artifactMap = new Map(artifacts.map((a) => [a.id, a]));
    const sbomMap = new Map(sboms.map((s) => [s.artifactId, s]));
    const deploymentsByArtifact = this.groupBy(deployments, (d) => d.artifactId);
    const exemptionsByCve = new Map(
      exemptions.map((e) => [e.cveId || '', e])
    );

    const exposures: ExposureItem[] = [];

    // For each vulnerability, find its exposures
    for (const vuln of vulnerabilities) {
      if (!vuln.artifactId) continue;

      const artifact = artifactMap.get(vuln.artifactId);
      if (!artifact) continue;

      const sbom = sbomMap.get(vuln.artifactId);
      const artifactDeployments = deploymentsByArtifact.get(vuln.artifactId) || [];
      const exemption = exemptionsByCve.get(vuln.cveId);

      // Create exposure for each deployment of this vulnerable artifact
      for (const deployment of artifactDeployments) {
        exposures.push({
          id: `${vuln.id}-${deployment.executionId}`,
          cveId: vuln.cveId,
          severity: this.normalizeSeverity(vuln.severity),
          cvssScore: vuln.cvssScore,
          epssScore: vuln.epssScore,
          epssPercentile: vuln.epssPercentile,
          isKev: false, // Will be enriched separately

          artifactId: artifact.id, // Store real artifact ID for linking
          artifactDigest: artifact.digest,
          artifactName: artifact.name,
          artifactRegistry: artifact.registry,
          artifactSourceId: (artifact as any).sourceId,
          pipelineId: (artifact as any).orchestration?.pipeline_id,

          componentName: vuln.componentName || 'unknown',
          componentVersion: vuln.componentVersion || 'unknown',

          serviceId: deployment.serviceId,
          serviceName: deployment.serviceName,
          ownerTeam: undefined, // Would come from IDP catalog
          ownerConfidence: 'unknown',

          environmentId: deployment.envId,
          environmentName: deployment.envName,
          environmentType: deployment.envType,

          deploymentConfidence: 'harness_record_only',
          deployedAt: new Date(deployment.deployedAt).toISOString(),

          hasExemption: !!exemption,
          exemptionStatus: exemption?.status,
          exemptionExpiresAt: exemption?.expiresAt
            ? new Date(exemption.expiresAt).toISOString()
            : undefined,

          hasSbom: !!sbom,
          dataFreshness: new Date().toISOString(),
          findingType: vuln.findingType,
        });
      }
    }

    return exposures;
  }

  /**
   * Calculate coverage metrics
   */
  calculateCoverage(params: {
    services: HarnessService[];
    sboms: HarnessSBOM[];
    deployments: HarnessDeployment[];
    artifacts?: any[]; // Optional for tracking deployment details
  }): CoverageSummary {
    const { services, sboms, deployments, artifacts = [] } = params;

    const servicesWithSbom = new Set(sboms.map((s) => s.artifactId));
    const servicesWithDeployments = new Set(deployments.map((d) => d.serviceId));

    console.log('🔍 Coverage Calculation:', {
      totalServices: services.length,
      servicesWithDeployments: servicesWithDeployments.size,
      deploymentServiceIds: Array.from(servicesWithDeployments),
      allServiceIds: services.map(s => ({ id: s.identifier, name: s.name })),
      sampleDeployment: deployments[0] ? { serviceId: deployments[0].serviceId, serviceName: deployments[0].serviceName } : null,
    });

    const uninstrumentedServices = services
      .filter((s) => !servicesWithDeployments.has(s.identifier))
      .map((s) => ({
        serviceId: s.identifier,
        serviceName: s.name,
        reason: 'No deployment records found in Harness',
      }));

    // Build instrumented services list
    const instrumentedServices = services
      .filter((s) => servicesWithDeployments.has(s.identifier))
      .map((s) => {
        // Count deployments for this service
        const serviceDeployments = deployments.filter(d => d.serviceId === s.identifier);
        const uniqueEnvironments = new Set(serviceDeployments.map(d => d.envId));
        const hasProductionDeployment = serviceDeployments.some(d => d.envType === 'Production');

        // Get unique artifact IDs deployed for this service
        const deployedArtifactIds = new Set(serviceDeployments.map(d => d.artifactId));

        // Find artifacts that match these deployments (check both real artifact IDs and image:tag format)
        const serviceArtifacts = artifacts.filter(a => {
          // Check if artifact ID matches directly
          if (deployedArtifactIds.has(a.id)) return true;

          // Also check image:tag format
          // Deployment has: "boutique-web-ui:1.0.1296"
          // Artifact has: name="proj-web-docker-dev/boutique-web-ui", tags=["1.0.1296"]
          // Extract short name from artifact (last part after /)
          const artifactShortName = a.name?.split('/').pop()?.split(':')[0];
          const artifactTag = a.tags?.[0];
          const artifactImageTag = artifactShortName && artifactTag ? `${artifactShortName}:${artifactTag}` : null;

          return artifactImageTag && deployedArtifactIds.has(artifactImageTag);
        });

        const artifactsWithSBOM = serviceArtifacts.filter(a => a.components_count && a.components_count > 0);

        return {
          serviceId: s.identifier,
          serviceName: s.name,
          deploymentCount: serviceDeployments.length,
          environmentCount: uniqueEnvironments.size,
          hasProduction: hasProductionDeployment,
          hasSBOM: artifactsWithSBOM.length > 0,
          sbomCoverage: serviceArtifacts.length > 0
            ? Math.round((artifactsWithSBOM.length / serviceArtifacts.length) * 100)
            : 0,
        };
      });

    console.log('✅ Instrumented Services:', instrumentedServices.length);
    console.log('🚨 Uninstrumented Services:', uninstrumentedServices.length);

    return {
      totalServices: services.length,
      servicesWithSbom: servicesWithSbom.size,
      servicesWithDeployments: servicesWithDeployments.size,
      uninstrumentedServices,
      instrumentedServices,
      coveragePercentage: services.length > 0
        ? Math.round((servicesWithDeployments.size / services.length) * 100)
        : 0,
    };
  }

  /**
   * Normalize Harness severity to our domain model
   */
  private normalizeSeverity(harnessSevertity: string): Severity {
    const normalized = harnessSevertity.toLowerCase();
    if (['critical', 'high', 'medium', 'low', 'info'].includes(normalized)) {
      return normalized as Severity;
    }
    return 'unknown';
  }

  /**
   * Group array by key function
   */
  private groupBy<T>(
    array: T[],
    keyFn: (item: T) => string
  ): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of array) {
      const key = keyFn(item);
      const group = map.get(key) || [];
      group.push(item);
      map.set(key, group);
    }
    return map;
  }
}

export const reconciliation = new ReconciliationEngine();
