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
