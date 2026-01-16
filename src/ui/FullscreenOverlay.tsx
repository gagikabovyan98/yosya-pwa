// src/ui/FullscreenOverlay.tsx

import { useEffect, useRef, useState } from "react";
import type { PhotoRecord } from "../storage/db";

export default function FullscreenOverlay(props: {
  items: PhotoRecord[];
  urls: string[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onShare: () => void;
  onChangeFolder: (name: string) => void;
}) {
  const { items, urls, index, onClose, onPrev, onNext, onToggleFavorite, onDelete, onShare, onChangeFolder } = props;

  const cur = items[index];
  const curUrl = urls[index];

  const totalX = useRef(0);
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [folderInput, setFolderInput] = useState(cur?.folder ?? "");

  useEffect(() => {
    setFolderInput(cur?.folder ?? "");
  }, [cur?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  function onPointerDown() {
    totalX.current = 0;
  }

  function onPointerMove(e: React.PointerEvent) {
    totalX.current += e.movementX || 0;
  }

  function onPointerUp() {
    if (totalX.current > 80) onPrev();
    else if (totalX.current < -80) onNext();
    totalX.current = 0;
  }

  if (!cur) return null;

  return (
    <div
      className="fsBack"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="fsClickClose" onClick={onClose} />

      <div className="fsImageBoxWrap">
        <div className="fsCard" onClick={(e) => e.stopPropagation()}>
          {curUrl ? <img className="fsImg" src={curUrl} alt={cur.name} draggable={false} /> : null}
        </div>
      </div>

      {/* heart */}
      <div
        className="fsHeart"
        style={{ color: cur.isFavorite ? "#FF5C8A" : "#FFE7FF", transform: `scale(${cur.isFavorite ? 1.25 : 1})`, transition: "transform 180ms ease" }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
      >
        {cur.isFavorite ? "♥" : "♡"}
      </div>

      {/* arrows */}
      <div className="fsArrowL" onClick={(e) => { e.stopPropagation(); onPrev(); }}>‹</div>
      <div className="fsArrowR" onClick={(e) => { e.stopPropagation(); onNext(); }}>›</div>

      {/* folder pill */}
      <div
        className="fsFolderPill"
        onClick={(e) => {
          e.stopPropagation();
          setFolderInput(cur.folder ?? "");
          setShowFolderDialog(true);
        }}
      >
        <div className="fsFolderText">Папка: {cur.folder ?? "Без папки"}</div>
      </div>

      {/* actions */}
      <div className="fsActions">
        <button className="fsBtn fsBtnShare" onClick={(e) => { e.stopPropagation(); onShare(); }}>
          Поделиться
        </button>
        <button className="fsBtn fsBtnDelete" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          Удалить
        </button>
      </div>

      {/* close */}
      <div className="fsClose" onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</div>

      {/* folder dialog */}
      {showFolderDialog ? (
        <div className="dialogBack" onClick={() => setShowFolderDialog(false)}>
          <div className="dialogCard" onClick={(e) => e.stopPropagation()}>
            <div className="dialogTitle">Папка</div>
            <input
              className="dialogInput"
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="Имя папки (пусто = без папки)"
            />
            <div className="dialogBtns">
              <button className="dialogBtn" onClick={() => setShowFolderDialog(false)}>Отмена</button>
              <button
                className="dialogBtn"
                onClick={() => {
                  onChangeFolder(folderInput);
                  setShowFolderDialog(false);
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
