import { useState } from 'react';
import { useCoverage } from '@/hooks/useBackendData';
import { useBackendStats, useBackendComponents } from '@/hooks/useBackendComponents';

export function CoveragePage() {
  const { data: coverage, isLoading, error } = useCoverage();
  const { data: stats } = useBackendStats();
  const { data: componentsData } = useBackendComponents({ page: 1, pageSize: 1000, hideContainers: true });

  // Extract unique org and project names from component data
  const orgProjectMap = new Map<string, Set<string>>();

  if (componentsData?.components) {
    componentsData.components.forEach((comp: any) => {
      const data = comp.data || comp;
      if (data.currentDeployments) {
        data.currentDeployments.forEach((dep: any) => {
          const orgName = dep.orgName || dep.orgId || 'Unknown';
          const projectName = dep.projectName || dep.projectId || 'Unknown';

          if (!orgProjectMap.has(orgName)) {
            orgProjectMap.set(orgName, new Set());
          }
          orgProjectMap.get(orgName)!.add(projectName);
        });
      }
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading coverage data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card bg-danger-50 border-danger-200">
        <h3 className="text-lg font-semibold text-danger-700 mb-2">Error Loading Coverage Data</h3>
        <p className="text-danger-600">{(error as Error).message}</p>
      </div>
    );
  }

  if (!coverage) return null;

  const instrumentedServices = coverage.totalServices - coverage.uninstrumentedServices.length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Coverage & Blind Spots</h1>
        <p className="mt-2 text-sm text-gray-600">
          Complete service inventory and instrumentation status
        </p>
      </div>

      {/* Scope Overview */}
      <div className="card bg-blue-50 border-blue-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Coverage Scope</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-sm font-medium text-gray-500 mb-1">Organizations</div>
            <div className="text-2xl font-bold text-blue-700">{stats?.total_orgs || 0}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500 mb-1">Projects</div>
            <div className="text-2xl font-bold text-blue-700">{stats?.total_projects || 0}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-500 mb-1">Services</div>
            <div className="text-2xl font-bold text-blue-700">{stats?.total_services || 0}</div>
          </div>
        </div>
        <div className="text-xs text-gray-600 mt-3">
          Tracking {stats?.total_components || 0} components across {stats?.total_orgs || 0} orgs and {stats?.total_projects || 0} projects
        </div>
      </div>

      {/* Coverage Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card">
          <div className="text-sm font-medium text-gray-500 mb-2">Total Services</div>
          <div className="text-3xl font-bold text-gray-900">{coverage.totalServices}</div>
          <div className="text-xs text-gray-500 mt-1">In Harness inventory</div>
        </div>

        <div className="card bg-success-50 border-success-200">
          <div className="text-sm font-medium text-gray-500 mb-2">✅ Instrumented</div>
          <div className="text-3xl font-bold text-success-700">{instrumentedServices}</div>
          <div className="text-xs text-gray-500 mt-1">With deployment tracking</div>
        </div>

        <div
          className={`card ${
            coverage.coveragePercentage < 50
              ? 'bg-danger-50 border-danger-200'
              : 'bg-warning-50 border-warning-200'
          }`}
        >
          <div className="text-sm font-medium text-gray-500 mb-2">❌ Blind Spots</div>
          <div
            className={`text-3xl font-bold ${
              coverage.coveragePercentage < 50 ? 'text-danger-700' : 'text-warning-700'
            }`}
          >
            {coverage.uninstrumentedServices.length}
          </div>
          <div className="text-xs text-gray-500 mt-1">No visibility</div>
        </div>

        <div
          className={`card ${
            coverage.coveragePercentage < 50
              ? 'bg-danger-50 border-danger-200'
              : coverage.coveragePercentage < 80
              ? 'bg-warning-50 border-warning-200'
              : 'bg-success-50 border-success-200'
          }`}
        >
          <div className="text-sm font-medium text-gray-500 mb-2">Coverage</div>
          <div
            className={`text-3xl font-bold ${
              coverage.coveragePercentage < 50
                ? 'text-danger-700'
                : coverage.coveragePercentage < 80
                ? 'text-warning-700'
                : 'text-success-700'
            }`}
          >
            {coverage.coveragePercentage}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {coverage.coveragePercentage < 50
              ? 'Critical'
              : coverage.coveragePercentage < 80
              ? 'Needs improvement'
              : 'Good'}
          </div>
        </div>
      </div>

      {/* Organizations and Projects List */}
      {orgProjectMap.size > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Organizations & Projects Monitored
          </h2>
          <div className="space-y-4">
            {Array.from(orgProjectMap.entries()).map(([orgName, projects]) => (
              <div key={orgName} className="border-l-4 border-primary-500 pl-4">
                <h3 className="font-semibold text-gray-900 mb-2">
                  {orgName}
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({projects.size} {projects.size === 1 ? 'project' : 'projects'})
                  </span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {Array.from(projects).map((projectName) => (
                    <span
                      key={projectName}
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-100 text-primary-800"
                    >
                      {projectName}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Org/Project Breakdown */}
      {stats && coverage && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Coverage by Scope</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Organizations monitored:</span>
                <span className="font-semibold text-gray-900">{stats.total_orgs}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Projects tracked:</span>
                <span className="font-semibold text-gray-900">{stats.total_projects}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Services discovered:</span>
                <span className="font-semibold text-gray-900">{coverage.totalServices}</span>
              </div>
              <div className="flex justify-between border-t pt-2 mt-2">
                <span className="text-gray-600">Services instrumented:</span>
                <span className="font-semibold text-success-700">{coverage.instrumentedServices.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Services w/o SBOM:</span>
                <span className="font-semibold text-danger-700">{coverage.uninstrumentedServices.length}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Component Inventory</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total components:</span>
                <span className="font-semibold text-gray-900">{stats.total_components}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">In production:</span>
                <span className="font-semibold text-gray-900">{stats.in_production}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">With vulnerabilities:</span>
                <span className="font-semibold text-danger-700">{stats.vulnerable_components}</span>
              </div>
              <div className="flex justify-between border-t pt-2 mt-2">
                <span className="text-gray-600">Coverage percentage:</span>
                <span className={`font-semibold ${
                  coverage.coveragePercentage >= 80 ? 'text-success-700' :
                  coverage.coveragePercentage >= 50 ? 'text-warning-700' : 'text-danger-700'
                }`}>
                  {coverage.coveragePercentage}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Core Principle Alert */}
      {coverage.coveragePercentage < 100 && (
        <div className="card bg-danger-50 border-danger-300">
          <div className="flex">
            <div className="flex-shrink-0">
              <span className="text-2xl">⚠️</span>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-danger-800">Core Principle Violation</h3>
              <div className="mt-2 text-sm text-danger-700">
                <p>
                  <strong>Never show "safe" when data is missing.</strong> You have{' '}
                  {coverage.uninstrumentedServices.length} services with <strong>zero visibility</strong>.
                  These are blind spots where vulnerabilities could exist undetected.
                </p>
                <p className="mt-2">
                  Until all services are instrumented, your security posture is <strong>unknown</strong>,
                  not "safe".
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Instrumented Services */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          ✅ Instrumented Services ({coverage.instrumentedServices.length})
        </h2>
        {coverage.instrumentedServices.length === 0 ? (
          <p className="text-gray-500 italic">No instrumented services</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Service
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Deployments
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Environments
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Production
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {coverage.instrumentedServices.map((svc: any) => (
                  <tr key={svc.serviceId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{svc.serviceName}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{svc.deploymentCount}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{svc.environmentCount}</td>
                    <td className="px-4 py-3 text-sm">
                      {svc.hasProduction ? (
                        <span className="text-success-600">✓ Yes</span>
                      ) : (
                        <span className="text-gray-400">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Uninstrumented Services */}
      {coverage.uninstrumentedServices.length > 0 && (
        <div className="card bg-danger-50 border-danger-300">
          <h2 className="text-lg font-semibold text-danger-900 mb-4">
            ❌ Blind Spots - Uninstrumented Services ({coverage.uninstrumentedServices.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-danger-200">
              <thead className="bg-danger-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-danger-900 uppercase">
                    Service
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-danger-900 uppercase">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-danger-200">
                {coverage.uninstrumentedServices.map((svc: any) => (
                  <tr key={svc.serviceId} className="hover:bg-danger-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{svc.serviceName}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{svc.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
