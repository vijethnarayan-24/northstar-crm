import { sql, type SQL } from "drizzle-orm";
import { schema, type Database } from "../db/client";

export async function workspaceTimezone(db: Database) {
  const [ws] = await db.select({ timezone: schema.workspace.timezone }).from(schema.workspace).limit(1);
  return ws?.timezone ?? "UTC";
}

/** SQL timestamp for the end of "today" (next local midnight) in the workspace time zone. */
export async function endOfTodaySql(db: Database): Promise<SQL> {
  const tz = await workspaceTimezone(db);
  return sql`((date_trunc('day', now() at time zone ${tz}) + interval '1 day') at time zone ${tz})`;
}
