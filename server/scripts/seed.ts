/**
 * Seeds a development database with the same people, leads, tasks and history
 * the UI prototype showed, with dates relative to "now" so overdue/age logic
 * stays realistic whenever you reseed.
 *
 * All seeded users share the password from SEED_PASSWORD (see server/.env.example).
 */
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { openDatabase, schema, type Database } from "../src/db/client";
import { env } from "../src/env";
import { hashPassword } from "../src/lib/password";
import { createLocalStorage, type Storage } from "../src/lib/storage";
import { placeholderPdf } from "./placeholder-pdf";
import { Readable } from "node:stream";

const DEFAULT_SEED_PASSWORD = "northstar-dev-only";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs);
/** Today at the given local hour/minute. */
const todayAt = (h: number, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export async function seed(db: Database, storage: Storage = createLocalStorage()) {
  // Real (tiny) PDFs behind the seeded documents so downloads and share links work.
  const seedFiles = {
    "seed/northstar-proposal-v2.pdf": "Northstar Product Proposal v2",
    "seed/discovery-brief.pdf": "Discovery Brief",
    "seed/mutual-nda.pdf": "Mutual NDA",
  } as const;
  const sizes: Record<string, number> = {};
  for (const [key, title] of Object.entries(seedFiles)) sizes[key] = await storage.save(key, Readable.from(placeholderPdf(title)), 1024 * 1024);

  const {
    workspace, users, leadSources, pipelineStages, tags, goals, leads, leadTags,
    activities, tasks, documents, stageChanges, events, notificationPrefs,
  } = schema;

  await db.transaction(async (tx) => {
    await tx.execute(sql`truncate table
      notifications, notification_prefs, events, stage_changes, documents, tasks, activities,
      lead_tags, leads, goals, tags, pipeline_stages, lead_sources, invitations, password_resets,
      sessions, users, workspace restart identity cascade`);

    // Use the machine's time zone so "today" in dev matches the developer's clock; change it in Settings → Workspace.
    await tx.insert(workspace).values({ id: 1, name: "Northstar", currency: "USD", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });

    // ---------- Team ----------
    const passwordHash = await hashPassword(process.env.SEED_PASSWORD || DEFAULT_SEED_PASSWORD);
    const [alex, aisha, rahul, mia] = await tx
      .insert(users)
      .values([
        { name: "Alex Kumar", email: "alex@northstar.agency", role: "admin", avatarColor: "violet", passwordHash },
        { name: "Aisha Rahman", email: "aisha@northstar.agency", role: "member", avatarColor: "violet", passwordHash },
        { name: "Rahul Kapoor", email: "rahul@northstar.agency", role: "member", avatarColor: "blue", passwordHash },
        { name: "Mia Kim", email: "mia@northstar.agency", role: "member", avatarColor: "violet", status: "away", passwordHash },
      ])
      .returning();

    // ---------- Configuration ----------
    const sourceRows = await tx
      .insert(leadSources)
      .values([
        { name: "Website", color: "violet", position: 0 },
        { name: "Upwork", color: "green", position: 1 },
        { name: "LinkedIn", color: "blue", position: 2 },
        { name: "Contra", color: "orange", position: 3 },
        { name: "Referral", color: "amber", position: 4 },
        { name: "Other", color: "gray", position: 5 },
      ])
      .returning();
    const source = Object.fromEntries(sourceRows.map((s) => [s.name, s.id]));

    const stageRows = await tx
      .insert(pipelineStages)
      .values([
        { name: "New", color: "blue", kind: "open", position: 0 },
        { name: "Contacted", color: "violet", kind: "open", position: 1 },
        { name: "In Discussion", color: "orange", kind: "open", position: 2 },
        { name: "Proposal Sent", color: "amber", kind: "open", position: 3 },
        { name: "Negotiation", color: "violet", kind: "open", position: 4 },
        { name: "Won", color: "green", kind: "won", position: 5 },
        { name: "Lost", color: "red", kind: "lost", position: 6 },
      ])
      .returning();
    const stage = Object.fromEntries(stageRows.map((s) => [s.name, s.id]));

    const tagRows = await tx
      .insert(tags)
      .values([
        { name: "High-value", color: "violet" },
        { name: "Urgent", color: "red" },
        { name: "Startup", color: "blue" },
        { name: "Agency partner", color: "green" },
        { name: "SaaS", color: "gray" },
        { name: "Q1 launch", color: "gray" },
      ])
      .returning();
    const tag = Object.fromEntries(tagRows.map((t) => [t.name, t.id]));

    const month = new Intl.DateTimeFormat("en-CA", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 7);
    await tx.insert(goals).values({ month, targetCents: 100_000_00 });

    // ---------- Leads ----------
    const leadRows = await tx
      .insert(leads)
      .values([
        {
          fullName: "Maya Chen", company: "Northstar Labs", jobTitle: "Head of Product",
          email: "maya@northstarlabs.io", phone: "+1 415 902 1847", location: "San Francisco, US",
          sourceId: source.Website, leadType: "Product Design", projectType: "one_time", temperature: "hot",
          stageId: stage.Negotiation, intent: "active", valueCents: 24_000_00, dealSize: "enterprise",
          expectedClose: dateOnly(at(30 * DAY)), ownerId: aisha.id, nextFollowupAt: todayAt(14, 30),
          pinnedNote: "Looking to redesign their SaaS platform before the Q1 investor roadshow. Strong fit for the product team.",
          pinnedBy: aisha.id, pinnedAt: at(-2 * DAY), lastActivityAt: at(-2 * HOUR), createdBy: aisha.id, createdAt: at(-4 * DAY),
        },
        {
          fullName: "James Wilson", company: "Arcstone Finance", sourceId: source.LinkedIn, leadType: "Development",
          temperature: "warm", stageId: stage["Proposal Sent"], valueCents: 18_500_00, ownerId: rahul.id,
          nextFollowupAt: at(2 * DAY), lastActivityAt: at(-1 * DAY), createdBy: rahul.id, createdAt: at(-8 * DAY),
        },
        {
          fullName: "Lena Rodriguez", company: "Flourish Health", sourceId: source.Referral, leadType: "Design",
          temperature: "hot", stageId: stage["In Discussion"], valueCents: 32_000_00, ownerId: mia.id,
          nextFollowupAt: at(-1 * DAY), lastActivityAt: at(-1 * DAY), createdBy: mia.id, createdAt: at(-6 * DAY),
        },
        {
          fullName: "Owen Wright", company: "Pixelworks", sourceId: source.Upwork, leadType: "Development",
          temperature: "cold", stageId: stage.Contacted, valueCents: 8_000_00, ownerId: aisha.id,
          nextFollowupAt: at(4 * DAY), lastActivityAt: at(-3 * DAY), createdBy: aisha.id, createdAt: at(-14 * DAY),
        },
        {
          fullName: "Priya Shah", company: "Terra & Co.", sourceId: source.Contra, leadType: "Marketing",
          temperature: "warm", stageId: stage.New, valueCents: 12_400_00, ownerId: rahul.id,
          nextFollowupAt: at(1 * DAY), lastActivityAt: at(-4 * HOUR), createdBy: rahul.id, createdAt: at(-2 * DAY),
        },
        {
          fullName: "Daniel Kim", company: "Monocle Studio", sourceId: source.Website, leadType: "Consulting",
          temperature: "cold", stageId: stage.Won, valueCents: 9_600_00, ownerId: mia.id, wonAt: at(-5 * DAY),
          lastActivityAt: at(-5 * DAY), createdBy: mia.id, createdAt: at(-21 * DAY),
        },
        {
          fullName: "Nora Reed", company: "Halcyon AI", sourceId: source.Website, leadType: "Design",
          temperature: "hot", stageId: stage.New, position: 1, valueCents: 16_000_00, ownerId: aisha.id,
          nextFollowupAt: todayAt(16), lastActivityAt: at(-6 * HOUR), createdBy: aisha.id, createdAt: at(-1 * DAY),
        },
        {
          fullName: "Theo Martin", company: "Atlas Goods", sourceId: source.LinkedIn, leadType: "Development",
          temperature: "warm", stageId: stage.Contacted, position: 1, valueCents: 7_500_00, ownerId: rahul.id,
          nextFollowupAt: at(3 * DAY), lastActivityAt: at(-2 * DAY), createdBy: rahul.id, createdAt: at(-9 * DAY),
        },
        {
          fullName: "Sara Ahmed", company: "Unison", sourceId: source.Referral, leadType: "Design",
          temperature: "hot", stageId: stage["Proposal Sent"], position: 1, valueCents: 28_000_00, ownerId: mia.id,
          nextFollowupAt: at(-2 * DAY), lastActivityAt: at(-2 * DAY), createdBy: mia.id, createdAt: at(-11 * DAY),
        },
      ])
      .returning();
    const lead = Object.fromEntries(leadRows.map((l) => [l.fullName, l]));
    const maya = lead["Maya Chen"];

    await tx.insert(leadTags).values([
      { leadId: maya.id, tagId: tag["High-value"] },
      { leadId: maya.id, tagId: tag.SaaS },
      { leadId: maya.id, tagId: tag["Q1 launch"] },
      { leadId: lead["Lena Rodriguez"].id, tagId: tag["High-value"] },
      { leadId: lead["Nora Reed"].id, tagId: tag.Startup },
      { leadId: lead["Sara Ahmed"].id, tagId: tag.Urgent },
    ]);

    // ---------- Maya's timeline ----------
    await tx.insert(activities).values([
      {
        leadId: maya.id, type: "email", occurredAt: at(-2 * HOUR), authorId: aisha.id,
        title: "Sent revised scope and timeline",
        body: "Maya confirmed the revised timeline works. She'll share it with the co-founder and get back by Friday.",
        nextStep: "Follow up Friday morning if no response",
      },
      {
        leadId: maya.id, type: "call", occurredAt: at(-2 * DAY), authorId: alex.id,
        title: "45-minute discovery call",
        body: "Discussed current product pain points, investor roadshow, and the need for a scalable design system.",
        nextStep: "Prepare phased proposal with design system included",
      },
      {
        leadId: maya.id, type: "note", occurredAt: at(-4 * DAY), authorId: aisha.id,
        title: "Lead qualification note",
        body: "Budget confirmed between $20–30k. Decision makers are Maya and co-founder Daniel.",
        nextStep: "Schedule discovery call",
      },
      {
        leadId: lead["Lena Rodriguez"].id, type: "email", occurredAt: at(-1 * HOUR), authorId: mia.id,
        title: "Shared case studies", body: "Sent two healthcare case studies and availability for a call.",
      },
    ]);

    await tx.insert(stageChanges).values([
      { leadId: maya.id, fromStageId: null, toStageId: stage.New, changedBy: aisha.id, changedAt: at(-4 * DAY) },
      { leadId: maya.id, fromStageId: stage.New, toStageId: stage.Contacted, changedBy: aisha.id, changedAt: at(-4 * DAY + HOUR) },
      { leadId: maya.id, fromStageId: stage.Contacted, toStageId: stage["In Discussion"], changedBy: aisha.id, changedAt: at(-3 * DAY) },
      { leadId: maya.id, fromStageId: stage["In Discussion"], toStageId: stage["Proposal Sent"], changedBy: alex.id, changedAt: at(-2 * DAY) },
      { leadId: maya.id, fromStageId: stage["Proposal Sent"], toStageId: stage.Negotiation, changedBy: aisha.id, changedAt: at(-1 * DAY) },
    ]);

    await tx.insert(documents).values([
      { leadId: maya.id, filename: "Northstar_Product_Proposal_v2.pdf", storageKey: "seed/northstar-proposal-v2.pdf", sizeBytes: sizes["seed/northstar-proposal-v2.pdf"]!, mimeType: "application/pdf", uploadedBy: aisha.id, sentAt: at(-2 * DAY), firstViewedAt: at(-2 * DAY + 3 * HOUR), lastViewedAt: at(-2 * HOUR), viewCount: 3, createdAt: at(-2 * DAY) },
      { leadId: maya.id, filename: "Discovery_Brief.pdf", storageKey: "seed/discovery-brief.pdf", sizeBytes: sizes["seed/discovery-brief.pdf"]!, mimeType: "application/pdf", uploadedBy: aisha.id, sentAt: at(-3 * DAY), createdAt: at(-3 * DAY) },
      { leadId: maya.id, filename: "Mutual_NDA.pdf", storageKey: "seed/mutual-nda.pdf", sizeBytes: sizes["seed/mutual-nda.pdf"]!, mimeType: "application/pdf", uploadedBy: aisha.id, sentAt: at(-4 * DAY), createdAt: at(-4 * DAY) },
    ]);

    // ---------- Tasks ----------
    await tx.insert(tasks).values([
      { title: "Send revised proposal to Northstar", leadId: maya.id, assigneeId: aisha.id, dueAt: at(-1 * DAY), createdBy: aisha.id },
      { title: "Discovery call with Maya Chen", leadId: maya.id, assigneeId: alex.id, dueAt: at(-3 * HOUR), createdBy: alex.id },
      { title: "Review Flourish creative brief", leadId: lead["Lena Rodriguez"].id, assigneeId: mia.id, dueAt: todayAt(14), createdBy: mia.id },
      { title: "Follow up on Arcstone contract", leadId: lead["James Wilson"].id, assigneeId: rahul.id, dueAt: todayAt(16, 30), createdBy: rahul.id },
      { title: "Prepare kickoff agenda", leadId: lead["Priya Shah"].id, assigneeId: rahul.id, dueAt: todayAt(17), createdBy: rahul.id },
      { title: "Update project estimate", leadId: lead["Owen Wright"].id, assigneeId: aisha.id, dueAt: todayAt(10), completedAt: todayAt(9, 40), createdBy: aisha.id },
      { title: "Follow up on revised proposal", leadId: maya.id, assigneeId: aisha.id, dueAt: at(2 * DAY), createdBy: aisha.id },
      { title: "Send design system case study", leadId: maya.id, assigneeId: aisha.id, dueAt: at(5 * DAY), createdBy: aisha.id },
      { title: "Schedule stakeholder workshop", leadId: maya.id, assigneeId: aisha.id, dueAt: at(7 * DAY), createdBy: aisha.id },
    ]);

    // ---------- Activity feed ----------
    await tx.insert(events).values([
      { type: "lead.stage_changed", actorId: rahul.id, leadId: lead["James Wilson"].id, payload: { from: "In Discussion", to: "Proposal Sent" }, createdAt: at(-8 * 60_000) },
      { type: "lead.created", actorId: aisha.id, leadId: maya.id, payload: {}, createdAt: at(-24 * 60_000) },
      { type: "activity.logged", actorId: mia.id, leadId: lead["Lena Rodriguez"].id, payload: { activityType: "email" }, createdAt: at(-1 * HOUR) },
      { type: "document.viewed", actorId: null, leadId: maya.id, payload: { filename: "Northstar_Product_Proposal_v2.pdf", viewer: "Northstar Labs" }, createdAt: at(-2 * HOUR) },
      { type: "note.pinned", actorId: alex.id, leadId: lead["Priya Shah"].id, payload: {}, createdAt: at(-3 * HOUR) },
    ]);

    // ---------- Default notification preferences ----------
    const defaultEvents = ["lead.assigned", "followup.due", "lead.stage_changed", "document.viewed"] as const;
    await tx.insert(notificationPrefs).values(
      [alex, aisha, rahul, mia].flatMap((u) => defaultEvents.map((eventType) => ({ userId: u.id, eventType, email: true, inApp: true }))),
    );
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (env.NODE_ENV === "production") {
    console.error("Refusing to seed a production database.");
    process.exit(1);
  }
  const handle = await openDatabase();
  await handle.migrate();
  await seed(handle.db);
  console.log(`Seeded ${handle.driver} database.`);
  await handle.close();
}
