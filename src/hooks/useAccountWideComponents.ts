/**
 * React hook for fetching components across ALL orgs and projects in the account
 * Used for account-wide zero-day component search
 */

import { useQuery } from '@tanstack/react-query';
import { harnessClient } from '@/api/harness-client';
import { sbomReconciliation, type SBOMComponent } from '@/lib/sbom-reconciliation';
import { config } from '@/lib/config';

const CACHE_TIME = config.app.cacheTtlMs;

export function useAccountWideComponents() {
  return useQuery({
    queryKey: ['account-wide-components'],
    queryFn: async (): Promise<SBOMComponent[]> => {
      console.log('🌍 Fetching components from ALL orgs and projects...');

      // Step 1: Get all orgs
      const orgs = await harnessClient.listOrganizations();
      console.log(`✓ Found ${orgs.length} organizations`);

      // Create org name map
      const orgNameMap = new Map(orgs.map(o => [o.identifier, o.name]));

      // Step 2: Get all projects across all orgs
      const projectPromises = orgs.map(org =>
        harnessClient.listProjects(org.identifier)
      );
      const projectResults = await Promise.all(projectPromises);
      const allProjects = projectResults.flat();
      console.log(`✓ Found ${allProjects.length} projects across all orgs`);

      // Step 3: Fetch data from each project in parallel
      const projectDataPromises = allProjects.map(async (project) => {
        try {
          console.log(`📦 Fetching data for ${project.orgIdentifier}/${project.identifier}...`);

          const [artifacts, vulnerabilities, deployments] = await Promise.all([
            harnessClient.listArtifacts(project.orgIdentifier, project.identifier).catch(() => []),
            harnessClient.listVulnerabilities(project.orgIdentifier, project.identifier).catch(() => []),
            harnessClient.listDeployments(project.orgIdentifier, project.identifier).catch(() => []),
          ]);

          // Match deployments to artifacts
          let matchedCount = 0;
          let unmatchedCount = 0;

          const deploymentsWithArtifactId = deployments.map(dep => {
            const matchingArtifact = artifacts.find(a => {
              const deploymentImage = dep.artifactId?.split(':')[0];
              const deploymentTag = dep.artifactId?.split(':')[1];
              const artifactShortName = a.name?.split('/').pop()?.split(':')[0];
              const artifactTag = (a as any).tags?.[0] || a.tag; // Try tags array first
              return artifactShortName === deploymentImage && artifactTag === deploymentTag;
            });

            if (matchingArtifact) {
              matchedCount++;
            } else {
              unmatchedCount++;
              // Debug first unmapped deployment per project
              if (unmatchedCount === 1) {
                console.log('[%s/%s] Failed to match deployment:', String(project.orgIdentifier), String(project.identifier), {
                  deploymentArtifactId: dep.artifactId,
                  deploymentImage: dep.artifactId?.split(':')[0],
                  deploymentTag: dep.artifactId?.split(':')[1],
                  totalArtifacts: artifacts.length,
                  sampleArtifact: artifacts[0] ? {
                    name: artifacts[0].name,
                    tag: artifacts[0].tag,
                    tags: (artifacts[0] as any).tags,
                    id: artifacts[0].id
                  } : null,
                });
              }
            }

            return {
              ...dep,
              artifactId: matchingArtifact?.id || dep.artifactId,
              orgId: project.orgIdentifier,
              orgName: orgNameMap.get(project.orgIdentifier) || project.orgIdentifier,
              projectId: project.identifier,
              projectName: project.name,
            };
          });

          if (deployments.length > 0) {
            console.log(`📊 [${project.orgIdentifier}/${project.identifier}] Matched ${matchedCount}/${deployments.length} deployments to artifacts`);
          }

          return {
            project,
            artifacts,
            vulnerabilities,
            deployments: deploymentsWithArtifactId,
          };
        } catch (error) {
          console.warn('Failed to fetch data for %s/%s:', String(project.orgIdentifier), String(project.identifier), error);
          return null;
        }
      });

      const projectDataResults = await Promise.all(projectDataPromises);
      const validProjectData = projectDataResults.filter(Boolean) as any[];

      console.log(`✓ Successfully fetched data from ${validProjectData.length} projects`);

      // Step 4: Merge all data and reconcile
      const allArtifacts = validProjectData.flatMap(pd => pd.artifacts);
      const allVulnerabilities = validProjectData.flatMap(pd => pd.vulnerabilities);
      const allDeployments = validProjectData.flatMap(pd => pd.deployments);

      console.log(`✓ Total across account: ${allArtifacts.length} artifacts, ${allVulnerabilities.length} vulnerabilities, ${allDeployments.length} deployments`);

      // Debug: Check deployment data
      const deploymentsWithEnv = allDeployments.filter(d => d.envName);
      console.log(`📍 Deployments with environment info: ${deploymentsWithEnv.length}/${allDeployments.length}`);
      if (deploymentsWithEnv.length > 0) {
        console.log(`📍 Sample deployment:`, deploymentsWithEnv[0]);
      }

      const components = sbomReconciliation.reconcile({
        artifacts: allArtifacts,
        vulnerabilities: allVulnerabilities,
        deployments: allDeployments,
      });

      console.log(`✓ Built ${components.length} unique components across entire account`);

      // Debug: Check if components have deployments
      const componentsWithDeployments = components.filter(c => c.currentDeployments.length > 0);
      console.log(`📍 Components with deployments: ${componentsWithDeployments.length}/${components.length}`);

      return components;
    },
    staleTime: CACHE_TIME,
    refetchOnWindowFocus: false,
    // Longer timeout for account-wide fetch
    retry: 1,
  });
}
