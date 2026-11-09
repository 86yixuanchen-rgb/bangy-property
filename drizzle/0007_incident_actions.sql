CREATE TABLE request_actions (
 id text PRIMARY KEY NOT NULL, user_id text NOT NULL, request_id text NOT NULL, action_key text NOT NULL,
 kind text NOT NULL, title text NOT NULL, reason text NOT NULL, recipient_email text, quote_id integer,
 subject text NOT NULL, body text NOT NULL, source_version text NOT NULL, active integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent')), operation_id text NOT NULL,
 edited_at integer, sent_at integer, created_at integer NOT NULL,
 FOREIGN KEY(user_id,request_id) REFERENCES repair_requests(user_id,id) ON DELETE CASCADE,
 UNIQUE(user_id,request_id,action_key)
);
--> statement-breakpoint
CREATE INDEX request_actions_request_idx ON request_actions(user_id,request_id);
