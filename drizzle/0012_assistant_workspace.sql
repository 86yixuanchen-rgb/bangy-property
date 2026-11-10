CREATE TABLE workspace_contacts (id text PRIMARY KEY NOT NULL,user_id text NOT NULL,name text NOT NULL,email text NOT NULL,role text NOT NULL,phone text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',archived_at integer,created_at integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_contacts_email_idx ON workspace_contacts(user_id,email);
--> statement-breakpoint
ALTER TABLE appointments ADD ends_at integer;
--> statement-breakpoint
UPDATE appointments SET ends_at=starts_at+3600000 WHERE ends_at IS NULL;
--> statement-breakpoint
ALTER TABLE appointments ADD attendee_emails text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE appointments ADD notes text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE appointments ADD operation_id text;
--> statement-breakpoint
CREATE UNIQUE INDEX appointment_operation_idx ON appointments(user_id,operation_id);
--> statement-breakpoint
CREATE TABLE assistant_sessions(id text PRIMARY KEY NOT NULL,user_id text NOT NULL,title text NOT NULL,created_at integer NOT NULL,updated_at integer NOT NULL);
--> statement-breakpoint
CREATE INDEX assistant_sessions_user_idx ON assistant_sessions(user_id,updated_at);
--> statement-breakpoint
CREATE TABLE assistant_messages(id text PRIMARY KEY NOT NULL,user_id text NOT NULL,session_id text NOT NULL,role text NOT NULL,content text NOT NULL,created_at integer NOT NULL);
--> statement-breakpoint
CREATE INDEX assistant_messages_session_idx ON assistant_messages(user_id,session_id,created_at);
--> statement-breakpoint
CREATE TABLE assistant_plans(id text PRIMARY KEY NOT NULL,user_id text NOT NULL,session_id text NOT NULL,title text NOT NULL,locked_at integer,context text NOT NULL DEFAULT '{}',revision integer NOT NULL DEFAULT 1,state text NOT NULL DEFAULT 'review',created_at integer NOT NULL);
--> statement-breakpoint
CREATE TABLE assistant_steps(id text PRIMARY KEY NOT NULL,user_id text NOT NULL,plan_id text NOT NULL,position integer NOT NULL,action text NOT NULL,args text NOT NULL,depends_on text NOT NULL DEFAULT '[]',state text NOT NULL DEFAULT 'pending',snapshot text NOT NULL DEFAULT '',result text,error text,started_at integer,completed_at integer);
--> statement-breakpoint
CREATE INDEX assistant_steps_plan_idx ON assistant_steps(user_id,plan_id,position);
