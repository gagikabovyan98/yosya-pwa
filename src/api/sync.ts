// src/api/sync.ts

import {
  getDeviceId,
  getPhoto,
  listPending,
  markSynced,
  setLastSyncAt,
  applyServerDeleted,
  insertDownloadedPhoto,
  upsertLocalMetaFromServer,
  type PhotoRecord,
  type ServerMetaItem,
} from "../storage/db";

/**
 * API base:
 * - default ""  => same-origin (recommended in prod behind nginx: /api/*)
 * - can be set to full origin via VITE_API_BASE (e.g. "https://api.domain.com")
 */
const API_BASE = ((import.meta as any).env?.VITE_API_BASE?.toString() ?? "").trim();

function apiUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function createUploadUrl(deviceId: string, p: PhotoRecord) {
  const body = {
    deviceId,
    id: p.id,
    contentType: p.blob?.type || "image/jpeg",
    originalName: p.name || "photo.jpg",
    folder: p.folder,
    favorite: p.isFavorite,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };

  const res = await fetch(apiUrl("/api/upload-url"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(`upload-url failed ${res.status} ${JSON.stringify(err)}`);
  }

  const data = await safeJson(res);
  if (!data?.url) throw new Error("upload-url: no url");
  return { url: data.url as string };
}

/**
 * IMPORTANT:
 * - confirm upload to server only AFTER PUT succeeded
 * - prevents "ghost items" in server meta
 */
async function confirmUpload(deviceId: string, p: PhotoRecord) {
  const res = await fetch(apiUrl("/api/upload-complete"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId,
      id: p.id,
      folder: p.folder,
      favorite: p.isFavorite,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      originalName: p.name || "photo.jpg",
    }),
  });

  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(`upload-complete failed ${res.status} ${JSON.stringify(err)}`);
  }
}

async function uploadBlobToSignedUrl(url: string, blob: Blob) {
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": blob?.type || "application/octet-stream",
    },
    body: blob,
  });

  if (!res.ok) throw new Error(`PUT signed url failed ${res.status}`);
}

async function updateFlags(deviceId: string, p: PhotoRecord) {
  const res = await fetch(apiUrl("/api/update"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId,
      id: p.id,
      folder: p.folder,
      favorite: p.isFavorite,
      updatedAt: p.updatedAt,
    }),
  });

  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(`update failed ${res.status} ${JSON.stringify(err)}`);
  }
}

async function deleteRemote(deviceId: string, id: string) {
  const res = await fetch(apiUrl("/api/delete"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId, id }),
  });

  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(`delete failed ${res.status} ${JSON.stringify(err)}`);
  }
}

async function getSyncList(deviceId: string): Promise<ServerMetaItem[]> {
  const u = apiUrl(`/api/sync?deviceId=${encodeURIComponent(deviceId)}`);
  const res = await fetch(u, { method: "GET" });
  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(`sync list failed ${res.status} ${JSON.stringify(err)}`);
  }

  const data = await safeJson(res);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items as ServerMetaItem[];
}

async function getDownloadUrl(deviceId: string, id: string): Promise<string> {
  const res = await fetch(apiUrl("/api/download-url"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId, id }),
  });

  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(`download-url failed ${res.status} ${JSON.stringify(err)}`);
  }

  const data = await safeJson(res);
  if (!data?.url) throw new Error("download-url: no url");
  return data.url as string;
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`download blob failed ${res.status}`);
  return await res.blob();
}

let syncLock = false;

export async function syncNow(): Promise<{
  ok: boolean;
  uploaded: number;
  updated: number;
  deleted: number;
  pulled: number;
}> {
  if (syncLock) return { ok: true, uploaded: 0, updated: 0, deleted: 0, pulled: 0 };
  syncLock = true;

  try {
    const deviceId = await getDeviceId();

    // ===== 1) PUSH (local -> server) =====
    const pending = await listPending();

    const deletes = pending.filter((x) => x.syncState === "pending_delete");
    const uploads = pending.filter((x) => x.syncState === "pending_upload");
    const updates = pending.filter((x) => x.syncState === "pending_update");

    let deleted = 0;
    let uploaded = 0;
    let updated = 0;

    // 1A) deletes first (tombstones)
    for (const p of deletes) {
      try {
        await deleteRemote(deviceId, p.id);

        // ✅ IMPORTANT: do NOT hard delete locally.
        // Tombstone must stay to prevent resurrection.
        await markSynced(p.id);

        deleted += 1;
      } catch {
        // keep pending_delete
      }
    }

    // 1B) uploads
    for (const p of uploads) {
      try {
        const fresh = await getPhoto(p.id);
        if (!fresh) continue;

        // if locally deleted before upload => just send delete tombstone
        if (fresh.deleted) {
          try {
            await deleteRemote(deviceId, fresh.id);
            await markSynced(fresh.id);
            deleted += 1;
          } catch {
            // keep pending_delete if server delete failed
          }
          continue;
        }

        const { url } = await createUploadUrl(deviceId, fresh);
        await uploadBlobToSignedUrl(url, fresh.blob);
        await confirmUpload(deviceId, fresh);

        await markSynced(fresh.id);
        uploaded += 1;
      } catch {
        // keep pending_upload
      }
    }

    // 1C) updates (folder/favorite)
    for (const p of updates) {
      try {
        const fresh = await getPhoto(p.id);
        if (!fresh) continue;

        if (fresh.deleted) {
          try {
            await deleteRemote(deviceId, fresh.id);
            await markSynced(fresh.id);
            deleted += 1;
          } catch {
            // keep pending_delete if server delete failed
          }
          continue;
        }

        await updateFlags(deviceId, fresh);
        await markSynced(fresh.id);
        updated += 1;
      } catch {
        // keep pending_update
      }
    }

    // ===== 2) PULL (server -> local) =====
    let pulled = 0;
    try {
      const items = await getSyncList(deviceId);

      for (const it of items) {
        // server tombstone wins
        if (it.deleted) {
          await applyServerDeleted(it.id);
          continue;
        }

        // update local metadata if safe
        await upsertLocalMetaFromServer(it);

        // if local photo missing => download and insert
        const local = await getPhoto(it.id);
        if (!local) {
          try {
            const dl = await getDownloadUrl(deviceId, it.id);
            const blob = await fetchBlob(dl);
            await insertDownloadedPhoto(it, blob);
            pulled += 1;
          } catch {
            // ignore download failures
          }
        }
      }
    } catch {
      // ignore pull if server/minio down; offline-first stays safe
    }

    await setLastSyncAt(Date.now());
    return { ok: true, uploaded, updated, deleted, pulled };
  } finally {
    syncLock = false;
  }
}
