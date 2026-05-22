import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma v7 moved datasource URLs out of schema.prisma. This file is what
// the Prisma CLI uses for `prisma migrate` / `prisma db push` / etc.
//
// `url` here = the connection string for *migrations* (session-mode pooler
// on Supabase, port 5432). DIRECT_URL in .env points at the session pooler.
//
// At runtime, PrismaClient still reads DATABASE_URL from the environment
// automatically — that one points at the transaction pooler (port 6543)
// for short pooled queries.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DIRECT_URL"),
  },
});
