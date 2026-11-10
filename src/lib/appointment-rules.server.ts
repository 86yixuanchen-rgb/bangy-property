import { sql } from "drizzle-orm";
export function appointmentWindow(startsAt: number, endsAt?: number) {
  const end = endsAt ?? startsAt + 3600000;
  if (
    !Number.isSafeInteger(startsAt) ||
    !Number.isSafeInteger(end) ||
    end <= startsAt ||
    end - startsAt > 86400000
  )
    throw new Error("Choose an end time after the start, within 24 hours.");
  return end;
}
// Used inside the write so concurrent bookings cannot both pass the overlap check.
export function noAppointmentConflict(
  userId: string,
  propertyId: number,
  start: number,
  end: number,
  emails: string[],
  exceptId = 0,
) {
  return sql`NOT EXISTS (SELECT 1 FROM appointments a WHERE a.user_id=${userId} AND a.id != ${exceptId} AND a.cancelled_at IS NULL AND a.starts_at < ${end} AND COALESCE(a.ends_at,a.starts_at+3600000) > ${start} AND (a.property_id=${propertyId} OR EXISTS(SELECT 1 FROM json_each(a.attendee_emails) ae JOIN json_each(${JSON.stringify(emails)}) incoming ON lower(ae.value)=lower(incoming.value))))`;
}
