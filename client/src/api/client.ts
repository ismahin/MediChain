import axios from "axios";
import type { ApiResponse } from "../types";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS || 30000)
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("medichain_access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string> | null = null;
api.interceptors.response.use(undefined, async (error) => {
  const request = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
  if (error.response?.status !== 401 || !request || request._retried || String(request.url).includes("/auth/refresh")) return Promise.reject(error);
  const refreshToken = localStorage.getItem("medichain_refresh_token");
  if (!refreshToken) return Promise.reject(error);
  request._retried = true;
  refreshing ??= axios.post(`${api.defaults.baseURL}/auth/refresh`, { refreshToken }).then((response) => {
    const tokens = response.data.data as { accessToken: string; refreshToken: string };
    localStorage.setItem("medichain_access_token", tokens.accessToken);
    localStorage.setItem("medichain_refresh_token", tokens.refreshToken);
    return tokens.accessToken;
  }).finally(() => { refreshing = null; });
  try { request.headers.Authorization = `Bearer ${await refreshing}`; return api(request); }
  catch (refreshError) { localStorage.removeItem("medichain_access_token"); localStorage.removeItem("medichain_refresh_token"); return Promise.reject(refreshError); }
});

export async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>) {
  try {
    const response = await promise;
    return response.data.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const payload = error.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
      const fieldError = payload?.errors ? Object.values(payload.errors).flat()[0] : undefined;
      throw new Error(fieldError || payload?.message || error.message);
    }
    throw error;
  }
}
