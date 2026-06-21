/**
 * React hook for fetching ALL components from SBOMs (not just vulnerable ones)
 * Used for zero-day component search
 */

import { useQuery } from '@tanstack/react-query';
import { harnessClient } from '@/api/harness-client';
import { sbomReconciliation, type SBOMComponent } from '@/lib/sbom-reconciliation';
import { config } from '@/lib/config';

const CACHE_TIME = config.app.cacheTtlMs;

export function useAllComponents(orgId: string, projectId: string) {
  return useQuery({
    queryKey: ['all-sbom-components', orgId, projectId],
    queryFn: async (): Promise<SBOMComponent[]> => {
      console.log('📦 Fetching ALL SBOM components for zero-day search...');

      const [artifacts, vulnerabilities, deployments] = await Promise.all([
        harnessClient.listArtifacts(orgId, projectId).catch(() => []),
        harnessClient.listVulnerabilities(orgId, projectId).catch(() => []),
        harnessClient.listDeployments(orgId, projectId).catch(() => []),
      ]);

      console.log(`✓ Got ${artifacts.length} artifacts, fetching SBOM components...`);

      // Fetch SBOM components for each artifact (in parallel)
      const sbomComponentsMap = new Map();

      const componentPromises = artifacts
        .filter(a => (a as any).sourceId) // Only fetch for artifacts with sourceId
        .map(async (artifact) => {
          try {
            const components = await harnessClient.getArtifactComponents(
              orgId,
              projectId,
              (artifact as any).sourceId,
              artifact.id
            );
            if (components.length > 0) {
              sbomComponentsMap.set(artifact.id, components);
            }
          } catch (error) {
            // Silently skip artifacts without SBOM data
            console.warn(`No SBOM for artifact ${artifact.name}`);
          }
        });

      await Promise.all(componentPromises);

      console.log(`✓ Fetched SBOM components for ${sbomComponentsMap.size} artifacts`);

      // Match deployments to artifacts by image name + tag
      const deploymentsWithArtifactId = deployments.map(dep => {
        const matchingArtifact = artifacts.find(a => {
          const deploymentImage = dep.artifactId?.split(':')[0];
          const deploymentTag = dep.artifactId?.split(':')[1];
          const artifactShortName = a.name?.split('/').pop()?.split(':')[0];
          const artifactTag = a.tag;
          return artifactShortName === deploymentImage && artifactTag === deploymentTag;
        });

        return {
          ...dep,
          artifactId: matchingArtifact?.id || dep.artifactId,
        };
      });

      const components = await sbomReconciliation.reconcileWithSBOM({
        artifacts,
        vulnerabilities,
        deployments: deploymentsWithArtifactId,
        sbomComponents: sbomComponentsMap,
      });

      return components;
    },
    staleTime: CACHE_TIME,
    refetchOnWindowFocus: false,
  });
}
