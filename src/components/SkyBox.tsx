import type { ReactNode } from "react";
import type { SkyState } from "../lib/sky.ts";
import { WeatherScene } from "./WeatherScene.tsx";

/** The animated sky when real weather is known; a plain neutral backdrop while it is not. */
export function SkyBox({ sky, className, children }: { sky: SkyState; className?: string; children: ReactNode }) {
  if (sky.scene) {
    return (
      <WeatherScene scene={sky.scene} sunProgress={sky.sunProgress} moonLit={sky.moonLit} className={className}>
        {children}
      </WeatherScene>
    );
  }
  return (
    <div className={"scene scene-idle " + (className || "")}>
      <div className="scene-content">{children}</div>
    </div>
  );
}
