(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const COLS = 20;
  const ROWS = 12;
  const TILE = 48;
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;

  const PATH = [
    [0, 6], [3, 6], [3, 2], [8, 2], [8, 9], [14, 9], [14, 6], [19, 6],
  ];

  const TOWERS = {
    archer: { name: "弓塔", cost: 60, range: 2.6, dmg: 9, rate: 0.42, color: "#6b8f3a", splash: 0, slow: 0, air: true },
    cannon: { name: "炮塔", cost: 90, range: 2.3, dmg: 22, rate: 1.05, color: "#6a4a2a", splash: 1.15, slow: 0, air: false },
    mage: { name: "法师塔", cost: 110, range: 2.9, dmg: 14, rate: 0.7, color: "#3a5a9a", splash: 0, slow: 0.45, air: true },
  };

  const WAVES = [
    { gold: 40, spawns: [["grunt", 8, 0.7]] },
    { gold: 45, spawns: [["grunt", 10, 0.55], ["wolf", 4, 0.8]] },
    { gold: 50, spawns: [["grunt", 8, 0.5], ["wolf", 8, 0.5]] },
    { gold: 55, spawns: [["brute", 4, 1.1], ["grunt", 10, 0.45]] },
    { gold: 60, spawns: [["wyvern", 6, 0.7], ["wolf", 8, 0.4]] },
    { gold: 70, spawns: [["brute", 6, 0.9], ["wyvern", 6, 0.65], ["grunt", 8, 0.4]] },
    { gold: 80, spawns: [["brute", 8, 0.7], ["wolf", 12, 0.35], ["wyvern", 6, 0.55]] },
    { gold: 120, spawns: [["grunt", 10, 0.35], ["brute", 6, 0.6], ["wyvern", 8, 0.45], ["warlord", 1, 2]] },
  ];

  const ENEMY = {
    grunt: { hp: 42, speed: 42, gold: 7, flying: false, w: 18, h: 22, skin: "#3d7a22" },
    wolf: { hp: 24, speed: 78, gold: 9, flying: false, w: 22, h: 14, skin: "#5a4630" },
    brute: { hp: 140, speed: 30, gold: 16, flying: false, w: 24, h: 28, skin: "#2f5a18" },
    wyvern: { hp: 58, speed: 56, gold: 15, flying: true, w: 28, h: 18, skin: "#4a6a28" },
    warlord: { hp: 900, speed: 24, gold: 80, flying: false, w: 32, h: 36, skin: "#245014" },
  };

  const pathSet = new Set(expandPath(PATH));
  const waypoints = PATH.map(([c, r]) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }));

  let gold, lives, wave, selectedType, selectedTower;
  let towers, enemies, shots, particles;
  let spawning, spawnQueue, spawnTimer;
  let mode; // title playing win lose
  let last = 0;

  function expandPath(pts) {
    const cells = [];
    for (let i = 0; i < pts.length - 1; i++) {
      let [x, y] = pts[i];
      const [tx, ty] = pts[i + 1];
      while (x !== tx || y !== ty) {
        cells.push(x + "," + y);
        if (x < tx) x++;
        else if (x > tx) x--;
        else if (y < ty) y++;
        else y--;
      }
    }
    const last = pts[pts.length - 1];
    cells.push(last[0] + "," + last[1]);
    return cells;
  }

  function reset() {
    gold = 140;
    lives = 20;
    wave = 0;
    selectedType = "archer";
    selectedTower = null;
    towers = [];
    enemies = [];
    shots = [];
    particles = [];
    spawning = false;
    spawnQueue = [];
    spawnTimer = 0;
    mode = "playing";
    syncHud();
    markButtons();
  }

  function syncHud() {
    document.getElementById("gold").textContent = Math.floor(gold);
    document.getElementById("lives").textContent = Math.max(0, lives);
    document.getElementById("wave").textContent = String(wave);
  }

  function markButtons() {
    document.querySelectorAll(".tower-btn").forEach((b) => {
      b.classList.toggle("on", b.dataset.type === selectedType);
    });
    document.getElementById("btn-wave").disabled = spawning || enemies.length > 0 || wave >= WAVES.length || mode !== "playing";
  }

  function cellKey(c, r) { return c + "," + r; }
  function occupied(c, r) {
    return towers.some((t) => t.c === c && t.r === r);
  }

  function startWave() {
    if (spawning || enemies.length || wave >= WAVES.length) return;
    const spec = WAVES[wave];
    spawnQueue = [];
    spec.spawns.forEach(([kind, n, gap]) => {
      for (let i = 0; i < n; i++) spawnQueue.push({ kind, wait: i === 0 ? 0.15 : gap });
    });
    spawning = true;
    spawnTimer = 0;
    wave += 1;
    syncHud();
    markButtons();
    beep(220, 0.08);
  }

  function spawn(kind) {
    const def = ENEMY[kind];
    const p0 = waypoints[0];
    enemies.push({
      kind,
      hp: def.hp,
      max: def.hp,
      speed: def.speed,
      gold: def.gold,
      flying: def.flying,
      x: p0.x - TILE,
      y: p0.y,
      wp: 0,
      slow: 1,
      slowT: 0,
    });
  }

  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function update(dt) {
    if (mode !== "playing") return;
    if (spawning) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        if (!spawnQueue.length) spawning = false;
        else {
          const next = spawnQueue.shift();
          spawn(next.kind);
          spawnTimer = next.wait;
        }
      }
    }

    for (const e of enemies) {
      if (e.slowT > 0) e.slowT -= dt;
      else e.slow = 1;
      const target = waypoints[e.wp];
      if (!target) continue;
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const step = e.speed * e.slow * dt;
      if (d <= step) {
        e.x = target.x;
        e.y = target.y;
        e.wp += 1;
        if (e.wp >= waypoints.length) {
          lives -= e.kind === "warlord" ? 8 : e.kind === "brute" ? 3 : 1;
          e.hp = 0;
          e.leaked = true;
          beep(90, 0.12);
        }
      } else {
        e.x += (dx / d) * step;
        e.y += (dy / d) * step;
      }
    }

    enemies = enemies.filter((e) => e.hp > 0);
    if (lives <= 0) {
      lives = 0;
      mode = "lose";
      showOverlay("要塞陷落", "兽人冲进了大门。再守一次？", "再战");
    }

    for (const t of towers) {
      t.cd = Math.max(0, t.cd - dt);
      if (t.cd > 0) continue;
      const range = t.range * TILE;
      let best = null, bestD = range;
      for (const e of enemies) {
        if (!t.air && e.flying) continue;
        const d = dist(t, e);
        if (d <= bestD) { best = e; bestD = d; }
      }
      if (!best) continue;
      t.cd = t.rate;
      shots.push({
        x: t.x, y: t.y, tx: best.x, ty: best.y, target: best,
        dmg: t.dmg, splash: t.splash * TILE, slow: t.slow, color: t.color, flyingOk: t.air,
      });
    }

    for (const s of shots) {
      if (s.target && s.target.hp > 0) {
        s.tx = s.target.x;
        s.ty = s.target.y;
      }
      const dx = s.tx - s.x, dy = s.ty - s.y;
      const d = Math.hypot(dx, dy) || 1;
      const spd = 420 * dt;
      if (d <= spd) {
        s.dead = true;
        hit(s);
      } else {
        s.x += (dx / d) * spd;
        s.y += (dy / d) * spd;
      }
    }
    shots = shots.filter((s) => !s.dead);

    for (const p of particles) {
      p.t -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    particles = particles.filter((p) => p.t > 0);

    if (wave >= WAVES.length && !spawning && enemies.length === 0 && lives > 0) {
      mode = "win";
      showOverlay("守住了", "灰烬要塞的旗帜还在。兽人退回了荒原。", "再来一局");
    }
    syncHud();
    markButtons();
  }

  function hit(s) {
    const apply = (e) => {
      if (e.hp <= 0) return;
      if (!s.flyingOk && e.flying) return;
      e.hp -= s.dmg;
      if (s.slow) { e.slow = s.slow; e.slowT = 1.4; }
      burst(e.x, e.y, s.color);
      if (e.hp <= 0) {
        gold += e.gold;
        beep(520, 0.04);
      }
    };
    if (s.splash > 0) {
      for (const e of enemies) {
        if (Math.hypot(e.x - s.tx, e.y - s.ty) <= s.splash) apply(e);
      }
    } else if (s.target) apply(s.target);
  }

  function burst(x, y, color) {
    for (let i = 0; i < 6; i++) {
      particles.push({
        x, y, t: 0.25 + Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 80,
        vy: (Math.random() - 0.5) * 80,
        color,
      });
    }
  }

  function draw() {
    drawField();
    for (const t of towers) drawTower(t);
    for (const e of enemies) drawEnemy(e);
    for (const s of shots) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.t * 3);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 3, 3);
      ctx.globalAlpha = 1;
    }
    if (selectedTower) {
      ctx.strokeStyle = "rgba(255,230,120,0.45)";
      ctx.beginPath();
      ctx.arc(selectedTower.x, selectedTower.y, selectedTower.range * TILE, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawField() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * TILE, y = r * TILE;
        const onPath = pathSet.has(cellKey(c, r));
        if (onPath) {
          ctx.fillStyle = (c + r) % 2 ? "#b08a4a" : "#c49a55";
        } else {
          ctx.fillStyle = (c + r) % 2 ? "#3f7a32" : "#4a8a3a";
        }
        ctx.fillRect(x, y, TILE, TILE);
        if (!onPath) {
          ctx.fillStyle = "rgba(20,60,10,0.15)";
          ctx.fillRect(x + 8, y + 18, 6, 8);
        }
      }
    }
    // keep on the right
    const kx = 18 * TILE, ky = 4 * TILE;
    ctx.fillStyle = "#6d6a66";
    ctx.fillRect(kx, ky, TILE * 2, TILE * 4);
    ctx.fillStyle = "#8b8680";
    ctx.fillRect(kx + 8, ky + 20, 28, 40);
    ctx.fillRect(kx + 52, ky + 20, 28, 40);
    ctx.fillStyle = "#2a4a8a";
    ctx.fillRect(kx + 20, ky - 18, 10, 28);
    ctx.fillRect(kx + 66, ky - 18, 10, 28);
    ctx.fillStyle = "#c9a44a";
    ctx.fillRect(kx + 18, ky - 22, 14, 8);
    ctx.fillRect(kx + 64, ky - 22, 14, 8);
    ctx.fillStyle = "#ffe9a8";
    ctx.font = "10px sans-serif";
    ctx.fillText("要塞", kx + 30, ky + TILE * 4 - 8);
  }

  function drawTower(t) {
    const x = t.x, y = t.y;
    ctx.fillStyle = "#3a3228";
    ctx.fillRect(x - 14, y - 10, 28, 22);
    ctx.fillStyle = t.color;
    ctx.fillRect(x - 10, y - 22, 20, 16);
    ctx.fillStyle = "#d8c48a";
    ctx.fillRect(x - 3, y - 28, 6, 10);
    if (t === selectedTower) {
      ctx.strokeStyle = "#ffe9a8";
      ctx.strokeRect(x - 16, y - 30, 32, 44);
    }
    if (t.lvl > 1) {
      ctx.fillStyle = "#ffd36a";
      ctx.fillText("+" + (t.lvl - 1), x - 6, y + 18);
    }
  }

  function drawEnemy(e) {
    const def = ENEMY[e.kind];
    const w = def.w, h = def.h;
    ctx.fillStyle = def.skin;
    ctx.fillRect(e.x - w / 2, e.y - h / 2 - (e.flying ? 10 : 0), w, h);
    ctx.fillStyle = "#1a1208";
    ctx.fillRect(e.x - 4, e.y - h / 2 + 4 - (e.flying ? 10 : 0), 3, 3);
    ctx.fillRect(e.x + 2, e.y - h / 2 + 4 - (e.flying ? 10 : 0), 3, 3);
    if (e.kind === "warlord") {
      ctx.fillStyle = "#8a2010";
      ctx.fillRect(e.x - 8, e.y - h / 2 - 8, 16, 6);
    }
    const ratio = Math.max(0, e.hp / e.max);
    ctx.fillStyle = "#2a1a10";
    ctx.fillRect(e.x - 12, e.y - h / 2 - 8 - (e.flying ? 10 : 0), 24, 4);
    ctx.fillStyle = ratio > 0.4 ? "#6fba3a" : "#c43a2a";
    ctx.fillRect(e.x - 12, e.y - h / 2 - 8 - (e.flying ? 10 : 0), 24 * ratio, 4);
  }

  function loop(t) {
    const dt = Math.min(0.04, (t - last) / 1000 || 0.016);
    last = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function canvasPos(ev) {
    const rect = canvas.getBoundingClientRect();
    const src = ev.touches ? ev.touches[0] : ev;
    return {
      x: ((src.clientX - rect.left) / rect.width) * canvas.width,
      y: ((src.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function onTap(ev) {
    if (mode !== "playing") return;
    const p = canvasPos(ev);
    const c = Math.floor(p.x / TILE);
    const r = Math.floor(p.y / TILE);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
    const hitT = towers.find((t) => t.c === c && t.r === r);
    if (hitT) {
      selectedTower = hitT;
      selectedType = null;
      markButtons();
      return;
    }
    if (!selectedType) return;
    if (pathSet.has(cellKey(c, r)) || occupied(c, r)) return;
    const def = TOWERS[selectedType];
    if (gold < def.cost) return;
    gold -= def.cost;
    const t = {
      type: selectedType,
      ...def,
      c, r,
      x: c * TILE + TILE / 2,
      y: r * TILE + TILE / 2,
      cd: 0,
      lvl: 1,
      spent: def.cost,
    };
    towers.push(t);
    selectedTower = t;
    beep(330, 0.06);
    syncHud();
  }

  canvas.addEventListener("pointerdown", onTap);

  document.querySelectorAll(".tower-btn").forEach((b) => {
    b.addEventListener("click", () => {
      selectedType = b.dataset.type;
      selectedTower = null;
      markButtons();
    });
  });
  document.getElementById("btn-wave").addEventListener("click", startWave);
  document.getElementById("btn-upgrade").addEventListener("click", () => {
    if (!selectedTower || mode !== "playing") return;
    const cost = Math.floor(selectedTower.cost * 0.8 * selectedTower.lvl);
    if (gold < cost) return;
    gold -= cost;
    selectedTower.lvl += 1;
    selectedTower.dmg = Math.round(selectedTower.dmg * 1.45);
    selectedTower.range *= 1.08;
    selectedTower.spent += cost;
    beep(400, 0.07);
    syncHud();
  });
  document.getElementById("btn-sell").addEventListener("click", () => {
    if (!selectedTower || mode !== "playing") return;
    gold += Math.floor(selectedTower.spent * 0.6);
    towers = towers.filter((t) => t !== selectedTower);
    selectedTower = null;
    syncHud();
  });

  const overlay = document.getElementById("overlay");
  document.getElementById("btn-start").addEventListener("click", () => {
    overlay.classList.remove("show");
    reset();
  });

  function showOverlay(title, body, btn) {
    overlay.classList.add("show");
    overlay.querySelector("h1").textContent = title;
    overlay.querySelector(".sub").textContent = "";
    overlay.querySelector("p:not(.sub)").textContent = body;
    document.getElementById("btn-start").textContent = btn;
  }

  let actx;
  function beep(freq, dur) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.frequency.value = freq;
      o.type = "square";
      g.gain.value = 0.04;
      o.connect(g); g.connect(actx.destination);
      o.start();
      o.stop(actx.currentTime + dur);
    } catch (_) {}
  }

  draw();
  requestAnimationFrame(loop);
})();
