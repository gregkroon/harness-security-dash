/**
 * Component Search Page - Matches OLD SPA spec exactly
 */

import { useState, useEffect } from 'react';
import { useBackendComponents, useBackendStats } from '@/hooks/useBackendComponents';

export function ComponentSearchPage() {
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [envFilter, setEnvFilter] = useState<'all' | 'prod' | 'non-prod'>('all');
  const [vulnerableOnly, setVulnerableOnly] = useState(false);
  const [scaOnly, setScaOnly] = useState(true);
  const [deployedOnly, setDeployedOnly] = useState(true); // Default to deployed libraries only
  const [hideContainers, setHideContainers] = useState(true); // Default to hide container images
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch data from backend
  const { data: componentsData, isLoading, error } = useBackendComponents({
    search: debouncedSearch,
    deployedOnly,
    scaOnly,
    vulnerableOnly,
    envFilter,
    hideContainers,
    page: currentPage,
    pageSize,
  });

  const { data: stats } = useBackendStats();

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, envFilter, vulnerableOnly, scaOnly, deployedOnly, hideContainers]);

  if (isLoading) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading component inventory...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="text-red-600">Error loading components: {(error as Error).message}</div>
      </div>
    );
  }

  const components = componentsData?.components || [];
  const pagination = componentsData?.pagination || { page: 1, page_size: 50, total: 0, total_pages: 0 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Component Search
          <span className="ml-3 text-sm font-normal text-blue-600">🌍 Account-wide</span>
        </h1>
        <p className="text-gray-600 mb-4">
          Search your entire software bill of materials (SBOM) across all organizations and projects for zero-day incident response
        </p>

        {/* Summary Stats */}
        <div className="grid grid-cols-6 gap-4">
          <div>
            <div className="text-sm text-gray-500">Total Components</div>
            <div className="text-2xl font-bold text-gray-900">{stats?.total_components || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">With Vulnerabilities</div>
            <div className="text-2xl font-bold text-orange-600">{stats?.vulnerable_components || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">In Production</div>
            <div className="text-2xl font-bold text-blue-600">{stats?.in_production || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Organizations</div>
            <div className="text-2xl font-bold text-indigo-600">{stats?.total_orgs || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Projects</div>
            <div className="text-2xl font-bold text-cyan-600">{stats?.total_projects || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Services</div>
            <div className="text-2xl font-bold text-purple-600">{stats?.total_services || 0}</div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Search Components</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Package Name (e.g., "log4j", "spring-core", "axios")
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search any package..."
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-lg px-4 py-3"
              autoFocus
            />
            {searchTerm && (
              <div className="mt-2 text-sm text-gray-600">
                Found {pagination.total} matching component{pagination.total !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Environment</label>
              <select
                value={envFilter}
                onChange={(e) => setEnvFilter(e.target.value as any)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              >
                <option value="all">All Environments</option>
                <option value="prod">Production Only</option>
                <option value="non-prod">Non-Prod Only</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={deployedOnly}
                  onChange={(e) => setDeployedOnly(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700 font-medium">Deployed Only</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={scaOnly}
                  onChange={(e) => setScaOnly(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">Libraries Only (SCA)</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={vulnerableOnly}
                  onChange={(e) => setVulnerableOnly(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">Vulnerable Only</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={hideContainers}
                  onChange={(e) => setHideContainers(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">Hide Container Images</span>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {Math.min((pagination.page - 1) * pagination.page_size + 1, pagination.total)}-
            {Math.min(pagination.page * pagination.page_size, pagination.total)} of {pagination.total} components
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Per page:</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results Table - EXACTLY matches old spec */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Package
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Version
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Vulnerabilities
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Org / Project
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Services
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Environments
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {components.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    {searchTerm ? (
                      <div>
                        <div className="text-lg font-medium mb-1">No matches found for "{searchTerm}"</div>
                        <div className="text-sm">Try a different search term or remove filters</div>
                      </div>
                    ) : (
                      'No components found'
                    )}
                  </td>
                </tr>
              ) : (
                components.map((component: any) => {
                  const criticalCount = component.vulnerabilities?.filter((v: any) => v.severity === 'critical').length || 0;
                  const highCount = component.vulnerabilities?.filter((v: any) => v.severity === 'high').length || 0;
                  const uniqueOrgProjects = Array.from(new Set(
                    (component.currentDeployments || []).map((d: any) =>
                      `${d.orgName || d.orgId}/${d.projectName || d.projectId}`
                    )
                  ));
                  const uniqueServiceNames = Array.from(new Set(
                    (component.currentDeployments || []).map((d: any) => d.serviceName)
                  ));

                  // Generate Harness URL to view this component
                  const getComponentUrl = () => {
                    if (!component.inArtifacts || component.inArtifacts.length === 0) return null;
                    const artifact = component.inArtifacts[0];
                    if (!artifact.sourceId || !artifact.artifactId) return null;

                    const deployment = component.currentDeployments?.[0];
                    if (!deployment?.orgId || !deployment?.projectId) return null;

                    // Use the PURL from the SBOM if available, otherwise generate it
                    let purl = component.purl;

                    if (!purl) {
                      // Fallback: Generate PURL if not provided by SBOM
                      const pkgName = component.package;
                      const version = component.version;

                      // Detect package type based on name patterns
                      if (pkgName.startsWith('@') || (pkgName.includes('/') && !pkgName.includes(':'))) {
                        purl = `pkg:npm/${pkgName}@${version}`;
                      } else if (pkgName.includes(':')) {
                        const parts = pkgName.split(':');
                        purl = `pkg:maven/${parts[0]}/${parts[1]}@${version}`;
                      } else {
                        purl = `pkg:deb/debian/${pkgName}@${version}`;
                      }
                    }

                    // Note: PURL encoding - Harness requires double-encoding for special characters
                    // 1. '+' signs in versions: %2B → %252B
                    // 2. '@' in npm scoped packages: %40 → %2540 (but only in package name, not version separator)
                    let encodedPurl = encodeURIComponent(purl)
                      .replace(/%2B/g, '%252B')  // Double-encode + signs
                      .replace(/(npm%2F)%40/g, '$1%2540');  // Double-encode @ in npm scopes only

                    const baseUrl = 'https://app.harness.io';
                    const accountId = 'EeRjnXTnS4GrLG5VNNJZUw';

                    return `${baseUrl}/ng/account/${accountId}/module/ssca/orgs/${deployment.orgId}/projects/${deployment.projectId}/artifact-sources/${artifact.sourceId}/artifacts/${artifact.artifactId}/details/dependencies?purl=${encodedPurl}`;
                  };

                  const componentUrl = getComponentUrl();

                  return (
                    <tr key={`${component.package}@${component.version}`} className="hover:bg-gray-50">
                      {/* Package */}
                      <td className="px-4 py-4">
                        {componentUrl ? (
                          <a
                            href={componentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-blue-600 hover:text-blue-800 underline break-all"
                            title="View in Harness SSCA"
                          >
                            {component.package}
                          </a>
                        ) : (
                          <div className="text-sm font-medium text-gray-900 break-all">
                            {component.package}
                          </div>
                        )}
                      </td>

                      {/* Version */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{component.version}</div>
                      </td>

                      {/* Vulnerabilities - EXACTLY as old spec */}
                      <td className="px-4 py-4">
                        {component.vulnerabilities && component.vulnerabilities.length > 0 ? (
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                component.highestSeverity === 'critical' ? 'bg-red-100 text-red-800' :
                                component.highestSeverity === 'high' ? 'bg-orange-100 text-orange-800' :
                                component.highestSeverity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {component.highestSeverity}
                              </span>
                              <span className="text-xs text-gray-500">
                                {component.vulnerabilities.length} CVE{component.vulnerabilities.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            {(criticalCount > 0 || highCount > 0) && (
                              <div className="text-xs mt-1 space-y-0.5">
                                {criticalCount > 0 && (
                                  <div className="text-red-600">🔴 {criticalCount} critical</div>
                                )}
                                {highCount > 0 && (
                                  <div className="text-orange-600">🟠 {highCount} high</div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-green-600">✓ None</span>
                        )}
                      </td>

                      {/* Org / Project - EXACTLY as old spec */}
                      <td className="px-4 py-4">
                        <div className="text-xs text-gray-500 space-y-1 max-h-20 overflow-y-auto">
                          {component.currentDeployments?.length === 0 || !component.currentDeployments ? (
                            <div className="text-gray-400">No deployments</div>
                          ) : (
                            <>
                              {uniqueOrgProjects.slice(0, 5).map((orgProject: string, idx: number) => (
                                <div key={idx}>{orgProject}</div>
                              ))}
                              {uniqueOrgProjects.length > 5 && (
                                <div className="text-gray-400">+{uniqueOrgProjects.length - 5} more</div>
                              )}
                            </>
                          )}
                        </div>
                      </td>

                      {/* Services - EXACTLY as old spec */}
                      <td className="px-4 py-4">
                        <div className="text-sm text-gray-900">
                          {component.uniqueServices || 0}
                        </div>
                        <div className="text-xs text-gray-500 max-h-16 overflow-y-auto">
                          {uniqueServiceNames.slice(0, 3).join(', ')}
                          {component.uniqueServices > 3 && ` +${component.uniqueServices - 3}`}
                        </div>
                      </td>

                      {/* Environments - EXACTLY as old spec */}
                      <td className="px-4 py-4">
                        <div className="text-sm text-gray-900">
                          {component.uniqueEnvironments || 0}
                        </div>
                        <div className="text-xs text-gray-500 space-y-0.5 max-h-20 overflow-y-auto">
                          {(component.currentDeployments || []).slice(0, 3).map((dep: any) => (
                            <div key={`${dep.serviceId}-${dep.envId}`}>
                              {dep.envType === 'Production' ? '🔴' : '🔵'} {dep.envName}
                            </div>
                          ))}
                          {(component.currentDeployments || []).length > 3 && (
                            <div className="text-gray-400">+{(component.currentDeployments || []).length - 3} more</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination - Simple like old spec */}
        {pagination.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">
                Page {currentPage} of {pagination.total_pages}
              </span>
            </div>

            <button
              onClick={() => setCurrentPage(p => Math.min(pagination.total_pages, p + 1))}
              disabled={currentPage === pagination.total_pages}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Help Text */}
      <div className="card bg-blue-50 border-blue-200">
        <div className="flex">
          <div className="flex-shrink-0">💡</div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">Zero-Day Response</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                Use this page to quickly search for any component when a zero-day vulnerability is announced.
                For example, search for "log4j", "spring", "openssl", or any library name to see all versions
                deployed across your services and environments.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Core Principle */}
      <div className="card bg-yellow-50 border-yellow-200">
        <p className="text-sm text-yellow-800">
          <strong>Core Principle:</strong> Never show "safe" when data is missing. Absence of evidence must be shown as a risk state, not as green status.
        </p>
      </div>
    </div>
  );
}
