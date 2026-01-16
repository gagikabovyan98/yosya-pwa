// src/ui/FullscreenViewer.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import type { PhotoRecord } from "../storage/db";

export default function FullscreenViewer(props: {
  items: PhotoRecord[];
  urls: string[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const { items, urls, index, onClose, onIndexChange, onToggleFavorite, onDelete } = props;

  const cur = items[index];
  const curUrl = urls[index];

  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const startXRef = useRef<number | null>(null);

  const canPrev = index > 0;
  const canNext = index < items.length - 1;

  const title = useMemo(() => {
    if (!cur) return "";
    return cur.name;
  }, [cur]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && canPrev) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && canNext) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onIndexChange, index, canPrev, canNext]);

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    setDragging(true);
    setDragX(0);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || startXRef.current === null) return;
    setDragX(e.clientX - startXRef.current);
  }

  function onPointerUp() {
    if (!dragging) return;
    setDragging(false);

    const dx = dragX;
    setDragX(0);
    startXRef.current = null;

    const TH = 60;
    if (dx > TH && canPrev) onIndexChange(index - 1);
    if (dx < -TH && canNext) onIndexChange(index + 1);
  }

  if (!cur) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        color: "#fff",
        zIndex: 9999,
      }}
    >
      {/* image */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "absolute",
          inset: 0,
          touchAction: "pan-y",
          display: "grid",
          placeItems: "center",
        }}
      >
        {curUrl ? (
          <img
            src={curUrl}
            alt={cur.name}
            draggable={false}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              transform: `translateX(${dragX}px)`,
              transition: dragging ? "none" : "transform 160ms ease",
              userSelect: "none",
            }}
          />
        ) : null}
      </div>

      {/* top bar */}
      <div style={{ position: "absolute", top: 10, left: 10, right: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onClose} style={btn}>←</button>
        <div style={{ flex: 1, fontSize: 12, opacity: 0.9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        <button onClick={onToggleFavorite} style={btn}>{cur.isFavorite ? "★" : "☆"}</button>
        <button onClick={onDelete} style={btn}>🗑</button>
      </div>

      {/* bottom nav */}
      <div style={{ position: "absolute", bottom: 14, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 10 }}>
        <button disabled={!canPrev} onClick={() => canPrev && onIndexChange(index - 1)} style={{ ...btn, opacity: canPrev ? 1 : 0.35 }}>
          ◀
        </button>
        <div style={{ fontSize: 12, opacity: 0.8, minWidth: 80, textAlign: "center" }}>
          {index + 1} / {items.length}
        </div>
        <button disabled={!canNext} onClick={() => canNext && onIndexChange(index + 1)} style={{ ...btn, opacity: canNext ? 1 : 0.35 }}>
          ▶
        </button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: 42,
  height: 36,
  borderRadius: 10,
  border: "1px solid #333",
  background: "#111",
  color: "#fff",
  cursor: "pointer",
};
