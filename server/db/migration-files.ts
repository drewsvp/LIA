import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type MigrationFile = {
  filename: string;
  sql: string;
};

export function migrationDirectory(): string {
  return path.resolve(import.meta.dirname, "../../migrations");
}

export function readMigrationFiles(): MigrationFile[] {
  const dir = migrationDirectory();
  const files = readdirSync(dir)
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`no .sql files found in ${dir}`);
  }

  return files.map((filename) => ({
    filename,
    sql: readFileSync(path.join(dir, filename), "utf8"),
  }));
}

/**
 * The first migrations were authored as standalone psql scripts and include
 * their own top-level BEGIN/COMMIT. The application runner owns the
 * transaction, so remove only transaction-control statements that occupy a
 * line by themselves. BEGIN/COMMIT inside a PL/pgSQL body is left untouched.
 */
export function withoutTopLevelTransactionControl(sql: string): string {
  return sql.replace(
    /^[ \t]*(?:begin|commit|rollback)(?:[ \t]+(?:work|transaction))?[ \t]*;[ \t]*$/gim,
    "",
  );
}