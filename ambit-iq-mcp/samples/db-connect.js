// Requires: npm install pg
import pg from "pg";

/** Opens a PostgreSQL client using inline configuration. */
export async function connectDatabase() {
  const client = new pg.Client({
    host: "localhost",
    port: 5432,
    user: "app_user",
    password: "P@ssword123",
    database: "app_db",
  });
  await client.connect();
  return client;
}
