export interface BolnaErrorOptions {
  status?: number;
  retryable?: boolean;
  cause?: unknown;
  details?: unknown;
}

export class BolnaError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(message: string, options: BolnaErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BolnaError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export class BolnaConfigError extends BolnaError {
  constructor(message: string, options: BolnaErrorOptions = {}) {
    super(message, options);
    this.name = "BolnaConfigError";
  }
}

export class BolnaHttpError extends BolnaError {
  readonly status: number;

  constructor(message: string, options: BolnaErrorOptions & { status: number }) {
    super(message, options);
    this.name = "BolnaHttpError";
    this.status = options.status;
  }
}

export class BolnaNetworkError extends BolnaError {
  constructor(message: string, options: BolnaErrorOptions = {}) {
    super(message, options);
    this.name = "BolnaNetworkError";
  }
}

export class BolnaTimeoutError extends BolnaError {
  constructor(message: string, options: BolnaErrorOptions = {}) {
    super(message, { ...options, retryable: true });
    this.name = "BolnaTimeoutError";
  }
}

export class BolnaResponseError extends BolnaError {
  constructor(message: string, options: BolnaErrorOptions = {}) {
    super(message, options);
    this.name = "BolnaResponseError";
  }
}

export class BolnaWebhookError extends BolnaError {
  constructor(message: string, options: BolnaErrorOptions = {}) {
    super(message, options);
    this.name = "BolnaWebhookError";
  }
}

export class BolnaToolError extends BolnaError {
  constructor(message: string, options: BolnaErrorOptions = {}) {
    super(message, options);
    this.name = "BolnaToolError";
  }
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value && value.length >= 4) {
      seen.add(value);
    }
  }
  return [...seen];
}

export function redactSecrets(value: string, secrets: readonly string[] = []): string {
  let redacted = value;
  const candidates = uniqueStrings([
    ...secrets,
    ...secrets.map((secret) => encodeURIComponent(secret)),
  ]);

  for (const secret of candidates) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  return redacted
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key\s*[:=]\s*["']?)[^"'\s,;}]+/gi, "$1[REDACTED]");
}
