// src/storage/db.ts

export type BackgroundStyle = "PURPLE" | "PINK";

export type SyncState = "local" | "pending_upload" | "pending_update" | "pending_delete" | "synced";

export type PhotoRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  folder: string | null;
  isFavorite: boolean;

  // tombstone: если true — в UI не показываем, но запись нужна для синка delete
  deleted: boolean;

  // sync flags
  syncState: SyncState;

  // image
  blob: Blob;
};

const DB_NAME = "yosya_db";
const DB_VERSION = 3; // bump because schema changed

const STORE_PHOTOS = "photos";
const STORE_META = "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

export function ensureDbReady() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise.then(() => undefined);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        const store = db.createObjectStore(STORE_PHOTOS, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("folder", "folder", { unique: false });
        store.createIndex("isFavorite", "isFavorite", { unique: false });
        store.createIndex("deleted", "deleted", { unique: false });
        store.createIndex("syncState", "syncState", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      } else {
        const store = req.transaction!.objectStore(STORE_PHOTOS);
        // add new indexes safely
        if (!store.indexNames.contains("deleted")) store.createIndex("deleted", "deleted", { unique: false });
        if (!store.indexNames.contains("syncState")) store.createIndex("syncState", "syncState", { unique: false });
        if (!store.indexNames.contains("updatedAt")) store.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);

      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);

      tx.onabort = () => reject(tx.error);
    });
  });
}

function nowMs() {
  return Date.now();
}

function genId(): string {
  // modern browsers (HTTPS usually)
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();

  // fallback: uuid v4 using getRandomValues
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else {
    // very old fallback (last resort)
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // RFC4122 v4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}


function normalizePhotoRow(row: any): PhotoRecord | null {
  if (!row || typeof row !== "object") return null;

  // back-compat with older records (DB_VERSION 2)
  const createdAt = typeof row.createdAt === "number" ? row.createdAt : nowMs();
  const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : createdAt;

  const deleted = typeof row.deleted === "boolean" ? row.deleted : false;
  const syncState: SyncState =
    row.syncState === "pending_upload" ||
    row.syncState === "pending_update" ||
    row.syncState === "pending_delete" ||
    row.syncState === "synced" ||
    row.syncState === "local"
      ? row.syncState
      : "local";

  return {
    id: String(row.id),
    name: String(row.name ?? "photo.jpg"),
    createdAt,
    updatedAt,
    folder: row.folder === null || row.folder === undefined ? null : String(row.folder),
    isFavorite: !!row.isFavorite,
    deleted,
    syncState,
    blob: row.blob as Blob,
  };
}

/* ===== photos ===== */

export async function listPhotos(): Promise<PhotoRecord[]> {
  const rows = await withStore<any[]>(STORE_PHOTOS, "readonly", (s) => s.getAll());
  const list = (rows || [])
    .map(normalizePhotoRow)
    .filter((x): x is PhotoRecord => !!x)
    .filter((x) => !x.deleted);

  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

// for sync/debug (includes deleted tombstones)
export async function listAllPhotos(): Promise<PhotoRecord[]> {
  const rows = await withStore<any[]>(STORE_PHOTOS, "readonly", (s) => s.getAll());
  const list = (rows || []).map(normalizePhotoRow).filter((x): x is PhotoRecord => !!x);
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

export async function getPhoto(id: string): Promise<PhotoRecord | undefined> {
  const row = await withStore<any | undefined>(STORE_PHOTOS, "readonly", (s) => s.get(id));
  const rec = normalizePhotoRow(row);
  return rec || undefined;
}

export async function addPhotos(files: File[], folder: string | null = null, favorite: boolean = false): Promise<void> {
  const db = await openDb();
  const ts = nowMs();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTOS, "readwrite");
    const store = tx.objectStore(STORE_PHOTOS);

    for (const f of files) {
      const rec: PhotoRecord = {
        id: genId(),
        name: f.name,
        createdAt: ts,
        updatedAt: ts,
        folder,
        isFavorite: favorite,
        deleted: false,
        syncState: "pending_upload",
        blob: f,
      };
      store.put(rec);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  // keep folder in folders list
  if (folder) {
    const folders = await getFolders();
    if (!folders.includes(folder)) {
      folders.push(folder);
      await setFolders(folders);
    }
  }
}

// IMPORTANT: tombstone delete (do not remove record -> so it never "returns" after sync)
export async function softDeletePhoto(id: string): Promise<void> {
  const rec = await getPhoto(id);
  if (!rec) return;

  rec.deleted = true;
  rec.updatedAt = nowMs();

  // if not uploaded yet: still keep as pending_delete (server will just accept delete)
  rec.syncState = "pending_delete";

  // optionally drop blob to reduce storage (keep tiny blob)
  try {
    rec.blob = new Blob([], { type: rec.blob?.type || "application/octet-stream" });
  } catch {
    // ignore
  }

  await withStore(STORE_PHOTOS, "readwrite", (s) => s.put(rec)).then(() => undefined);
}

// hard delete only after successful delete sync (optional cleanup)
export async function hardDeletePhoto(id: string): Promise<void> {
  await withStore(STORE_PHOTOS, "readwrite", (s) => s.delete(id)).then(() => undefined);
}

export async function toggleFavorite(id: string): Promise<void> {
  const rec = await getPhoto(id);
  if (!rec || rec.deleted) return;

  rec.isFavorite = !rec.isFavorite;
  rec.updatedAt = nowMs();

  // if already synced -> update; else keep pending_upload
  rec.syncState = rec.syncState === "synced" ? "pending_update" : "pending_upload";

  await withStore(STORE_PHOTOS, "readwrite", (s) => s.put(rec)).then(() => undefined);
}

export async function setPhotoFolder(id: string, folder: string | null): Promise<void> {
  const rec = await getPhoto(id);
  if (!rec || rec.deleted) return;

  rec.folder = folder;
  rec.updatedAt = nowMs();

  rec.syncState = rec.syncState === "synced" ? "pending_update" : "pending_upload";

  await withStore(STORE_PHOTOS, "readwrite", (s) => s.put(rec)).then(() => undefined);

  if (folder) {
    const folders = await getFolders();
    if (!folders.includes(folder)) {
      folders.push(folder);
      await setFolders(folders);
    }
  }
}

export async function markSynced(id: string): Promise<void> {
  const rec = await getPhoto(id);
  if (!rec) return;

  if (rec.deleted) {
    // keep tombstone as synced delete (or you can hardDeletePhoto)
    rec.syncState = "synced";
  } else {
    rec.syncState = "synced";
  }
  rec.updatedAt = nowMs();

  await withStore(STORE_PHOTOS, "readwrite", (s) => s.put(rec)).then(() => undefined);
}

export async function listPending(): Promise<PhotoRecord[]> {
  const all = await listAllPhotos();
  return all.filter((x) => x.syncState.startsWith("pending_"));
}

export function blobToUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/* ===== meta (bgStyle, folders, sync) ===== */

type MetaRow = { key: string; value: any };

export async function getBackgroundStyle(): Promise<BackgroundStyle> {
  const row = await withStore<MetaRow | undefined>(STORE_META, "readonly", (s) => s.get("bgStyle"));
  const v = row?.value;
  return v === "PINK" ? "PINK" : "PURPLE";
}

export async function setBackgroundStyle(style: BackgroundStyle): Promise<void> {
  await withStore(STORE_META, "readwrite", (s) => s.put({ key: "bgStyle", value: style })).then(() => undefined);
}

export async function getFolders(): Promise<string[]> {
  const row = await withStore<MetaRow | undefined>(STORE_META, "readonly", (s) => s.get("folders"));
  const v = row?.value;
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((x) => x.trim().length > 0);
}

export async function setFolders(folders: string[]): Promise<void> {
  const clean = folders.map((x) => x.trim()).filter((x) => x.length > 0);
  const uniq = Array.from(new Set(clean));
  await withStore(STORE_META, "readwrite", (s) => s.put({ key: "folders", value: uniq })).then(() => undefined);
}

export async function getSyncEnabled(): Promise<boolean> {
  const row = await withStore<MetaRow | undefined>(STORE_META, "readonly", (s) => s.get("syncEnabled"));
  const v = row?.value;
  return v === false ? false : true; // default ON
}

export async function setSyncEnabled(enabled: boolean): Promise<void> {
  await withStore(STORE_META, "readwrite", (s) => s.put({ key: "syncEnabled", value: !!enabled })).then(() => undefined);
}

export async function getLastSyncAt(): Promise<number | null> {
  const row = await withStore<MetaRow | undefined>(STORE_META, "readonly", (s) => s.get("lastSyncAt"));
  const v = row?.value;
  return typeof v === "number" ? v : null;
}

export async function setLastSyncAt(ts: number): Promise<void> {
  await withStore(STORE_META, "readwrite", (s) => s.put({ key: "lastSyncAt", value: ts })).then(() => undefined);
}

/* ===== defaults ===== */

export async function ensureDefaults(): Promise<void> {
  const row = await withStore<{ key: string; value: boolean } | undefined>(
    STORE_META,
    "readonly",
    (s) => s.get("defaults_initialized")
  );

  if (row?.value) return;

  const defaults = [
    "/yosya.jpg",
    "/yosya1.jpg",
    "/yosya2.jpg",
    "/yosya3.jpg",
    "/yosya4.jpg",
    "/yosya5.jpg",
    "/yosya6.jpg",
    "/yosya7.jpg",
    "/yosya8.jpg",
  ];

  // 1) fetch blobs without transaction
  const blobs: { name: string; blob: Blob }[] = [];
  for (const url of defaults) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Default image not found: ${url} (HTTP ${res.status})`);
    const blob = await res.blob();
    blobs.push({ name: url.split("/").pop() || "default.jpg", blob });
  }

  // 2) write fast in one tx
  const db = await openDb();
  const ts = nowMs();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTOS, "readwrite");
    const store = tx.objectStore(STORE_PHOTOS);

    for (const item of blobs) {
      const rec: PhotoRecord = {
        id: genId(),
        name: item.name,
        createdAt: ts,
        updatedAt: ts,
        folder: null,
        isFavorite: false,
        deleted: false,
        syncState: "pending_upload",
        blob: item.blob,
      };
      store.put(rec);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  await withStore(STORE_META, "readwrite", (s) => s.put({ key: "defaults_initialized", value: true })).then(
    () => undefined
  );
}
