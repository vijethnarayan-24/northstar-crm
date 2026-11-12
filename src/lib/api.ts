import type { ApiErrorBody } from "@crm/shared";

/** Same-origin `/api/v1` in dev (Vite proxy). Set VITE_API_URL when the API lives elsewhere. */
const BASE = `${import.meta.env.VITE_API_URL ?? ""}/api/v1`;

export class ApiError extends Error {
  status: number;
  code: string;
  issues: Record<string, string[] | undefined>;
  /** Full response body, for structured extras such as a conflicting record. */
  body: Record<string, unknown>;
  constructor(status: number, body: Partial<ApiErrorBody> & Record<string, unknown>) {
    super(body.message ?? "Something went wrong. Please try again.");
    this.status = status;
    this.code = body.error ?? "error";
    this.issues = body.issues ?? {};
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  const isForm = body instanceof FormData;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      // FormData sets its own multipart boundary header.
      headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: "network_error", message: "Can't reach the server. Check your connection and try again." });
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
};

/** Absolute URL for links the browser opens directly (downloads, previews). */
export const apiUrl = (path: string) => `${BASE}${path}`;

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong. Please try again.");
