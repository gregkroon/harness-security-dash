/**
 * React hooks for fetching Harness data with TanStack Query
 */

import { useQuery } from '@tanstack/react-query';
import { harnessClient } from '@/api/harness-client';
import { reconciliation } from '@/lib/reconciliation';
import type { DashboardOverview, ExposureItem, FilterOptions } from '@/types';
import { config } from '@/lib/config';

const CACHE_TIME = config.app.cacheTtlMs;

/**
 * Fetch and reconcile all data for dashboard overview
 */
export function useDashboardOverview(orgId: string, projectId: string) {
  return useQuery({
    queryKey: ['dashboard-overview', orgId, projectId],
    queryFn: async (): Promise<DashboardOverview> => {
      // Fetch all data in parallel with error handling
      const [artifacts, sboms, vulnerabilities, deployments, services, exemptions] =
        await Promise.all([
          harnessClient.listArtifacts(orgId, projectId).catch(e => { console.error('artifacts:', e); return []; }),
          harnessClient.listSBOMs(orgId, projectId).catch(e => { console.error('sboms:', e); return []; }),
          harnessClient.listVulnerabilities(orgId, projectId).catch(e => { console.error('vulnerabilities:', e); return []; }),
          harnessClient.listDeployments(orgId, projectId).catch(e => { console.error('deployments:', e); return []; }),
          harnessClient.listServices(orgId, projectId).catch(e => { console.error('services:', e); return []; }),
          harnessClient.listExemptions(orgId, projectId).catch(e => { console.error('exemptions:', e); return []; }),
        ]);

      // Use real deployments from cd:service_infra_info
      console.log('📊 Real deployments from cd:service_infra_info:', deployments.length);
      console.log('🔍 Sample deployment:', deployments[0]);

      // Match deployments to artifacts by image name + tag
      const deploymentsWithArtifactId = deployments.map(dep => {
        // Find matching artifact by name and tag
        const matchingArtifact = artifacts.find(a => {
          // Deployment: "boutique-web-ui:1.0.1296"
          // Artifact: name="proj-web-docker-dev/boutique-web-ui", tags=["1.0.1296"]
          const deploymentImage = dep.artifactId?.split(':')[0]; // "boutique-web-ui"
          const deploymentTag = dep.artifactId?.split(':')[1]; // "1.0.1296"

          // Extract short name from artifact (last part after /)
          const artifactShortName = a.name?.split('/').pop()?.split(':')[0]; // "boutique-web-ui"
          const artifactTag = a.tags?.[0]; // "1.0.1296"

          return artifactShortName === deploymentImage && artifactTag === deploymentTag;
        });

        return {
          ...dep,
          artifactId: matchingArtifact?.id || dep.artifactId, // Use real artifact ID if found
        };
      });

      console.log('🔗 Matched deployments to artifacts:', deploymentsWithArtifactId.length);

      // Count artifacts with SBOMs (components_count > 0)
      const artifactsWithSBOM = artifacts.filter(a => a.components_count && a.components_count > 0);

      // Debug logging
      console.log('📊 Data Summary:', {
        artifacts: artifacts.length,
        artifactsWithSBOM: artifactsWithSBOM.length,
        services: services.length,
        exemptions: exemptions.length,
        deployments: deploymentsWithArtifactId.length,
      });

      // Reconcile into exposures using real deployment data
      const exposures = reconciliation.reconcileExposures({
        artifacts,
        sboms: artifactsWithSBOM.map(a => ({ artifactId: a.id, componentCount: a.components_count })),
        vulnerabilities,
        deployments: deploymentsWithArtifactId,
        services,
        exemptions,
      });

      // Calculate coverage using real deployment data
      const coverage = reconciliation.calculateCoverage({
        services,
        sboms: artifactsWithSBOM.map(a => ({ artifactId: a.id, componentCount: a.components_count })),
        deployments: deploymentsWithArtifactId,
        artifacts, // Pass artifacts so we can track which services have data
      });

      // Calculate metrics
      const productionExposures = exposures.filter(
        (e) => e.environmentType === 'Production'
      );

      const criticalInProduction = productionExposures.filter(
        (e) => e.severity === 'critical'
      ).length;
      const highInProduction = productionExposures.filter(
        (e) => e.severity === 'high'
      ).length;

      // Generate top actions
      const topActions = generateTopActions(productionExposures, coverage);

      return {
        criticalInProduction,
        highInProduction,
        coverage,
        topActions,
        dataFreshness: {
          lastFetchedAt: new Date().toISOString(),
          source: 'live',
        },
      };
    },
    staleTime: CACHE_TIME,
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch and reconcile exposures with filtering
 */
export function useExposures(
  orgId: string,
  projectId: string,
  filters: FilterOptions = {}
) {
  return useQuery({
    queryKey: ['exposures', orgId, projectId, filters],
    queryFn: async (): Promise<ExposureItem[]> => {
      const [artifacts, sboms, vulnerabilities, deployments, services, exemptions] =
        await Promise.all([
          harnessClient.listArtifacts(orgId, projectId),
          harnessClient.listSBOMs(orgId, projectId),
          harnessClient.listVulnerabilities(orgId, projectId, {
            ...(filters.severity && { severity: filters.severity.join(',') }),
          }),
          harnessClient.listDeployments(orgId, projectId, {
            ...(filters.serviceId && { serviceId: filters.serviceId }),
          }),
          harnessClient.listServices(orgId, projectId),
          harnessClient.listExemptions(orgId, projectId),
        ]);

      // Match deployments to artifacts by image name + tag
      const deploymentsWithArtifactId = deployments.map(dep => {
        // Find matching artifact by name and tag
        const matchingArtifact = artifacts.find(a => {
          // Deployment: "boutique-web-ui:1.0.1296"
          // Artifact: name="proj-web-docker-dev/boutique-web-ui", tags=["1.0.1296"]
          const deploymentImage = dep.artifactId?.split(':')[0]; // "boutique-web-ui"
          const deploymentTag = dep.artifactId?.split(':')[1]; // "1.0.1296"

          // Extract short name from artifact (last part after /)
          const artifactShortName = a.name?.split('/').pop()?.split(':')[0]; // "boutique-web-ui"
          const artifactTag = a.tags?.[0]; // "1.0.1296"

          return artifactShortName === deploymentImage && artifactTag === deploymentTag;
        });

        return {
          ...dep,
          artifactId: matchingArtifact?.id || dep.artifactId, // Use real artifact ID if found
        };
      });

      let exposures = reconciliation.reconcileExposures({
        artifacts,
        sboms,
        vulnerabilities,
        deployments: deploymentsWithArtifactId,
        services,
        exemptions,
      });

      // Apply client-side filters
      exposures = applyFilters(exposures, filters);

      return exposures;
    },
    staleTime: CACHE_TIME,
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch services for dropdown/selection
 */
export function useServices(orgId: string, projectId: string) {
  return useQuery({
    queryKey: ['services', orgId, projectId],
    queryFn: () => harnessClient.listServices(orgId, projectId),
    staleTime: CACHE_TIME * 2, // Services change less frequently
  });
}

// Helper functions

function generateTopActions(exposures: ExposureItem[], coverage: any) {
  const actions = [];

  // CRITICAL: Low coverage is a high-priority blind spot
  // Never show "safe" when data is missing - absence of evidence is a risk state
  const CRITICAL_COVERAGE_THRESHOLD = 50; // Below 50% is critical
  const WARNING_COVERAGE_THRESHOLD = 80;  // Below 80% is concerning

  if (coverage.coveragePercentage < CRITICAL_COVERAGE_THRESHOLD) {
    actions.push({
      priority: 1,
      type: 'critical_low_coverage' as const,
      title: `⚠️ Critical: Only ${coverage.coveragePercentage}% coverage (${coverage.servicesWithDeployments}/${coverage.totalServices} services)`,
      description: `${coverage.uninstrumentedServices.length} services have no visibility. This is a major blind spot - vulnerabilities in these services are undetected.`,
      serviceId: coverage.uninstrumentedServices[0]?.serviceId || 'unknown',
      serviceName: coverage.uninstrumentedServices[0]?.serviceName || 'Multiple services',
    });
  } else if (coverage.coveragePercentage < WARNING_COVERAGE_THRESHOLD) {
    actions.push({
      priority: 2,
      type: 'warning_low_coverage' as const,
      title: `⚠️ Warning: Only ${coverage.coveragePercentage}% coverage (${coverage.servicesWithDeployments}/${coverage.totalServices} services)`,
      description: `${coverage.uninstrumentedServices.length} services have no visibility. Increase instrumentation to reduce blind spots.`,
      serviceId: coverage.uninstrumentedServices[0]?.serviceId || 'unknown',
      serviceName: coverage.uninstrumentedServices[0]?.serviceName || 'Multiple services',
    });
  }

  // Expired exemptions
  const expiredExemptions = exposures.filter(
    (e) => e.hasExemption && e.exemptionStatus === 'expired'
  );
  if (expiredExemptions.length > 0) {
    actions.push({
      priority: actions.length + 1,
      type: 'critical_expired_waiver' as const,
      title: `${expiredExemptions.length} expired exemptions`,
      description: 'Production vulnerabilities with expired waivers',
      serviceId: expiredExemptions[0].serviceId,
      serviceName: expiredExemptions[0].serviceName,
    });
  }

  // Missing SBOMs (only show if coverage is acceptable but specific services are missing)
  if (coverage.coveragePercentage >= CRITICAL_COVERAGE_THRESHOLD && coverage.uninstrumentedServices.length > 0) {
    actions.push({
      priority: actions.length + 1,
      type: 'missing_sbom' as const,
      title: `${coverage.uninstrumentedServices.length} services not instrumented`,
      description: 'Services with no SBOM or deployment tracking',
      serviceId: coverage.uninstrumentedServices[0].serviceId,
      serviceName: coverage.uninstrumentedServices[0].serviceName,
    });
  }

  return actions.slice(0, 10);
}

function applyFilters(exposures: ExposureItem[], filters: FilterOptions): ExposureItem[] {
  let filtered = [...exposures];

  if (filters.severity && filters.severity.length > 0) {
    filtered = filtered.filter((e) => filters.severity!.includes(e.severity));
  }

  if (filters.environmentType && filters.environmentType.length > 0) {
    filtered = filtered.filter((e) =>
      filters.environmentType!.includes(e.environmentType)
    );
  }

  if (filters.kevOnly) {
    filtered = filtered.filter((e) => e.isKev);
  }

  if (filters.hasExemption !== undefined) {
    filtered = filtered.filter((e) => e.hasExemption === filters.hasExemption);
  }

  if (filters.serviceId) {
    filtered = filtered.filter((e) => e.serviceId === filters.serviceId);
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.cveId.toLowerCase().includes(searchLower) ||
        e.serviceName.toLowerCase().includes(searchLower) ||
        e.componentName.toLowerCase().includes(searchLower)
    );
  }

  return filtered;
}
