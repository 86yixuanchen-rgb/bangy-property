ALTER TABLE assistant_sessions ADD COLUMN archived_at INTEGER;
--> statement-breakpoint
ALTER TABLE assistant_sessions ADD COLUMN activity TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE assistant_sessions ADD COLUMN run_id TEXT;
--> statement-breakpoint
ALTER TABLE assistant_sessions ADD COLUMN stop_requested INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE assistant_plans ADD COLUMN stop_requested INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE email_triage (user_id TEXT NOT NULL, email_id TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(user_id,email_id));
--> statement-breakpoint
CREATE TABLE assistant_receipts (step_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, entity TEXT NOT NULL, record_id TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, undone_at INTEGER);
