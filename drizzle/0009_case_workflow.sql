ALTER TABLE request_actions ADD COLUMN disposition text NOT NULL DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE request_actions ADD COLUMN disposition_note text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE request_actions ADD COLUMN follow_up_at integer;
--> statement-breakpoint
ALTER TABLE request_actions ADD COLUMN handled_reply_id text;
--> statement-breakpoint
CREATE TABLE case_closures (id text PRIMARY KEY, user_id text NOT NULL, request_id text NOT NULL, type text NOT NULL, outcome text NOT NULL, cost_cents integer, tenant_confirmation text NOT NULL, at integer NOT NULL, FOREIGN KEY(user_id,request_id) REFERENCES repair_requests(user_id,id));
--> statement-breakpoint
CREATE TABLE quote_decisions (id text PRIMARY KEY, user_id text NOT NULL, request_id text NOT NULL, quote_id integer NOT NULL, decision text NOT NULL, method text NOT NULL, evidence text NOT NULL, email_id text, amount_cents integer NOT NULL, at integer NOT NULL, FOREIGN KEY(user_id,request_id) REFERENCES repair_requests(user_id,id));
--> statement-breakpoint
CREATE TABLE case_attachments (id text PRIMARY KEY, user_id text NOT NULL, request_id text NOT NULL, name text NOT NULL, mime text NOT NULL, category text NOT NULL, size integer NOT NULL, content text NOT NULL, at integer NOT NULL, FOREIGN KEY(user_id,request_id) REFERENCES repair_requests(user_id,id));
--> statement-breakpoint
CREATE INDEX case_attachments_request_idx ON case_attachments(user_id,request_id);
