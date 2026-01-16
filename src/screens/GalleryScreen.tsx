// src/screens/GalleryScreen.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import ParticleField from "../ui/ParticleField";
import FullscreenOverlay from "../ui/FullscreenOverlay";
import {
  addPhotos,
  blobToUrl,
  softDeletePhoto,
  ensureDefaults,
  getBackgroundStyle,
  getFolders,
  listPhotos,
  setBackgroundStyle,
  getSyncEnabled,
  setFolders,
  setPhotoFolder,
  toggleFavorite,
  type BackgroundStyle,
  type PhotoRecord,
} from "../storage/db";
import { syncNow } from "../api/sync";


type GalleryTab = "ALL" | "FAVORITES" | "SETTINGS";

export default function GalleryScreen() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState<PhotoRecord[]>([]);
  const [tab, setTab] = useState<GalleryTab>("ALL");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const [bgStyle, setBgStyleState] = useState<BackgroundStyle>("PURPLE");

  const [folders, setFoldersState] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const [showMoveSelected, setShowMoveSelected] = useState(false);

  async function refresh() {
    const rows = await listPhotos();
    setItems(rows);
  }

  useEffect(() => {
    let alive = true;

    const onOnline = async () => {
      try {
        const enabled = await getSyncEnabled();
        if (!enabled) return;

        await syncNow();
        if (alive) await refresh();
      } catch {}
    };

    (async () => {
      try {
        await ensureDefaults();
        if (!alive) return;

        await refresh();
        if (!alive) return;

        const bg = await getBackgroundStyle();
        if (alive) setBgStyleState(bg);

        const f = await getFolders();
        if (alive) setFoldersState(f);

        // optional: если стартуем уже онлайн — можно сразу попробовать досинкать
        if (navigator.onLine) {
          await onOnline();
        }
      } catch {}
    })();

    window.addEventListener("online", onOnline);

    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const urls = useMemo(() => {
    return items.map((x) => ({ id: x.id, url: blobToUrl(x.blob) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    return () => {
      for (const u of urls) URL.revokeObjectURL(u.url);
    };
  }, [urls]);

  const favoritesCount = useMemo(() => items.filter((x) => x.isFavorite).length, [items]);
  const totalCount = items.length;

  const baseList = useMemo(() => {
    if (tab === "FAVORITES") return items.filter((x) => x.isFavorite);
    return items;
  }, [items, tab]);

  const photoList = useMemo(() => {
    if (currentFolder == null) return baseList;
    return baseList.filter((x) => x.folder === currentFolder);
  }, [baseList, currentFolder]);

  useEffect(() => {
    // если ушли в настройки — закрываем fullscreen/selection
    if (tab === "SETTINGS") {
      setSelectedIndex(null);
      clearSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function clearSelection() {
    setSelectionMode(false);
    setSelectedIds([]);
  }

  function isSelected(id: string) {
    return selectedIds.includes(id);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        if (next.length === 0) setSelectionMode(false);
        return next;
      }
      return [...prev, id];
    });
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const fav = tab === "FAVORITES";
    await addPhotos(files, currentFolder, fav);
    e.target.value = "";
    await refresh();

    // try sync if online
    if (navigator.onLine) {
      try { await syncNow(); } catch {}
    }


  }

  async function onToggleFavorite(id: string) {
    await toggleFavorite(id);
    await refresh();

    // try sync if online
    if (navigator.onLine) {
      try { await syncNow(); } catch {}
    }

    // если мы в избранных и сняли лайк — закрыть fullscreen как в android
    if (tab === "FAVORITES") {
      const stillFav = (await listPhotos()).find((x) => x.id === id)?.isFavorite;
      if (!stillFav) setSelectedIndex(null);
    }
  }


  async function onDelete(id: string) {
    await softDeletePhoto(id);
    await refresh();
    setSelectedIndex(null);
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    // try sync if online
    if (navigator.onLine) {
      try { await syncNow(); } catch {}
    }
  }


  async function onChangeFolderOne(id: string, folderValue: string | null) {
    await setPhotoFolder(id, folderValue);
    await refresh();

    const f = await getFolders();
    setFoldersState(f);

    // try sync if online
    if (navigator.onLine) {
      try { await syncNow(); } catch {}
    }
  }


  async function onChangeFolderMany(ids: string[], folderValue: string | null) {
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      await setPhotoFolder(id, folderValue);
    }

    await refresh();
    const f = await getFolders();
    setFoldersState(f);

    // one sync after bulk changes
    if (navigator.onLine) {
      try { await syncNow(); } catch {}
    }
  }


  async function createFolderAndSelect(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = folders.includes(trimmed) ? folders : [...folders, trimmed];
    setFoldersState(next);
    await setFolders(next);
    setCurrentFolder(trimmed);
  }

  // Share helpers
  async function shareOne(id: string) {
    const rec = items.find((x) => x.id === id);
    if (!rec) return;
    const file = new File([rec.blob], rec.name || "photo.jpg", { type: rec.blob.type || "image/jpeg" });

    // Web Share API
    const nav: any = navigator;
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: "Поделиться рисунком" });
      return;
    }

    // fallback: download
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = rec.name || "photo.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function shareMany(ids: string[]) {
    const list = items.filter((x) => ids.includes(x.id));
    if (!list.length) return;

    const files = list.map((rec) => new File([rec.blob], rec.name || "photo.jpg", { type: rec.blob.type || "image/jpeg" }));
    const nav: any = navigator;

    if (nav.share && nav.canShare && nav.canShare({ files })) {
      await nav.share({ files, title: "Поделиться фотками" });
      return;
    }

    // fallback: download zip нельзя без либ, поэтому просто скачиваем по очереди
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  }

  const bgStyleObj =
    bgStyle === "PINK"
      ? { background: "linear-gradient(to bottom, #3B001F 0%, #5B0130 45%, #7B0150 100%)" }
      : { background: "linear-gradient(to bottom, #060016 0%, #130826 45%, #26123D 100%)" };

  return (
    <div className="galleryRoot" style={bgStyleObj}>
      <ParticleField />

      <div className="galleryInner">
        {/* Header like Android */}
        <div className="headerTitleRow">
          <div className="headerTitle">YosyaDrows</div>
          <div className="headerHeart">♥</div>
        </div>
        <div className="headerSub">для самой любимой твари :3</div>

        <div style={{ height: 18 }} />

        {tab !== "SETTINGS" ? (
          <>
            {/* top controls: Все / Папки / Выбрать */}
            {items.length > 0 ? (
              <div className="topControlsRow">
                <button
                  className={`pill ${currentFolder === null ? "pillSelected" : ""}`}
                  onClick={() => {
                    setCurrentFolder(null);
                    clearSelection();
                  }}
                >
                  Все
                </button>

                <button
                  className={`pill ${currentFolder !== null ? "pillSelected" : ""}`}
                  onClick={() => {
                    setShowFolderPicker(true);
                  }}
                >
                  {currentFolder ? `Папка: ${currentFolder}` : "Папки"}
                </button>

                <button
                  className={`pill ${selectionMode ? "pillSelected" : ""}`}
                  onClick={() => {
                    if (selectionMode) clearSelection();
                    else setSelectionMode(true);
                  }}
                >
                  {selectionMode ? "Отмена" : "Выбрать"}
                </button>
              </div>
            ) : null}

            {selectionMode && selectedIds.length === 0 ? (
              <div className="selectionHint">Ткни по нужным фоткам, чтобы выбрать</div>
            ) : null}

            {selectionMode && selectedIds.length > 0 ? (
              <div className="selectionBar">
                <div className="selectionBarText">Выбрано: {selectedIds.length}</div>
                <div className="selectionActions">
                  <button className={`smallChip smallChipBlue`} onClick={() => setShowMoveSelected(true)}>
                    В папку
                  </button>
                  <button className={`smallChip smallChipWhite`} onClick={() => shareMany(selectedIds)}>
                    Поделиться
                  </button>
                  <button className={`smallChip smallChipWhite`} onClick={() => clearSelection()}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}

            {/* content */}
            {tab === "FAVORITES" && photoList.length === 0 ? (
              <div style={{ height: "60%", display: "grid", placeItems: "center" }}>
                <div style={{ color: "#FFE7FF", fontSize: 18, textAlign: "center" }}>Пока нет избранных :3</div>
              </div>
            ) : (
              <div className="grid">
                <div className="gridInner">
                  {photoList.map((p, idx) => {
                    const urlObj = urls.find((x) => x.id === p.id);
                    const u = urlObj?.url;

                    const selected = isSelected(p.id);

                    return (
                      <div className="card" key={p.id}>
                        <div
                          className="cardBox"
                          onClick={() => {
                            if (selectionMode) {
                              toggleSelect(p.id);
                            } else {
                              setSelectedIndex(idx);
                            }
                          }}
                        >
                          {u ? <img className="cardImg" src={u} alt={p.name} /> : null}

                          {/* heart */}
                          <div
                            className="heartBadge"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavorite(p.id);
                            }}
                          >
                            <span
                              className="heartText"
                              style={{ color: p.isFavorite ? "#FF5C8A" : "#FFE7FF" }}
                            >
                              {p.isFavorite ? "♥" : "♡"}
                            </span>
                          </div>

                          {/* selection dot */}
                          {selectionMode ? (
                            <>
                              <div
                                className={`selectDot ${selected ? "selectDotSelected" : ""}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelect(p.id);
                                }}
                              >
                                <span style={{ fontSize: 10, color: "#FFE7FF" }}>{selected ? "✓" : ""}</span>
                              </div>

                              {selected ? <div className="selectionOverlay" /> : null}
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* FAB */}
            <button className="fab" onClick={() => inputRef.current?.click()}>
              +
            </button>
            <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onPickFiles} />
          </>
        ) : (
          // SETTINGS
          <div style={{ height: "70%", display: "grid", placeItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#FFE7FF", fontSize: 20, fontWeight: 600 }}>Настройки</div>
              <div style={{ height: 8 }} />
              <div style={{ color: "#FFB3D9", fontSize: 14 }}>главное — ты тут ♥</div>

              <div style={{ height: 24 }} />

              <div style={{ color: "#FFE7FF", fontSize: 14 }}>Всего фото: {totalCount}</div>
              <div style={{ color: "#FFE7FF", fontSize: 14 }}>Избранных: {favoritesCount}</div>

              <div style={{ height: 24 }} />
              <div style={{ color: "#FFE7FF", fontSize: 14, fontWeight: 600 }}>Фон галереи</div>

              <div style={{ height: 8 }} />

              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button
                  className={`pill ${bgStyle === "PURPLE" ? "pillSelected" : ""}`}
                  onClick={async () => {
                    setBgStyleState("PURPLE");
                    await setBackgroundStyle("PURPLE");
                  }}
                >
                  Фиолетовый
                </button>
                <button
                  className={`pill ${bgStyle === "PINK" ? "pillSelected" : ""}`}
                  onClick={async () => {
                    setBgStyleState("PINK");
                    await setBackgroundStyle("PINK");
                  }}
                >
                  Розовый
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fullscreen overlay */}
        {selectedIndex !== null && tab !== "SETTINGS" ? (
          <FullscreenOverlay
            items={photoList}
            urls={photoList.map((p) => urls.find((x) => x.id === p.id)?.url || "")}
            index={selectedIndex}
            onClose={() => setSelectedIndex(null)}
            onPrev={() => {
              if (!photoList.length) return;
              setSelectedIndex((i) => {
                if (i === null) return null;
                return (i - 1 + photoList.length) % photoList.length;
              });
            }}
            onNext={() => {
              if (!photoList.length) return;
              setSelectedIndex((i) => {
                if (i === null) return null;
                return (i + 1) % photoList.length;
              });
            }}
            onToggleFavorite={async () => {
              const id = photoList[selectedIndex].id;
              await onToggleFavorite(id);
            }}
            onDelete={async () => {
              const id = photoList[selectedIndex].id;
              await onDelete(id);

              // recompute list and index like Android
              const newItems = await listPhotos();
              const newBase = tab === "FAVORITES" ? newItems.filter((x) => x.isFavorite) : newItems;
              const newList = currentFolder ? newBase.filter((x) => x.folder === currentFolder) : newBase;

              if (newList.length === 0) {
                setSelectedIndex(null);
              } else {
                setSelectedIndex((i) => {
                  if (i === null) return null;
                  const ni = i >= newList.length ? newList.length - 1 : i;
                  return ni >= 0 ? ni : null;
                });
              }
              await refresh();
            }}
            onShare={async () => {
              const id = photoList[selectedIndex].id;
              await shareOne(id);
            }}
            onChangeFolder={async (name) => {
              const trimmed = name.trim();
              const folderVal = trimmed.length ? trimmed : null;
              const id = photoList[selectedIndex].id;
              await onChangeFolderOne(id, folderVal);
            }}
          />
        ) : null}

        {/* bottom bar */}
        <div className="bottomBarWrap">
          <div className="bottomBar">
            <button
              className={`bottomItem ${tab === "ALL" ? "bottomItemSelected" : ""}`}
              onClick={() => {
                setSelectedIndex(null);
                setTab("ALL");
                clearSelection();
              }}
            >
              <div className="bottomIcon">🖼</div>
              <div className="bottomLabel">Все</div>
            </button>

            <button
              className={`bottomItem ${tab === "FAVORITES" ? "bottomItemSelected" : ""}`}
              onClick={() => {
                setSelectedIndex(null);
                setTab("FAVORITES");
                clearSelection();
              }}
            >
              <div className="bottomIcon">{tab === "FAVORITES" ? "♥" : "♡"}</div>
              <div className="bottomLabel">
                {favoritesCount > 0 ? `Избранные (${favoritesCount})` : "Избранные"}
              </div>
            </button>

            <button
              className={`bottomItem ${tab === "SETTINGS" ? "bottomItemSelected" : ""}`}
              onClick={() => {
                setSelectedIndex(null);
                setTab("SETTINGS");
                clearSelection();
              }}
            >
              <div className="bottomIcon">⚙</div>
              <div className="bottomLabel">Настройки</div>
            </button>
          </div>
        </div>

        {/* dialogs */}
        {showFolderPicker ? (
          <FolderPickerDialog
            folders={folders}
            currentFolder={currentFolder}
            onClose={() => setShowFolderPicker(false)}
            onSelect={(name) => {
              setCurrentFolder(name);
              clearSelection();
              setShowFolderPicker(false);
            }}
            onCreate={() => {
              setShowFolderPicker(false);
              setNewFolderName("");
              setShowCreateFolder(true);
            }}
          />
        ) : null}

        {showCreateFolder ? (
          <CreateFolderDialog
            value={newFolderName}
            onChange={setNewFolderName}
            onCancel={() => setShowCreateFolder(false)}
            onCreate={async () => {
              await createFolderAndSelect(newFolderName);
              setNewFolderName("");
              setShowCreateFolder(false);
            }}
          />
        ) : null}

        {showMoveSelected && selectedIds.length > 0 ? (
          <MoveSelectedDialog
            folders={folders}
            count={selectedIds.length}
            onClose={() => setShowMoveSelected(false)}
            onMove={async (folderVal) => {
              await onChangeFolderMany(selectedIds, folderVal);
              setCurrentFolder(folderVal);
              clearSelection();
              setShowMoveSelected(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ===== dialogs ===== */

function FolderPickerDialog(props: {
  folders: string[];
  currentFolder: string | null;
  onClose: () => void;
  onSelect: (name: string | null) => void;
  onCreate: () => void;
}) {
  const { folders, currentFolder, onClose, onSelect, onCreate } = props;

  return (
    <div className="dialogBack" onClick={onClose}>
      <div className="dialogCard" onClick={(e) => e.stopPropagation()}>
        <div className="dialogTitle">Папки</div>

        <div style={{ display: "grid", gap: 6 }}>
          <button className="dialogBtn" style={{ textAlign: "left" }} onClick={() => onSelect(null)}>
            Все
          </button>

          {folders.map((f) => (
            <button
              key={f}
              className="dialogBtn"
              style={{
                textAlign: "left",
                background: currentFolder === f ? "rgba(255,142,219,0.33)" : "rgba(255,255,255,0.12)",
              }}
              onClick={() => onSelect(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="dialogBtns">
          <button className="dialogBtn" onClick={onCreate}>
            Новая папка
          </button>
          <button className="dialogBtn" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateFolderDialog(props: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const { value, onChange, onCancel, onCreate } = props;

  return (
    <div className="dialogBack" onClick={onCancel}>
      <div className="dialogCard" onClick={(e) => e.stopPropagation()}>
        <div className="dialogTitle">Новая папка</div>
        <input className="dialogInput" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Имя папки" />
        <div className="dialogBtns">
          <button className="dialogBtn" onClick={onCancel}>
            Отмена
          </button>
          <button className="dialogBtn" onClick={onCreate}>
            Создать
          </button>
        </div>
      </div>
    </div>
  );
}

function MoveSelectedDialog(props: {
  folders: string[];
  count: number;
  onClose: () => void;
  onMove: (folder: string | null) => void;
}) {
  const { folders, count, onClose, onMove } = props;

  const [newFolder, setNewFolder] = useState("");
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="dialogBack" onClick={onClose}>
      <div className="dialogCard" onClick={(e) => e.stopPropagation()}>
        <div className="dialogTitle">Переместить в папку</div>

        <div style={{ color: "#FFE7FF", fontSize: 12, marginBottom: 8 }}>
          {folders.length ? `Выбери папку для ${count} фото` : "Папок пока нет :3\nСоздай новую ниже"}
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <button className="dialogBtn" style={{ textAlign: "left" }} onClick={() => onMove(null)}>
            Без папки (Все)
          </button>

          {folders.map((f) => (
            <button key={f} className="dialogBtn" style={{ textAlign: "left" }} onClick={() => onMove(f)}>
              {f}
            </button>
          ))}
        </div>

        <div style={{ height: 10 }} />

        {!showNew ? (
          <button className="dialogBtn" onClick={() => setShowNew(true)} style={{ width: "100%", textAlign: "left" }}>
            Новая папка
          </button>
        ) : (
          <>
            <input className="dialogInput" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Имя новой папки" />
            <div className="dialogBtns">
              <button className="dialogBtn" onClick={onClose}>
                Отмена
              </button>
              <button
                className="dialogBtn"
                onClick={() => {
                  const t = newFolder.trim();
                  if (!t) return;
                  onMove(t);
                }}
              >
                Создать и переместить
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
