import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentDTO } from "@crm/shared";
import { seed } from "../scripts/seed";
import { ADMIN, AISHA, RAHUL, setupApp } from "./helpers";

let ctx: Awaited<ReturnType<typeof setupApp>>;
let cookies: Record<string, string>;
const leadId = async (name: string) => (await ctx.as(cookies.admin!).get(`/api/v1/leads?q=${encodeURIComponent(name)}`)).json().items[0].id as string;

/** Builds a multipart/form-data body with one file field. */
function multipart(filename: string, content: Buffer | string, field = "file") {
  const boundary = "----crmtest" + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
const upload = (who: string, lead: string, filename: string, content: Buffer | string) => {
  const { body, headers } = multipart(filename, content);
  return ctx.app.inject({ method: "POST", url: `/api/v1/leads/${lead}/documents`, headers: { ...headers, cookie: cookies[who]! }, payload: body });
};

beforeAll(async () => {
  ctx = await setupApp();
});
beforeEach(async () => {
  await seed(ctx.handle.db, ctx.storage);
  cookies = { admin: await ctx.login(ADMIN), aisha: await ctx.login(AISHA), rahul: await ctx.login(RAHUL) };
});
afterAll(async () => ctx?.close());

describe("uploads", () => {
  it("anyone can upload an allowed file; it lists, downloads byte-for-byte and records a feed event", async () => {
    const maya = await leadId("Maya Chen");
    const res = await upload("rahul", maya, "Scope v3 (final).pdf", "%PDF-1.4 hello");
    expect(res.statusCode, res.body).toBe(201);
    const doc = res.json().document as DocumentDTO;
    expect(doc).toMatchObject({ filename: "Scope v3 (final).pdf", mimeType: "application/pdf", sizeBytes: 14, shared: false, uploadedBy: { name: "Rahul Kapoor" }, canManage: true });

    const list = (await ctx.as(cookies.aisha!).get(`/api/v1/leads/${maya}/documents`)).json().documents as DocumentDTO[];
    expect(list[0]!.id).toBe(doc.id);
    expect(list).toHaveLength(4);

    const dl = await ctx.as(cookies.admin!).get(`/api/v1/documents/${doc.id}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe("%PDF-1.4 hello");
    expect(dl.headers["content-disposition"]).toContain("attachment");
    expect(dl.headers["content-disposition"]).toContain("filename*=UTF-8''Scope%20v3%20(final).pdf");
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");

    const feed = (await ctx.as(cookies.admin!).get("/api/v1/feed?limit=1")).json().events;
    expect(feed[0]).toMatchObject({ type: "document.uploaded", payload: { filename: "Scope v3 (final).pdf" } });
  });

  it("seeded documents have real files behind them", async () => {
    const maya = await leadId("Maya Chen");
    const docs = (await ctx.as(cookies.admin!).get(`/api/v1/leads/${maya}/documents`)).json().documents as DocumentDTO[];
    const dl = await ctx.as(cookies.admin!).get(`/api/v1/documents/${docs[0]!.id}/download?inline=1`);
    expect(dl.statusCode).toBe(200);
    expect(dl.body.startsWith("%PDF-1.4")).toBe(true);
    expect(dl.headers["content-disposition"]).toContain("inline");
  });

  it("rejects disallowed types, empty files and path tricks in names", async () => {
    const maya = await leadId("Maya Chen");
    expect((await upload("rahul", maya, "evil.html", "<script>")).statusCode).toBe(415);
    expect((await upload("rahul", maya, "run.exe", "MZ")).statusCode).toBe(415);
    expect((await upload("rahul", maya, "empty.pdf", "")).statusCode).toBe(400);
    const sneaky = await upload("rahul", maya, "../../etc/passwd.txt", "x");
    expect(sneaky.statusCode).toBe(201);
    expect(sneaky.json().document.filename).toBe("passwd.txt");
  });

  it("rejects files over the size limit", async () => {
    const maya = await leadId("Maya Chen");
    const big = Buffer.alloc(26 * 1024 * 1024, 1); // default limit 25 MB
    const res = await upload("rahul", maya, "big.zip", big);
    expect(res.statusCode).toBe(413);
  });

  it("only the uploader, the lead owner or an admin can delete; others get 403", async () => {
    const maya = await leadId("Maya Chen"); // owner Aisha
    const doc = (await upload("rahul", maya, "notes.txt", "hi")).json().document as DocumentDTO;
    const seeded = ((await ctx.as(cookies.rahul!).get(`/api/v1/leads/${maya}/documents`)).json().documents as DocumentDTO[]).find((d) => d.filename === "Mutual_NDA.pdf")!;
    expect(seeded.canManage).toBe(false);
    expect((await ctx.as(cookies.rahul!).delete(`/api/v1/documents/${seeded.id}`)).statusCode).toBe(403);
    expect((await ctx.as(cookies.aisha!).delete(`/api/v1/documents/${doc.id}`)).statusCode).toBe(204);
    expect((await ctx.as(cookies.admin!).get(`/api/v1/documents/${doc.id}/download`)).statusCode).toBe(404);
  });
});

describe("share links", () => {
  it("creates a public link that works without sign-in, counts views and tells the owner", async () => {
    const maya = await leadId("Maya Chen");
    const doc = ((await ctx.as(cookies.aisha!).get(`/api/v1/leads/${maya}/documents`)).json().documents as DocumentDTO[]).find((d) => d.filename === "Discovery_Brief.pdf")!;
    const link = await ctx.as(cookies.aisha!).post(`/api/v1/documents/${doc.id}/share`, { expiresInDays: 7 });
    expect(link.statusCode).toBe(200);
    const path = new URL(link.json().shareUrl).pathname;

    const view = await ctx.app.inject({ method: "GET", url: path });
    expect(view.statusCode).toBe(200);
    expect(view.body.startsWith("%PDF")).toBe(true);
    expect(view.headers["x-robots-tag"]).toContain("noindex");
    await ctx.app.inject({ method: "GET", url: path });

    const after = ((await ctx.as(cookies.aisha!).get(`/api/v1/leads/${maya}/documents`)).json().documents as DocumentDTO[]).find((d) => d.id === doc.id)!;
    expect(after).toMatchObject({ shared: true, viewCount: 2 });
    expect(after.firstViewedAt).not.toBeNull();

    // One feed event for the burst of views, attributed to the lead's company.
    const viewed = (await ctx.as(cookies.admin!).get("/api/v1/feed?type=document.viewed")).json().events;
    expect(viewed.filter((e: { payload: { filename: string } }) => e.payload.filename === "Discovery_Brief.pdf")).toHaveLength(1);
    expect(viewed[0].payload.viewer).toBe("Northstar Labs");
    // Aisha uploaded it and owns the lead: one notification, not two.
    const notes = (await ctx.as(cookies.aisha!).get("/api/v1/notifications")).json();
    expect(notes.items.filter((n: { event: { type: string } }) => n.event.type === "document.viewed")).toHaveLength(1);
  });

  it("revoked, replaced or unknown links stop working; only managers can share", async () => {
    const maya = await leadId("Maya Chen");
    const doc = ((await ctx.as(cookies.aisha!).get(`/api/v1/leads/${maya}/documents`)).json().documents as DocumentDTO[])[0]!;
    expect((await ctx.as(cookies.rahul!).post(`/api/v1/documents/${doc.id}/share`, {})).statusCode).toBe(403);
    const first = new URL((await ctx.as(cookies.aisha!).post(`/api/v1/documents/${doc.id}/share`, {})).json().shareUrl).pathname;
    const second = new URL((await ctx.as(cookies.aisha!).post(`/api/v1/documents/${doc.id}/share`, {})).json().shareUrl).pathname;
    expect((await ctx.app.inject({ method: "GET", url: first })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "GET", url: second })).statusCode).toBe(200);
    expect((await ctx.as(cookies.aisha!).delete(`/api/v1/documents/${doc.id}/share`)).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: "GET", url: second })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "GET", url: "/api/v1/share/not-a-real-token-but-long-enough" })).statusCode).toBe(404);
  });

  it("documents of a deleted lead are no longer reachable", async () => {
    const maya = await leadId("Maya Chen");
    const doc = ((await ctx.as(cookies.aisha!).get(`/api/v1/leads/${maya}/documents`)).json().documents as DocumentDTO[])[0]!;
    const path = new URL((await ctx.as(cookies.aisha!).post(`/api/v1/documents/${doc.id}/share`, {})).json().shareUrl).pathname;
    await ctx.as(cookies.aisha!).delete(`/api/v1/leads/${maya}`);
    expect((await ctx.app.inject({ method: "GET", url: path })).statusCode).toBe(404);
    expect((await ctx.as(cookies.admin!).get(`/api/v1/documents/${doc.id}/download`)).statusCode).toBe(404);
  });
});
