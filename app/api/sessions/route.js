import { collectionHandlers } from "@/lib/api/crud";

export const dynamic = "force-dynamic";
export const { GET, POST } = collectionHandlers("sessions", { listFields: "-healthHistory" });
