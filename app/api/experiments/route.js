import { collectionHandlers } from "@/lib/api/crud";

export const dynamic = "force-dynamic";
export const { GET, POST } = collectionHandlers("experiments", {
  validate: (b) => (!b.scenarioName ? "scenarioName is required" : !b.motorParameters || !b.faults ? "motorParameters and faults are required" : null),
});
