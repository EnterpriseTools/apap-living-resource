import 'server-only';
import snowflake from 'snowflake-sdk';

type Env = {
  SNOWFLAKE_ACCOUNT?: string;
  SNOWFLAKE_USERNAME?: string;
  SNOWFLAKE_PASSWORD?: string;
  /** e.g. SNOWFLAKE (default), EXTERNALBROWSER, OAUTH, SNOWFLAKE_JWT */
  SNOWFLAKE_AUTHENTICATOR?: string;
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
    // Works for local dev (interactive browser). Not suitable for serverless/prod.
    return snowflake.createConnection({
      ...base,
      authenticator,
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

export async function snowflakeQuery<T extends Record<string, unknown>>(
  sqlText: string,
  binds: unknown[] = [],
  env: Env = process.env
): Promise<T[]> {
  const connection = createSnowflakeConnection(env);

  const authenticator = normAuthenticator(env.SNOWFLAKE_AUTHENTICATOR);

  if (authenticator === 'EXTERNALBROWSER' && 'connectAsync' in connection) {
    // Snowflake docs recommend connectAsync for EXTERNALBROWSER.
    await (connection as any).connectAsync();
  } else {
    await new Promise<void>((resolve, reject) => {
      connection.connect((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  try {
    const rows = await new Promise<T[]>((resolve, reject) => {
      connection.execute({
        sqlText,
        binds,
        complete: (err, _stmt, rows) => {
          if (err) reject(err);
          else resolve((rows ?? []) as T[]);
        },
      });
    });
    return rows;
  } finally {
    // Best-effort close; ignore errors to avoid masking query errors
    try {
      connection.destroy((_err) => {});
    } catch {
      /* ignore */
    }
  }
}

