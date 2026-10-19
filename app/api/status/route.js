import { NextResponse } from "next/server";
import { storageStatus } from "@/lib/store/repository";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(await storageStatus());
}
