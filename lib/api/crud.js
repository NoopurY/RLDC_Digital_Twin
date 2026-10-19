// Shared CRUD route-handler factories for repository collections.
import { NextResponse } from "next/server";
import * as repo from "../store/repository.js";

const fail = (e, status = 500) => NextResponse.json({ error: e?.message ?? String(e) }, { status });

export function collectionHandlers(col, { validate, listFields } = {}) {
  return {
    async GET(req) {
      try {
        const limit = Number(new URL(req.url).searchParams.get("limit") ?? 200);
        const [items, storage] = await Promise.all([repo.list(col, { limit, fields: listFields }), repo.storageStatus()]);
        return NextResponse.json({ items, storage: storage.mode });
      } catch (e) {
        return fail(e);
      }
    },
    async POST(req) {
      try {
        const body = await req.json();
        const err = validate?.(body);
        if (err) return fail(new Error(err), 400);
        const doc = await repo.create(col, body);
        return NextResponse.json({ item: doc }, { status: 201 });
      } catch (e) {
        return fail(e);
      }
    },
  };
}

export function itemHandlers(col) {
  return {
    async GET(_req, { params }) {
      const { id } = await params;
      const doc = await repo.get(col, id);
      return doc ? NextResponse.json({ item: doc }) : fail(new Error("Not found"), 404);
    },
    async PUT(req, { params }) {
      try {
        const { id } = await params;
        const doc = await repo.update(col, id, await req.json());
        return doc ? NextResponse.json({ item: doc }) : fail(new Error("Not found"), 404);
      } catch (e) {
        return fail(e);
      }
    },
    async DELETE(_req, { params }) {
      const { id } = await params;
      const ok = await repo.remove(col, id);
      return ok ? NextResponse.json({ ok }) : fail(new Error("Not found"), 404);
    },
  };
}
