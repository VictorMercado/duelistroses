import { useState, useEffect, useRef } from "react";

interface FPSCounterProps {
  style?: "default" | "minimal";
}

export default function FPSCounter({ style }: FPSCounterProps) {
  const [fps, setFps] = useState(0);
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());

  useEffect(() => {
    let animationFrameId: number;

    const updateFPS = () => {
      frameCount.current++;
      const currentTime = performance.now();
      const delta = currentTime - lastTime.current;

      if (delta >= 1000) {
        setFps(Math.round((frameCount.current * 1000) / delta));
        frameCount.current = 0;
        lastTime.current = currentTime;
      }

      animationFrameId = requestAnimationFrame(updateFPS);
    };

    animationFrameId = requestAnimationFrame(updateFPS);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  if (style === "minimal") {
    return (
      <div className="bg-black/80 text-white px-2 py-2 rounded-lg border border-white/20 font-mono text-xs">
        FPS: {fps}
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-24 bg-black/80 text-white px-4 py-2 rounded-lg border border-white/20 font-mono text-sm z-50">
      FPS: {fps}
    </div>
  );
}
