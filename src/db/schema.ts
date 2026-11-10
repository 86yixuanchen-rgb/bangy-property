import {
  foreignKey,
  index,
  uniqueIndex,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const repairRequests = sqliteTable(
  "repair_requests",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    title: text("title").notNull(),
    address: text("address").notNull(),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "restrict" }),
    priority: text("priority", { enum: ["Urgent", "High", "Medium", "Low"] }).notNull(),
    boardColumn: text("board_column", {
      enum: ["New", "Waiting", "Action Needed", "Scheduled", "Completed"],
    }).notNull(),
    status: text("status").notNull(),
    waitingOn: text("waiting_on").notNull(),
    nextAction: text("next_action").notNull(),
    waiting: text("waiting").notNull(),
    lastUpdate: text("last_update").notNull(),
    sortOrder: integer("sort_order").notNull(),
    aiSummary: text("ai_summary"),
    aiNextStep: text("ai_next_step"),
    aiColumn: text("ai_column"),
    aiWaitingOn: text("ai_waiting_on"),
    aiUpdatedAt: integer("ai_updated_at"),
    aiSourceVersion: text("ai_source_version"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("requests_property_idx").on(t.userId, t.propertyId),
  ],
);

export const participantRoles = ["Property Manager", "Tenant", "Landlord", "Repair Team"] as const;

export const requestParticipants = sqliteTable(
  "request_participants",
  {
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    role: text("role", { enum: participantRoles }).notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.requestId, t.email] })],
);

export const requestEvents = sqliteTable("request_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  requestId: text("request_id").notNull(),
  at: integer("at").notNull(),
  kind: text("kind", { enum: ["created", "status", "note", "quote", "appointment"] }).notNull(),
  text: text("text").notNull(),
  actor: text("actor").notNull(),
});

export const gmailAccounts = sqliteTable("gmail_accounts", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  refreshToken: text("refresh_token").notNull(),
  lastSyncAt: integer("last_sync_at"),
});

export const emailMessages = sqliteTable(
  "email_messages",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    threadId: text("thread_id").notNull(),
    fromName: text("from_name").notNull(),
    fromEmail: text("from_email").notNull(),
    subject: text("subject").notNull(),
    snippet: text("snippet").notNull(),
    body: text("body").notNull(),
    toEmails: text("to_emails").notNull().default(""),
    receivedAt: integer("received_at").notNull(),
    unread: integer("unread", { mode: "boolean" }).notNull(),
    inInbox: integer("in_inbox", { mode: "boolean" }).notNull().default(true),
    sent: integer("sent", { mode: "boolean" }).notNull().default(false),
    trashed: integer("trashed", { mode: "boolean" }).notNull().default(false),
    requestId: text("request_id"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

export const properties = sqliteTable("properties", {
  archivedAt: integer("archived_at"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  address: text("address").notNull(),
  managerName: text("manager_name").notNull().default(""),
  managerEmail: text("manager_email").notNull().default(""),
  tenantName: text("tenant_name").notNull().default(""),
  tenantEmail: text("tenant_email").notNull().default(""),
  ownerName: text("owner_name").notNull().default(""),
  ownerEmail: text("owner_email").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export const requestQuotes = sqliteTable(
  "request_quotes",
  {
    supersedesId: integer("supersedes_id"),
    supersededAt: integer("superseded_at"),
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    supplier: text("supplier").notNull(),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ["Pending", "Approved", "Rejected"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("quote_successor_idx").on(t.userId, t.supersedesId)],
);

export const appointments = sqliteTable(
  "appointments",
  {
    endsAt: integer("ends_at"),
    attendeeEmails: text("attendee_emails").notNull().default("[]"),
    notes: text("notes").notNull().default(""),
    operationId: text("operation_id"),
    cancelledAt: integer("cancelled_at"),
    cancelReason: text("cancel_reason"),
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    requestId: text("request_id"),
    propertyId: integer("property_id").references(() => properties.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    startsAt: integer("starts_at").notNull(),
    location: text("location").notNull().default(""),
  },
  (t) => [uniqueIndex("appointment_operation_idx").on(t.userId, t.operationId)],
);

// IDs are reserved atomically on the server, independently of browser caches.
export const requestCounters = sqliteTable("request_counters", {
  userId: text("user_id").primaryKey(),
  value: integer("value").notNull(),
});

export const mailSendOperations = sqliteTable(
  "mail_send_operations",
  {
    userId: text("user_id").notNull(),
    operationId: text("operation_id").notNull(),
    mailbox: text("mailbox").notNull(),
    payload: text("payload").notNull(),
    state: text("state", { enum: ["sending", "sent", "failed"] }).notNull(),
    messageId: text("message_id"),
    threadId: text("thread_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.operationId] })],
);

export const requestActions = sqliteTable(
  "request_actions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    actionKey: text("action_key").notNull(),
    kind: text("kind").$type<import("@/lib/incident-action-types").ActionKind>().notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    recipientEmail: text("recipient_email"),
    quoteId: integer("quote_id"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    sourceVersion: text("source_version").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    state: text("state", { enum: ["pending", "sending", "sent"] })
      .notNull()
      .default("pending"),
    operationId: text("operation_id").notNull(),
    editedAt: integer("edited_at"),
    sentAt: integer("sent_at"),
    attachmentIds: text("attachment_ids").notNull().default("[]"),
    disposition: text("disposition").notNull().default("open"),
    dispositionNote: text("disposition_note").notNull().default(""),
    followUpAt: integer("follow_up_at"),
    handledReplyId: text("handled_reply_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("request_actions_request_idx").on(t.userId, t.requestId),
    uniqueIndex("request_actions_key_idx").on(t.userId, t.requestId, t.actionKey),
    foreignKey({
      columns: [t.userId, t.requestId],
      foreignColumns: [repairRequests.userId, repairRequests.id],
    }).onDelete("cascade"),
  ],
);

export const caseClosures = sqliteTable("case_closures", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  requestId: text("request_id").notNull(),
  type: text("type").notNull(),
  outcome: text("outcome").notNull(),
  costCents: integer("cost_cents"),
  tenantConfirmation: text("tenant_confirmation").notNull(),
  at: integer("at").notNull(),
});
export const quoteDecisions = sqliteTable(
  "quote_decisions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    quoteId: integer("quote_id").notNull(),
    decision: text("decision").notNull(),
    method: text("method").notNull(),
    evidence: text("evidence").notNull(),
    emailId: text("email_id"),
    amountCents: integer("amount_cents").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [uniqueIndex("quote_decisions_once_idx").on(t.userId, t.quoteId)],
);
export const caseAttachments = sqliteTable("case_attachments", {
  trashedAt: integer("trashed_at"),
  quoteId: integer("quote_id"),
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  requestId: text("request_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  category: text("category").notNull(),
  size: integer("size").notNull(),
  content: text("content").notNull(),
  at: integer("at").notNull(),
});

export const mailSendFiles = sqliteTable(
  "mail_send_files",
  {
    userId: text("user_id").notNull(),
    operationId: text("operation_id").notNull(),
    fileId: text("file_id").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    content: text("content").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.operationId, t.fileId] })],
);
export const notificationReads = sqliteTable(
  "notification_reads",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const workspaceContacts = sqliteTable(
  "workspace_contacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    phone: text("phone").notNull().default(""),
    notes: text("notes").notNull().default(""),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("workspace_contacts_email_idx").on(t.userId, t.email)],
);
export const assistantSessions = sqliteTable(
  "assistant_sessions",
  {
    archivedAt: integer("archived_at"),
    activity: text("activity").notNull().default(""),
    runId: text("run_id"),
    stopRequested: integer("stop_requested", { mode: "boolean" }).notNull().default(false),
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("assistant_sessions_user_idx").on(t.userId, t.updatedAt)],
);
export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("assistant_messages_session_idx").on(t.userId, t.sessionId, t.createdAt)],
);
export const assistantPlans = sqliteTable("assistant_plans", {
  stopRequested: integer("stop_requested", { mode: "boolean" }).notNull().default(false),
  lockedAt: integer("locked_at"),
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  title: text("title").notNull(),
  context: text("context").notNull().default("{}"),
  revision: integer("revision").notNull().default(1),
  state: text("state").notNull().default("review"),
  createdAt: integer("created_at").notNull(),
});
export const assistantSteps = sqliteTable(
  "assistant_steps",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    planId: text("plan_id").notNull(),
    position: integer("position").notNull(),
    action: text("action").notNull(),
    args: text("args").notNull(),
    dependsOn: text("depends_on").notNull().default("[]"),
    state: text("state").notNull().default("pending"),
    snapshot: text("snapshot").notNull().default(""),
    result: text("result"),
    error: text("error"),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
  },
  (t) => [index("assistant_steps_plan_idx").on(t.userId, t.planId, t.position)],
);

export const emailTriage = sqliteTable(
  "email_triage",
  {
    userId: text("user_id").notNull(),
    emailId: text("email_id").notNull(),
    state: text("state").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.emailId] })],
);
export const assistantReceipts = sqliteTable("assistant_receipts", {
  stepId: text("step_id").primaryKey(),
  userId: text("user_id").notNull(),
  entity: text("entity").notNull(),
  recordId: text("record_id").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json").notNull(),
  undoneAt: integer("undone_at"),
});
