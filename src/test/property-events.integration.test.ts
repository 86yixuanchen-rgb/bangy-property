// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@/db/schema";
import { createRequestRecord, linkRequestToProperty } from "@/lib/request-create.server";
const session = vi.hoisted(() => ({ userId: "property-user" }));
let db: ReturnType<typeof drizzle<typeof schema>>;
const aiFixture = vi.hoisted(() => ({ content: "{}", requestBody: "" }));
vi.mock("@/lib/ai-gateway.server", () => ({
  aiConfigured: () => true,
  fetchDeepSeek: async (input: { body: string }) => {
    aiFixture.requestBody = input.body;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: aiFixture.content } }] }),
      { status: 200 },
    );
  },
}));

vi.mock("@/lib/db.server", () => ({ getDb: async () => db }));
vi.mock("@clerk/tanstack-react-start/server", () => ({
  auth: async () => ({ userId: session.userId }),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse = (v: unknown) => v;
    const chain = {
      validator: (schema: { parse: (v: unknown) => unknown }) => {
        parse = schema.parse.bind(schema);
        return chain;
      },
      handler: (fn: (v: { data: unknown }) => unknown) => async (args?: { data: unknown }) =>
        fn({ data: args ? parse(args.data) : undefined }),
    };
    return chain;
  },
}));

beforeAll(async () => {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ DB: import("drizzle-orm/d1").AnyD1Database }>({
    persist: { path: mkdtempSync(join(tmpdir(), "banjg-properties-")) },
  });
  afterAll(() => proxy.dispose());
  const raw = proxy.env.DB;
  for (const file of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (file.startsWith("0006")) {
      for (const statement of [
        "INSERT INTO properties(id,user_id,address) VALUES (9001,'migration','12 Test St'),(9002,'migration','Duplicate'),(9003,'migration',' duplicate '),(9004,'other','Foreign address')",
        ...[
          ["REQ-901", " 12 test st "],
          ["REQ-902", "Duplicate"],
          ["REQ-903", "Foreign address"],
        ].map(
          ([id, address]) =>
            `INSERT INTO repair_requests(user_id,id,title,address,priority,board_column,status,waiting_on,next_action,waiting,last_update,sort_order) VALUES ('migration','${id}','Legacy','${address}','High','New','New','PM','Review','','',0)`,
        ),
      ])
        await raw.prepare(statement).run();
    }
    for (const statement of readFileSync(join("drizzle", file), "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await raw.prepare(statement).run();
    }
  }
  db = drizzle(raw, { schema });
});
let counter = 0;
beforeEach(() => {
  session.userId = `property-user-${++counter}`;
});
const input = () => ({
  address: "24 King St",
  managerName: "PM",
  managerEmail: "pm@example.test",
  ownerName: "Owner",
  ownerEmail: "owner@example.test",
  tenantName: "Tenant",
  tenantEmail: "tenant@example.test",
  notes: "",
});
async function property() {
  const { addProperty } = await import("@/lib/workspace.functions");
  return addProperty({ data: input() });
}
describe("Property-centred events", () => {
  it("backfills only exact unambiguous addresses in the same workspace", async () => {
    const rows = await db
      .select()
      .from(schema.repairRequests)
      .where(eq(schema.repairRequests.userId, "migration"));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.propertyId]))).toEqual({
      "REQ-901": 9001,
      "REQ-902": null,
      "REQ-903": null,
    });
  });
  it("requires a property for new API events and derives the canonical address and three people", async () => {
    const p = await property();
    const { createRequest } = await import("@/lib/requests.functions");
    // Deliberately malformed network input must be rejected by the server validator.
    await expect(
      createRequest({ data: { title: "Missing property", priority: "High" } as never }),
    ).rejects.toThrow();
    const r = await createRequest({
      data: { title: "Tap leak", propertyId: p.id, priority: "High" },
    });
    expect(r.propertyId).toBe(p.id);
    expect(r.address).toBe(p.address);
    const people = await db
      .select()
      .from(schema.requestParticipants)
      .where(
        and(
          eq(schema.requestParticipants.userId, session.userId),
          eq(schema.requestParticipants.requestId, r.id),
        ),
      );
    expect(people.map((x) => x.role).sort()).toEqual(["Landlord", "Property Manager", "Tenant"]);
  });
  it("rejects another workspace's property and event links", async () => {
    const p = await property();
    const owner = session.userId;
    session.userId = "stranger";
    await expect(
      createRequestRecord(db, session.userId, { title: "Bad", propertyId: p.id, priority: "Low" }),
    ).rejects.toThrow("Property not found");
    session.userId = owner;
    const r = await createRequestRecord(db, owner, {
      title: "Owned",
      propertyId: p.id,
      priority: "Low",
    });
    await expect(linkRequestToProperty(db, "stranger", r.id, p.id)).rejects.toThrow("not found");
  });
  it("keeps historical participants after a tenant changes, but new events inherit the new tenant", async () => {
    const p = await property();
    const old = await createRequestRecord(db, session.userId, {
      title: "Before move",
      propertyId: p.id,
      priority: "Low",
    });
    const { updateProperty } = await import("@/lib/workspace.functions");
    await updateProperty({
      data: { ...input(), id: p.id, tenantName: "New tenant", tenantEmail: "new@example.test" },
    });
    const newer = await createRequestRecord(db, session.userId, {
      title: "After move",
      propertyId: p.id,
      priority: "Low",
    });
    const people = await db
      .select()
      .from(schema.requestParticipants)
      .where(eq(schema.requestParticipants.userId, session.userId));
    expect(people.find((x) => x.requestId === old.id && x.role === "Tenant")?.email).toBe(
      "tenant@example.test",
    );
    expect(people.find((x) => x.requestId === newer.id && x.role === "Tenant")?.email).toBe(
      "new@example.test",
    );
  });
  it("links a legacy event and its people and prevents moving it silently to another property", async () => {
    const p = await property();
    await db.insert(schema.repairRequests).values({
      userId: session.userId,
      id: "REQ-1",
      title: "Legacy",
      address: "Old text",
      priority: "High",
      boardColumn: "New",
      status: "New",
      waitingOn: "PM",
      nextAction: "Review",
      waiting: "",
      lastUpdate: "",
      sortOrder: 0,
    });
    await linkRequestToProperty(db, session.userId, "REQ-1", p.id);
    const [r] = await db
      .select()
      .from(schema.repairRequests)
      .where(
        and(
          eq(schema.repairRequests.userId, session.userId),
          eq(schema.repairRequests.id, "REQ-1"),
        ),
      );
    expect(r?.propertyId).toBe(p.id);
    expect(r?.address).toBe(p.address);
    const second = await property();
    await expect(linkRequestToProperty(db, session.userId, "REQ-1", second.id)).rejects.toThrow(
      "another property",
    );
  });
  it("only allows one property to win concurrent legacy linking", async () => {
    const first = await property();
    const { addProperty } = await import("@/lib/workspace.functions");
    const second = await addProperty({
      data: { ...input(), address: "Other address", tenantEmail: "other-tenant@example.test" },
    });
    await db.insert(schema.repairRequests).values({
      userId: session.userId,
      id: "REQ-2",
      title: "Legacy",
      address: "Old",
      priority: "Low",
      boardColumn: "New",
      status: "New",
      waitingOn: "PM",
      nextAction: "Review",
      waiting: "",
      lastUpdate: "",
      sortOrder: 0,
    });
    const results = await Promise.allSettled([
      linkRequestToProperty(db, session.userId, "REQ-2", first.id),
      linkRequestToProperty(db, session.userId, "REQ-2", second.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [event] = await db
      .select()
      .from(schema.repairRequests)
      .where(
        and(
          eq(schema.repairRequests.userId, session.userId),
          eq(schema.repairRequests.id, "REQ-2"),
        ),
      );
    const people = await db
      .select()
      .from(schema.requestParticipants)
      .where(
        and(
          eq(schema.requestParticipants.userId, session.userId),
          eq(schema.requestParticipants.requestId, "REQ-2"),
        ),
      );
    expect(people.filter((p) => p.role === "Tenant").map((p) => p.email)).toEqual([
      event!.propertyId === first.id ? "tenant@example.test" : "other-tenant@example.test",
    ]);
  });

  it("keeps linked properties and restricts appointments to their event's property", async () => {
    const p = await property();
    const second = await property();
    const r = await createRequestRecord(db, session.userId, {
      title: "Repair",
      propertyId: p.id,
      priority: "High",
    });
    const { deleteProperty, addAppointment } = await import("@/lib/workspace.functions");
    await expect(deleteProperty({ data: { id: p.id } })).rejects.toThrow("cannot be removed");
    await expect(
      addAppointment({
        data: {
          title: "Bad",
          startsAt: Date.now(),
          location: "",
          requestId: r.id,
          propertyId: second.id,
        },
      }),
    ).rejects.toThrow("does not match");
    await addAppointment({
      data: { title: "Visit", startsAt: Date.now(), location: "", requestId: r.id },
    });
    const [appointment] = await db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.userId, session.userId));
    expect(appointment?.propertyId).toBe(p.id);
    await addAppointment({
      data: {
        title: "Inspection",
        startsAt: Date.now(),
        location: "",
        requestId: null,
        propertyId: second.id,
      },
    });
    await expect(deleteProperty({ data: { id: second.id } })).rejects.toThrow("cannot be removed");
  });
  it("reviews and applies changed contacts to active events while preserving completed history", async () => {
    const p = await property();
    const r = await createRequestRecord(db, session.userId, {
      title: "Active",
      propertyId: p.id,
      priority: "Medium",
    });
    const done = await createRequestRecord(db, session.userId, {
      title: "Done",
      propertyId: p.id,
      priority: "Medium",
    });
    await db
      .update(schema.repairRequests)
      .set({ boardColumn: "Completed" })
      .where(
        and(
          eq(schema.repairRequests.userId, session.userId),
          eq(schema.repairRequests.id, done.id),
        ),
      );
    const api = await import("@/lib/workspace.functions");
    await api.updateProperty({
      data: { ...input(), id: p.id, tenantName: "New tenant", tenantEmail: "new@example.test" },
    });
    const changes = await api.listPropertyContactChanges();
    expect(changes.map((c) => c.requestId)).toEqual([r.id]);
    await expect(
      api.syncPropertyEventContacts({ data: { requestId: r.id, version: "old" } }),
    ).rejects.toThrow("Contacts changed");
    await api.syncPropertyEventContacts({
      data: { requestId: r.id, version: changes[0]!.version },
    });
    expect(await api.listPropertyContactChanges()).toEqual([]);
    const people = await db
      .select()
      .from(schema.requestParticipants)
      .where(eq(schema.requestParticipants.userId, session.userId));
    expect(people.find((p) => p.requestId === r.id && p.role === "Tenant")!.email).toBe(
      "new@example.test",
    );
    expect(people.find((p) => p.requestId === done.id && p.role === "Tenant")!.email).toBe(
      "tenant@example.test",
    );
  });
  it("property contacts appear before an event exists", async () => {
    await property();
    const { listContacts } = await import("@/lib/workspace.functions");
    const contacts = await listContacts();
    expect(contacts.map((c) => c.email).sort()).toEqual([
      "owner@example.test",
      "pm@example.test",
      "tenant@example.test",
    ]);
  });
});

describe("Incident action plans", () => {
  async function setupPlan() {
    const p = await property();
    const r = await createRequestRecord(db, session.userId, {
      title: "Kitchen tap leaking",
      propertyId: p.id,
      priority: "Medium",
    });
    const service = await import("@/lib/incident-actions.server");
    const context = await service.actionContext(db, session.userId, r.id);
    const tenant = {
      kind: "request_details" as const,
      title: "Reply to tenant",
      reason: "Need photos and access",
      recipientEmail: "tenant@example.test",
      quoteId: null,
      subject: "Tap details",
      body: "Please send photos and access times.",
    };
    const landlord = {
      ...tenant,
      kind: "notify_landlord" as const,
      title: "Notify landlord",
      recipientEmail: "owner@example.test",
      body: "A leaking tap was reported. A quote will follow.",
    };
    const approval = { ...landlord, kind: "request_approval" as const, title: "Request approval" };
    await service.persistActionPlan(db, session.userId, r.id, context.version, [
      tenant,
      landlord,
      approval,
    ]);
    return { r, service, tenant, landlord, approval, context };
  }
  it("generates and persists multiple real action drafts from the AI response", async () => {
    const { r, tenant, landlord, approval } = await setupPlan();
    aiFixture.content = JSON.stringify({
      summary: "A tenant reported a leaking tap.",
      nextStep: "Request details and notify owner",
      column: "Action Needed",
      waitingOn: "Property Manager",
      actions: [tenant, landlord, approval],
    });
    const { analyzeIncident, getIncident } = await import("@/lib/incidents.functions");
    expect(await analyzeIncident({ data: { id: r.id } })).toEqual({ ok: true });
    const incident = await getIncident({ data: { id: r.id } });
    expect(incident.actions).toHaveLength(3);
    expect(incident.ai?.summary).toContain("leaking tap");
    const sent = JSON.parse(aiFixture.requestBody);
    expect(sent.max_tokens).toBeLessThanOrEqual(4000);
    expect(JSON.parse(sent.messages[1].content)).toHaveProperty("quotes");
  });
  it("does not repeat tenant intake as both acknowledgement and details emails", async () => {
    const { r, service, tenant, context } = await setupPlan();
    await service.persistActionPlan(db, session.userId, r.id, context.version, [
      tenant,
      { ...tenant, kind: "acknowledge_tenant" },
    ]);
    const plan = await service.listActionPlan(db, session.userId, r.id);
    expect(plan.actions).toHaveLength(1);
  });
  it("records the source version for an intentional empty AI plan", async () => {
    const { r, service } = await setupPlan();
    aiFixture.content = JSON.stringify({
      summary: "No repair action needed.",
      nextStep: "Review the report",
      column: "New",
      waitingOn: "Property Manager",
      actions: [],
    });
    const { analyzeIncident, getIncident } = await import("@/lib/incidents.functions");
    await analyzeIncident({ data: { id: r.id } });
    const result = await getIncident({ data: { id: r.id } });
    expect(result.actions).toHaveLength(0);
    expect(result.planSourceVersion).toBe(
      (await service.actionContext(db, session.userId, r.id)).version,
    );
  });
  it("does not treat an information-only landlord notification as awaiting a reply", async () => {
    const { r, service, landlord, context } = await setupPlan();
    await service.persistActionPlan(db, session.userId, r.id, context.version, [landlord]);
    const a = (await service.listActionPlan(db, session.userId, r.id)).actions[0]!;
    await service.sendPlannedAction(
      db,
      session.userId,
      a.id,
      { subject: a.subject, body: a.body },
      async () => {},
    );
    const [request] = await db
      .select()
      .from(schema.repairRequests)
      .where(
        and(eq(schema.repairRequests.userId, session.userId), eq(schema.repairRequests.id, r.id)),
      );
    expect(request?.waitingOn).toBe("Property Manager");
    expect(request?.boardColumn).toBe("Action Needed");
  });
  it("does not reopen an event closed while a confirmed email is being saved", async () => {
    const { r, service } = await setupPlan();
    const a = (await service.listActionPlan(db, session.userId, r.id)).actions.find(
      (a) => a.kind === "request_details",
    )!;
    await service.sendPlannedAction(
      db,
      session.userId,
      a.id,
      { subject: a.subject, body: a.body },
      async () => {
        await db
          .update(schema.repairRequests)
          .set({ boardColumn: "Completed" })
          .where(
            and(
              eq(schema.repairRequests.userId, session.userId),
              eq(schema.repairRequests.id, r.id),
            ),
          );
      },
    );
    const [request] = await db
      .select()
      .from(schema.repairRequests)
      .where(
        and(eq(schema.repairRequests.userId, session.userId), eq(schema.repairRequests.id, r.id)),
      );
    expect(request?.boardColumn).toBe("Completed");
  });
  it("blocks new action sends on a completed event", async () => {
    const { r, service } = await setupPlan();
    const a = (await service.listActionPlan(db, session.userId, r.id)).actions[0]!;
    await db
      .update(schema.repairRequests)
      .set({ boardColumn: "Completed" })
      .where(
        and(eq(schema.repairRequests.userId, session.userId), eq(schema.repairRequests.id, r.id)),
      );
    await expect(
      service.sendPlannedAction(
        db,
        session.userId,
        a.id,
        { subject: a.subject, body: a.body },
        async () => {},
      ),
    ).rejects.toThrow("completed event");
  });
  it("makes two parallel tasks ready and blocks approval without a quote", async () => {
    const { r, service } = await setupPlan();
    const plan = await service.listActionPlan(db, session.userId, r.id);
    expect(plan.actions.filter((a) => !a.blockedReason)).toHaveLength(2);
    expect(plan.actions.find((a) => a.kind === "request_approval")?.blockedReason).toContain(
      "pending quote",
    );
  });
  it("sends only the reviewed action and leaves its parallel sibling pending", async () => {
    const { r, service } = await setupPlan();
    const plan = await service.listActionPlan(db, session.userId, r.id);
    const a = plan.actions.find((a) => a.kind === "request_details")!;
    const deliver = vi.fn(async (_input: unknown) => {});
    await service.sendPlannedAction(
      db,
      session.userId,
      a.id,
      { subject: "Edited subject", body: "Reviewed message" },
      deliver,
    );
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[0]).toMatchObject({
      to: "tenant@example.test",
      subject: "Edited subject",
      body: "Reviewed message",
    });
    const after = await service.listActionPlan(db, session.userId, r.id);
    expect(after.actions.find((x) => x.id === a.id)?.state).toBe("sent");
    expect(after.actions.find((x) => x.kind === "notify_landlord")?.blockedReason).toBeNull();
    await service.sendPlannedAction(
      db,
      session.userId,
      a.id,
      { subject: "Again", body: "Again" },
      deliver,
    );
    expect(deliver).toHaveBeenCalledTimes(1);
    const events = await db
      .select()
      .from(schema.requestEvents)
      .where(
        and(
          eq(schema.requestEvents.userId, session.userId),
          eq(schema.requestEvents.requestId, r.id),
          eq(schema.requestEvents.kind, "status"),
        ),
      );
    expect(events).toHaveLength(1);
  });
  it("preserves completed actions and saved edits when regenerating", async () => {
    const { r, service, tenant, landlord, context } = await setupPlan();
    let plan = await service.listActionPlan(db, session.userId, r.id);
    const t = plan.actions.find((a) => a.kind === tenant.kind)!;
    const l = plan.actions.find((a) => a.kind === landlord.kind)!;
    await service.saveActionDraft(db, session.userId, l.id, {
      subject: "My subject",
      body: "My edit",
    });
    await service.sendPlannedAction(
      db,
      session.userId,
      t.id,
      { subject: t.subject, body: t.body },
      async () => {},
    );
    await service.persistActionPlan(db, session.userId, r.id, context.version, [
      tenant,
      { ...landlord, body: "Regenerated" },
    ]);
    plan = await service.listActionPlan(db, session.userId, r.id);
    expect(plan.actions.find((a) => a.id === l.id)?.body).toBe("My edit");
    expect(plan.actions.find((a) => a.id === t.id)?.state).toBe("sent");
  });
  it("rejects stale drafts when new inbound evidence arrives", async () => {
    const { r, service } = await setupPlan();
    const a = (await service.listActionPlan(db, session.userId, r.id)).actions[0]!;
    await db.insert(schema.emailMessages).values({
      userId: session.userId,
      id: crypto.randomUUID(),
      threadId: "thread",
      fromName: "Tenant",
      fromEmail: "tenant@example.test",
      subject: "Update",
      snippet: "Fixed",
      body: "The leak stopped",
      toEmails: "pm@example.test",
      receivedAt: Date.now(),
      unread: true,
      requestId: r.id,
    });
    const deliver = vi.fn(async (_input: unknown) => {});
    await expect(
      service.sendPlannedAction(
        db,
        session.userId,
        a.id,
        { subject: a.subject, body: a.body },
        deliver,
      ),
    ).rejects.toThrow("New case information");
    expect(deliver).not.toHaveBeenCalled();
  });
  it("rejects another user's action and never accepts an invented recipient", async () => {
    const { r, service, tenant, context } = await setupPlan();
    const a = (await service.listActionPlan(db, session.userId, r.id)).actions[0]!;
    await expect(
      service.sendPlannedAction(
        db,
        "stranger",
        a.id,
        { subject: a.subject, body: a.body },
        async () => {},
      ),
    ).rejects.toThrow("not found");
    await service.persistActionPlan(db, session.userId, r.id, context.version, [
      { ...tenant, recipientEmail: "outsider@example.test" },
    ]);
    const plan = await service.listActionPlan(db, session.userId, r.id);
    expect(plan.actions[0]?.recipientEmail).toBeNull();
    expect(plan.actions[0]?.blockedReason).toContain("contact");
  });
  it("locks an uncertain send and retries with the same operation and exact message", async () => {
    const { r, service } = await setupPlan();
    const a = (await service.listActionPlan(db, session.userId, r.id)).actions.find(
      (a) => a.kind === "request_details",
    )!;
    const deliveries: unknown[] = [];
    await expect(
      service.sendPlannedAction(
        db,
        session.userId,
        a.id,
        { subject: "Original", body: "Original body" },
        async (input) => {
          deliveries.push(input);
          await db.insert(schema.mailSendOperations).values({
            userId: session.userId,
            operationId: input.operationId,
            mailbox: "pm@example.test",
            payload: JSON.stringify(input),
            state: "sending",
            createdAt: Date.now(),
          });
          throw new Error("Lost response");
        },
      ),
    ).rejects.toThrow("Lost response");
    const after = await service.listActionPlan(db, session.userId, r.id);
    expect(after.actions.find((x) => x.id === a.id)?.state).toBe("sending");
    await expect(
      service.saveActionDraft(db, session.userId, a.id, { subject: "Changed", body: "Changed" }),
    ).rejects.toThrow("cannot be edited");
    await service.sendPlannedAction(
      db,
      session.userId,
      a.id,
      { subject: "Changed", body: "Changed" },
      async (input) => {
        deliveries.push(input);
      },
    );
    expect(deliveries[1]).toEqual(deliveries[0]);
  });
  it("keeps edited drafts stale until the current evidence is explicitly reviewed", async () => {
    const { r, service, tenant } = await setupPlan();
    const a = (await service.listActionPlan(db, session.userId, r.id)).actions.find(
      (a) => a.kind === tenant.kind,
    )!;
    await service.saveActionDraft(db, session.userId, a.id, {
      subject: "Saved",
      body: "Saved text",
    });
    await db.insert(schema.requestEvents).values({
      userId: session.userId,
      requestId: r.id,
      at: Date.now(),
      kind: "note",
      text: "New access information",
      actor: "PM",
    });
    const context = await service.actionContext(db, session.userId, r.id);
    await service.persistActionPlan(db, session.userId, r.id, context.version, [tenant]);
    const stale = (await service.listActionPlan(db, session.userId, r.id)).actions[0]!;
    expect(stale.needsReview).toBe(true);
    expect(stale.body).toBe("Saved text");
    await expect(
      service.saveActionDraft(
        db,
        session.userId,
        a.id,
        { subject: "Saved", body: "Reviewed" },
        "old-version",
      ),
    ).rejects.toThrow("Case changed");
    await service.saveActionDraft(
      db,
      session.userId,
      a.id,
      { subject: "Saved", body: "Reviewed" },
      context.version,
    );
    expect(
      (await service.listActionPlan(db, session.userId, r.id)).actions[0]!.blockedReason,
    ).toBeNull();
  });
  it("allows one follow-up after new evidence but does not repeat a sent action on unchanged evidence", async () => {
    const { r, service, tenant, context } = await setupPlan();
    const a = (await service.listActionPlan(db, session.userId, r.id)).actions.find(
      (a) => a.kind === tenant.kind,
    )!;
    await service.sendPlannedAction(
      db,
      session.userId,
      a.id,
      { subject: a.subject, body: a.body },
      async () => {},
    );
    await service.persistActionPlan(db, session.userId, r.id, context.version, [tenant]);
    expect((await service.listActionPlan(db, session.userId, r.id)).actions).toHaveLength(1);
    await db.insert(schema.requestEvents).values({
      userId: session.userId,
      requestId: r.id,
      at: Date.now(),
      kind: "note",
      text: "Need a different photo",
      actor: "PM",
    });
    const next = await service.actionContext(db, session.userId, r.id);
    await service.persistActionPlan(db, session.userId, r.id, next.version, [tenant]);
    await service.persistActionPlan(db, session.userId, r.id, next.version, [tenant]);
    expect(
      (await service.listActionPlan(db, session.userId, r.id)).actions.map((a) => a.state).sort(),
    ).toEqual(["pending", "sent"]);
  });
  it("unlocks definite rejections and keeps a new editable retry operation", async () => {
    const { r, service, tenant } = await setupPlan();
    const a = (await service.listActionPlan(db, session.userId, r.id)).actions.find(
      (a) => a.kind === tenant.kind,
    )!;
    await expect(
      service.sendPlannedAction(
        db,
        session.userId,
        a.id,
        { subject: a.subject, body: a.body },
        async (input) => {
          await db.insert(schema.mailSendOperations).values({
            userId: session.userId,
            operationId: input.operationId,
            mailbox: "pm@example.test",
            payload: JSON.stringify(input),
            state: "failed",
            createdAt: Date.now(),
          });
          throw new Error("Rejected");
        },
      ),
    ).rejects.toThrow("Rejected");
    const after = (await service.listActionPlan(db, session.userId, r.id)).actions.find(
      (x) => x.id === a.id,
    )!;
    expect(after.state).toBe("pending");
    expect(after.operationId).not.toBe(a.operationId);
    await service.saveActionDraft(db, session.userId, a.id, {
      subject: "Corrected",
      body: "Corrected",
    });
  });
  it("matches responses only to the sent action thread", async () => {
    const { r, service, tenant } = await setupPlan();
    const a = (await service.listActionPlan(db, session.userId, r.id)).actions.find(
      (a) => a.kind === tenant.kind,
    )!;
    await service.sendPlannedAction(
      db,
      session.userId,
      a.id,
      { subject: a.subject, body: a.body },
      async (input) => {
        await db.insert(schema.mailSendOperations).values({
          userId: session.userId,
          operationId: input.operationId,
          mailbox: "pm@example.test",
          payload: JSON.stringify(input),
          state: "sent",
          threadId: "correct-thread",
          createdAt: Date.now(),
        });
      },
    );
    await db.insert(schema.emailMessages).values({
      userId: session.userId,
      id: "reply",
      threadId: "other-thread",
      fromName: "Tenant",
      fromEmail: tenant.recipientEmail,
      subject: "Other topic",
      snippet: "Hello",
      body: "Hello",
      receivedAt: Date.now() + 1000,
      unread: true,
      requestId: r.id,
    });
    expect(
      (await service.listActionPlan(db, session.userId, r.id)).actions.find((x) => x.id === a.id)!
        .replyReceived,
    ).toBe(false);
    await db
      .update(schema.emailMessages)
      .set({ threadId: "correct-thread" })
      .where(
        and(eq(schema.emailMessages.userId, session.userId), eq(schema.emailMessages.id, "reply")),
      );
    expect(
      (await service.listActionPlan(db, session.userId, r.id)).actions.find((x) => x.id === a.id)!
        .replyReceived,
    ).toBe(true);
  });
  it("requires a recorded pending quote for approval and an approved quote for arranging repair", async () => {
    const { r, service, approval } = await setupPlan();
    const [q] = await db
      .insert(schema.requestQuotes)
      .values({
        userId: session.userId,
        requestId: r.id,
        supplier: "Plumber",
        amountCents: 24000,
        description: "Replace washer",
        status: "Pending",
        createdAt: Date.now(),
      })
      .returning();
    let context = await service.actionContext(db, session.userId, r.id);
    await service.persistActionPlan(db, session.userId, r.id, context.version, [
      { ...approval, quoteId: q!.id },
      { ...approval, kind: "arrange_repair", recipientEmail: null, quoteId: q!.id },
    ]);
    let plan = await service.listActionPlan(db, session.userId, r.id);
    expect(plan.actions.find((a) => a.kind === "request_approval")?.blockedReason).toBeNull();
    await db
      .update(schema.requestQuotes)
      .set({ status: "Approved" })
      .where(eq(schema.requestQuotes.id, q!.id));
    context = await service.actionContext(db, session.userId, r.id);
    await service.persistActionPlan(db, session.userId, r.id, context.version, [
      { ...approval, quoteId: q!.id },
    ]);
    plan = await service.listActionPlan(db, session.userId, r.id);
    expect(plan.actions.find((a) => a.kind === "request_approval")?.blockedReason).toContain(
      "pending quote",
    );
  });
});

describe("Complete case workflow", () => {
  async function fixture() {
    const p = await property();
    const r = await createRequestRecord(db, session.userId, {
      title: "Workflow repair",
      propertyId: p.id,
      priority: "Medium",
    });
    const api = await import("@/lib/case-workflow.functions");
    const service = await import("@/lib/incident-actions.server");
    await api.createContactDraft({
      data: {
        requestId: r.id,
        email: "tenant@example.test",
        subject: "Repair update",
        body: "Please confirm access.",
        operationId: crypto.randomUUID(),
      },
    });
    const action = (await service.listActionPlan(db, session.userId, r.id)).actions[0]!;
    return { p, r, api, service, action };
  }
  it("records offline completion, blocks sending, and preserves it across AI regeneration", async () => {
    const { r, api, service, action } = await fixture();
    await api.manageAction({
      data: { id: action.id, operation: "done", reason: "Called tenant and confirmed access" },
    });
    const context = await service.actionContext(db, session.userId, r.id);
    await service.persistActionPlan(db, session.userId, r.id, context.version, []);
    const plan = await service.listActionPlan(db, session.userId, r.id);
    expect(plan.actions[0]!.disposition).toBe("done");
    await expect(
      service.sendPlannedAction(
        db,
        session.userId,
        action.id,
        { subject: "No", body: "No" },
        async () => {},
      ),
    ).rejects.toThrow("handled");
    await api.manageAction({ data: { id: action.id, operation: "restore" } });
    expect((await service.listActionPlan(db, session.userId, r.id)).actions[0]!.disposition).toBe(
      "open",
    );
  });
  it("requires reasons, persists follow-up times, and scopes reminders to the owner", async () => {
    const { api, action } = await fixture();
    await expect(api.manageAction({ data: { id: action.id, operation: "skip" } })).rejects.toThrow(
      "reason",
    );
    await expect(
      api.manageAction({
        data: { id: action.id, operation: "defer", reason: "Waiting", dueAt: 1 },
      }),
    ).rejects.toThrow("future");
    const dueAt = Date.now() + 86400000;
    await api.manageAction({
      data: { id: action.id, operation: "defer", reason: "Waiting for access", dueAt },
    });
    expect((await api.listFollowUps())[0]!.dueAt).toBe(dueAt);
    const owner = session.userId;
    session.userId = "another-user";
    expect(await api.listFollowUps()).toEqual([]);
    await expect(
      api.manageAction({ data: { id: action.id, operation: "restore" } }),
    ).rejects.toThrow("not found");
    session.userId = owner;
    await api.manageAction({ data: { id: action.id, operation: "clear_followup" } });
    expect(await api.listFollowUps()).toEqual([]);
  });
  it("keeps property contact history scoped and drafts idempotent", async () => {
    const { p, r, api } = await fixture();
    const key = crypto.randomUUID();
    const input = {
      requestId: r.id,
      email: "owner@example.test",
      subject: "Update",
      body: "A repair was reported.",
      operationId: key,
    };
    await api.createContactDraft({ data: input });
    await api.createContactDraft({ data: input });
    const rows = await db
      .select()
      .from(schema.requestActions)
      .where(
        and(
          eq(schema.requestActions.userId, session.userId),
          eq(schema.requestActions.actionKey, `manual:${key}`),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(
      (
        await api.getPropertyContactHistory({
          data: { propertyId: p.id, email: "owner@example.test" },
        })
      ).events,
    ).toHaveLength(1);
    await expect(
      api.createContactDraft({
        data: { ...input, email: "outsider@example.test", operationId: crypto.randomUUID() },
      }),
    ).rejects.toThrow("linked");
    session.userId = "outsider";
    expect(
      (
        await api.getPropertyContactHistory({
          data: { propertyId: p.id, email: "owner@example.test" },
        })
      ).events,
    ).toEqual([]);
  });
  it("requires confirmed quote amount and landlord evidence, retaining the decision record", async () => {
    const { r, api } = await fixture();
    const [q] = await db
      .insert(schema.requestQuotes)
      .values({
        userId: session.userId,
        requestId: r.id,
        supplier: "Plumber",
        amountCents: 12000,
        status: "Pending",
        createdAt: Date.now(),
      })
      .returning();
    await expect(
      api.recordQuoteDecision({
        data: {
          id: q!.id,
          decision: "Approved",
          method: "phone",
          evidence: "Owner confirmed by phone today",
          amount: 121,
        },
      }),
    ).rejects.toThrow("amount changed");
    await expect(
      api.recordQuoteDecision({
        data: {
          id: q!.id,
          decision: "Approved",
          method: "email",
          evidence: "Owner confirmed",
          amount: 120,
          emailId: "invented",
        },
      }),
    ).rejects.toThrow("linked email");
    await api.recordQuoteDecision({
      data: {
        id: q!.id,
        decision: "Approved",
        method: "phone",
        evidence: "Owner confirmed $120 by phone today",
        amount: 120,
      },
    });
    expect(
      (await api.getCaseRecords({ data: { requestId: r.id } })).decisions[0]!.amountCents,
    ).toBe(12000);
    await expect(
      api.recordQuoteDecision({
        data: {
          id: q!.id,
          decision: "Rejected",
          method: "phone",
          evidence: "Changed mind",
          amount: 120,
        },
      }),
    ).rejects.toThrow("already");
  });
  it("reschedules a visit and prepares role-scoped notifications without sending", async () => {
    const { p, r, api, service } = await fixture();
    await db.insert(schema.requestParticipants).values({
      userId: session.userId,
      requestId: r.id,
      role: "Repair Team",
      name: "Plumber",
      email: "plumber@example.test",
    });
    const old = Date.now() + 86400000;
    const [a] = await db
      .insert(schema.appointments)
      .values({
        userId: session.userId,
        requestId: r.id,
        propertyId: p.id,
        title: "Plumber visit",
        startsAt: old,
        location: p.address,
      })
      .returning();
    const result = await api.rescheduleVisit({
      data: {
        id: a!.id,
        previousStart: old,
        startsAt: old + 86400000,
        location: p.address,
        reason: "Tenant availability changed",
      },
    });
    expect(result.drafts).toBe(2);
    const plan = await service.listActionPlan(db, session.userId, r.id);
    const notifications = plan.actions.filter((a) => a.actionKey.startsWith(`manual:visit:`));
    expect(notifications.map((a) => a.recipientRole).sort()).toEqual(["Repair Team", "Tenant"]);
    expect(notifications.every((a) => a.state === "pending" && !a.blockedReason)).toBe(true);
    await expect(
      api.rescheduleVisit({
        data: {
          id: a!.id,
          previousStart: old,
          startsAt: old + 172800000,
          location: p.address,
          reason: "Stale update",
        },
      }),
    ).rejects.toThrow("changed");
  });
  it("validates file format and ownership and keeps metadata separate from file contents", async () => {
    const { r, api } = await fixture();
    const id = crypto.randomUUID();
    const content = btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0));
    await expect(
      api.uploadCaseFile({
        data: {
          requestId: r.id,
          id,
          name: "fake.png",
          mime: "image/png",
          category: "Damage photo",
          content: btoa("not a PNG"),
        },
      }),
    ).rejects.toThrow("format");
    await api.uploadCaseFile({
      data: {
        requestId: r.id,
        id,
        name: "damage.png",
        mime: "image/png",
        category: "Damage photo",
        content,
      },
    });
    expect((await api.getCaseRecords({ data: { requestId: r.id } })).files[0]).not.toHaveProperty(
      "content",
    );
    expect((await api.getCaseFile({ data: { id } })).content).toBe(content);
    session.userId = "outsider";
    await expect(api.getCaseFile({ data: { id } })).rejects.toThrow("not found");
  });
  it("closes with an outcome, stops follow-ups, and prevents new work on a closed case", async () => {
    const { r, api, action } = await fixture();
    await api.manageAction({
      data: { id: action.id, operation: "followup", dueAt: Date.now() + 86400000 },
    });
    await expect(
      api.closeCase({
        data: {
          requestId: r.id,
          type: "repair_completed",
          outcome: "Fixed tap",
          cost: null,
          tenantConfirmation: "confirmed",
          confirmationNote: "",
        },
      }),
    ).rejects.toThrow("actual cost");
    await api.closeCase({
      data: {
        requestId: r.id,
        type: "repair_completed",
        outcome: "Tap repaired and checked",
        cost: 120,
        tenantConfirmation: "confirmed",
        confirmationNote: "Tenant confirmed by phone today",
      },
    });
    expect(await api.listFollowUps()).toEqual([]);
    const records = await api.getCaseRecords({ data: { requestId: r.id } });
    expect(records.closures[0]!.costCents).toBe(12000);
    await expect(
      api.manageAction({ data: { id: action.id, operation: "restore" } }),
    ).rejects.toThrow("Reopen");
    await expect(
      api.createContactDraft({
        data: {
          requestId: r.id,
          email: "tenant@example.test",
          subject: "No",
          body: "No",
          operationId: crypto.randomUUID(),
        },
      }),
    ).rejects.toThrow("Reopen");
  });
  it("manual drafts require renewed review after case evidence changes", async () => {
    const { r, api, service, action } = await fixture();
    await db.insert(schema.requestEvents).values({
      userId: session.userId,
      requestId: r.id,
      at: Date.now(),
      kind: "note",
      text: "New access instructions",
      actor: "PM",
    });
    expect((await service.listActionPlan(db, session.userId, r.id)).actions[0]!.needsReview).toBe(
      true,
    );
    const current = await service.actionContext(db, session.userId, r.id);
    await service.saveActionDraft(
      db,
      session.userId,
      action.id,
      { subject: action.subject, body: action.body },
      current.version,
    );
    expect(
      (await service.listActionPlan(db, session.userId, r.id)).actions[0]!.blockedReason,
    ).toBeNull();
    await api.manageAction({
      data: {
        id: action.id,
        operation: "defer",
        reason: "Wait until tomorrow",
        dueAt: Date.now() + 86400000,
      },
    });
    await db
      .update(schema.requestActions)
      .set({ followUpAt: Date.now() - 1000 })
      .where(eq(schema.requestActions.id, action.id));
    expect(
      (await service.listActionPlan(db, session.userId, r.id)).actions[0]!.blockedReason,
    ).toBeNull();
  });
  it("only one concurrent quote decision is recorded", async () => {
    const { r, api } = await fixture();
    const [q] = await db
      .insert(schema.requestQuotes)
      .values({
        userId: session.userId,
        requestId: r.id,
        supplier: "Plumber",
        amountCents: 12000,
        status: "Pending",
        createdAt: Date.now(),
      })
      .returning();
    const outcomes = await Promise.allSettled(
      ["Approved", "Rejected"].map((decision) =>
        api.recordQuoteDecision({
          data: {
            id: q!.id,
            decision: decision as "Approved" | "Rejected",
            method: "phone",
            evidence: "Recorded phone decision",
            amount: 120,
          },
        }),
      ),
    );
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await api.getCaseRecords({ data: { requestId: r.id } })).decisions).toHaveLength(1);
  });
  it("marks only the matching current reply as handled without approving the quote", async () => {
    const { r, api, service, action } = await fixture();
    const sentAt = Date.now() - 5000;
    await db
      .update(schema.requestActions)
      .set({ state: "sent", sentAt })
      .where(eq(schema.requestActions.id, action.id));
    await db.insert(schema.mailSendOperations).values({
      userId: session.userId,
      operationId: action.operationId,
      mailbox: "pm@example.test",
      payload: "{}",
      state: "sent",
      threadId: "reply-thread",
      createdAt: sentAt,
    });
    await db.insert(schema.emailMessages).values({
      userId: session.userId,
      id: "review-reply",
      threadId: "reply-thread",
      fromName: "Tenant",
      fromEmail: "tenant@example.test",
      subject: "Access",
      snippet: "Available",
      body: "I am available tomorrow",
      receivedAt: Date.now(),
      unread: true,
      requestId: r.id,
    });
    await expect(
      api.manageAction({ data: { id: action.id, operation: "reply_done", replyId: "other" } }),
    ).rejects.toThrow("reply changed");
    await api.manageAction({
      data: {
        id: action.id,
        operation: "reply_done",
        replyId: "review-reply",
        reason: "Access confirmed",
      },
    });
    const plan = await service.listActionPlan(db, session.userId, r.id);
    expect(plan.actions[0]!.replyHandled).toBe(true);
    expect((await api.getCaseRecords({ data: { requestId: r.id } })).decisions).toEqual([]);
  });
  it("rejects direct completed status changes without the closure flow", async () => {
    const { r } = await fixture();
    const { patchRequest } = await import("@/lib/requests.functions");
    await expect(
      patchRequest({ data: { id: r.id, patch: { column: "Completed" } } }),
    ).rejects.toThrow("Close case");
  });
});

describe("Workflow management and history", () => {
  async function setup() {
    const p = await property();
    const r = await createRequestRecord(db, session.userId, {
      title: "Repair leak",
      propertyId: p.id,
      priority: "Medium",
    });
    const api = await import("@/lib/workflow-management.functions");
    const workflow = await import("@/lib/case-workflow.functions");
    const actions = await import("@/lib/incident-actions.server");
    const [visit] = await db
      .insert(schema.appointments)
      .values({
        userId: session.userId,
        requestId: r.id,
        propertyId: p.id,
        title: "Plumber visit",
        startsAt: Date.now() + 86400000,
        location: p.address,
      })
      .returning();
    return { p, r, api, workflow, actions, visit: visit! };
  }
  it("retains cancelled visits and creates idempotent notification drafts without sending", async () => {
    const { r, api, visit, workflow, actions } = await setup();
    await api.cancelVisit({ data: { id: visit.id, reason: "Tenant unavailable" } });
    await api.cancelVisit({ data: { id: visit.id, reason: "Repeated request" } });
    const [saved] = await db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.id, visit.id));
    expect(saved?.cancelReason).toBe("Tenant unavailable");
    expect(saved?.cancelledAt).toBeGreaterThan(0);
    const plan = await actions.listActionPlan(db, session.userId, r.id);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.state).toBe("pending");
    await expect(
      workflow.rescheduleVisit({
        data: {
          id: visit.id,
          previousStart: visit.startsAt,
          startsAt: visit.startsAt + 1000,
          location: "Here",
          reason: "New time",
        },
      }),
    ).rejects.toThrow("Cancelled");
    await expect(
      workflow.closeCase({
        data: {
          requestId: r.id,
          type: "non_repair",
          outcome: "Not needed",
          cost: null,
          tenantConfirmation: "not_required",
          confirmationNote: "",
        },
      }),
    ).rejects.toThrow("cancellation notifications");
  });
  it("requires future visit disposition and blocks archiving until history is resolved", async () => {
    const { r, p, api, workflow, visit } = await setup();
    const closure = {
      requestId: r.id,
      type: "non_repair" as const,
      outcome: "Duplicate report",
      cost: null,
      tenantConfirmation: "not_required" as const,
      confirmationNote: "",
    };
    await expect(workflow.closeCase({ data: closure })).rejects.toThrow("future visits");
    await workflow.closeCase({
      data: {
        ...closure,
        retainFutureVisits: true,
        futureVisitReason: "Independent safety inspection",
      },
    });
    await expect(api.archiveProperty({ data: { id: p.id, archive: true } })).rejects.toThrow(
      "upcoming visits",
    );
    await db
      .update(schema.appointments)
      .set({ cancelledAt: Date.now(), cancelReason: "Recorded externally" })
      .where(eq(schema.appointments.id, visit.id));
    await api.archiveProperty({ data: { id: p.id, archive: true } });
    await expect(
      createRequestRecord(db, session.userId, {
        title: "New repair",
        propertyId: p.id,
        priority: "Low",
      }),
    ).rejects.toThrow();
    await api.archiveProperty({ data: { id: p.id, archive: false } });
    const [saved] = await db.select().from(schema.properties).where(eq(schema.properties.id, p.id));
    expect(saved?.archivedAt).toBeNull();
  });
  it("revises an approved quote into a new pending version and rejects competing revisions", async () => {
    const { r, api } = await setup();
    const [q] = await db
      .insert(schema.requestQuotes)
      .values({
        userId: session.userId,
        requestId: r.id,
        supplier: "Trade",
        amountCents: 10000,
        status: "Approved",
        createdAt: Date.now(),
      })
      .returning();
    const change = {
      id: q!.id,
      supplier: "Trade",
      amount: 150,
      description: "Additional parts",
      reason: "Updated scope",
    };
    await api.reviseQuote({ data: change });
    await expect(api.reviseQuote({ data: change })).rejects.toThrow();
    const rows = await db
      .select()
      .from(schema.requestQuotes)
      .where(
        and(
          eq(schema.requestQuotes.userId, session.userId),
          eq(schema.requestQuotes.requestId, r.id),
        ),
      );
    expect(rows).toHaveLength(2);
    expect(rows.find((x) => x.id === q!.id)).toMatchObject({
      status: "Approved",
      amountCents: 10000,
    });
    expect(rows.find((x) => x.supersedesId === q!.id)).toMatchObject({
      status: "Pending",
      amountCents: 15000,
    });
  });
  it("restores files, validates quote links and rejects cross-account or recycled attachments", async () => {
    const { r, api, workflow } = await setup();
    const id = crypto.randomUUID();
    await workflow.uploadCaseFile({
      data: {
        id,
        requestId: r.id,
        name: "damage.pdf",
        category: "Quote",
        mime: "application/pdf",
        content: btoa("%PDF-1.4\nTest document"),
      },
    });
    const metadata = {
      id,
      name: "Updated quote.pdf",
      category: "Quote" as const,
      quoteId: null,
      trash: true,
    };
    await api.updateCaseFile({ data: metadata });
    const { resolveAttachments } = await import("@/lib/mail-attachments.server");
    await expect(resolveAttachments(db, session.userId, r.id, [id])).rejects.toThrow();
    await api.updateCaseFile({ data: { ...metadata, trash: false } });
    expect((await resolveAttachments(db, session.userId, r.id, [id]))[0]?.name).toBe(
      "Updated quote.pdf",
    );
    await expect(api.updateCaseFile({ data: { ...metadata, quoteId: 9999999 } })).rejects.toThrow(
      "quote",
    );
    session.userId = "outsider";
    await expect(api.updateCaseFile({ data: metadata })).rejects.toThrow("not found");
    await expect(resolveAttachments(db, session.userId, r.id, [id])).rejects.toThrow();
  });
  it("previews property correction, rejects stale review and replaces contacts without deleting evidence", async () => {
    const { r, p, api, workflow, actions, visit } = await setup();
    const { addProperty } = await import("@/lib/workspace.functions");
    const target = await addProperty({
      data: { ...input(), address: "56 Correct St", tenantEmail: "newtenant@example.test" },
    });
    await workflow.createContactDraft({
      data: {
        requestId: r.id,
        email: "tenant@example.test",
        subject: "Old visit",
        body: "Old address",
        operationId: crypto.randomUUID(),
      },
    });
    const preview = await api.previewPropertyCorrection({
      data: { requestId: r.id, propertyId: target.id },
    });
    const correction = {
      requestId: r.id,
      propertyId: target.id,
      version: preview.version,
      targetVersion: JSON.stringify(preview.target),
      reason: "Wrong property selected",
    };
    await expect(
      api.correctProperty({ data: { ...correction, version: "stale" } }),
    ).rejects.toThrow();
    await api.correctProperty({ data: correction });
    const context = await actions.actionContext(db, session.userId, r.id);
    expect(context.request.propertyId).toBe(target.id);
    expect(context.participants.some((x) => x.email === "newtenant@example.test")).toBe(true);
    expect(context.participants.some((x) => x.email === "tenant@example.test")).toBe(false);
    expect(context.bookings.find((x) => x.id === visit.id)?.location).toBe(target.address);
    expect((await actions.listActionPlan(db, session.userId, r.id)).actions[0]?.disposition).toBe(
      "skipped",
    );
    const [original] = await db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.id, p.id));
    expect(original).toBeDefined();
  });
  it("persists notification reads independently per user", async () => {
    const { r, api } = await setup();
    await db.insert(schema.emailMessages).values({
      userId: session.userId,
      id: "notification-test",
      threadId: "thread-notification",
      fromEmail: "tenant@example.test",
      fromName: "Tenant",
      toEmails: "pm@example.test",
      subject: "Access confirmed",
      snippet: "Reply",
      body: "Confirmed",
      receivedAt: Date.now(),
      requestId: r.id,
      unread: true,
      inInbox: true,
      sent: false,
      trashed: false,
    });
    let items = await api.listNotifications();
    expect(items.find((x) => x.key === "reply:notification-test")?.read).toBe(false);
    await api.markNotificationsRead({ data: { keys: ["reply:notification-test"] } });
    items = await api.listNotifications();
    expect(items.find((x) => x.key === "reply:notification-test")?.read).toBe(true);
    session.userId = "different-notification-user";
    expect(await api.listNotifications()).toEqual([]);
  });
  it("filters parallel waiting recipients even when PM work remains, and clears a recipient after reply", async () => {
    const { r, api } = await setup();
    const operationId = crypto.randomUUID();
    const sentAt = Date.now() - 1000;
    await db.insert(schema.requestActions).values({
      id: crypto.randomUUID(),
      userId: session.userId,
      requestId: r.id,
      actionKey: "test-waiter",
      kind: "request_approval",
      title: "Approve quote",
      reason: "Approval needed",
      recipientEmail: "owner@example.test",
      subject: "Approval",
      body: "Please review",
      sourceVersion: "test",
      state: "sent",
      sentAt,
      operationId,
      createdAt: sentAt,
    });
    await db.insert(schema.mailSendOperations).values({
      userId: session.userId,
      operationId,
      mailbox: "pm@example.test",
      payload: "{}",
      state: "sent",
      threadId: "waiter-thread",
      createdAt: sentAt,
    });
    expect(await api.listWaitingCases()).toContainEqual({ requestId: r.id, role: "Landlord" });
    await db.insert(schema.emailMessages).values({
      userId: session.userId,
      id: "waiter-reply",
      threadId: "waiter-thread",
      fromEmail: "owner@example.test",
      fromName: "Owner",
      toEmails: "pm@example.test",
      subject: "Re: Approval",
      snippet: "Reply",
      body: "Reply",
      receivedAt: Date.now(),
      requestId: r.id,
      unread: true,
      inInbox: true,
      sent: false,
      trashed: false,
    });
    expect(await api.listWaitingCases()).toEqual([]);
  });
});
