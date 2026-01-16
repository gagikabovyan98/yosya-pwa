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
 * CORS:
 * - В проде лучше same-origin, потому что фронт и api у тебя на одном домене через nginx (/api/*).
 * - Но в dev удобно localhost:5173.
 */
await app.register(cors, {
  origin: (origin, cb) => {
    // allow server-to-server / curl (no Origin)
    if (!origin) return cb(null, true);

    const allowed = new Set([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      // добавишь позже домен:
      // "https://yourdomain.com",
    ]);

    cb(null, allowed.has(origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
});

// ===== env =====
const S3_ENDPOINT_INTERNAL = process.env.S3_ENDPOINT_INTERNAL || "http://127.0.0.1:9100";
const S3_ENDPOINT_PUBLIC = process.env.S3_ENDPOINT_PUBLIC || S3_ENDPOINT_INTERNAL;

const S3_REGION = process.env.S3_REGION || "us-east-1";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || "supersecretpassword";
const S3_BUCKET = process.env.S3_BUCKET || "yosya";
const PUBLIC_BASE = process.env.PUBLIC_BASE || "photos"; // prefix in bucket

/**
 * IMPORTANT:
 * Presigned URL MUST be signed with the SAME endpoint host that will be used by the client.
 * So we sign with S3_ENDPOINT_PUBLIC.
 */
const s3Signer = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT_PUBLIC,
  forcePathStyle: true,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
});

// (optional) if later you need server->minio direct operations, you can use internal client
const s3Internal = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT_INTERNAL,
  forcePathStyle: true,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
});

// ===== simple metadata store (MVP) =====
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

app.post("/api/upload-url", async (req, reply) => {
  const body = z
    .object({
      id: z.string(),
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

  // SIGN WITH PUBLIC ENDPOINT (critical)
  const url = await getSignedUrl(s3Signer, cmd, { expiresIn: 60 * 10 });

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

app.post("/api/download-url", async (req, reply) => {
  const body = z.object({ id: z.string() }).parse(req.body);

  const meta = loadMeta();
  const rec = meta[body.id];
  if (!rec || rec.deleted) return reply.code(404).send({ error: "not found" });

  const cmd = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: rec.key,
  });

  // SIGN WITH PUBLIC ENDPOINT (so phone can use it)
  const url = await getSignedUrl(s3Signer, cmd, { expiresIn: 60 * 10 });
  return reply.send({ url });
});

app.post("/api/delete", async (req, reply) => {
  const body = z.object({ id: z.string() }).parse(req.body);

  const meta = loadMeta();
  const rec = meta[body.id];
  if (!rec) return reply.send({ ok: true });

  rec.deleted = true;
  saveMeta(meta);

  return reply.send({ ok: true });
});

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

app.get("/api/sync", async () => {
  const meta = loadMeta();
  const list = Object.values(meta).sort((a, b) => b.createdAt - a.createdAt);
  return { items: list };
});

const PORT = Number(process.env.PORT || 8787);
app.listen({ port: PORT, host: "0.0.0.0" });
