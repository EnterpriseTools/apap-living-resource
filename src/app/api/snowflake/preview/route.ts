import { NextResponse } from 'next/server';
import { snowflakeQuery } from '@/lib/snowflake';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Simple connectivity + schema preview endpoint.
 * Returns the first N rows (default 5) from a table/view.
 *
 * Query params:
 * - table: fully qualified name, default PRODUCT_ANALYTICS.APAP.RPT_ADOPTION_VR
 * - limit: number of rows, default 5 (max 50)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const table = url.searchParams.get('table') || 'PRODUCT_ANALYTICS.APAP.RPT_ADOPTION_VR';
    const limitRaw = Number(url.searchParams.get('limit') || 5);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 50) : 5;

    // NOTE: Table name can't be bound, so we minimally validate it to reduce risk.
    if (!/^[A-Z0-9_]+(\.[A-Z0-9_]+){0,2}$/i.test(table)) {
      return NextResponse.json({ error: 'Invalid table parameter' }, { status: 400 });
    }

    const sql = `select * from ${table} limit ${limit}`;
    const rows = await snowflakeQuery<Record<string, unknown>>(sql);
    const columns = rows[0] ? Object.keys(rows[0]) : [];
    return NextResponse.json({ table, limit, columns, rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Snowflake preview failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

