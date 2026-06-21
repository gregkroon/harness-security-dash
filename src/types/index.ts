/**
 * Core domain types for Harness Security Dashboard
 */

// ============================================================================
// Harness API Types
// ============================================================================

export interface HarnessArtifact {
  id: string;
  name: string;
  registry: string;
  repository: string;
  digest: string;
  tag?: string;
  type: string;
  createdAt: number;
  sourceId?: string; // Added for URL generation
}

export interface HarnessSBOM {
  id: string;
  artifactId: string;
  format: 'spdx' | 'cyclonedx';
  version: string;
  tool: string;
  createdAt: number;
  components?: HarnessSBOMComponent[];
}

export interface HarnessSBOMComponent {
  name: string;
  version: string;
  purl?: string;
  cpe?: string;
  license?: string;
  type: string;
}

export interface HarnessVulnerability {
  id: string;
  cveId: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  cvssScore?: number;
  cvssVector?: string;
  epssScore?: number;
  epssPercentile?: number;
  description: string;
  publishedDate: number;
  componentName?: string;
  componentVersion?: string;
  artifactId?: string;
  findingType?: string; // SAST, SCA, DAST, IaC, Secret, etc.
}

export interface HarnessDeployment {
  artifactId: string;
  digest: string;
  serviceId: string;
  serviceName: string;
  envId: string;
  envName: string;
  envType: 'Production' | 'PreProduction';
  executionId: string;
  deployedAt: number;
  status: string;
}

export interface HarnessService {
  identifier: string;
  orgIdentifier: string;
  projectIdentifier: string;
  name: string;
  description?: string;
  tags?: Record<string, string>;
}

export interface HarnessEnvironment {
  identifier: string;
  orgIdentifier: string;
  projectIdentifier: string;
  name: string;
  type: 'Production' | 'PreProduction';
}

export interface HarnessExemption {
  id: string;
  cveId?: string;
  status: 'active' | 'expired' | 'revoked';
  approvedBy: string;
  approvedAt: number;
  expiresAt?: number;
  reason: string;
}

// ============================================================================
// Dashboard Domain Types
// ============================================================================

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown';
export type Confidence = 'verified' | 'partial' | 'unknown';
export type DeploymentConfidence = 'runtime_verified' | 'harness_record_only' | 'unknown';

export interface ExposureItem {
  id: string;
  cveId: string;
  severity: Severity;
  cvssScore?: number;
  epssScore?: number;
  epssPercentile?: number;
  isKev: boolean;
  kevDueDate?: string;

  // Artifact info
  artifactId: string; // Real artifact ID for linking
  artifactDigest: string;
  artifactName: string;
  artifactRegistry: string;
  artifactSourceId?: string;
  pipelineId?: string;

  // Component info
  componentName: string;
  componentVersion: string;

  // Service info
  serviceId: string;
  serviceName: string;
  ownerTeam?: string;
  ownerConfidence: Confidence;

  // Environment info
  environmentId: string;
  environmentName: string;
  environmentType: 'Production' | 'PreProduction';

  // Deployment info
  deploymentConfidence: DeploymentConfidence;
  deployedAt: string;

  // Control info
  hasExemption: boolean;
  exemptionStatus?: 'active' | 'expired' | 'revoked';
  exemptionExpiresAt?: string;

  // Metadata
  hasSbom: boolean;
  dataFreshness: string;
  findingType?: string; // SAST, SCA, DAST, IaC, Secret, etc.
}

export interface CoverageSummary {
  totalServices: number;
  servicesWithSbom: number;
  servicesWithDeployments: number;
  uninstrumentedServices: UninstrumentedService[];
  instrumentedServices: InstrumentedService[];
  coveragePercentage: number;
}

export interface UninstrumentedService {
  serviceId: string;
  serviceName: string;
  reason: string;
}

export interface InstrumentedService {
  serviceId: string;
  serviceName: string;
  deploymentCount: number;
  environmentCount: number;
  hasProduction: boolean;
  hasSBOM: boolean;
  sbomCoverage: number; // Percentage of deployments with SBOM
}

export interface TopAction {
  priority: number;
  type: 'critical_low_coverage' | 'warning_low_coverage' | 'critical_expired_waiver' | 'missing_sbom' | 'unknown_owner';
  title: string;
  description: string;
  serviceId: string;
  serviceName: string;
  cveId?: string;
}

export interface DashboardOverview {
  criticalInProduction: number;
  highInProduction: number;
  coverage: CoverageSummary;
  topActions: TopAction[];
  dataFreshness: {
    lastFetchedAt: string;
    source: 'cache' | 'live';
  };
}

export interface FilterOptions {
  severity?: Severity[];
  environmentType?: ('Production' | 'PreProduction')[];
  kevOnly?: boolean;
  hasExemption?: boolean;
  serviceId?: string;
  search?: string;
}
