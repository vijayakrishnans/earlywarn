import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { manifest } from "@saas/db/manifest";

/* A real SQLite behind the D1 binding shape, loaded with the real migrations. */

interface SqliteStatement {
  all(...values: unknown[]): Record<string, unknown>[];
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as unknown as {
  DatabaseSync: new (path: string) => SqliteDb;
};

const MIGRATIONS = resolve(process.cwd(), "../../packages/db/src/migrations");

export function createTestDb(): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const m of manifest.migrations.filter((x) => x.context === "desk")) {
    db.exec(readFileSync(resolve(MIGRATIONS, m.path), "utf-8"));
  }
  const prepare = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => prepare(sql, next),
    all: async () => ({ results: db.prepare(sql).all(...values), success: true, meta: {} }),
    run: () => db.prepare(sql).all(...values),
  });
  return {
    prepare,
    batch: async (statements: Array<{ run(): unknown[] }>) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => ({ results: s.run(), success: true, meta: {} }));
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Database;
}

/** Roles per subject; a subject not listed is not a member. */
export function createMembership(roles: Record<string, string>): { membership: Fetcher; policy: Fetcher } {
  const fetcher = (handler: (body: Record<string, unknown>) => unknown) =>
    ({
      fetch: async (_url: string, init: RequestInit) =>
        Response.json({ data: handler(JSON.parse(String(init.body))) }),
    }) as unknown as Fetcher;
  return {
    membership: fetcher((body) => ({
      memberships: roles[(body.subject as { id: string }).id]
        ? [{ role: roles[(body.subject as { id: string }).id], orgId: body.orgId, scopeKind: "organization" }]
        : [],
    })),
    policy: fetcher((body) => {
      const role = ((body.context as { memberships: Array<{ role: string }> }).memberships[0] ?? {}).role;
      const action = String(body.action);
      const allow = role !== undefined && (action === "desk.read" || role === "owner" || role === "admin");
      return { allow };
    }),
  };
}
