import BookingCallTable from "@/components/booking-call-table";
import { BOOKING_CALL_SERVICE_LEADERS } from "@/lib/booking-call-leaders";

export const dynamic = "force-dynamic";

export default async function BookingCallPage() {
  return (
    <BookingCallTable sourceFile="postgres/booking_call_entries" leaders={[...BOOKING_CALL_SERVICE_LEADERS]} />
  );
}
