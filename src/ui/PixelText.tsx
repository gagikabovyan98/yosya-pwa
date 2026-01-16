// src/PixelText/tsx

import { useEffect, useMemo, useState } from "react";

type Props = {
  text: string;
  size: number;
  color: string;
  weight?: number;
  glow?: { color: string; blur: number };
};

const cache = new Map<string, string>();

export default function PixelText({
  text,
  size,
  color,
  weight = 700,
  glow
}: Props) {
  const [src, setSrc] = useState<string | null>(null);

  const key = useMemo(
    () => JSON.stringify({ text, size, color, weight, glow }),
    [text, size, color, weight, glow]
  );

  useEffect(() => {
    const cached = cache.get(key);
    if (cached) {
      setSrc(cached);
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const font = `${weight} ${size}px Pixel, monospace`;
    ctx.font = font;

    const metrics = ctx.measureText(text);
    const w = Math.ceil(metrics.width + 10);
    const h = Math.ceil(size + 10);

    canvas.width = w;
    canvas.height = h;

    const c = canvas.getContext("2d")!;
    c.imageSmoothingEnabled = false;
    c.font = font;

    if (glow) {
      c.shadowColor = glow.color;
      c.shadowBlur = glow.blur;
    }

    c.fillStyle = color;
    c.fillText(text, 5, size);

    const url = canvas.toDataURL("image/png");
    cache.set(key, url);
    setSrc(url);
  }, [key]);

  if (!src) return null;

  return (
    <img
      src={src}
      alt={text}
      draggable={false}
      style={{
        imageRendering: "pixelated",
        display: "block"
      }}
    />
  );
}

