// The database "version" is the last migration Wrangler applied, read from the
// d1_migrations table it keeps. A dictionary's version is the last migration
// that built it: those are named NNNN_dictionary_uk_<language>_… (seed, story
// refresh, or an update from scripts/dictionary/prepare-update.mjs).
const DICTIONARY_MIGRATION_PATTERN = /^\d{4}_dictionary_uk_([a-z]{2})_/u;

function describeMigration(row) {
  const name = String(row.name).replace(/\.sql$/u, "");
  return {
    number: name.slice(0, 4),
    name,
    appliedAt: typeof row.appliedAt === "string" ? row.appliedAt : null,
  };
}

export function summarizeMigrations(rows) {
  const migrations = (rows || [])
    .filter((row) => typeof row?.name === "string" && /^\d{4}_/u.test(row.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(describeMigration);

  const dictionaries = {};
  for (const migration of migrations) {
    const language = migration.name.match(DICTIONARY_MIGRATION_PATTERN)?.[1];
    if (language) dictionaries[language] = migration;
  }

  return {
    latest: migrations.at(-1) || null,
    count: migrations.length,
    dictionaries,
  };
}

// Null when the table cannot be read, e.g. a database never set up with Wrangler.
export async function getDatabaseVersion(db) {
  try {
    const { results } = await db
      .prepare("SELECT name, applied_at AS appliedAt FROM d1_migrations")
      .all();
    return summarizeMigrations(results);
  } catch {
    return null;
  }
}
