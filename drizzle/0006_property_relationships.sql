ALTER TABLE properties ADD COLUMN manager_name text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE properties ADD COLUMN manager_email text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE properties ADD COLUMN tenant_name text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE properties ADD COLUMN tenant_email text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE repair_requests ADD COLUMN property_id integer REFERENCES properties(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX requests_property_idx ON repair_requests(user_id, property_id);
--> statement-breakpoint
-- Only unambiguous exact addresses within the same workspace are linked.
UPDATE repair_requests SET property_id = (
 SELECT min(p.id) FROM properties p
 WHERE p.user_id = repair_requests.user_id AND lower(trim(p.address)) = lower(trim(repair_requests.address))
) WHERE (SELECT count(*) FROM properties p WHERE p.user_id = repair_requests.user_id
 AND lower(trim(p.address)) = lower(trim(repair_requests.address))) = 1;

--> statement-breakpoint
ALTER TABLE appointments ADD COLUMN property_id integer REFERENCES properties(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX appointments_property_idx ON appointments(user_id, property_id);
--> statement-breakpoint
UPDATE appointments SET property_id = (SELECT r.property_id FROM repair_requests r
 WHERE r.user_id = appointments.user_id AND r.id = appointments.request_id) WHERE request_id IS NOT NULL;
