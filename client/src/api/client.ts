import axios from "axios";
import type { ApiResponse } from "../types";

export const api = axios.create({
  baseURL: "/api"
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("medichain_access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
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
