// An animated sky drawn on a 2D canvas: sun or moon, stars, layered clouds with
// parallax, rain, snow, fog and lightning — chosen entirely by the live weather.
// It pauses when off-screen or when the tab is hidden, caps itself at ~30 fps, and
// draws a single still frame when the visitor prefers reduced motion.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { sceneLabel, type Scene } from "../lib/scene.ts";

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

const SKY: Record<string, [string, string]> = {
  "clear-d": ["#2f78bd", "#9fcdec"], "cloudy-d": ["#4d83b3", "#b3cde0"], "overcast-d": ["#6f7f8d", "#b2bdc5"], "fog-d": ["#87939b", "#c6cdd1"],
  "rain-d": ["#4b5a66", "#8794a0"], "storm-d": ["#262f3b", "#525d6a"], "snow-d": ["#7f8d9b", "#cfd7de"],
  "clear-n": ["#070d26", "#22335e"], "cloudy-n": ["#0d142b", "#2c3a5c"], "overcast-n": ["#141a29", "#343d52"], "fog-n": ["#1b2130", "#3d4658"],
  "rain-n": ["#0c111b", "#293140"], "storm-n": ["#080b12", "#232a38"], "snow-n": ["#1a2233", "#48546b"],
};

// deterministic pseudo-random so the sky is stable between renders
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function cloudSprite(tone: RGB, seed: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 360;
  c.height = 160;
  const g = c.getContext("2d")!;
  const r = rng(seed);
  for (let i = 0; i < 11; i++) {
    const x = 60 + r() * 240, y = 82 + (r() - 0.5) * 46, rad = 34 + r() * 44;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, css(tone, 0.5));
    grd.addColorStop(0.6, css(tone, 0.22));
    grd.addColorStop(1, css(tone, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

interface Cloud { x: number; y: number; s: number; v: number; z: number; sp: number; a: number }
interface Drop { x: number; y: number; z: number; v: number }
interface State {
  clouds: Cloud[]; drops: Drop[]; stars: { x: number; y: number; r: number; p: number; v: number }[]; sprites: HTMLCanvasElement[];
  nextFlash: number; strike: number; bolts: [number, number][][]; splashes: { x: number; y: number; a: number; z: number }[]; key: string;
}

// a strike flickers: a hard flash, a dip, a second flash, then it dies away
const flicker = (age: number) => (age < 0 ? 0 : age < 0.07 ? 1 : age < 0.14 ? 0.2 : age < 0.26 ? 0.9 : Math.max(0, 0.9 - (age - 0.26) * 1.9));

function forkedBolt(w: number, h: number): [number, number][][] {
  const main: [number, number][] = [];
  let x = w * (0.25 + Math.random() * 0.6), y = 0;
  const end = h * (0.6 + Math.random() * 0.3);
  main.push([x, y]);
  while (y < end) (x += (Math.random() - 0.5) * h * 0.16), (y += h * (0.035 + Math.random() * 0.06)), main.push([x, y]);
  const out = [main];
  for (let b = 0; b < 2; b++) {
    const from = main[2 + Math.floor(Math.random() * Math.max(1, main.length - 4))];
    if (!from) continue;
    const dir = Math.random() < 0.5 ? -1 : 1;
    let [bx, by] = from;
    const br: [number, number][] = [[bx, by]];
    for (let i = 0; i < 4 + Math.floor(Math.random() * 3); i++) (bx += dir * h * (0.02 + Math.random() * 0.06)), (by += h * (0.03 + Math.random() * 0.045)), br.push([bx, by]);
    out.push(br);
  }
  return out;
}

function build(sc: Scene): State {
  const r = rng(sc.sky.length * 977 + (sc.night ? 31 : 7) + Math.round(sc.cloud * 10));
  const tone: RGB = sc.sky === "storm" ? hex("#4a5461") : sc.sky === "rain" ? hex("#7d8996") : sc.sky === "overcast" || sc.sky === "fog" ? hex("#dfe5ea") : hex("#ffffff");
  const dim = sc.night ? mix(tone, hex("#1c2540"), 0.55) : tone;
  const sprites = [cloudSprite(dim, 11), cloudSprite(dim, 29), cloudSprite(dim, 53)];
  const n = Math.round(2 + sc.cloud * 12);
  const clouds: Cloud[] = Array.from({ length: n }, () => {
    const z = 0.35 + r() * 0.65;
    return { x: r(), y: 0.02 + r() * (sc.cloud > 0.7 ? 0.62 : 0.4), s: 0.6 + z * 1.1, v: (0.004 + z * 0.012) * (0.5 + sc.wind * 2.2), z, sp: Math.floor(r() * 3), a: (0.45 + z * 0.5) * (sc.sky === "clear" ? 0.6 : 1) };
  }).sort((a, b) => a.z - b.z);
  const wet = sc.sky === "rain" || sc.sky === "storm" || sc.sky === "snow";
  const count = !wet ? 0 : sc.sky === "snow" ? Math.round(60 + sc.intensity * 160) : Math.round(50 + sc.intensity * 330);
  const drops: Drop[] = Array.from({ length: count }, () => ({ x: r(), y: r(), z: 0.3 + r() * 0.7, v: 0.6 + r() * 0.6 }));
  const stars = sc.night ? Array.from({ length: Math.round(110 * (1 - sc.cloud * 0.85)) }, () => ({ x: r(), y: r() * 0.8, r: 0.4 + r() * 1.1, p: r() * 6.28, v: 0.4 + r() * 1.4 })) : [];
  return { clouds, drops, stars, sprites, nextFlash: 1.5 + r() * 2.5, strike: -1, bolts: [], splashes: [], key: JSON.stringify(sc) };
}

function paint(g: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number, sc: Scene, st: State, sunP: number, moonLit: number, px: number, py: number, still: boolean) {
  const [topH, botH] = SKY[`${sc.sky}-${sc.night ? "n" : "d"}`];
  let top = hex(topH), bot = hex(botH);
  // warm the horizon near sunrise and sunset
  const edge = sc.night ? 0 : Math.max(0, 1 - Math.min(sunP, 1 - sunP) / 0.12);
  if (edge > 0 && (sc.sky === "clear" || sc.sky === "cloudy")) (bot = mix(bot, hex("#f0a35e"), edge * 0.75)), (top = mix(top, hex("#5a6fa8"), edge * 0.45));
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, css(top));
  sky.addColorStop(1, css(bot));
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  // stars
  for (const s of st.stars) {
    const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.v + s.p));
    g.fillStyle = `rgba(255,255,255,${a * 0.9})`;
    g.beginPath();
    g.arc(s.x * w + px * 4, s.y * h + py * 3, s.r, 0, 6.283);
    g.fill();
  }

  // sun or moon — hidden behind heavy cloud
  const veil = sc.sky === "clear" ? 1 : sc.sky === "cloudy" ? 0.75 : sc.sky === "fog" ? 0.35 : sc.sky === "snow" ? 0.2 : sc.sky === "overcast" ? 0.25 : 0;
  if (veil > 0) {
    if (!sc.night) {
      const x = w * (0.1 + 0.8 * sunP) + px * 10, y = h * (0.86 - Math.sin(Math.PI * sunP) * 0.66) + py * 6;
      const R = Math.max(w, h) * 0.42 * (1 + 0.03 * Math.sin(t * 0.6));
      const glow = g.createRadialGradient(x, y, 0, x, y, R);
      const warm = mix(hex("#fff3c4"), hex("#ffb163"), edge);
      glow.addColorStop(0, css(warm, 0.8 * veil));
      glow.addColorStop(0.06, css(warm, 0.36 * veil));
      glow.addColorStop(0.22, css(warm, 0.09 * veil));
      glow.addColorStop(1, css(warm, 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h);
      if (veil >= 0.75) {
        // slow turning rays, each one breathing a little
        const L = Math.max(w, h) * 0.95, k = sc.sky === "clear" ? 1 : 0.55;
        g.save();
        g.translate(x, y);
        g.rotate(t * 0.045);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * 6.283, half = 0.045 + 0.028 * Math.sin(t * 0.7 + i * 1.7);
          const ray = g.createLinearGradient(0, 0, Math.cos(a) * L, Math.sin(a) * L);
          ray.addColorStop(0, css(warm, 0.26 * k));
          ray.addColorStop(1, css(warm, 0));
          g.fillStyle = ray;
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(Math.cos(a - half) * L, Math.sin(a - half) * L);
          g.lineTo(Math.cos(a + half) * L, Math.sin(a + half) * L);
          g.closePath();
          g.fill();
        }
        g.restore();
        // lens flares on the line from the sun through the middle of the picture
        const m = Math.min(w, h);
        for (const [f, rr, al] of [[0.5, 0.045, 0.14], [0.85, 0.022, 0.2], [1.3, 0.075, 0.09], [1.7, 0.035, 0.12]]) {
          g.fillStyle = css(warm, al * k);
          g.beginPath();
          g.arc(x + (w / 2 - x) * f, y + (h / 2 - y) * f, m * rr, 0, 6.283);
          g.fill();
        }
      }
      g.fillStyle = css(mix(hex("#fffbe8"), hex("#ffd08a"), edge), veil);
      g.beginPath();
      g.arc(x, y, Math.min(w, h) * 0.075, 0, 6.283);
      g.fill();
    } else {
      const x = w * 0.8 + px * 8, y = h * 0.26 + py * 5 + Math.sin(t * 0.05) * 3, r = Math.min(w, h) * 0.085;
      const glow = g.createRadialGradient(x, y, r * 0.6, x, y, r * 6);
      glow.addColorStop(0, `rgba(190,205,255,${0.3 * veil})`);
      glow.addColorStop(1, "rgba(190,205,255,0)");
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h);
      g.save();
      g.beginPath();
      g.arc(x, y, r, 0, 6.283);
      g.clip();
      g.fillStyle = `rgba(236,240,250,${veil})`;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      // shade the unlit part so the disc matches the real phase
      g.fillStyle = css(mix(top, bot, 0.3), 0.93);
      g.beginPath();
      g.arc(x - r * 2 * moonLit, y, r * 1.02, 0, 6.283);
      if (moonLit < 0.97) g.fill();
      g.restore();
    }
  }

  // clouds, back to front
  for (const c of st.clouds) {
    if (!still) c.x += c.v * dt;
    if (c.x > 1.25) c.x = -0.35;
    const sp = st.sprites[c.sp];
    const cw = sp.width * c.s * (w / 900 + 0.45), ch = sp.height * c.s * (w / 900 + 0.45);
    g.globalAlpha = Math.min(1, c.a);
    g.drawImage(sp, c.x * w - cw / 2 + px * 26 * c.z, c.y * h - ch / 2 + py * 12 * c.z, cw, ch);
  }
  g.globalAlpha = 1;

  if (sc.sky === "fog") {
    for (let i = 0; i < 4; i++) {
      const y = h * (0.35 + i * 0.17), off = ((t * (6 + i * 3)) % (w * 1.6)) - w * 0.3;
      const f = g.createLinearGradient(0, y - h * 0.14, 0, y + h * 0.14);
      f.addColorStop(0, "rgba(235,238,240,0)");
      f.addColorStop(0.5, `rgba(235,238,240,${sc.night ? 0.12 : 0.3})`);
      f.addColorStop(1, "rgba(235,238,240,0)");
      g.fillStyle = f;
      g.fillRect(off - w, y - h * 0.14, w * 3, h * 0.28);
    }
  }

  // rain / snow
  if (st.drops.length) {
    const snow = sc.sky === "snow";
    const slant = 0.12 + sc.wind * 0.55;
    if (!snow) {
      g.lineCap = "round";
      for (const d of st.drops) {
        if (!still) (d.y += d.v * dt * (1.5 + d.z * 1.4)), (d.x += slant * d.v * dt * 0.9);
        if (d.y > 1.05) {
          if (d.z > 0.55 && st.splashes.length < 70) st.splashes.push({ x: d.x + slant * 0.04, y: 0.9 + d.z * 0.09, a: 1, z: d.z });
          (d.y = -0.05), (d.x = Math.random() * 1.2 - 0.2);
        }
        const x = d.x * w + px * 14 * d.z, y = d.y * h, len = (10 + d.z * 22) * (0.7 + sc.intensity * 0.6);
        g.strokeStyle = `rgba(214,228,240,${0.16 + d.z * 0.42})`;
        g.lineWidth = 0.6 + d.z * 1.1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + len * slant, y + len);
        g.stroke();
      }
      // each near drop ends in a small ring where it lands
      g.lineWidth = 1;
      for (const sp of st.splashes) {
        const rx = (2 + (1 - sp.a) * 11) * sp.z;
        g.strokeStyle = `rgba(222,234,244,${sp.a * 0.55})`;
        g.beginPath();
        g.ellipse(sp.x * w, sp.y * h, rx, rx * 0.3, 0, 0, 6.283);
        g.stroke();
        sp.a -= dt * 3.4;
      }
      st.splashes = st.splashes.filter((sp) => sp.a > 0);
      // a wet haze along the ground when it pours
      if (sc.intensity > 0.5) {
        const mist = g.createLinearGradient(0, h * 0.78, 0, h);
        mist.addColorStop(0, "rgba(200,214,226,0)");
        mist.addColorStop(1, `rgba(200,214,226,${0.2 * sc.intensity})`);
        g.fillStyle = mist;
        g.fillRect(0, h * 0.78, w, h * 0.22);
      }
    } else {
      for (const d of st.drops) {
        if (!still) (d.y += d.v * dt * (0.05 + d.z * 0.09)), (d.x += Math.sin(t * 0.8 + d.v * 9) * 0.0006 + sc.wind * 0.02 * dt);
        if (d.y > 1.04) (d.y = -0.04), (d.x = Math.random());
        if (d.x > 1.05) d.x = -0.05;
        g.fillStyle = `rgba(255,255,255,${0.35 + d.z * 0.6})`;
        g.beginPath();
        g.arc(d.x * w + px * 16 * d.z, d.y * h, 0.8 + d.z * 2.4, 0, 6.283);
        g.fill();
      }
    }
  }

  // lightning: a forked bolt and a flicker that lights the whole sky
  if (sc.sky === "storm" && !still) {
    st.nextFlash -= dt;
    if (st.nextFlash <= 0) {
      st.strike = 0;
      st.nextFlash = 2.5 + Math.random() * 5;
      st.bolts = forkedBolt(w, h);
    }
    if (st.strike >= 0) {
      const f = flicker(st.strike);
      g.fillStyle = `rgba(226,233,255,${f * 0.42})`;
      g.fillRect(0, 0, w, h);
      if (f > 0.5) {
        g.lineJoin = "round";
        g.shadowColor = "rgba(190,205,255,0.95)";
        g.shadowBlur = 18;
        st.bolts.forEach((bolt, i) => {
          g.strokeStyle = `rgba(255,255,255,${i ? f * 0.7 : f})`;
          g.lineWidth = i ? 1.2 : 2.4;
          g.beginPath();
          bolt.forEach(([bx, by], j) => (j ? g.lineTo(bx, by) : g.moveTo(bx, by)));
          g.stroke();
        });
        g.shadowBlur = 0;
      }
      st.strike += dt;
      if (f <= 0) st.strike = -1;
    }
  }
}

export function WeatherScene({ scene, sunProgress = 0.5, moonLit = 1, className, style, children }: { scene: Scene; sunProgress?: number; moonLit?: number; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ scene, sunProgress, moonLit });
  live.current = { scene, sunProgress, moonLit };
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    const el = wrap.current!, cv = canvas.current!;
    const g = cv.getContext("2d");
    if (!g) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let st = build(live.current.scene);
    let w = 0, h = 0, raf = 0, last = 0, t = 0, visible = true, px = 0, py = 0, tx = 0, ty = 0;

    const frame = (now: number) => {
      raf = 0;
      const { scene: sc, sunProgress: sp, moonLit: ml } = live.current;
      if (st.key !== JSON.stringify(sc)) st = build(sc);
      const still = reduce.matches;
      const dt = still ? 0 : Math.min(0.08, (now - last) / 1000 || 0.016);
      if (!still && now - last < 30) return schedule(); // ~30 fps is plenty for weather
      last = now;
      t += dt;
      px += (tx - px) * 0.06;
      py += (ty - py) * 0.06;
      g.setTransform(devicePixelRatio || 1, 0, 0, devicePixelRatio || 1, 0, 0);
      paint(g, w, h, t, dt, sc, st, sp, ml, still ? 0 : px, still ? 0 : py, still);
      if (!still) schedule();
    };
    const schedule = () => {
      if (!raf && visible && document.visibilityState === "visible") raf = requestAnimationFrame(frame);
    };
    const resize = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      last = 0;
      if (reduce.matches) frame(performance.now());
      else schedule();
    };
    redraw.current = () => (reduce.matches ? frame(performance.now()) : schedule());
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => ((visible = e.isIntersecting), schedule()));
    io.observe(el);
    const onVis = () => schedule();
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * -1;
      ty = ((e.clientY - r.top) / r.height - 0.5) * -1;
    };
    const onLeave = () => ((tx = 0), (ty = 0));
    const onMotion = () => resize();
    document.addEventListener("visibilitychange", onVis);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    reduce.addEventListener("change", onMotion);
    resize();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      reduce.removeEventListener("change", onMotion);
    };
  }, []);

  // a still frame must be redrawn when the weather itself changes
  useEffect(() => {
    redraw.current();
  }, [JSON.stringify(scene), sunProgress]);

  return (
    <div ref={wrap} className={"scene " + (className || "")} style={style} data-sky={scene.sky} data-night={scene.night}>
      <canvas ref={canvas} role="img" aria-label={sceneLabel(scene)} />
      <div className="scene-scrim" aria-hidden />
      <div className="scene-content">{children}</div>
    </div>
  );
}
