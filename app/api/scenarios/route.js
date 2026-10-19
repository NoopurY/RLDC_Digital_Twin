import { collectionHandlers } from "@/lib/api/crud";

export const dynamic = "force-dynamic";
export const { GET, POST } = collectionHandlers("scenarios", {
  validate: (b) => (!b.name ? "name is required" : !b.motorParameters || !b.faults ? "motorParameters and faults are required" : null),
});
