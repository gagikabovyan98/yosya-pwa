// src/server/index.ts

import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

const app = Fastify({ logger: true });

/**
 * NOTE:
 * - Frontend calls API via same-origin "/api/..." (nginx proxy) => CORS is not required for that.
 * - Upload itself is a PUT to MinIO via presigned URL => CORS must be configured in MinIO (not here).
 * We keep CORS enabled for dev convenience.
 */
await app.register(cors, {
  origin: [
    "http://localhost:5173",
    // "https://yourdomain.com"
  ],
  methods: ["GET", "POST", "OPTIONS"],
});

// ===== env =====
// INTERNAL: server -> MinIO (usually localhost)
const S3_ENDPOINT_INTERNAL =
  process.env.S3_ENDPOINT_INTERNAL || process.env.S3_ENDPOINT || "http://127.0.0.1:9100";

// PUBLIC: what client must use in presigned URL (IP or domain)
const S3_ENDPOINT_PUBLIC =
  process.env.S3_ENDPOINT_PUBLIC ||
  process.env.S3_PUBLIC_ENDPOINT ||
  process.env.S3_PUBLIC_ENDPOINT_URL ||
  "";

// other
const S3_REGION = process.env.S3_REGION || "us-east-1";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || "supersecretpassword";
const S3_BUCKET = process.env.S3_BUCKET || "yosya";
const PUBLIC_BASE = process.env.PUBLIC_BASE || "photos"; // prefix in bucket

function rewriteSignedUrlToPublic(url: string) {
  if (!S3_ENDPOINT_PUBLIC) return url;

  try {
    const u = new URL(url);
    const pub = new URL(S3_ENDPOINT_PUBLIC);

    u.protocol = pub.protocol;
    u.host = pub.host; // includes port if any

    return u.toString();
  } catch {
    return url;
  }
}

const s3 = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT_INTERNAL,
  forcePathStyle: true, // important for MinIO
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
});

// ===== very simple metadata store (MVP) =====
// stores: folder, favorite, deleted, createdAt, originalName
const dataDir = path.resolve(process.cwd(), "data");
const metaPath = path.join(dataDir, "meta.json");

type Meta = Record<
  string,
  {
    id: string;
    key: string; // s3 object key
    createdAt: number;
    folder: string | null;
    favorite: boolean;
    deleted: boolean;
    originalName: string;
  }
>;

function loadMeta(): Meta {
  try {
    if (!fs.existsSync(metaPath)) return {};
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return {};
  }
}

function saveMeta(m: Meta) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(m, null, 2), "utf8");
}

// ===== routes =====

app.get("/api/health", async () => ({ ok: true }));

// 1) create upload url
app.post("/api/upload-url", async (req, reply) => {
  const body = z
    .object({
      id: z.string(), // uuid from client
      contentType: z.string().default("image/jpeg"),
      originalName: z.string().default("photo.jpg"),
      folder: z.string().nullable().default(null),
      favorite: z.boolean().default(false),
      createdAt: z.number().int().default(() => Date.now()),
    })
    .parse(req.body);

  const objectKey = `${PUBLIC_BASE}/${body.id}`;

  const cmd = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: objectKey,
    ContentType: body.contentType,
  });

  // Sign using INTERNAL endpoint, then rewrite to PUBLIC so mobile/browser can reach it
  const urlInternal = await getSignedUrl(s3, cmd, { expiresIn: 60 * 10 });
  const url = rewriteSignedUrlToPublic(urlInternal);

  const meta = loadMeta();
  meta[body.id] = {
    id: body.id,
    key: objectKey,
    createdAt: body.createdAt,
    folder: body.folder,
    favorite: body.favorite,
    deleted: false,
    originalName: body.originalName,
  };
  saveMeta(meta);

  return reply.send({ url, objectKey });
});

// 2) get download url
app.post("/api/download-url", async (req, reply) => {
  const body = z.object({ id: z.string() }).parse(req.body);

  const meta = loadMeta();
  const rec = meta[body.id];
  if (!rec || rec.deleted) return reply.code(404).send({ error: "not found" });

  const cmd = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: rec.key,
  });

  const urlInternal = await getSignedUrl(s3, cmd, { expiresIn: 60 * 10 });
  const url = rewriteSignedUrlToPublic(urlInternal);

  return reply.send({ url });
});

// 3) soft delete (tombstone)
app.post("/api/delete", async (req, reply) => {
  const body = z.object({ id: z.string() }).parse(req.body);

  const meta = loadMeta();
  const rec = meta[body.id];
  if (!rec) return reply.send({ ok: true });

  rec.deleted = true;
  saveMeta(meta);

  return reply.send({ ok: true });
});

// 4) update flags (folder/favorite)
app.post("/api/update", async (req, reply) => {
  const body = z
    .object({
      id: z.string(),
      folder: z.string().nullable().optional(),
      favorite: z.boolean().optional(),
    })
    .parse(req.body);

  const meta = loadMeta();
  const rec = meta[body.id];
  if (!rec || rec.deleted) return reply.code(404).send({ error: "not found" });

  if (body.folder !== undefined) rec.folder = body.folder;
  if (body.favorite !== undefined) rec.favorite = body.favorite;

  saveMeta(meta);
  return reply.send({ ok: true });
});

// 5) sync list
app.get("/api/sync", async () => {
  const meta = loadMeta();
  const list = Object.values(meta).sort((a, b) => b.createdAt - a.createdAt);
  return { items: list };
});

const PORT = Number(process.env.PORT || 8787);
app.listen({ port: PORT, host: "0.0.0.0" });
