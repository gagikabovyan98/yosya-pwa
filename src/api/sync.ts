// src/api/sync.ts

import {
  getPhoto,
  listPending,
  markSynced,
  setLastSyncAt,
  hardDeletePhoto,
  type PhotoRecord,
} from "../storage/db";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE?.toString() ||
  "http://localhost:8787"; // later: https://api.yourdomain.com

function apiUrl(path: string) {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function createUploadUrl(p: PhotoRecord) {
  const body = {
    id: p.id,
    contentType: p.blob.type || "image/jpeg",
    originalName: p.name || "photo.jpg",
    folder: p.folder,
    favorite: p.isFavorite,
    createdAt: p.createdAt,
  };

  const res = await fetch(apiUrl("/api/upload-url"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`upload-url failed ${res.status}`);
  const data = await safeJson(res);
  if (!data?.url) throw new Error("upload-url: no url");
  return data.url as string;
}

async function uploadBlobToSignedUrl(url: string, blob: Blob) {
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      // some S3 setups like explicit content-type
      "content-type": blob.type || "application/octet-stream",
    },
    body: blob,
  });

  if (!res.ok) throw new Error(`PUT signed url failed ${res.status}`);
}

async function updateFlags(p: PhotoRecord) {
  const res = await fetch(apiUrl("/api/update"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: p.id,
      folder: p.folder,
      favorite: p.isFavorite,
    }),
  });

  if (!res.ok) throw new Error(`update failed ${res.status}`);
}

async function deleteRemote(id: string) {
  const res = await fetch(apiUrl("/api/delete"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });

  if (!res.ok) throw new Error(`delete failed ${res.status}`);
}

let syncLock = false;

export async function syncNow(): Promise<{ ok: boolean; uploaded: number; updated: number; deleted: number }> {
  if (syncLock) return { ok: true, uploaded: 0, updated: 0, deleted: 0 };
  syncLock = true;

  try {
    const pending = await listPending();

    // stable order: deletes first, then uploads, then updates
    const deletes = pending.filter((x) => x.syncState === "pending_delete");
    const uploads = pending.filter((x) => x.syncState === "pending_upload");
    const updates = pending.filter((x) => x.syncState === "pending_update");

    let deleted = 0;
    let uploaded = 0;
    let updated = 0;

    // 1) deletes (tombstones)
    for (const p of deletes) {
      try {
        await deleteRemote(p.id);
        await markSynced(p.id);
        // optional cleanup: remove tombstone completely (comment if you want keep it)
        await hardDeletePhoto(p.id);
        deleted += 1;
      } catch {
        // keep pending
      }
    }

    // 2) uploads
    // 2) uploads
    for (const p of uploads) {
        try {
            const fresh = await getPhoto(p.id);
            if (!fresh) continue;

            // если уже удалено локально — аплоад не нужен, чистим хвост
            if (fresh.deleted) {
            await markSynced(fresh.id);
            await hardDeletePhoto(fresh.id);
            continue;
            }

            const url = await createUploadUrl(fresh);
            await uploadBlobToSignedUrl(url, fresh.blob);

            await markSynced(fresh.id);
            uploaded += 1;
        } catch {
            // keep pending
        }
    }


    // 3) updates (folder/favorite)
    for (const p of updates) {
        try {
            const fresh = await getPhoto(p.id);
            if (!fresh) continue;

            // если уже удалено локально — апдейт не нужен, чистим хвост
            if (fresh.deleted) {
            await markSynced(fresh.id);
            await hardDeletePhoto(fresh.id);
            continue;
            }

            await updateFlags(fresh);
            await markSynced(fresh.id);
            updated += 1;
        } catch {
            // keep pending
        }
    }


    await setLastSyncAt(Date.now());
    return { ok: true, uploaded, updated, deleted };
  } finally {
    syncLock = false;
  }
}
