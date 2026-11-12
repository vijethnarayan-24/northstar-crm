import { sql, type SQL } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { LOST_REASONS, reportQuery, type LostReason, type ReportsDTO } from "@crm/shared";
import { requireAuth } from "../auth/session";
import type { Database } from "../db/client";
import { workspaceTimezone } from "../lib/time";

/**
 * Sales reports. Everyone signed in can see them (the whole pipeline is visible to the team).
 *  - "Closed in the range": won_at / lost_at falls inside the dates (workspace time zone).
 *  - Sales cycle: days from a lead's creation to being won.
 *  - Source performance: leads *created* in the range, by source, and what became of them.
 */

const DAY = 86_400_000;
/** YYYY-MM-DD for a moment, in a time zone. */
const dayIn = (tz: string, date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** node-postgres returns { rows }, PGlite too; normalise. */
const rows = <T>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

async function resolveRange(db: Database, q: { from?: string; to?: string }) {
  const tz = await workspaceTimezone(db);
  const to = q.to ?? dayIn(tz);
  const from = q.from ?? new Date(new Date(`${to}T12:00:00Z`).getTime() - 89 * DAY).toISOString().slice(0, 10);
  return {
    tz,
    from,
    to,
    start: sql`(${from}::date::timestamp at time zone ${tz})`,
    end: sql`((${to}::date + 1)::timestamp at time zone ${tz})`,
  };
}

function filters(q: { ownerId?: string; sourceId?: string }): SQL {
  const parts: SQL[] = [sql`l.deleted_at is null`];
  if (q.ownerId) parts.push(sql`l.owner_id = ${q.ownerId}`);
  if (q.sourceId) parts.push(sql`l.source_id = ${q.sourceId}`);
  return sql.join(parts, sql` and `);
}

export async function buildReport(db: Database, query: unknown): Promise<ReportsDTO> {
  const q = reportQuery.parse(query);
  const { tz, from, to, start, end } = await resolveRange(db, q);
  const where = filters(q);
  const wonIn = sql`(s.kind = 'won' and l.won_at >= ${start} and l.won_at < ${end})`;
  const lostIn = sql`(s.kind = 'lost' and l.lost_at >= ${start} and l.lost_at < ${end})`;
  const createdIn = sql`(l.created_at >= ${start} and l.created_at < ${end})`;
  const cycle = sql`(extract(epoch from (l.won_at - l.created_at)) / 86400.0)`;
  const base = sql`from leads l join pipeline_stages s on s.id = l.stage_id where ${where}`;

  const [summaryRows, reasonRows, sourceRows, ownerRows, bucketRows, monthRows] = await Promise.all([
    db.execute(sql`select
        count(*) filter (where ${createdIn})::int as created,
        count(*) filter (where ${wonIn})::int as won,
        coalesce(sum(l.value_cents) filter (where ${wonIn}), 0)::float8 as won_cents,
        count(*) filter (where ${lostIn})::int as lost,
        coalesce(sum(l.value_cents) filter (where ${lostIn}), 0)::float8 as lost_cents,
        avg(${cycle}) filter (where ${wonIn})::float8 as avg_cycle,
        (percentile_cont(0.5) within group (order by ${cycle}) filter (where ${wonIn}))::float8 as median_cycle
      ${base}`),
    db.execute(sql`select l.lost_reason as reason, count(*)::int as count, coalesce(sum(l.value_cents), 0)::float8 as value_cents
      ${base} and ${lostIn} group by l.lost_reason order by count(*) desc`),
    db.execute(sql`select src.id as source_id, src.name as source_name, src.color as source_color,
        count(*)::int as created,
        count(*) filter (where s.kind = 'won')::int as won,
        count(*) filter (where s.kind = 'lost')::int as lost,
        count(*) filter (where s.kind = 'open')::int as open,
        coalesce(sum(l.value_cents) filter (where s.kind = 'won'), 0)::float8 as won_cents,
        avg(${cycle}) filter (where s.kind = 'won' and l.won_at is not null)::float8 as avg_cycle
      from leads l join pipeline_stages s on s.id = l.stage_id left join lead_sources src on src.id = l.source_id
      where ${where} and ${createdIn}
      group by src.id, src.name, src.color order by count(*) desc`),
    db.execute(sql`select u.id as owner_id, u.name as owner_name, u.avatar_color as owner_color,
        count(*) filter (where ${wonIn})::int as won,
        count(*) filter (where ${lostIn})::int as lost,
        coalesce(sum(l.value_cents) filter (where ${wonIn}), 0)::float8 as won_cents,
        avg(${cycle}) filter (where ${wonIn})::float8 as avg_cycle
      from leads l join pipeline_stages s on s.id = l.stage_id left join users u on u.id = l.owner_id
      where ${where} and (${wonIn} or ${lostIn})
      group by u.id, u.name, u.avatar_color order by coalesce(sum(l.value_cents) filter (where ${wonIn}), 0) desc`),
    db.execute(sql`select
        count(*) filter (where ${cycle} <= 7)::int as b1,
        count(*) filter (where ${cycle} > 7 and ${cycle} <= 30)::int as b2,
        count(*) filter (where ${cycle} > 30 and ${cycle} <= 60)::int as b3,
        count(*) filter (where ${cycle} > 60 and ${cycle} <= 90)::int as b4,
        count(*) filter (where ${cycle} > 90)::int as b5
      ${base} and ${wonIn}`),
    db.execute(sql`select month, sum(won)::int as won, sum(lost)::int as lost, sum(won_cents)::float8 as won_cents from (
        select to_char(l.won_at at time zone ${tz}, 'YYYY-MM') as month, 1 as won, 0 as lost, coalesce(l.value_cents, 0) as won_cents ${base} and ${wonIn}
        union all
        select to_char(l.lost_at at time zone ${tz}, 'YYYY-MM') as month, 0, 1, 0 ${base} and ${lostIn}
      ) closed group by month order by month`),
  ]);

  const s = rows<Record<string, unknown>>(summaryRows)[0] ?? {};
  const won = Number(s.won ?? 0);
  const lost = Number(s.lost ?? 0);
  const wonCents = Number(s.won_cents ?? 0);
  const b = rows<Record<string, number>>(bucketRows)[0] ?? {};

  // Every month in the range, so the chart has no gaps.
  const months: string[] = [];
  for (let d = new Date(`${from.slice(0, 7)}-01T12:00:00Z`); d.toISOString().slice(0, 7) <= to.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  const byMonth = new Map(rows<{ month: string; won: number; lost: number; won_cents: number }>(monthRows).map((r) => [r.month, r]));

  return {
    range: { from, to, timezone: tz },
    summary: {
      created: Number(s.created ?? 0),
      won,
      wonCents,
      lost,
      lostCents: Number(s.lost_cents ?? 0),
      winRate: ratio(won, won + lost),
      avgDealCents: won ? Math.round(wonCents / won) : null,
      avgCycleDays: round1(num(s.avg_cycle)),
      medianCycleDays: round1(num(s.median_cycle)),
    },
    lostReasons: rows<{ reason: string | null; count: number; value_cents: number }>(reasonRows).map((r) => ({
      reason: (LOST_REASONS as readonly string[]).includes(r.reason ?? "") ? (r.reason as LostReason) : "other",
      count: Number(r.count),
      valueCents: Number(r.value_cents),
    })),
    sources: rows<Record<string, unknown>>(sourceRows).map((r) => ({
      source: r.source_id ? { id: String(r.source_id), name: String(r.source_name), color: r.source_color as never } : null,
      created: Number(r.created),
      won: Number(r.won),
      lost: Number(r.lost),
      open: Number(r.open),
      wonCents: Number(r.won_cents),
      conversion: ratio(Number(r.won), Number(r.created)),
      avgCycleDays: round1(num(r.avg_cycle)),
    })),
    owners: rows<Record<string, unknown>>(ownerRows).map((r) => ({
      owner: r.owner_id ? { id: String(r.owner_id), name: String(r.owner_name), avatarColor: r.owner_color as never } : null,
      won: Number(r.won),
      lost: Number(r.lost),
      wonCents: Number(r.won_cents),
      winRate: ratio(Number(r.won), Number(r.won) + Number(r.lost)),
      avgCycleDays: round1(num(r.avg_cycle)),
    })),
    cycleBuckets: [
      { label: "0–7 days", count: Number(b.b1 ?? 0) },
      { label: "8–30 days", count: Number(b.b2 ?? 0) },
      { label: "31–60 days", count: Number(b.b3 ?? 0) },
      { label: "61–90 days", count: Number(b.b4 ?? 0) },
      { label: "90+ days", count: Number(b.b5 ?? 0) },
    ],
    monthly: months.map((month) => {
      const r = byMonth.get(month);
      return { month, won: Number(r?.won ?? 0), lost: Number(r?.lost ?? 0), wonCents: Number(r?.won_cents ?? 0) };
    }),
  };
}

/** One CSV cell: quoted, and spreadsheet formulas neutralised (a cell starting with = + - @ runs in Excel). */
function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const reportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/reports", async (request): Promise<ReportsDTO> => buildReport(app.db, request.query));

  /** Every deal closed (won or lost) in the range, one row each, for spreadsheets. */
  app.get("/reports/deals.csv", async (request, reply) => {
    const q = reportQuery.parse(request.query);
    const { tz, from, to, start, end } = await resolveRange(app.db, q);
    const result = await app.db.execute(sql`select l.full_name, l.company, l.email, src.name as source, u.name as owner,
        s.kind as outcome, l.lost_reason, l.lost_notes, l.value_cents,
        to_char(l.created_at at time zone ${tz}, 'YYYY-MM-DD') as created,
        to_char(coalesce(l.won_at, l.lost_at) at time zone ${tz}, 'YYYY-MM-DD') as closed,
        round((extract(epoch from (coalesce(l.won_at, l.lost_at) - l.created_at)) / 86400.0)::numeric, 1)::float8 as days
      from leads l join pipeline_stages s on s.id = l.stage_id
      left join lead_sources src on src.id = l.source_id left join users u on u.id = l.owner_id
      where ${filters(q)} and ((s.kind = 'won' and l.won_at >= ${start} and l.won_at < ${end}) or (s.kind = 'lost' and l.lost_at >= ${start} and l.lost_at < ${end}))
      order by coalesce(l.won_at, l.lost_at) desc`);
    const header = ["Lead", "Company", "Email", "Source", "Owner", "Outcome", "Lost reason", "Lost notes", "Value", "Created", "Closed", "Days to close"];
    const lines = rows<Record<string, unknown>>(result).map((r) =>
      [r.full_name, r.company, r.email, r.source, r.owner, r.outcome === "won" ? "Won" : "Lost", r.lost_reason, r.lost_notes,
        r.value_cents === null ? "" : (Number(r.value_cents) / 100).toFixed(2), r.created, r.closed, r.days].map(csvCell).join(","),
    );
    // BOM so Excel opens it as UTF-8.
    const body = `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="closed-deals-${from}-to-${to}.csv"`)
      .send(body);
  });
};

export default reportRoutes;
