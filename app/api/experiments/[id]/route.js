import { itemHandlers } from "@/lib/api/crud";

export const dynamic = "force-dynamic";
export const { GET, PUT, DELETE } = itemHandlers("experiments");
