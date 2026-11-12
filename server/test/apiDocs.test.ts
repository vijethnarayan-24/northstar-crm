import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paths } from "../src/env";
import { setupApp } from "./helpers";

/** docs/API.md must list every registered route as `METHOD /path`, and nothing that no longer exists. */
let ctx: Awaited<ReturnType<typeof setupApp>>;
const doc = readFileSync(path.join(paths.serverRoot, "..", "docs", "API.md"), "utf8");
const documented = new Set([...doc.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/api\/v1\/[^`\s]*)`/g)].map((m) => `${m[1]} ${m[2]}`));

beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(async () => ctx?.close());

describe("API reference", () => {
  it("documents every route", () => {
    const routes = ctx.app.routeList.filter((r) => r.method !== "OPTIONS").map((r) => `${r.method} ${r.url}`);
    const missing = routes.filter((r) => !documented.has(r));
    expect(missing, "add these endpoints to docs/API.md").toEqual([]);
  });

  it("doesn't document routes that don't exist", () => {
    const routes = new Set(ctx.app.routeList.map((r) => `${r.method} ${r.url}`));
    const stale = [...documented].filter((r) => !routes.has(r));
    expect(stale, "remove or fix these in docs/API.md").toEqual([]);
  });
});
