import 'server-only';
import snowflake from 'snowflake-sdk';

type Env = {
  SNOWFLAKE_ACCOUNT?: string;
  SNOWFLAKE_USERNAME?: string;
  SNOWFLAKE_PASSWORD?: string;
  /** e.g. SNOWFLAKE (default), EXTERNALBROWSER, OAUTH, SNOWFLAKE_JWT */
  SNOWFLAKE_AUTHENTICATOR?: string;
  /** For authenticator=EXTERNALBROWSER. Default 300000 (5 min). */
  SNOWFLAKE_BROWSER_ACTION_TIMEOUT_MS?: string;
  /** For authenticator=OAUTH */
  SNOWFLAKE_OAUTH_TOKEN?: string;
  /** For authenticator=SNOWFLAKE_JWT (key-pair auth) */
  SNOWFLAKE_PRIVATE_KEY?: string;
  SNOWFLAKE_PRIVATE_KEY_PATH?: string;
  SNOWFLAKE_PRIVATE_KEY_PASSPHRASE?: string;
  SNOWFLAKE_WAREHOUSE?: string;
  SNOWFLAKE_DATABASE?: string;
  SNOWFLAKE_SCHEMA?: string;
  SNOWFLAKE_ROLE?: string;
};

function required(name: keyof Env, env: Env): string {
  const v = env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function normAuthenticator(v?: string): string {
  return (v || 'SNOWFLAKE').trim().toUpperCase();
}

function envKey(env: Env): string {
  return [
    env.SNOWFLAKE_ACCOUNT ?? '',
    env.SNOWFLAKE_USERNAME ?? '',
    env.SNOWFLAKE_WAREHOUSE ?? '',
    env.SNOWFLAKE_DATABASE ?? '',
    env.SNOWFLAKE_SCHEMA ?? '',
    env.SNOWFLAKE_ROLE ?? '',
    normAuthenticator(env.SNOWFLAKE_AUTHENTICATOR),
  ].join('|');
}

export function createSnowflakeConnection(env: Env = process.env): snowflake.Connection {
  const authenticator = normAuthenticator(env.SNOWFLAKE_AUTHENTICATOR);

  const base: Record<string, unknown> = {
    account: required('SNOWFLAKE_ACCOUNT', env),
    username: required('SNOWFLAKE_USERNAME', env),
    warehouse: env.SNOWFLAKE_WAREHOUSE,
    database: env.SNOWFLAKE_DATABASE,
    schema: env.SNOWFLAKE_SCHEMA,
    role: env.SNOWFLAKE_ROLE,
  };

  if (authenticator === 'SNOWFLAKE') {
    return snowflake.createConnection({
      ...base,
      authenticator,
      password: required('SNOWFLAKE_PASSWORD', env),
    });
  }

  if (authenticator === 'EXTERNALBROWSER') {
    const browserActionTimeout =
      Number(env.SNOWFLAKE_BROWSER_ACTION_TIMEOUT_MS) > 0 ? Number(env.SNOWFLAKE_BROWSER_ACTION_TIMEOUT_MS) : 300_000;
    // Works for local dev (interactive browser). Not suitable for serverless/prod.
    return snowflake.createConnection({
      ...base,
      authenticator,
      // Reduce repeated login prompts across connections in the same dev session.
      clientStoreTemporaryCredential: true,
      browserActionTimeout,
    });
  }

  if (authenticator === 'OAUTH') {
    return snowflake.createConnection({
      ...base,
      authenticator,
      token: required('SNOWFLAKE_OAUTH_TOKEN', env),
    });
  }

  if (authenticator === 'SNOWFLAKE_JWT') {
    const privateKey = env.SNOWFLAKE_PRIVATE_KEY;
    const privateKeyPath = env.SNOWFLAKE_PRIVATE_KEY_PATH;
    if (!privateKey && !privateKeyPath) {
      throw new Error('Missing env var: SNOWFLAKE_PRIVATE_KEY or SNOWFLAKE_PRIVATE_KEY_PATH');
    }
    return snowflake.createConnection({
      ...base,
      authenticator,
      ...(privateKey ? { privateKey } : {}),
      ...(privateKeyPath ? { privateKeyPath } : {}),
      ...(env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE
        ? { privateKeyPass: env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE }
        : {}),
    });
  }

  throw new Error(`Unsupported SNOWFLAKE_AUTHENTICATOR: ${authenticator}`);
}

// ---------------------------------------------------------------------------
// EXTERNALBROWSER session reuse (local dev)
// ---------------------------------------------------------------------------
//
// Without this, each API request can create a new Snowflake connection and
// trigger a separate external browser auth flow (opening many verification tabs).
//
// We keep a single connected session in-process and serialize queries through it.
// This is intended for local dev only (Next runtime=nodejs).
let cachedExternalBrowser:
  | {
      key: string;
      conn: snowflake.Connection;
      lastUsedAt: number;
      execChain: Promise<void>;
    }
  | null = null;
let externalBrowserConnectPromise: Promise<snowflake.Connection> | null = null;

const EXTERNALBROWSER_IDLE_DESTROY_MS = 10 * 60 * 1000; // 10 minutes

async function connectExternalBrowser(env: Env): Promise<snowflake.Connection> {
  const key = envKey(env);
  const now = Date.now();

  if (cachedExternalBrowser && cachedExternalBrowser.key === key) {
    if (now - cachedExternalBrowser.lastUsedAt <= EXTERNALBROWSER_IDLE_DESTROY_MS) {
      cachedExternalBrowser.lastUsedAt = now;
      return cachedExternalBrowser.conn;
    }
    // idle too long: drop it
    try {
      cachedExternalBrowser.conn.destroy((_err) => {});
    } catch {
      /* ignore */
    }
    cachedExternalBrowser = null;
  }

  if (externalBrowserConnectPromise) return externalBrowserConnectPromise;

  const conn = createSnowflakeConnection(env);
  externalBrowserConnectPromise = (async () => {
    if ('connectAsync' in conn) {
      await (conn as any).connectAsync();
    } else {
      await new Promise<void>((resolve, reject) => {
        conn.connect((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    cachedExternalBrowser = { key, conn, lastUsedAt: Date.now(), execChain: Promise.resolve() };
    externalBrowserConnectPromise = null;
    return conn;
  })().catch((e) => {
    externalBrowserConnectPromise = null;
    try {
      conn.destroy((_err) => {});
    } catch {
      /* ignore */
    }
    throw e;
  });

  return externalBrowserConnectPromise;
}

function enqueueExternalBrowser<T>(fn: () => Promise<T>): Promise<T> {
  if (!cachedExternalBrowser) {
    // Should never happen: callers must connect first.
    return fn();
  }
  const run = cachedExternalBrowser.execChain.then(fn, fn);
  cachedExternalBrowser.execChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function isTerminatedConnectionError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /terminated connection|connection.*terminated|connection.*closed|network error/i.test(msg);
}

export async function snowflakeQuery<T extends Record<string, unknown>>(
  sqlText: string,
  binds: unknown[] = [],
  env: Env = process.env
): Promise<T[]> {
  const authenticator = normAuthenticator(env.SNOWFLAKE_AUTHENTICATOR);

  // Special-case EXTERNALBROWSER: reuse one session to avoid opening many auth tabs.
  // If the cached connection has been terminated by the server, clear it and reconnect once.
  if (authenticator === 'EXTERNALBROWSER') {
    const runQuery = async (): Promise<T[]> => {
      const conn = await connectExternalBrowser(env);
      cachedExternalBrowser!.lastUsedAt = Date.now();
      return enqueueExternalBrowser(
        () =>
          new Promise<T[]>((resolve, reject) => {
            conn.execute({
              sqlText,
              binds,
              complete: (err, _stmt, rows) => {
                if (err) reject(err);
                else resolve((rows ?? []) as T[]);
              },
            });
          })
      );
    };

    try {
      return await runQuery();
    } catch (err) {
      if (isTerminatedConnectionError(err)) {
        // Drop the dead cached connection and retry once with a fresh one.
        if (cachedExternalBrowser) {
          try { cachedExternalBrowser.conn.destroy((_e) => {}); } catch { /* ignore */ }
          cachedExternalBrowser = null;
        }
        externalBrowserConnectPromise = null;
        return await runQuery();
      }
      throw err;
    }
  }

  const connection = createSnowflakeConnection(env);
  await new Promise<void>((resolve, reject) => {
    connection.connect((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  try {
    return await new Promise<T[]>((resolve, reject) => {
      connection.execute({
        sqlText,
        binds,
        complete: (err, _stmt, rows) => {
          if (err) reject(err);
          else resolve((rows ?? []) as T[]);
        },
      });
    });
  } finally {
    try {
      connection.destroy((_err) => {});
    } catch {
      /* ignore */
    }
  }
}

