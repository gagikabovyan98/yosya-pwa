// src/App.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import IntroScreen from "./screens/IntroScreen";
import GalleryScreen from "./screens/GalleryScreen";

const DESIGN_H = 800; // фиксируем "высоту дизайна", как было

function useViewport() {
  const [vp, setVp] = useState(() => {
    const vv = window.visualViewport;
    return {
      w: vv?.width ?? window.innerWidth,
      h: vv?.height ?? window.innerHeight,
    };
  });

  useEffect(() => {
    const read = () => {
      const vv = window.visualViewport;
      setVp({
        w: vv?.width ?? window.innerWidth,
        h: vv?.height ?? window.innerHeight,
      });
    };

    const vv = window.visualViewport;
    vv?.addEventListener("resize", read);
    vv?.addEventListener("scroll", read);

    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);

    return () => {
      vv?.removeEventListener("resize", read);
      vv?.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);

  return vp;
}

function SnowOverlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;

    type Dot = { x: number; y: number; r: number; vy: number; vx: number; t: number };
    let dots: Dot[] = [];

    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    const resize = () => {
      dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const vv = window.visualViewport;

      w = Math.floor(vv?.width ?? window.innerWidth);
      h = Math.floor(vv?.height ?? window.innerHeight);

      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.floor((w * h) / 14000);
      const count = Math.max(80, Math.min(220, target));

      dots = Array.from({ length: count }).map(() => ({
        x: rand(0, w),
        y: rand(0, h),
        r: rand(0.6, 1.6),
        vy: rand(0.15, 0.7),
        vx: rand(-0.12, 0.12),
        t: rand(0, Math.PI * 2),
      }));
    };

    const tick = () => {
      ctx.clearRect(0, 0, w, h);

      for (const p of dots) {
        p.t += 0.01;
        p.x += p.vx + Math.sin(p.t) * 0.08;
        p.y += p.vy;

        if (p.y > h + 6) {
          p.y = -6;
          p.x = rand(0, w);
        }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    resize();

    const vv = window.visualViewport;
    vv?.addEventListener("resize", resize);
    vv?.addEventListener("scroll", resize);

    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      vv?.removeEventListener("resize", resize);
      vv?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 5,
      }}
    />
  );
}

export default function App() {
  const { w, h } = useViewport();

  const [showIntro, setShowIntro] = useState(true);

  // ✅ FULLSCREEN без полей и без обрезки:
  // 1) фиксируем высоту "дизайна" (800)
  // 2) под текущий экран считаем "базовую ширину сцены"
  // 3) масштабируем по высоте — и ширина ровно попадает в экран
  const { baseW, scale } = useMemo(() => {
    const safeH = Math.max(1, h);
    const safeW = Math.max(1, w);

    // ширина сцены в "дизайн-пикселях" под текущий aspect
    const computedBaseW = Math.round((DESIGN_H * safeW) / safeH);

    // масштаб по высоте (точный, НЕ квантуем — иначе появятся поля)
    const s = safeH / DESIGN_H;

    return { baseW: computedBaseW, scale: s };
  }, [w, h]);

  const handleContinue = () => setShowIntro(false);

  // вернуть интро после “долгого” ухода в фон
  useEffect(() => {
    const hiddenAtRef = { current: null as number | null };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (document.visibilityState === "visible") {
        const hiddenAt = hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (hiddenAt && Date.now() - hiddenAt > 2500) {
          setShowIntro(true);
        }
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // iOS Safari bfcache
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setShowIntro(true);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  return (
    <div className="app">
      <div className="viewport">
        <SnowOverlay />

        {/* scaler: сцена в "дизайн-пикселях", потом scale до реального экрана */}
        <div
          className="scaler"
          style={{
            width: baseW,
            height: DESIGN_H,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <div className="stage" style={{ width: baseW, height: DESIGN_H }}>
            {showIntro ? (
              <IntroScreen onContinue={handleContinue} />
            ) : (
              <GalleryScreen />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
