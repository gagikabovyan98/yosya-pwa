// src/screens/IntroScreen.tsx

import { useRef } from "react";
import ParticleField from "../ui/ParticleField";

export default function IntroScreen({ onContinue }: { onContinue: () => void }) {
  const already = useRef(false);

  const dragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);

  function reset() {
    dragging.current = false;
    startX.current = 0;
    startY.current = 0;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (already.current) return;

    dragging.current = true;
    startX.current = e.clientX;
    startY.current = e.clientY;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current || already.current) return;

    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;

    // mostly horizontal swipe like Android
    if (Math.abs(dx) > 120 && Math.abs(dy) < 90) {
      already.current = true;
      reset();
      onContinue();
    }
  }

  function onPointerUp() {
    reset();
  }

  return (
    <div
      className="introRoot"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <ParticleField />

      <div className="introCenter">
        <div className="kittyBox">
          <img className="kittyGif" src="/black_back.gif" alt="Hello Kitty" />
        </div>

        <div className="introTitle">Моей любимой мразоте :3</div>
      </div>

      <div className="swipeHint">
        <span className="neonArrowWrap">
          <span className="neonArrow">←</span>
        </span>
      </div>
    </div>
  );
}
