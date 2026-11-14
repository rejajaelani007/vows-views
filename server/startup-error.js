export class StartupError extends Error {
  constructor(code, message, stage = 'configuration', { cause, missing = [] } = {}) {
    super(message, { cause });
    this.name = 'StartupError';
    this.code = code;
    this.stage = stage;
    this.missing = missing;
  }
}

export function databaseStartupError(error) {
  if (error instanceof StartupError) return error;
  // Inspect provider text only to choose a fixed message. Never send provider
  // messages, URLs, connection strings or tokens to the browser or logs.
  const messages = [error?.message, error?.cause?.message].filter(Boolean).join(' ');
  const codes = [error?.code, error?.cause?.code].filter(Boolean).join(' ');
  if (/no such (table|column)|has no column|unknown column/i.test(messages))
    return new StartupError(
      'DATABASE_SCHEMA_NOT_READY',
      'Tabel atau kolom database belum siap. Jalankan npm run db:init pada database Turso yang dipakai deployment ini, lalu redeploy.',
      'database',
      { cause: error },
    );
  if (
    /UNAUTHORIZED|AUTH_FAILED|TOKEN_EXPIRED|JWT_INVALID/i.test(codes) ||
    /unauthorized|authentication failed|invalid (auth|token|jwt)|expired token|status(?: code)?[: ]+401/i.test(
      messages,
    )
  )
    return new StartupError(
      'DATABASE_AUTH_FAILED',
      'Autentikasi Turso gagal. Periksa TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN pada environment deployment ini, lalu redeploy.',
      'database',
      { cause: error },
    );
  return new StartupError(
    'DATABASE_CONNECTION_FAILED',
    'Database Turso belum dapat diakses. Periksa URL, token, dan ketersediaan database pada deployment ini.',
    'database',
    { cause: error },
  );
}

export function startupDiagnostic(error) {
  const known = error instanceof StartupError;
  const providerCode = error?.cause?.code || error?.code || error?.name;
  return {
    code: known ? error.code : 'SERVICE_UNAVAILABLE',
    message: known ? error.message : 'Server belum siap. Periksa konfigurasi database dan storage.',
    stage: known ? error.stage : 'startup',
    missing: known ? error.missing : [],
    providerCode:
      typeof providerCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(providerCode)
        ? providerCode
        : undefined,
  };
}
