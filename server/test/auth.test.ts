import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { openDatabase, type DbHandle } from "../src/db/client";
import { createMemoryMailer } from "../src/lib/mailer";
import { seed } from "../scripts/seed";

const PASSWORD = process.env.SEED_PASSWORD || "northstar-dev-only";
const ADMIN = "alex@northstar.agency";
const MEMBER = "aisha@northstar.agency";

let handle: DbHandle;
let app: Awaited<ReturnType<typeof buildApp>>;
const mailer = createMemoryMailer();

beforeAll(async () => {
  handle = await openDatabase({ dataDir: "memory://" });
  await handle.migrate();
  app = await buildApp(handle, { logger: false, mailer, rateLimit: false });
});
beforeEach(async () => {
  await seed(handle.db);
  mailer.sent.length = 0;
});
afterAll(async () => {
  await app?.close();
  await handle?.close();
});

/** Returns a Cookie header value for a signed-in user. */
async function login(email: string, password = PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(res.statusCode, res.body).toBe(200);
  const sid = res.cookies.find((c) => c.name === "crm_sid");
  expect(sid).toBeDefined();
  return `crm_sid=${sid!.value}`;
}
const me = (cookie?: string) => app.inject({ method: "GET", url: "/api/v1/me", headers: cookie ? { cookie } : {} });
const linkToken = (text: string, path: "invite" | "reset") => text.match(new RegExp(`/${path}/([A-Za-z0-9_-]+)`))![1];

describe("login / logout / me", () => {
  it("rejects wrong passwords and unknown emails with the same error", async () => {
    const wrong = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: ADMIN, password: "nope" } });
    const unknown = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "ghost@x.com", password: "nope" } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error).toBe(unknown.json().error);
  });

  it("sets an httpOnly session cookie and is case-insensitive on email", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "ALEX@Northstar.Agency", password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const sid = res.cookies.find((c) => c.name === "crm_sid")!;
    expect(sid.httpOnly).toBe(true);
    expect(sid.sameSite).toBe("Lax");
    expect(res.json().user).toMatchObject({ email: ADMIN, role: "admin", active: true });
    expect(res.json().user.passwordHash).toBeUndefined();
  });

  it("requires a session for /me and ends it on logout", async () => {
    expect((await me()).statusCode).toBe(401);
    const cookie = await login(ADMIN);
    expect((await me(cookie)).json().user.email).toBe(ADMIN);
    const out = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("rejects state-changing requests from unknown origins", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin: "https://evil.example" }, payload: { email: ADMIN, password: PASSWORD } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("bad_origin");
  });
});

describe("profile", () => {
  it("updates name, color and status", async () => {
    const cookie = await login(MEMBER);
    const res = await app.inject({ method: "PATCH", url: "/api/v1/me", headers: { cookie }, payload: { name: "Aisha R.", avatarColor: "green", status: "away" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ name: "Aisha R.", avatarColor: "green", status: "away" });
  });

  it("changes password only with the current one, and signs out other devices", async () => {
    const laptop = await login(MEMBER);
    const phone = await login(MEMBER);
    const bad = await app.inject({ method: "POST", url: "/api/v1/me/password", headers: { cookie: laptop }, payload: { currentPassword: "wrong", newPassword: "a-brand-new-password" } });
    expect(bad.statusCode).toBe(400);
    const short = await app.inject({ method: "POST", url: "/api/v1/me/password", headers: { cookie: laptop }, payload: { currentPassword: PASSWORD, newPassword: "short" } });
    expect(short.statusCode).toBe(400);
    expect(short.json().issues.newPassword).toBeDefined();
    const ok = await app.inject({ method: "POST", url: "/api/v1/me/password", headers: { cookie: laptop }, payload: { currentPassword: PASSWORD, newPassword: "a-brand-new-password" } });
    expect(ok.statusCode).toBe(204);
    expect((await me(laptop)).statusCode).toBe(200);
    expect((await me(phone)).statusCode).toBe(401);
    await login(MEMBER, "a-brand-new-password");
  });
});

describe("invitations", () => {
  it("only admins can invite", async () => {
    const cookie = await login(MEMBER);
    const res = await app.inject({ method: "POST", url: "/api/v1/invitations", headers: { cookie }, payload: { email: "new@x.com" } });
    expect(res.statusCode).toBe(403);
  });

  it("full flow: invite → view → accept → signed in; link can't be reused", async () => {
    const admin = await login(ADMIN);
    const created = await app.inject({ method: "POST", url: "/api/v1/invitations", headers: { cookie: admin }, payload: { email: "Jordan@Example.com", role: "member" } });
    expect(created.statusCode).toBe(201);
    expect(created.json().invitation.email).toBe("jordan@example.com");
    expect(mailer.sent).toHaveLength(1);
    const token = linkToken(created.json().inviteUrl, "invite");
    expect(mailer.sent[0].text).toContain(token);

    const pending = await app.inject({ method: "GET", url: "/api/v1/invitations", headers: { cookie: admin } });
    expect(pending.json().invitations).toHaveLength(1);

    const view = await app.inject({ method: "GET", url: `/api/v1/auth/invite/${token}` });
    expect(view.json()).toEqual({ email: "jordan@example.com", role: "member" });

    const accept = await app.inject({ method: "POST", url: "/api/v1/auth/accept-invite", payload: { token, name: "Jordan Lee", password: "jordan-password-123" } });
    expect(accept.statusCode).toBe(201);
    const cookie = `crm_sid=${accept.cookies.find((c) => c.name === "crm_sid")!.value}`;
    expect((await me(cookie)).json().user).toMatchObject({ name: "Jordan Lee", role: "member" });

    const again = await app.inject({ method: "POST", url: "/api/v1/auth/accept-invite", payload: { token, name: "X", password: "jordan-password-123" } });
    expect(again.statusCode).toBe(404);
  });

  it("refuses to invite existing members and replaces older open invites", async () => {
    const admin = await login(ADMIN);
    const dup = await app.inject({ method: "POST", url: "/api/v1/invitations", headers: { cookie: admin }, payload: { email: MEMBER } });
    expect(dup.statusCode).toBe(409);

    const first = await app.inject({ method: "POST", url: "/api/v1/invitations", headers: { cookie: admin }, payload: { email: "sam@x.com" } });
    const second = await app.inject({ method: "POST", url: "/api/v1/invitations", headers: { cookie: admin }, payload: { email: "sam@x.com" } });
    const oldToken = linkToken(first.json().inviteUrl, "invite");
    expect((await app.inject({ method: "GET", url: `/api/v1/auth/invite/${oldToken}` })).statusCode).toBe(404);
    const renewed = await app.inject({ method: "POST", url: `/api/v1/invitations/${second.json().invitation.id}/renew`, headers: { cookie: admin } });
    expect(renewed.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/v1/auth/invite/${linkToken(second.json().inviteUrl, "invite")}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/auth/invite/${linkToken(renewed.json().inviteUrl, "invite")}` })).statusCode).toBe(200);

    const revoked = await app.inject({ method: "DELETE", url: `/api/v1/invitations/${second.json().invitation.id}`, headers: { cookie: admin } });
    expect(revoked.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/v1/invitations", headers: { cookie: admin } })).json().invitations).toHaveLength(0);
  });
});

describe("team management", () => {
  const memberId = async (cookie: string, email: string) =>
    (await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie } })).json().users.find((u: { email: string }) => u.email === email).id as string;

  it("any member can list the team; only admins can change it", async () => {
    const member = await login(MEMBER);
    const list = await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie: member } });
    expect(list.json().users).toHaveLength(4);
    const id = await memberId(member, "rahul@northstar.agency");
    const res = await app.inject({ method: "PATCH", url: `/api/v1/users/${id}`, headers: { cookie: member }, payload: { role: "admin" } });
    expect(res.statusCode).toBe(403);
  });

  it("deactivating a member signs them out and blocks login; reactivating restores it", async () => {
    const admin = await login(ADMIN);
    const member = await login(MEMBER);
    const id = await memberId(admin, MEMBER);
    const off = await app.inject({ method: "PATCH", url: `/api/v1/users/${id}`, headers: { cookie: admin }, payload: { active: false } });
    expect(off.json().user.active).toBe(false);
    expect((await me(member)).statusCode).toBe(401);
    const blocked = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: MEMBER, password: PASSWORD } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe("deactivated");
    await app.inject({ method: "PATCH", url: `/api/v1/users/${id}`, headers: { cookie: admin }, payload: { active: true } });
    await login(MEMBER);
  });

  it("protects against admins locking themselves or the workspace out", async () => {
    const admin = await login(ADMIN);
    const selfId = await memberId(admin, ADMIN);
    const self = await app.inject({ method: "PATCH", url: `/api/v1/users/${selfId}`, headers: { cookie: admin }, payload: { role: "member" } });
    expect(self.json().error).toBe("self_lockout");

    // Promote Aisha, have her demote Alex: allowed (2 admins). Then she can't be the last admin removed.
    const aishaId = await memberId(admin, MEMBER);
    await app.inject({ method: "PATCH", url: `/api/v1/users/${aishaId}`, headers: { cookie: admin }, payload: { role: "admin" } });
    const aisha = await login(MEMBER);
    const demote = await app.inject({ method: "PATCH", url: `/api/v1/users/${selfId}`, headers: { cookie: aisha }, payload: { role: "member" } });
    expect(demote.json().user.role).toBe("member");
    const lastAdmin = await app.inject({ method: "PATCH", url: `/api/v1/users/${aishaId}`, headers: { cookie: aisha }, payload: { active: false } });
    expect(lastAdmin.statusCode).toBe(409);
  });
});

describe("password reset", () => {
  it("does not reveal whether an email exists", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: "ghost@x.com" } });
    expect(res.statusCode).toBe(204);
    expect(mailer.sent).toHaveLength(0);
  });

  it("resets with a one-time link and signs out existing sessions", async () => {
    const before = await login(MEMBER);
    await app.inject({ method: "POST", url: "/api/v1/auth/forgot", payload: { email: MEMBER } });
    expect(mailer.sent).toHaveLength(1);
    const token = linkToken(mailer.sent[0].text, "reset");
    const reset = await app.inject({ method: "POST", url: "/api/v1/auth/reset", payload: { token, password: "reset-password-456" } });
    expect(reset.statusCode).toBe(204);
    expect((await me(before)).statusCode).toBe(401);
    await login(MEMBER, "reset-password-456");
    const reuse = await app.inject({ method: "POST", url: "/api/v1/auth/reset", payload: { token, password: "another-password-789" } });
    expect(reuse.statusCode).toBe(400);
  });
});

describe("rate limiting", () => {
  it("limits repeated login attempts", async () => {
    const limited = await buildApp(handle, { logger: false, mailer });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await limited.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: ADMIN, password: "wrong" } });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    await limited.close();
  });
});
