/**
 * Creates the first workspace admin (or restores admin access) on any environment, including
 * production. Also creates the workspace row on an empty database.
 *
 *   pnpm --filter @crm/server create-admin --email owner@company.com --name "Owner Name"
 *
 * The password comes from ADMIN_PASSWORD if set; otherwise a strong one is generated and
 * printed once. If the email already exists, the user is made an active admin and, with
 * --reset-password, given a new password (their other sessions are signed out).
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { eq, sql } from "drizzle-orm";
import { openDatabase, schema } from "../src/db/client";
import { hashPassword } from "../src/lib/password";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    "reset-password": { type: "boolean", default: false },
    "workspace-name": { type: "string", default: "Northstar" },
    timezone: { type: "string", default: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" },
  },
});

const email = values.email?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: create-admin --email you@company.com --name "Your Name" [--reset-password]');
  process.exit(1);
}

const providedPassword = process.env.ADMIN_PASSWORD;
if (providedPassword !== undefined && providedPassword.length < 12) {
  console.error("ADMIN_PASSWORD must be at least 12 characters.");
  process.exit(1);
}
const password = providedPassword ?? randomBytes(18).toString("base64url");

const handle = await openDatabase();
await handle.migrate();
const { users, workspace, sessions } = schema;

const [ws] = await handle.db.select().from(workspace).limit(1);
if (!ws) {
  await handle.db.insert(workspace).values({ id: 1, name: values["workspace-name"]!, timezone: values.timezone!, currency: "USD" });
  console.log(`Created workspace "${values["workspace-name"]}" (time zone ${values.timezone}).`);
}

const [existing] = await handle.db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
let showPassword = false;
if (!existing) {
  if (!values.name?.trim()) {
    console.error("--name is required when creating a new user.");
    process.exit(1);
  }
  await handle.db.insert(users).values({ name: values.name.trim(), email, role: "admin", passwordHash: await hashPassword(password) });
  console.log(`Created admin ${email}.`);
  showPassword = true;
} else {
  const set: Partial<typeof users.$inferInsert> = { role: "admin", deactivatedAt: null };
  if (values["reset-password"]) set.passwordHash = await hashPassword(password);
  await handle.db.update(users).set(set).where(eq(users.id, existing.id));
  if (values["reset-password"]) await handle.db.delete(sessions).where(eq(sessions.userId, existing.id));
  console.log(`${email} is now an active admin${values["reset-password"] ? " with a new password (other sessions signed out)" : ""}.`);
  showPassword = !!values["reset-password"];
}

if (showPassword && providedPassword === undefined) {
  console.log(`\nTemporary password (shown once; change it after signing in):\n  ${password}\n`);
}
await handle.close();
