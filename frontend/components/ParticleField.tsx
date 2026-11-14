"use client";

// Futuristic animated background — Canvas 2D.
// Features: multi-color particle network, pulsing nodes, data streams,
// hex grid, cursor glow, occasional flashes.

import { useEffect, useRef } from "react";

const NODE_COUNT = 100;
const LINK_DISTANCE = 160;
const MOUSE_RADIUS = 120;
const MOUSE_FORCE = 0.6;
const DRIFT_SPEED = 12;
const DT_CAP = 0.05;

const COLORS = [
  { r: 245, g: 245, b: 245 }, // білий
  { r: 200, g: 200, b: 200 }, // світло-сірий
  { r: 160, g: 160, b: 160 }, // сірий
  { r: 120, g: 120, b: 120 }, // темно-сірий
  { r: 184, g: 184, b: 184 }, // сірий (текст secondary)
];

const STREAM_COUNT = 12;

type PNode = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: { r: number; g: number; b: number };
  pulsePhase: number;
  pulseSpeed: number;
};

type Stream = {
  x: number;
  speed: number;
  dots: number[];
  color: { r: number; g: number; b: number };
};

export function ParticleField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let nodes: PNode[] = [];
    let streams: Stream[] = [];
    let rafId = 0;
    let lastTime = performance.now();
    let time = 0;
    const mouse = { x: -9999, y: -9999, active: false };
    const flash = { x: 0, y: 0, alpha: 0 };
    // Кеш гекс-сітки (off-screen canvas): скидається при resize
    const gridRef: { canvas: HTMLCanvasElement | null } = { canvas: null };
    let dpr = 1; // оголошено тут — drawHexGrid малює в off-screen canvas у px

    const pickColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

    const spawn = (w: number, h: number): PNode => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * DRIFT_SPEED,
      vy: (Math.random() - 0.5) * DRIFT_SPEED,
      r: 1.0 + Math.random() * 1.8,
      color: pickColor(),
      pulsePhase: Math.random() * Math.PI * 2,
      pulseSpeed: 1.5 + Math.random() * 2.5,
    });

    const spawnStream = (w: number, h: number): Stream => ({
      x: Math.random() * w,
      speed: 30 + Math.random() * 60,
      dots: Array.from({ length: 6 + Math.floor(Math.random() * 8) }, (_, i) => i * 18),
      color: pickColor(),
    });

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return;
      const dpr2 = Math.min(window.devicePixelRatio || 1, 2);
      dpr = dpr2;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gridRef.canvas = null; // гекс-сітка залежить від розміру — перемальовуємо
      if (nodes.length !== NODE_COUNT) {
        nodes = Array.from({ length: NODE_COUNT }, () => spawn(width, height));
        streams = Array.from({ length: STREAM_COUNT }, () => spawnStream(width, height));
      }
    };

    const step = (dt: number) => {
      for (const n of nodes) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;

        if (mouse.active) {
          const dx = n.x - mouse.x;
          const dy = n.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MOUSE_RADIUS && dist > 0.01) {
            const push = (1 - dist / MOUSE_RADIUS) * MOUSE_FORCE * dt;
            n.x += (dx / dist) * push;
            n.y += (dy / dist) * push;
          }
        }

        if (n.x < -10) n.x = width + 10;
        else if (n.x > width + 10) n.x = -10;
        if (n.y < -10) n.y = height + 10;
        else if (n.y > height + 10) n.y = -10;
      }

      for (const s of streams) {
        for (let i = 0; i < s.dots.length; i++) {
          s.dots[i] += s.speed * dt;
        }
        if (s.dots.length > 0 && s.dots[0] > height + 20) {
          s.x = Math.random() * width;
          s.color = pickColor();
          s.dots = Array.from({ length: 6 + Math.floor(Math.random() * 8) }, (_, i) => i * 18);
        }
      }

      if (flash.alpha > 0) flash.alpha -= dt * 2;
    };

    const drawHexGrid = () => {
      // Кешована off-screen гекс-сітка: малюється ОДИН раз на resize,
      // а не щокадрово (кожен кадр — сотні stroke → помітне навантаження).
      if (!gridRef.canvas) {
        const off = document.createElement("canvas");
        off.width = Math.max(1, Math.floor(width * dpr));
        off.height = Math.max(1, Math.floor(height * dpr));
        const g = off.getContext("2d");
        if (!g) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.strokeStyle = "rgba(255, 255, 255, 0.03)";
        g.lineWidth = 0.5;
        const size = 60;
        const h = size * Math.sqrt(3);
        for (let row = -1; row < height / h + 1; row++) {
          for (let col = -1; col < width / size + 1; col++) {
            const cx = col * size * 1.5;
            const cy = row * h + (col % 2 === 0 ? 0 : h / 2);
            g.beginPath();
            for (let i = 0; i < 6; i++) {
              const angle = (Math.PI / 3) * i + Math.PI / 6;
              const px = cx + size * 0.4 * Math.cos(angle);
              const py = cy + size * 0.4 * Math.sin(angle);
              if (i === 0) g.moveTo(px, py);
              else g.lineTo(px, py);
            }
            g.closePath();
            g.stroke();
          }
        }
        gridRef.canvas = off;
      }
      ctx.drawImage(gridRef.canvas, 0, 0, width, height);
    };

    const draw = () => {
      if (width <= 0 || height <= 0) return;
      ctx.clearRect(0, 0, width, height);

      drawHexGrid();

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 > LINK_DISTANCE * LINK_DISTANCE) continue;
          // Прозрачність 8–15% (ТЗ) + ОДИН strokeStyle на прохід замість
          // createLinearGradient (~5000 градієнтів/кадр — головне гальмо).
          const alpha = 0.08 + (1 - Math.sqrt(dist2) / LINK_DISTANCE) * 0.07;
          ctx.strokeStyle = `rgba(200, 200, 200, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const n of nodes) {
        const pulse = 0.5 + 0.5 * Math.sin(time * n.pulseSpeed + n.pulsePhase);
        // Прозрачність вузлів 8–15% за ТЗ (було 35–90% — надто шумно)
        const alpha = 0.08 + pulse * 0.07;
        const glowR = n.r + pulse * 2.5;

        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR * 3);
        grad.addColorStop(0, `rgba(${n.color.r}, ${n.color.g}, ${n.color.b}, ${(alpha * 0.6).toFixed(3)})`);
        grad.addColorStop(0.4, `rgba(${n.color.r}, ${n.color.g}, ${n.color.b}, ${(alpha * 0.2).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${n.color.r}, ${n.color.g}, ${n.color.b}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, glowR * 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${n.color.r}, ${n.color.g}, ${n.color.b}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const s of streams) {
        for (let i = 0; i < s.dots.length; i++) {
          const y = s.dots[i];
          if (y < -10 || y > height + 10) continue;
          const fade = i < 3 ? i / 3 : i > s.dots.length - 3 ? (s.dots.length - i) / 3 : 1;
          const alpha = fade * 0.12;
          const r = 1.2 + (1 - fade) * 0.8;
          ctx.fillStyle = `rgba(${s.color.r}, ${s.color.g}, ${s.color.b}, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(s.x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (mouse.active) {
        const mGrad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, MOUSE_RADIUS);
        mGrad.addColorStop(0, "rgba(255, 255, 255, 0.06)");
        mGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.02)");
        mGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = mGrad;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, MOUSE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      if (flash.alpha > 0) {
        const fGrad = ctx.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, 200);
        fGrad.addColorStop(0, `rgba(255, 255, 255, ${(flash.alpha * 0.2).toFixed(3)})`);
        fGrad.addColorStop(1, `rgba(255, 255, 255, 0)`);
        ctx.fillStyle = fGrad;
        ctx.beginPath();
        ctx.arc(flash.x, flash.y, 200, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, DT_CAP);
      lastTime = now;
      time += dt;
      step(dt);
      draw();
      rafId = requestAnimationFrame(loop);
    };

    const onResize = () => resize();

    const setMouse = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = clientX - rect.left;
      mouse.y = clientY - rect.top;
      mouse.active = true;
    };

    const onMouseMove = (e: MouseEvent) => setMouse(e.clientX, e.clientY);
    const onMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      flash.x = e.clientX - rect.left;
      flash.y = e.clientY - rect.top;
      flash.alpha = 1;
    };
    const onMouseLeave = (e: MouseEvent) => {
      if (!e.relatedTarget) {
        mouse.active = false;
        mouse.x = -9999;
        mouse.y = -9999;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) setMouse(t.clientX, t.clientY);
    };
    const onTouchEnd = () => {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
    };

    resize();
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseout", onMouseLeave);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    if (prefersReduced) {
      draw();
    } else {
      rafId = requestAnimationFrame(loop);
    }

    // Пауза, коли вкладка прихована: rAF і так зупиняється браузером,
    // але й обробники не варто крутити у фоні.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      } else if (!prefersReduced && !rafId) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseout", onMouseLeave);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return <canvas ref={canvasRef} className={`${className ?? ""} w-full h-full`} aria-hidden="true" />;
}
