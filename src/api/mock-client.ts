/**
 * Mock API client for demo mode
 */

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
import {
  mockArtifacts,
  mockSBOMs,
  mockVulnerabilities,
  mockDeployments,
  mockServices,
  mockEnvironments,
  mockExemptions,
} from '@/lib/mock-data';

// Simulate network delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class MockAPIClient {
  async listArtifacts(
    _orgId: string,
    _projectId: string
  ): Promise<HarnessArtifact[]> {
    await delay(300);
    return [...mockArtifacts];
  }

  async listSBOMs(
    _orgId: string,
    _projectId: string,
    artifactId?: string
  ): Promise<HarnessSBOM[]> {
    await delay(200);
    if (artifactId) {
      return mockSBOMs.filter(sbom => sbom.artifactId === artifactId);
    }
    return [...mockSBOMs];
  }

  async listVulnerabilities(
    _orgId: string,
    _projectId: string,
    params?: { artifactId?: string; severity?: string }
  ): Promise<HarnessVulnerability[]> {
    await delay(400);
    let result = [...mockVulnerabilities];

    if (params?.artifactId) {
      result = result.filter(vuln => vuln.artifactId === params.artifactId);
    }

    if (params?.severity) {
      const severities = params.severity.split(',');
      result = result.filter(vuln => severities.includes(vuln.severity));
    }

    return result;
  }

  async listDeployments(
    _orgId: string,
    _projectId: string,
    params?: { serviceId?: string; envId?: string }
  ): Promise<HarnessDeployment[]> {
    await delay(250);
    let result = [...mockDeployments];

    if (params?.serviceId) {
      result = result.filter(deploy => deploy.serviceId === params.serviceId);
    }

    if (params?.envId) {
      result = result.filter(deploy => deploy.environmentId === params.envId);
    }

    return result;
  }

  async listOrganizations(): Promise<Array<{ identifier: string; name: string }>> {
    await delay(100);
    return [
      { identifier: 'demo', name: 'Demo Organization' },
      { identifier: 'default', name: 'Default Organization' },
    ];
  }

  async listProjects(_orgId: string): Promise<Array<{ identifier: string; name: string; orgIdentifier: string }>> {
    await delay(100);
    return [
      { identifier: 'Platform_Engineering', name: 'Platform Engineering', orgIdentifier: _orgId },
      { identifier: 'ProductTeam', name: 'Product Team', orgIdentifier: _orgId },
    ];
  }

  async listServices(
    _orgId: string,
    _projectId: string
  ): Promise<HarnessService[]> {
    await delay(150);
    return [...mockServices];
  }

  async listEnvironments(
    _orgId: string,
    _projectId: string
  ): Promise<HarnessEnvironment[]> {
    await delay(150);
    return [...mockEnvironments];
  }

  async listExemptions(
    _orgId: string,
    _projectId: string
  ): Promise<HarnessExemption[]> {
    await delay(100);
    return [...mockExemptions];
  }

  async getArtifactComponents(
    _orgId: string,
    _projectId: string,
    _sourceId: string,
    artifactId: string
  ): Promise<HarnessSBOMComponent[]> {
    await delay(200);

    // Return mock SBOM components for the artifact
    const mockComponents: HarnessSBOMComponent[] = [
      { name: 'log4j-core', version: '2.14.1', type: 'library' },
      { name: 'spring-boot', version: '2.7.0', type: 'library' },
      { name: 'jackson-databind', version: '2.13.0', type: 'library' },
      { name: 'netty-all', version: '4.1.77.Final', type: 'library' },
      { name: 'guava', version: '31.1-jre', type: 'library' },
      { name: 'commons-io', version: '2.11.0', type: 'library' },
      { name: 'slf4j-api', version: '1.7.36', type: 'library' },
      { name: 'logback-classic', version: '1.2.11', type: 'library' },
      { name: 'gson', version: '2.9.0', type: 'library' },
      { name: 'okhttp', version: '4.9.3', type: 'library' },
    ];

    return mockComponents;
  }
}

export const mockClient = new MockAPIClient();
