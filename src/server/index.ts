// // src/server/index.ts

// import Fastify from "fastify";
// import cors from "@fastify/cors";
// import { z } from "zod";
// import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
// import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
// import fs from "node:fs";
// import path from "node:path";
// import "dotenv/config";

// const app = Fastify({ logger: true });

// /**
//  * CORS:
//  * - В проде лучше same-origin, потому что фронт и api у тебя на одном домене через nginx (/api/*).
//  * - Но в dev удобно localhost:5173.
//  */
// await app.register(cors, {
//   origin: (origin, cb) => {
//     // allow server-to-server / curl (no Origin)
//     if (!origin) return cb(null, true);

//     const allowed = new Set([
//       "http://localhost:5173",
//       "http://127.0.0.1:5173",
//       // добавишь позже домен:
//       // "https://yourdomain.com",
//     ]);

//     cb(null, allowed.has(origin));
//   },
//   methods: ["GET", "POST", "OPTIONS"],
// });

// // ===== env =====
// const S3_ENDPOINT_INTERNAL = process.env.S3_ENDPOINT_INTERNAL || "http://127.0.0.1:9100";
// const S3_ENDPOINT_PUBLIC = process.env.S3_ENDPOINT_PUBLIC || S3_ENDPOINT_INTERNAL;

// const S3_REGION = process.env.S3_REGION || "us-east-1";
// const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
// const S3_SECRET_KEY = process.env.S3_SECRET_KEY || "supersecretpassword";
// const S3_BUCKET = process.env.S3_BUCKET || "yosya";
// const PUBLIC_BASE = process.env.PUBLIC_BASE || "photos"; // prefix in bucket

// /**
//  * IMPORTANT:
//  * Presigned URL MUST be signed with the SAME endpoint host that will be used by the client.
//  * So we sign with S3_ENDPOINT_PUBLIC.
//  */
// const s3Signer = new S3Client({
//   region: S3_REGION,
//   endpoint: S3_ENDPOINT_PUBLIC,
//   forcePathStyle: true,
//   credentials: {
//     accessKeyId: S3_ACCESS_KEY,
//     secretAccessKey: S3_SECRET_KEY,
//   },
// });

// // (optional) if later you need server->minio direct operations, you can use internal client
// const s3Internal = new S3Client({
//   region: S3_REGION,
//   endpoint: S3_ENDPOINT_INTERNAL,
//   forcePathStyle: true,
//   credentials: {
//     accessKeyId: S3_ACCESS_KEY,
//     secretAccessKey: S3_SECRET_KEY,
//   },
// });

// // ===== simple metadata store (MVP) =====
// const dataDir = path.resolve(process.cwd(), "data");
// const metaPath = path.join(dataDir, "meta.json");

// type Meta = Record<
//   string,
//   {
//     id: string;
//     key: string; // s3 object key
//     createdAt: number;
//     folder: string | null;
//     favorite: boolean;
//     deleted: boolean;
//     originalName: string;
//   }
// >;

// function loadMeta(): Meta {
//   try {
//     if (!fs.existsSync(metaPath)) return {};
//     return JSON.parse(fs.readFileSync(metaPath, "utf8"));
//   } catch {
//     return {};
//   }
// }

// function saveMeta(m: Meta) {
//   if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
//   fs.writeFileSync(metaPath, JSON.stringify(m, null, 2), "utf8");
// }

// // ===== routes =====

// app.get("/api/health", async () => ({ ok: true }));

// app.post("/api/upload-url", async (req, reply) => {
//   const body = z
//     .object({
//       id: z.string(),
//       contentType: z.string().default("image/jpeg"),
//       originalName: z.string().default("photo.jpg"),
//       folder: z.string().nullable().default(null),
//       favorite: z.boolean().default(false),
//       createdAt: z.number().int().default(() => Date.now()),
//     })
//     .parse(req.body);

//   const objectKey = `${PUBLIC_BASE}/${body.id}`;

//   const cmd = new PutObjectCommand({
//     Bucket: S3_BUCKET,
//     Key: objectKey,
//     ContentType: body.contentType,
//   });

//   // SIGN WITH PUBLIC ENDPOINT (critical)
//   const url = await getSignedUrl(s3Signer, cmd, { expiresIn: 60 * 10 });

//   const meta = loadMeta();
//   meta[body.id] = {
//     id: body.id,
//     key: objectKey,
//     createdAt: body.createdAt,
//     folder: body.folder,
//     favorite: body.favorite,
//     deleted: false,
//     originalName: body.originalName,
//   };
//   saveMeta(meta);

//   return reply.send({ url, objectKey });
// });

// app.post("/api/download-url", async (req, reply) => {
//   const body = z.object({ id: z.string() }).parse(req.body);

//   const meta = loadMeta();
//   const rec = meta[body.id];
//   if (!rec || rec.deleted) return reply.code(404).send({ error: "not found" });

//   const cmd = new GetObjectCommand({
//     Bucket: S3_BUCKET,
//     Key: rec.key,
//   });

//   // SIGN WITH PUBLIC ENDPOINT (so phone can use it)
//   const url = await getSignedUrl(s3Signer, cmd, { expiresIn: 60 * 10 });
//   return reply.send({ url });
// });

// app.post("/api/delete", async (req, reply) => {
//   const body = z.object({ id: z.string() }).parse(req.body);

//   const meta = loadMeta();
//   const rec = meta[body.id];
//   if (!rec) return reply.send({ ok: true });

//   rec.deleted = true;
//   saveMeta(meta);

//   return reply.send({ ok: true });
// });

// app.post("/api/update", async (req, reply) => {
//   const body = z
//     .object({
//       id: z.string(),
//       folder: z.string().nullable().optional(),
//       favorite: z.boolean().optional(),
//     })
//     .parse(req.body);

//   const meta = loadMeta();
//   const rec = meta[body.id];
//   if (!rec || rec.deleted) return reply.code(404).send({ error: "not found" });

//   if (body.folder !== undefined) rec.folder = body.folder;
//   if (body.favorite !== undefined) rec.favorite = body.favorite;

//   saveMeta(meta);
//   return reply.send({ ok: true });
// });

// app.get("/api/sync", async () => {
//   const meta = loadMeta();
//   const list = Object.values(meta).sort((a, b) => b.createdAt - a.createdAt);
//   return { items: list };
// });

// const PORT = Number(process.env.PORT || 8787);
// app.listen({ port: PORT, host: "0.0.0.0" });

// src/server/index.ts

import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

const app = Fastify({ logger: true });

// ===== env =====
const PORT = Number(process.env.PORT || 8787);

const S3_ENDPOINT_INTERNAL =
  process.env.S3_ENDPOINT_INTERNAL || "http://127.0.0.1:9100";
const S3_ENDPOINT_PUBLIC = process.env.S3_ENDPOINT_PUBLIC || S3_ENDPOINT_INTERNAL;

const S3_REGION = process.env.S3_REGION || "us-east-1";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || "supersecretpassword";
const S3_BUCKET = process.env.S3_BUCKET || "yosya";
const PUBLIC_BASE = process.env.PUBLIC_BASE || "photos";

// IMPORTANT: where server stores meta JSON files
// If you want it fixed and predictable, set DATA_DIR in .env (recommended).
const DATA_DIR =
  process.env.DATA_DIR?.trim() ||
  path.resolve(process.cwd(), "data");

const DEFAULT_DEVICE_ID = "global";

// ===== CORS =====
// In prod behind nginx same-origin is usually used, but Safari/PWA can still hit it directly.
// We'll be permissive by default + allow localhost dev.
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    const allowed = new Set([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://62.169.27.185",
      "https://62.169.27.185",
    ]);

    // allow same host origins + allowed list
    if (allowed.has(origin)) return cb(null, true);

    // allow any origin in case you're using custom domain later (optional)
    // comment next line if you want strict allowlist
    return cb(null, true);
  },
  methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
  allowedHeaders: ["content-type"],
});

// ===== S3 clients =====
const s3Signer = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT_PUBLIC,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

// internal client for maintenance ops (delete object etc.)
const s3Internal = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT_INTERNAL,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
});

// ===== helpers =====
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function safeDeviceId(deviceId: string) {
  const d = (deviceId || DEFAULT_DEVICE_ID).trim();
  const safe = d.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe.length > 0 ? safe : DEFAULT_DEVICE_ID;
}

function metaPathFor(deviceId: string) {
  ensureDataDir();
  return path.join(DATA_DIR, `meta-${safeDeviceId(deviceId)}.json`);
}

type MetaItem = {
  id: string;
  key: string;
  createdAt: number;
  updatedAt: number;
  folder: string | null;
  favorite: boolean;
  deleted: boolean;
  originalName: string;
};

type Meta = Record<string, MetaItem>;

function loadMeta(deviceId: string): Meta {
  try {
    const p = metaPathFor(deviceId);
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function saveMeta(deviceId: string, m: Meta) {
  ensureDataDir();
  fs.writeFileSync(metaPathFor(deviceId), JSON.stringify(m, null, 2), "utf8");
}

function objKey(deviceId: string, id: string) {
  return `${PUBLIC_BASE}/${safeDeviceId(deviceId)}/${id}`;
}

function badRequest(reply: any, msg: string, details?: any) {
  return reply.code(400).send({ error: "Bad Request", message: msg, details });
}

function nowMs() {
  return Date.now();
}

// ===== routes =====
app.get("/api/health", async () => ({ ok: true }));

/**
 * Create upload url
 * deviceId is OPTIONAL (fallback = "global") so old clients don't break.
 */
app.post("/api/upload-url", async (req, reply) => {
  const parsed = z
    .object({
      deviceId: z.string().optional(),
      id: z.string().min(1),
      contentType: z.string().optional(),
      originalName: z.string().optional(),
      folder: z.string().nullable().optional(),
      favorite: z.boolean().optional(),
      createdAt: z.number().int().optional(),
      updatedAt: z.number().int().optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return badRequest(reply, "invalid body", parsed.error.flatten());
  }

  const body = parsed.data;
  const deviceId = safeDeviceId(body.deviceId || DEFAULT_DEVICE_ID);

  const objectKey = objKey(deviceId, body.id);

  const cmd = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: objectKey,
    ContentType: body.contentType || "application/octet-stream",
  });

  const url = await getSignedUrl(s3Signer, cmd, { expiresIn: 60 * 10 });

  return reply.send({ url, objectKey, deviceId });
});

/**
 * Confirm upload success: write meta
 */
app.post("/api/upload-complete", async (req, reply) => {
  const parsed = z
    .object({
      deviceId: z.string().optional(),
      id: z.string().min(1),
      folder: z.string().nullable().optional(),
      favorite: z.boolean().optional(),
      createdAt: z.number().int().optional(),
      updatedAt: z.number().int().optional(),
      originalName: z.string().optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return badRequest(reply, "invalid body", parsed.error.flatten());
  }

  const body = parsed.data;
  const deviceId = safeDeviceId(body.deviceId || DEFAULT_DEVICE_ID);

  const meta = loadMeta(deviceId);
  const existing = meta[body.id];

  const createdAt =
    typeof body.createdAt === "number" ? body.createdAt : nowMs();
  const updatedAt =
    typeof body.updatedAt === "number" ? body.updatedAt : nowMs();

  meta[body.id] = {
    id: body.id,
    key: objKey(deviceId, body.id),
    createdAt,
    updatedAt,
    folder: body.folder ?? null,
    favorite: body.favorite ?? false,
    deleted: false,
    originalName: body.originalName || "photo.jpg",
  };

  // keep tombstone if it existed
  if (existing?.deleted) meta[body.id].deleted = true;

  saveMeta(deviceId, meta);
  return reply.send({ ok: true });
});

/**
 * Get download url
 */
app.post("/api/download-url", async (req, reply) => {
  const parsed = z
    .object({
      deviceId: z.string().optional(),
      id: z.string().min(1),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return badRequest(reply, "invalid body", parsed.error.flatten());
  }

  const deviceId = safeDeviceId(parsed.data.deviceId || DEFAULT_DEVICE_ID);

  const meta = loadMeta(deviceId);
  const rec = meta[parsed.data.id];
  if (!rec || rec.deleted) return reply.code(404).send({ error: "not found" });

  const cmd = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: rec.key,
  });

  const url = await getSignedUrl(s3Signer, cmd, { expiresIn: 60 * 10 });
  return reply.send({ url });
});

/**
 * Tombstone delete
 * NOTE: we keep object in MinIO by default. If you later want hard delete, flip flag below.
 */
const HARD_DELETE_FROM_MINIO = false;

app.post("/api/delete", async (req, reply) => {
  const parsed = z
    .object({
      deviceId: z.string().optional(),
      id: z.string().min(1),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return badRequest(reply, "invalid body", parsed.error.flatten());
  }

  const deviceId = safeDeviceId(parsed.data.deviceId || DEFAULT_DEVICE_ID);
  const id = parsed.data.id;

  const meta = loadMeta(deviceId);
  const rec = meta[id];

  if (!rec) {
    meta[id] = {
      id,
      key: objKey(deviceId, id),
      createdAt: nowMs(),
      updatedAt: nowMs(),
      folder: null,
      favorite: false,
      deleted: true,
      originalName: "photo.jpg",
    };
    saveMeta(deviceId, meta);
    return reply.send({ ok: true });
  }

  rec.deleted = true;
  rec.updatedAt = nowMs();
  saveMeta(deviceId, meta);

  if (HARD_DELETE_FROM_MINIO) {
    try {
      await s3Internal.send(
        new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: rec.key })
      );
    } catch {
      // ignore
    }
  }

  return reply.send({ ok: true });
});

/**
 * Update flags
 */
app.post("/api/update", async (req, reply) => {
  const parsed = z
    .object({
      deviceId: z.string().optional(),
      id: z.string().min(1),
      folder: z.string().nullable().optional(),
      favorite: z.boolean().optional(),
      updatedAt: z.number().int().optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return badRequest(reply, "invalid body", parsed.error.flatten());
  }

  const body = parsed.data;
  const deviceId = safeDeviceId(body.deviceId || DEFAULT_DEVICE_ID);

  const meta = loadMeta(deviceId);
  const rec = meta[body.id];
  if (!rec || rec.deleted) return reply.code(404).send({ error: "not found" });

  const incomingUpdatedAt =
    typeof body.updatedAt === "number" ? body.updatedAt : nowMs();

  if (incomingUpdatedAt < rec.updatedAt) return reply.send({ ok: true });

  if (body.folder !== undefined) rec.folder = body.folder;
  if (body.favorite !== undefined) rec.favorite = body.favorite;

  rec.updatedAt = incomingUpdatedAt;
  saveMeta(deviceId, meta);

  return reply.send({ ok: true });
});

/**
 * Sync list (includes tombstones)
 */
app.get("/api/sync", async (req, reply) => {
  const parsed = z
    .object({ deviceId: z.string().optional() })
    .safeParse(req.query);

  if (!parsed.success) {
    return badRequest(reply, "invalid query", parsed.error.flatten());
  }

  const deviceId = safeDeviceId(parsed.data.deviceId || DEFAULT_DEVICE_ID);
  const meta = loadMeta(deviceId);

  const list = Object.values(meta).sort(
    (a, b) =>
      (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
  );

  return reply.send({ items: list });
});

app.listen({ port: PORT, host: "0.0.0.0" });
