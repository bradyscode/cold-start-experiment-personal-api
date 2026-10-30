import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createApi } from './client';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5047';

export type Api = ReturnType<typeof createApi>;

type ApiContextValue = {
  api: Api;
  baseUrl: string;
};

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ children, baseUrl = API_BASE_URL }: { children: ReactNode; baseUrl?: string }) {
  const value = useMemo<ApiContextValue>(() => ({ api: createApi(baseUrl), baseUrl }), [baseUrl]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used inside ApiProvider');
  return ctx;
}
