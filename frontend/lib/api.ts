/**
 * Base URL of the API.
 *  - Production on Vercel: "/api". The browser calls the same origin and Next.js proxies
 *    /api/* to the backend (see next.config.ts), so there is no CORS and cookies stay first-party.
 *  - Local development: http://localhost:4000, or whatever NEXT_PUBLIC_API_URL says.
 */
export const API_URL: string =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:4000");

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

/** Parse a fetch Response as JSON, throwing ApiError (with the server's message) when not ok. */
export async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && typeof data === "object" && "error" in data && String((data as { error: unknown }).error)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}
