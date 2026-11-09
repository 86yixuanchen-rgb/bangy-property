ALTER TABLE properties ADD COLUMN archived_at integer;
--> statement-breakpoint
ALTER TABLE request_quotes ADD COLUMN supersedes_id integer;
--> statement-breakpoint
ALTER TABLE request_quotes ADD COLUMN superseded_at integer;
--> statement-breakpoint
CREATE UNIQUE INDEX quote_successor_idx ON request_quotes(user_id, supersedes_id);
--> statement-breakpoint
ALTER TABLE appointments ADD COLUMN cancelled_at integer;
--> statement-breakpoint
ALTER TABLE appointments ADD COLUMN cancel_reason text;
--> statement-breakpoint
ALTER TABLE case_attachments ADD COLUMN trashed_at integer;
--> statement-breakpoint
ALTER TABLE case_attachments ADD COLUMN quote_id integer;
--> statement-breakpoint
ALTER TABLE request_actions ADD COLUMN attachment_ids text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE TABLE mail_send_files(user_id text NOT NULL,operation_id text NOT NULL,file_id text NOT NULL,name text NOT NULL,mime text NOT NULL,content text NOT NULL,PRIMARY KEY(user_id,operation_id,file_id));
--> statement-breakpoint
CREATE TABLE notification_reads(user_id text NOT NULL,key text NOT NULL,at integer NOT NULL,PRIMARY KEY(user_id,key));
