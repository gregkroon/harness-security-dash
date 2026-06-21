/**
 * Org and Project selector component
 */

import { useState, useEffect } from 'react';
import { config } from '@/lib/config';

interface OrgProjectSelectorProps {
  selectedOrg: string;
  selectedProject: string;
  onOrgChange: (org: string) => void;
  onProjectChange: (project: string) => void;
}

interface Org {
  identifier: string;
  name?: string;
}

interface Project {
  identifier: string;
  name?: string;
}

export function OrgProjectSelector({
  selectedOrg,
  selectedProject,
  onOrgChange,
  onProjectChange,
}: OrgProjectSelectorProps) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch organizations on mount
  useEffect(() => {
    if (config.app.demoMode) {
      setOrgs([{ identifier: 'default', name: 'Default Org' }]);
      setProjects([{ identifier: 'default', name: 'Default Project' }]);
      setLoading(false);
      return;
    }

    const fetchOrgs = async () => {
      try {
        const baseUrl = config.harness.useProxy ? '/api/harness' : config.harness.baseUrl;
        const url = `${baseUrl}/ng/api/organizations?accountIdentifier=${config.harness.accountId}`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (!config.harness.useProxy) {
          headers['x-api-key'] = config.harness.apiKey;
          headers['Harness-Account'] = config.harness.accountId;
        }

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error('Failed to fetch organizations');

        const data = await response.json();
        const orgList = data.data?.content || [];
        setOrgs(orgList.map((org: any) => ({
          identifier: org.organization?.identifier || org.identifier,
          name: org.organization?.name || org.name,
        })));

        if (orgList.length > 0 && !selectedOrg) {
          onOrgChange(orgList[0].organization?.identifier || orgList[0].identifier);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load organizations');
      } finally {
        setLoading(false);
      }
    };

    fetchOrgs();
  }, []);

  // Fetch projects when org changes
  useEffect(() => {
    if (!selectedOrg || config.app.demoMode) return;

    const fetchProjects = async () => {
      try {
        const baseUrl = config.harness.useProxy ? '/api/harness' : config.harness.baseUrl;
        const url = `${baseUrl}/ng/api/projects?accountIdentifier=${config.harness.accountId}&orgIdentifier=${selectedOrg}`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (!config.harness.useProxy) {
          headers['x-api-key'] = config.harness.apiKey;
          headers['Harness-Account'] = config.harness.accountId;
        }

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error('Failed to fetch projects');

        const data = await response.json();
        const projectList = data.data?.content || [];
        setProjects(projectList.map((proj: any) => ({
          identifier: proj.project?.identifier || proj.identifier,
          name: proj.project?.name || proj.name,
        })));

        if (projectList.length > 0 && !selectedProject) {
          onProjectChange(projectList[0].project?.identifier || projectList[0].identifier);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      }
    };

    fetchProjects();
  }, [selectedOrg]);

  if (loading) {
    return (
      <div className="flex gap-4 items-center">
        <div className="animate-pulse bg-gray-200 h-10 w-48 rounded-md"></div>
        <div className="animate-pulse bg-gray-200 h-10 w-48 rounded-md"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600">
        {error}
      </div>
    );
  }

  return (
    <div className="flex gap-4 items-center">
      <div className="flex-1">
        <label htmlFor="org-select" className="block text-xs font-medium text-gray-600 mb-1">
          Organization
        </label>
        <select
          id="org-select"
          value={selectedOrg}
          onChange={(e) => onOrgChange(e.target.value)}
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
        >
          {orgs.map((org) => (
            <option key={org.identifier} value={org.identifier}>
              {org.name || org.identifier}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1">
        <label htmlFor="project-select" className="block text-xs font-medium text-gray-600 mb-1">
          Project
        </label>
        <select
          id="project-select"
          value={selectedProject}
          onChange={(e) => onProjectChange(e.target.value)}
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
          disabled={!selectedOrg}
        >
          {projects.map((project) => (
            <option key={project.identifier} value={project.identifier}>
              {project.name || project.identifier}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
