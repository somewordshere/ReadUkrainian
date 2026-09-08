import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function seedDatabase({ before = null } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql") && (!before || name < before)).sort()) {
    sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  const db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let params = [];
    const query = {
      bind(...values) { params = values; return query; },
      async first() { return statement.get(...params) ?? null; },
      async all() { return { results: statement.all(...params) }; },
      async run() { return { success: true, meta: statement.run(...params) }; },
    };
    return query;
  }};
  return { sqlite, db };
}
