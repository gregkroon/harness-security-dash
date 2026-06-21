import { useState, useEffect, useMemo } from 'react';
import { useExposures } from '@/hooks/useBackendData';

export function ExposuresPage() {
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [envFilter, setEnvFilter] = useState<'all' | 'prod' | 'non-prod'>('all');
  const [sortBy, setSortBy] = useState<'severity' | 'deployments' | 'services'>('severity');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch data
  const { data, isLoading, error } = useExposures({
    search: debouncedSearch,
    severity: severityFilter,
    envFilter,
    sortBy,
    page: currentPage,
    pageSize,
  });

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, severityFilter, envFilter, sortBy]);

  if (isLoading) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading component exposures...</div>
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

  const components = data?.components || [];
  const pagination = data?.pagination || { page: 1, page_size: 50, total: 0, total_pages: 0 };

  const severityCounts = useMemo(() => {
    // This would need a separate stats endpoint or be included in the response
    return {
      critical: 0,
      high: 0,
      medium: 0,
    };
  }, []);

  const toggleSeverity = (severity: string) => {
    setSeverityFilter(prev =>
      prev.includes(severity)
        ? prev.filter(s => s !== severity)
        : [...prev, severity]
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Component Exposures</h1>
        <p className="mt-2 text-sm text-gray-600">
          Vulnerable packages and libraries across your services
        </p>
      </div>

      {/* Filters */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
        <div className="space-y-4">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search (e.g., "log4j", "spring", package name, or CVE)
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Package name..."
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
            />
          </div>

          {/* Severity Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Severity</label>
            <div className="flex gap-2">
              {['critical', 'high', 'medium'].map((severity) => (
                <button
                  key={severity}
                  onClick={() => toggleSeverity(severity)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    severityFilter.includes(severity)
                      ? severity === 'critical'
                        ? 'bg-red-600 text-white'
                        : severity === 'high'
                        ? 'bg-orange-600 text-white'
                        : 'bg-yellow-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {severity.charAt(0).toUpperCase() + severity.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Environment & Sort */}
          <div className="grid grid-cols-2 gap-4">
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
              >
                <option value="severity">Severity</option>
                <option value="deployments">Deployments</option>
                <option value="services">Services</option>
              </select>
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

      {/* Results Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Package</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vulnerabilities</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Services</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deployments</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {components.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No vulnerable components found
                  </td>
                </tr>
              ) : (
                components.map((comp: any) => {
                  const severityCounts = {
                    critical: comp.vulnerabilities.filter((v: any) => v.severity === 'critical').length,
                    high: comp.vulnerabilities.filter((v: any) => v.severity === 'high').length,
                    medium: comp.vulnerabilities.filter((v: any) => v.severity === 'medium').length,
                  };

                  return (
                    <tr key={`${comp.package}-${comp.version}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-mono text-sm font-medium text-gray-900">{comp.package}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-sm text-gray-700">{comp.version}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            comp.highestSeverity === 'critical'
                              ? 'bg-red-100 text-red-800'
                              : comp.highestSeverity === 'high'
                              ? 'bg-orange-100 text-orange-800'
                              : comp.highestSeverity === 'medium'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {comp.highestSeverity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {severityCounts.critical > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                              {severityCounts.critical} Critical
                            </span>
                          )}
                          {severityCounts.high > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                              {severityCounts.high} High
                            </span>
                          )}
                          {severityCounts.medium > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                              {severityCounts.medium} Medium
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{comp.uniqueServices}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {comp.totalCurrentDeployments}
                        {comp.hasProduction && <span className="ml-1 text-red-600">🔴</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.total_pages > 1 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(pagination.total_pages, p + 1))}
                disabled={currentPage === pagination.total_pages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Page <span className="font-medium">{pagination.page}</span> of{' '}
                  <span className="font-medium">{pagination.total_pages}</span>
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(pagination.total_pages, p + 1))}
                    disabled={currentPage === pagination.total_pages}
                    className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setCurrentPage(pagination.total_pages)}
                    disabled={currentPage === pagination.total_pages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Last
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
