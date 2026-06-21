import { useState } from 'react';
import { useDashboard } from '@/hooks/useBackendData';

export function DashboardPage() {
  const [showInstrumented, setShowInstrumented] = useState(false);
  const { data, isLoading, error } = useDashboard();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card bg-danger-50 border-danger-200">
        <h3 className="text-lg font-semibold text-danger-700 mb-2">Error Loading Data</h3>
        <p className="text-danger-600">{(error as Error).message}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Security Dashboard</h1>
        <p className="mt-2 text-sm text-gray-600">
          Verified production exposure and measured blindness
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className={`card ${data.coverage.coveragePercentage < 80 ? 'border-warning-300 bg-warning-50' : ''}`}>
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-danger-100 rounded-lg flex items-center justify-center">
                <span className="text-2xl">🔴</span>
              </div>
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  Critical in Production
                </dt>
                <dd className="flex items-baseline">
                  <div className="text-3xl font-bold text-danger-700">
                    {data.criticalInProduction}
                  </div>
                  {data.coverage.coveragePercentage < 80 && (
                    <span className="ml-2 text-sm font-medium text-warning-600">
                      ({data.coverage.coveragePercentage}% visibility)
                    </span>
                  )}
                </dd>
              </dl>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            Critical severity vulnerabilities deployed
            {data.coverage.coveragePercentage < 80 && (
              <span className="block mt-1 text-warning-700 font-medium">
                ⚠️ Low coverage - actual count may be higher
              </span>
            )}
          </div>
        </div>

        <div className="card border-warning-300 bg-warning-50">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <span className="text-2xl">🟠</span>
              </div>
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  High in Production
                </dt>
                <dd className="flex items-baseline">
                  <div className="text-3xl font-bold text-orange-700">
                    {data.highInProduction}
                  </div>
                </dd>
              </dl>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            High severity vulnerabilities deployed
          </div>
        </div>

        <div className={`card ${data.coverage.coveragePercentage < 50 ? 'border-danger-300 bg-danger-50' : data.coverage.coveragePercentage < 80 ? 'border-warning-300 bg-warning-50' : 'border-success-300 bg-success-50'}`}>
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${data.coverage.coveragePercentage < 50 ? 'bg-danger-100' : data.coverage.coveragePercentage < 80 ? 'bg-warning-100' : 'bg-success-100'}`}>
                <span className="text-2xl">📊</span>
              </div>
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  Coverage
                </dt>
                <dd className="flex items-baseline">
                  <div className={`text-3xl font-bold ${data.coverage.coveragePercentage < 50 ? 'text-danger-700' : data.coverage.coveragePercentage < 80 ? 'text-warning-700' : 'text-success-700'}`}>
                    {data.coverage.coveragePercentage}%
                  </div>
                </dd>
              </dl>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            {data.coverage.servicesWithDeployments} / {data.coverage.totalServices} services instrumented
          </div>
        </div>
      </div>

      {/* Top Actions */}
      {data.topActions.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Top Priority Actions
          </h2>
          <div className="space-y-3">
            {data.topActions.map((action: any, idx: number) => {
              const priorityColor = action.priority === 1 ? 'bg-danger-600' : action.priority === 2 ? 'bg-warning-600' : 'bg-primary-600';

              return (
                <div
                  key={idx}
                  className={`flex items-start p-4 bg-gray-50 rounded-lg border-2 ${
                    action.priority === 1 ? 'border-danger-300' : action.priority === 2 ? 'border-warning-300' : 'border-gray-200'
                  }`}
                >
                  <div className="flex-shrink-0">
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${priorityColor} text-white text-sm font-bold`}>
                      {action.priority}
                    </span>
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="text-sm font-medium text-gray-900">{action.title}</h3>
                    <p className="mt-1 text-sm text-gray-600">{action.description}</p>
                    <p className="mt-2 text-xs text-gray-500">
                      Service: {action.serviceName}
                      {action.cveId && ` • CVE: ${action.cveId}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Services List */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Services ({data.coverage.instrumentedServices.length})
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInstrumented(!showInstrumented)}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              {showInstrumented ? 'Show Summary' : 'Show Details'}
            </button>
          </div>
        </div>

        {showInstrumented && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Service</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Deployments</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Environments</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Production</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.coverage.instrumentedServices.map((svc: any) => (
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

        {!showInstrumented && (
          <div className="text-sm text-gray-600">
            All {data.coverage.instrumentedServices.length} services have deployment tracking enabled.
            Click "Show Details" to see the full list.
          </div>
        )}
      </div>
    </div>
  );
}
