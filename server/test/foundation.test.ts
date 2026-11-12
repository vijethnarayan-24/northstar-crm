import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leadInput } from "@crm/shared";
import { buildApp } from "../src/app";
import { openDatabase, schema, type DbHandle } from "../src/db/client";
import { verifyPassword } from "../src/lib/password";
import { seed } from "../scripts/seed";

let handle: DbHandle;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  handle = await openDatabase({ dataDir: "memory://" });
  await handle.migrate();
  await seed(handle.db);
  app = await buildApp(handle, { logger: false });
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe("migrations + seed", () => {
  it("creates the prototype's data", async () => {
    const [{ value: leadCount }] = await handle.db.select({ value: count() }).from(schema.leads);
    const [{ value: userCount }] = await handle.db.select({ value: count() }).from(schema.users);
    const stages = await handle.db.select().from(schema.pipelineStages).orderBy(schema.pipelineStages.position);
    expect(leadCount).toBe(9);
    expect(userCount).toBe(4);
    expect(stages.map((s) => s.name)).toEqual(["New", "Contacted", "In Discussion", "Proposal Sent", "Negotiation", "Won", "Lost"]);
    expect(stages.filter((s) => s.kind !== "open").map((s) => s.kind)).toEqual(["won", "lost"]);
  });

  it("stores argon2 password hashes, not plain text", async () => {
    const [user] = await handle.db.select().from(schema.users).limit(1);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(user.passwordHash!, process.env.SEED_PASSWORD || "northstar-dev-only")).toBe(true);
  });

  it("reseeding is idempotent", async () => {
    await seed(handle.db);
    const [{ value }] = await handle.db.select({ value: count() }).from(schema.leads);
    expect(value).toBe(9);
  });
});

describe("api", () => {
  it("GET /api/v1/health reports the database as up", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", database: "up" });
  });

  it("unknown routes return a JSON 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });
});

describe("shared schemas", () => {
  it("requires a lead name and rejects bad emails", () => {
    expect(leadInput.safeParse({ fullName: "" }).success).toBe(false);
    expect(leadInput.safeParse({ fullName: "Jordan Lee", email: "not-an-email" }).success).toBe(false);
    const ok = leadInput.parse({ fullName: "  Jordan Lee ", email: "Jordan@Example.com" });
    expect(ok).toMatchObject({ fullName: "Jordan Lee", email: "jordan@example.com", temperature: "warm" });
  });
});
