// Derives the credentials needed by exec'd database tooling (pg_dump, psql,
// mysqldump, pg_isready, ...) from the environment an instance was created with.
// Inside the official postgres image, `docker exec` connects over the local
// socket which uses trust auth, so only user/database are needed. MariaDB
// clients require the root password, passed via the MYSQL_PWD env var so it
// never appears in the command line inside the container.

export interface PostgresExecCredentials {
  user: string;
  database: string;
}

export function getPostgresExecCredentials(
  environment: Record<string, string> = {}
): PostgresExecCredentials {
  const user = environment.POSTGRES_USER || 'postgres';
  return {
    user,
    database: environment.POSTGRES_DB || user,
  };
}

export function getMariaDBRootPassword(environment: Record<string, string> = {}): string {
  return environment.MYSQL_ROOT_PASSWORD || '';
}
