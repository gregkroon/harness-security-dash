/**
 * React hooks for SBOM component data
 */

import { useQuery } from '@tanstack/react-query';
import { harnessClient } from '@/api/harness-client';
import { sbomReconciliation, type SBOMComponent } from '@/lib/sbom-reconciliation';
import { config } from '@/lib/config';

const CACHE_TIME = config.app.cacheTtlMs;

export function useComponents(orgId: string, projectId: string) {
  return useQuery({
    queryKey: ['sbom-components', orgId, projectId],
    queryFn: async (): Promise<SBOMComponent[]> => {
      const [artifacts, vulnerabilities, deployments] =
        await Promise.all([
          harnessClient.listArtifacts(orgId, projectId).catch(() => []),
          harnessClient.listVulnerabilities(orgId, projectId).catch(() => []),
          harnessClient.listDeployments(orgId, projectId).catch(() => []),
        ]);

      // Match deployments to artifacts by image name + tag
      const deploymentsWithArtifactId = deployments.map(dep => {
        const matchingArtifact = artifacts.find(a => {
          const deploymentImage = dep.artifactId?.split(':')[0];
          const deploymentTag = dep.artifactId?.split(':')[1];
          const artifactShortName = a.name?.split('/').pop()?.split(':')[0];
          const artifactTag = a.tags?.[0];
          return artifactShortName === deploymentImage && artifactTag === deploymentTag;
        });

        return {
          ...dep,
          artifactId: matchingArtifact?.id || dep.artifactId,
        };
      });

      const components = sbomReconciliation.reconcile({
        artifacts,
        vulnerabilities,
        deployments: deploymentsWithArtifactId,
      });

      return components;
    },
    staleTime: CACHE_TIME,
    refetchOnWindowFocus: false,
  });
}
