import { useState, useEffect } from "react";
import { totalFrames } from "@/game/frameStats";

interface FPSCounterProps {
  style?: "default" | "minimal";
}

/** Frames the board drew in the last second (0 when idle: it renders on demand). */
export default function FPSCounter({ style }: FPSCounterProps) {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let last = performance.now();
    let seen = totalFrames();
    const timer = setInterval(() => {
      const now = performance.now();
      const total = totalFrames();
      setFps(Math.round(((total - seen) * 1000) / (now - last)));
      seen = total;
      last = now;
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (style === "minimal") {
    return (
      <div className="bg-black/80 text-white px-2 py-2 border border-white/20 font-mono text-xs">
        FPS: {fps}
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-24 bg-black/80 text-white px-4 py-2 border border-white/20 font-mono text-sm z-50">
      FPS: {fps}
    </div>
  );
}
