// // src/ui/ParticleField.tsx

// import { useEffect, useMemo, useRef } from "react";

// type Particle = { x: number; y: number; size: number; speed: number; alpha: number };

// export default function ParticleField() {
//   const canvasRef = useRef<HTMLCanvasElement | null>(null);

//   const particles = useMemo<Particle[]>(() => {
//     const list: Particle[] = [];
//     for (let i = 0; i < 40; i++) {
//       list.push({
//         x: Math.random(),
//         y: Math.random(),
//         size: Math.random() * 4 + 2,
//         speed: Math.random() * 0.25 + 0.08,
//         alpha: Math.random() * 0.6 + 0.2,
//       });
//     }
//     return list;
//   }, []);

//   useEffect(() => {
//     let raf = 0;
//     const start = performance.now();

//     const tick = (t: number) => {
//       const cvs = canvasRef.current;
//       if (!cvs) return;
//       const ctx = cvs.getContext("2d");
//       if (!ctx) return;

//       const rect = cvs.getBoundingClientRect();
//       const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
//       const w = Math.floor(rect.width * dpr);
//       const h = Math.floor(rect.height * dpr);

//       if (cvs.width !== w || cvs.height !== h) {
//         cvs.width = w;
//         cvs.height = h;
//       }

//       ctx.clearRect(0, 0, w, h);

//       const tt = ((t - start) % 8000) / 8000; // 0..1, linear, 8000ms
//       for (const p of particles) {
//         const yPos = ((p.y + tt * p.speed) % 1) * h;
//         const xPos = p.x * w;

//         const a = Math.max(0, Math.min(1, p.alpha));
//         ctx.beginPath();
//         ctx.fillStyle = `rgba(255, 200, 255, ${a})`;
//         ctx.arc(xPos, yPos, p.size * dpr, 0, Math.PI * 2);
//         ctx.fill();
//       }

//       raf = requestAnimationFrame(tick);
//     };

//     raf = requestAnimationFrame(tick);
//     return () => cancelAnimationFrame(raf);
//   }, [particles]);

//   return (
//     <canvas
//       ref={canvasRef}
//       style={{
//         position: "absolute",
//         inset: 0,
//         width: "100%",
//         height: "100%",
//         pointerEvents: "none",
//       }}
//     />
//   );
// }



// src/ui/ParticleField.tsx

import { useEffect, useMemo, useRef } from "react";

type Particle = { x: number; y: number; size: number; speed: number; alpha: number };

export default function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const particles = useMemo<Particle[]>(() => {
    const list: Particle[] = [];
    for (let i = 0; i < 40; i++) {
      list.push({
        x: Math.random(), // 0..1
        y: Math.random(), // 0..1
        size: Math.random() * 4 + 2,
        speed: Math.random() * 0.25 + 0.08,
        alpha: Math.random() * 0.6 + 0.2,
      });
    }
    return list;
  }, []);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();

    const resizeToScreen = () => {
      const cvs = canvasRef.current;
      if (!cvs) return;

      const dpr = Math.max(1, window.devicePixelRatio || 1);

      // Use visualViewport when available (iOS address bar / safe area quirks)
      const vw = Math.floor((window.visualViewport?.width ?? window.innerWidth) * dpr);
      const vh = Math.floor((window.visualViewport?.height ?? window.innerHeight) * dpr);

      if (cvs.width !== vw || cvs.height !== vh) {
        cvs.width = vw;
        cvs.height = vh;
      }
    };

    const tick = (t: number) => {
      const cvs = canvasRef.current;
      if (!cvs) return;

      const ctx = cvs.getContext("2d");
      if (!ctx) return;

      resizeToScreen();

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = cvs.width;
      const h = cvs.height;

      ctx.clearRect(0, 0, w, h);

      const tt = ((t - start) % 8000) / 8000; // 0..1

      for (const p of particles) {
        const yPos = ((p.y + tt * p.speed) % 1) * h;
        const xPos = p.x * w;

        const a = Math.max(0, Math.min(1, p.alpha));
        ctx.beginPath();
        ctx.fillStyle = `rgba(255, 200, 255, ${a})`;

        // sizes were authored in CSS px, convert to device px by *dpr
        ctx.arc(xPos, yPos, p.size * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };

    // initial size + keep in sync
    const onResize = () => resizeToScreen();
    resizeToScreen();

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [particles]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100dvh",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
