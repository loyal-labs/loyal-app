# Confetti burst (Pro)

## When to use

A celebration burst (success states, upgrades, achievements) where paper flakes fall with
real physics and **collide with the trigger button**: the button is modelled as a true
pill — flat top between the end-cap centers, circular caps at the ends. Flakes rest on the
flat top; on the curved caps the local slope is steep, so they slide off sideways and keep
falling. Once every flake settles, the pile holds, then fades out. Canvas-driven; skipped
entirely under reduced motion.

## HTML usage

```html
<div class="t-confetti-stage" id="confetti-stage">
  <canvas class="t-confetti-canvas" id="confetti-canvas" aria-hidden="true"></canvas>
  <button class="your-button" id="confetti-btn" type="button">Celebrate</button>
</div>
```

## Tunable variables

Read live by the JS on every burst/frame, so they can be tweaked at runtime.

| Variable | Default | Notes |
| --- | --- | --- |
| `--confetti-count` | `120` | flakes per burst |
| `--confetti-gravity` | `1300` | px/s² |
| `--confetti-size` | `8px` | base flake size (each flake randomises around it) |
| `--confetti-sway` | `16` | horizontal flutter amplitude (px/s) |
| `--confetti-bounce` | `0.3` | restitution when hitting the button/floor |
| `--confetti-hold` | `1600ms` | rest time before the pile fades out |
| `--confetti-fade` | `600ms` | fade-out duration |

```css
:root {
  --confetti-count: 120;
  --confetti-gravity: 1300;
  --confetti-size: 8px;
  --confetti-sway: 16;
  --confetti-bounce: 0.3;
  --confetti-hold: 1600ms;
  --confetti-fade: 600ms;
}
```

## CSS

```css
.t-confetti-stage {
  position: relative;
  overflow: hidden;
  /* Size/radius to taste — the canvas fills whatever this is. */
}

/* The trigger sits below the canvas layer so flakes visibly land ON it. */
.t-confetti-stage .your-button,
.t-confetti-stage button {
  position: relative;
  z-index: 1;
}

.t-confetti-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
}
```

## JS

```js
(function initConfetti() {
  const stage = document.getElementById("confetti-stage");
  const canvas = document.getElementById("confetti-canvas");
  const btn = document.getElementById("confetti-btn");
  if (!stage || !canvas || !btn) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ctx = canvas.getContext("2d");

  // Read a numeric CSS variable off :root ("px"/"ms"/"s" suffixes ok).
  function readNum(name, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!raw) return fallback;
    if (raw.endsWith("ms")) return parseFloat(raw);
    if (raw.endsWith("s") && !raw.endsWith("ms")) return parseFloat(raw) * 1000;
    const n = parseFloat(raw);
    return isNaN(n) ? fallback : n;
  }

  const COLORS = [
    "#ff4d67", "#ffb020", "#3b82f6", "#22c55e",
    "#a855f7", "#f97316", "#06b6d4", "#f43f5e",
  ];

  let particles = [];
  let running = false;
  let lastT = 0;
  let burstEnd = 0;
  let fadeStart = null;
  let stageW = 0;
  let stageH = 0;

  function sizeCanvas() {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    stageW = r.width;
    stageH = r.height;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function buttonRect() {
    const s = stage.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    return { left: b.left - s.left, top: b.top - s.top, right: b.right - s.left, bottom: b.bottom - s.top };
  }

  // Top surface of the pill button at horizontal position x, or null when
  // x misses the button. Returns the surface y and the local slope
  // (0 on the flat top, steepening toward the cap edges).
  function buttonSurface(x, b) {
    if (x < b.left || x > b.right) return null;
    const r = (b.bottom - b.top) / 2;
    const lc = b.left + r;
    const rc = b.right - r;
    if (x >= lc && x <= rc) return { y: b.top, slope: 0 };
    const cx = x < lc ? lc : rc;
    const dx = x - cx;
    const root = Math.sqrt(Math.max(r * r - dx * dx, 0));
    return { y: b.top + (r - root), slope: dx / Math.max(root, 0.001) };
  }

  function burst() {
    sizeCanvas();
    const now = performance.now();
    const count = Math.round(readNum("--confetti-count", 120));
    const size = readNum("--confetti-size", 8);
    const spawnWindow = 500;

    particles = [];
    fadeStart = null;
    for (let i = 0; i < count; i++) {
      particles.push({
        start: now + Math.random() * spawnWindow,
        x: Math.random() * stageW,
        y: -12 - Math.random() * 30,
        py: -12,
        vx: (Math.random() - 0.5) * 60,
        vy: 40 + Math.random() * 120,
        w: size * (0.7 + Math.random() * 0.6),
        h: size * (0.5 + Math.random() * 0.5),
        maxFall: 420 + Math.random() * 280,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 7,
        tumble: Math.random() * Math.PI * 2,
        tumbleSpeed: 4 + Math.random() * 8,
        squish: 1,
        phase: Math.random() * Math.PI * 2,
        swayFreq: 2 + Math.random() * 3,
        swayScale: 0.5 + Math.random(),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        bounces: 0,
        resting: false,
        dead: false,
      });
    }
    burstEnd = now + spawnWindow + 100;
    if (!running) {
      running = true;
      lastT = now;
      requestAnimationFrame(frame);
    }
  }

  function step(dt, now) {
    const g = readNum("--confetti-gravity", 1300);
    const sway = readNum("--confetti-sway", 16);
    const restitution = readNum("--confetti-bounce", 0.3);
    const b = buttonRect();

    for (const p of particles) {
      if (p.resting || p.dead || now < p.start) continue;

      p.py = p.y;
      p.vy += g * dt;
      if (p.vy > p.maxFall) p.vy = p.maxFall;
      p.phase += p.swayFreq * dt;
      p.x += (p.vx + Math.cos(p.phase) * sway * p.swayScale) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tumble += p.tumbleSpeed * dt;
      p.squish = 0.25 + 0.75 * Math.abs(Math.cos(p.tumble));

      const half = p.h / 2;

      // Button collision — only while falling and only when the flake
      // crossed the surface this frame (prevY above it).
      if (p.vy > 0) {
        const s = buttonSurface(p.x, b);
        if (s && p.y + half >= s.y && p.py + half <= s.y + 2) {
          if (Math.abs(s.slope) > 0.85) {
            // Steep cap — slide off sideways and keep falling.
            const dir = p.x < (b.left + b.right) / 2 ? -1 : 1;
            p.vx = dir * Math.max(Math.abs(p.vx), 50 + Math.random() * 50);
            p.vy *= 0.35;
            p.y = s.y - half;
          } else if (p.vy > 150 && p.bounces < 2) {
            p.bounces++;
            p.vy = -p.vy * restitution * (0.6 + Math.random() * 0.5);
            p.vx = p.vx * 0.7 + s.slope * 40 + (Math.random() - 0.5) * 40;
            p.y = s.y - half;
          } else {
            p.resting = true;
            p.y = s.y - half - 0.5;
            p.vx = 0;
            p.vy = 0;
          }
        }
      }

      // Floor.
      if (!p.resting && p.y + half >= stageH - 1) {
        if (p.vy > 170 && p.bounces < 2) {
          p.bounces++;
          p.vy = -p.vy * restitution * (0.5 + Math.random() * 0.4);
          p.vx *= 0.7;
          p.y = stageH - 1 - half;
        } else {
          p.resting = true;
          p.y = stageH - 1 - half;
          p.vx = 0;
          p.vy = 0;
        }
      }

      // Left the stage sideways — treat as settled.
      if (p.x < -30 || p.x > stageW + 30 || p.y > stageH + 30) {
        p.dead = true;
      }
    }
  }

  function draw(alpha) {
    ctx.clearRect(0, 0, stageW, stageH);
    ctx.globalAlpha = alpha;
    const now = performance.now();
    for (const p of particles) {
      if (p.dead || now < p.start) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, p.squish);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!running) return;
    // Substep the physics so it tracks wall-clock time even when rAF is
    // throttled: a long frame advances the sim in ≤16ms slices instead of
    // one big unstable step. Capped so a suspended tab doesn't burst.
    let remaining = Math.min((now - lastT) / 1000, 0.25);
    lastT = now;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 60);
      step(dt, now);
      remaining -= dt;
    }

    const settled =
      now > burstEnd &&
      particles.every(function (p) { return p.resting || p.dead; });
    if (settled && fadeStart === null) {
      fadeStart = now + readNum("--confetti-hold", 1600);
    }

    let alpha = 1;
    if (fadeStart !== null && now >= fadeStart) {
      const fade = Math.max(readNum("--confetti-fade", 600), 1);
      alpha = 1 - (now - fadeStart) / fade;
      if (alpha <= 0) {
        running = false;
        particles = [];
        ctx.clearRect(0, 0, stageW, stageH);
        return;
      }
    }

    draw(alpha);
    requestAnimationFrame(frame);
  }

  btn.addEventListener("click", burst);
  window.addEventListener("resize", function () {
    if (running) sizeCanvas();
  });
})();
```
