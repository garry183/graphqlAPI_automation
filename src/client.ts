import type { APIRequestContext } from '@playwright/test';
import type { ZodType } from 'zod';

export interface GqlError {
  message: string;
  path?: (string | number)[];
  locations?: { line: number; column: number }[];
  extensions?: Record<string, unknown>;
}

export interface GqlResponse<T> {
  status: number;
  data: T | null | undefined;
  errors: GqlError[] | undefined;
  durationMs: number;
  body: unknown;
}

/** Thrown when the upstream returns non-JSON (CDN error page, WAF block). Not a GraphQL failure. */
export class UpstreamUnavailableError extends Error {
  constructor(url: string, status: number, snippet: string) {
    super(`[upstream-unavailable] ${url} returned ${status} non-JSON: ${snippet}`);
  }
}

export interface ExecOptions<T> {
  operationName?: string;
  headers?: Record<string, string>;
  /** Validates `data` when the response carries no errors. */
  schema?: ZodType<T>;
}

export class GqlClient {
  constructor(
    private readonly request: APIRequestContext,
    readonly url: string,
    private readonly defaultHeaders: Record<string, string> = {},
  ) {}

  /** Posts an arbitrary body: used for batching and malformed-request tests. */
  async post(body: unknown, headers: Record<string, string> = {}) {
    const started = Date.now();
    const res = await this.request.post(this.url, {
      data: body,
      headers: { 'content-type': 'application/json', ...this.defaultHeaders, ...headers },
      failOnStatusCode: false,
    });
    const durationMs = Date.now() - started;
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new UpstreamUnavailableError(this.url, res.status(), text.slice(0, 160).replace(/\s+/g, ' '));
    }
    return { status: res.status(), json, durationMs, headers: res.headers() };
  }

  async exec<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    opts: ExecOptions<T> = {},
  ): Promise<GqlResponse<T>> {
    const { status, json, durationMs } = await this.post(
      { query, variables, operationName: opts.operationName },
      opts.headers,
    );
    const body = json as { data?: unknown; errors?: GqlError[] };
    let data = body.data as T | null | undefined;
    if (opts.schema && !body.errors && data != null) data = opts.schema.parse(data);
    return { status, data, errors: body.errors, durationMs, body: json };
  }

  /** Executes and fails loudly on transport or GraphQL errors; returns validated data. */
  async data<T>(query: string, variables: Record<string, unknown> | undefined, schema: ZodType<T>, opts: Omit<ExecOptions<T>, 'schema'> = {}): Promise<T> {
    const res = await this.exec(query, variables, { ...opts, schema });
    if (res.errors?.length) {
      throw new Error(`GraphQL errors from ${this.url}: ${JSON.stringify(res.errors)}`);
    }
    if (res.status !== 200) throw new Error(`HTTP ${res.status} from ${this.url}`);
    if (res.data == null) throw new Error(`No data from ${this.url}`);
    return res.data;
  }
}
