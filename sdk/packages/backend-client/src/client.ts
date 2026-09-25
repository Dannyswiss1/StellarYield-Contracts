/**
 * Minimal typed backend client (generated SDK client, Issue #382).
 *
 * Exposes an `openapi-fetch`-style `client.GET(path)` surface so the
 * integration test reads like the generated client usage:
 *
 *   const client = createBackendClient(process.env.BACKEND_URL);
 *   const { data } = await client.GET("/api/v1/health");
 */

export interface GetResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

type KnownPaths = "/api/v1/health" | "/api/v1/vaults" | "/health";

export function createBackendClient(baseUrl: string): {
  GET: <T = unknown>(path: KnownPaths | (string & {})) => Promise<GetResult<T>>;
} {
  const normalizedBase = baseUrl.replace(/\/$/, "");

  async function GET<T = unknown>(path: string): Promise<GetResult<T>> {
    const response = await fetch(`${normalizedBase}${path}`, {
      headers: { Accept: "application/json" },
    });
    let data: T | undefined;
    try {
      data = (await response.json()) as T;
    } catch (err) {
      return { error: err, response };
    }
    if (!response.ok) {
      return { error: data, response };
    }
    return { data, response };
  }

  return { GET };
}
