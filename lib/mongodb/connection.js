// Cached Mongoose connection (survives Next.js dev hot-reloads).
import mongoose from "mongoose";

const g = globalThis;
g.__mongoose ??= { conn: null, promise: null, failed: false };

export const mongoConfigured = () => Boolean(process.env.MONGODB_URI);

export async function connectMongo() {
  if (!mongoConfigured()) return null;
  const cache = g.__mongoose;
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 4000, bufferCommands: false })
      .then((m) => m)
      .catch((err) => {
        cache.promise = null;
        throw err;
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
