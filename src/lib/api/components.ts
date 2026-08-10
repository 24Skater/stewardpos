import { apiClient } from '../api-client';

export type ComponentSide = 'frontend' | 'backend';
export type ComponentCategory = 'dependency' | 'devDependency';

/** An installed package, as reported from the corresponding `package.json`. */
export interface Component {
  name: string;
  currentVersion: string;
  type: ComponentSide;
  category: ComponentCategory;
}

export interface ComponentUpdate extends Component {
  latestVersion: string;
}

/**
 * Dependency inspection and upgrade (`backend/src/api/routes/components.ts`,
 * mounted under `/api/admin/components`).
 *
 * The update endpoints run a package install on the server, so they are slow and
 * inherently privileged - an operator tool, not something to call on a timer.
 */
export const componentsApi = {
  list: () => apiClient.get<Component[]>('/api/admin/components'),
  /** Only packages with a newer version available. */
  updates: () => apiClient.get<ComponentUpdate[]>('/api/admin/components/updates'),
  update: (packages: string[], type: ComponentSide) =>
    apiClient.post<unknown>('/api/admin/components/update', { packages, type }),
  updateAll: (type: ComponentSide) =>
    apiClient.post<unknown>('/api/admin/components/update-all', { type }),
};
