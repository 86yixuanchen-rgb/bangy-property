CREATE TABLE request_counters (user_id text PRIMARY KEY NOT NULL, value integer NOT NULL);
--> statement-breakpoint
CREATE TABLE mail_send_operations (
  user_id text NOT NULL, operation_id text NOT NULL, mailbox text NOT NULL,
  payload text NOT NULL, state text NOT NULL, message_id text, thread_id text,
  created_at integer NOT NULL, PRIMARY KEY (user_id, operation_id)
);
