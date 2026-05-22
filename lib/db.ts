// =============================================================================
// lib/db.ts — Neon PostgreSQL client
//
// DATABASE_URL is automatically provided by Vercel when you connect
// Neon via the Vercel Storage dashboard. No manual setup needed.
// =============================================================================

import { neon } from '@neondatabase/serverless';

// 1. Raw tagged template client — use for static queries
export const sql = neon(process.env.DATABASE_URL!);

// 2. Typed wrapper around sql for static template literal queries
//    Usage: const rows = await query<Stock>`SELECT * FROM stocks`
export async function query<T>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const rows = await sql(strings, ...values);
  return rows as T[];
}

// 3. For dynamically built SQL strings (e.g. screener WHERE clauses)
//    Usage: const rows = await queryUnsafe<ScreenerRow>(sqlString, params)
export async function queryUnsafe<T>(
  sqlString: string,
  params: unknown[] = [],
): Promise<T[]> {
  const rows = await (sql as any).unsafe(sqlString, params);
  return rows as T[];
}

// 4. Returns the most recent date available in any date-keyed table.
//    Falls back to today's date if the table is empty or the query fails.
export async function getLatestDate(tableName: string): Promise<string> {
  try {
    const rows = await queryUnsafe<{ max: string | null }>(
      `SELECT MAX(date) AS max FROM ${tableName}`,
      [],
    );
    return rows[0]?.max ?? new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}