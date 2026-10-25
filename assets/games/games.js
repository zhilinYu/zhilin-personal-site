(() => {
  "use strict";
  const app = document.querySelector(".play-app");
  if (!app) return;
  const kind = app.dataset.game;
  const board = app.querySelector("[data-board]");
  const scoreNode = app.querySelector("[data-score]");
  const status = app.querySelector("[data-status]");
  const setStatus = (message) => { if (status) status.textContent = message; };

  app.querySelector("[data-fullscreen]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else { setStatus("此浏览器不支持全屏模式。"); return; }
    } catch (_) { setStatus("无法开启全屏，请检查浏览器权限。"); }
    button.querySelector("span").textContent = document.fullscreenElement ? "退出全屏" : "全屏";
  });
  document.addEventListener("fullscreenchange", () => {
    const label = app.querySelector("[data-fullscreen] span");
    if (label) label.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
  });
  app.querySelector("[data-howto]").addEventListener("click", () => {
    const panel = app.querySelector("[data-howto-panel]");
    panel.hidden = !panel.hidden;
  });

  const DIRS = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
  if (kind === "2048") init2048();
  if (kind === "tetris") initTetris();

  function init2048() {
    let grid, score, over, startX = 0, startY = 0;
    const render = () => {
      board.innerHTML = grid.flat().map((value) => `<div class="tile"${value ? ` data-value="${value}"` : ""}>${value || ""}</div>`).join("");
      scoreNode.textContent = String(score);
    };
    const spawn = () => {
      const free = [];
      grid.forEach((row, y) => row.forEach((v, x) => { if (!v) free.push([x, y]); }));
      if (!free.length) return;
      const [x, y] = free[Math.floor(Math.random() * free.length)];
      grid[y][x] = Math.random() < .9 ? 2 : 4;
    };
    const reset = () => {
      grid = Array.from({ length: 4 }, () => Array(4).fill(0)); score = 0; over = false;
      spawn(); spawn(); render(); setStatus("方向键、WASD 或滑动棋盘来移动。");
    };
    const canMove = () => {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        if (!grid[y][x]) return true;
        if (x < 3 && grid[y][x] === grid[y][x + 1]) return true;
        if (y < 3 && grid[y][x] === grid[y + 1][x]) return true;
      }
      return false;
    };
    const move = (direction) => {
      if (over) return;
      const before = JSON.stringify(grid);
      let gained = 0;
      for (let line = 0; line < 4; line++) {
        let values = [];
        for (let step = 0; step < 4; step++) {
          const x = direction === "left" ? step : direction === "right" ? 3 - step : line;
          const y = direction === "up" ? step : direction === "down" ? 3 - step : line;
          values.push(grid[y][x]);
        }
        values = values.filter(Boolean);
        for (let i = 0; i < values.length - 1; i++) if (values[i] === values[i + 1]) {
          values[i] *= 2; gained += values[i]; values.splice(i + 1, 1);
        }
        while (values.length < 4) values.push(0);
        for (let step = 0; step < 4; step++) {
          const x = direction === "left" ? step : direction === "right" ? 3 - step : line;
          const y = direction === "up" ? step : direction === "down" ? 3 - step : line;
          grid[y][x] = values[step];
        }
      }
      if (before === JSON.stringify(grid)) return;
      score += gained; spawn(); render();
      if (!canMove()) { over = true; setStatus("棋盘已满。重新开始，再来一局吧。"); }
      else setStatus("继续合并相同数字。");
    };
    app.querySelector("[data-restart]").addEventListener("click", reset);
    app.querySelectorAll("[data-move]").forEach((button) => button.addEventListener("click", () => move(button.dataset.move)));
    document.addEventListener("keydown", (event) => {
      const direction = DIRS[event.key];
      if (!direction || event.target.matches("select,input,textarea")) return;
      if (event.key.startsWith("Arrow")) event.preventDefault();
      move(direction);
    });
    board.addEventListener("touchstart", (event) => { const t = event.changedTouches[0]; startX = t.clientX; startY = t.clientY; }, { passive: true });
    board.addEventListener("touchend", (event) => {
      const t = event.changedTouches[0], dx = t.clientX - startX, dy = t.clientY - startY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
      move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    }, { passive: true });
    reset();
  }

  function initTetris() {
    const W = 10, H = 20;
    const shapes = [
      { color: 1, cells: [[0,1],[1,1],[2,1],[3,1]] },
      { color: 2, cells: [[0,0],[1,0],[0,1],[1,1]] },
      { color: 3, cells: [[1,0],[0,1],[1,1],[2,1]] },
      { color: 4, cells: [[1,0],[2,0],[0,1],[1,1]] },
      { color: 1, cells: [[0,0],[1,0],[1,1],[2,1]] },
      { color: 2, cells: [[0,0],[0,1],[1,1],[2,1]] },
      { color: 3, cells: [[2,0],[0,1],[1,1],[2,1]] }
    ];
    let matrix, piece, next, timer = null, score = 0, lines = 0, paused = false, ended = false;
    const pauseButton = app.querySelector("[data-pause]");
    const updatePauseButton = () => {
      pauseButton.textContent = ended ? "已结束" : paused ? "继续" : "暂停";
      pauseButton.setAttribute("aria-pressed", String(paused));
      pauseButton.disabled = ended;
    };
    const stopGravity = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const startGravity = () => {
      stopGravity();
      if (!paused && !ended && !document.hidden) timer = setInterval(() => move("down"), 720);
    };
    const freshPiece = () => {
      const template = next || shapes[Math.floor(Math.random() * shapes.length)];
      next = shapes[Math.floor(Math.random() * shapes.length)];
      piece = { color: template.color, cells: template.cells.map(([x,y])=>[x,y]), x: 3, y: 0 };
      if (collides(piece, 0, 0, piece.cells)) {
        ended = true; paused = false; stopGravity();
        setStatus("游戏结束。重新开始会清空棋盘，再来一局。");
        updatePauseButton();
      }
      renderNext();
    };
    const collides = (p, dx, dy, cells) => cells.some(([x,y]) => {
      const nx = p.x + x + dx, ny = p.y + y + dy;
      return nx < 0 || nx >= W || ny >= H || (ny >= 0 && matrix[ny][nx]);
    });
    const render = () => {
      const visible = matrix.map((row) => row.slice());
      if (piece) piece.cells.forEach(([x,y]) => { const px = piece.x+x, py = piece.y+y; if (py >= 0 && py < H && px >= 0 && px < W) visible[py][px] = piece.color; });
      board.innerHTML = visible.flat().map((v) => `<i class="tetris-cell${v ? " filled" : ""}"${v ? ` data-color="${v}"` : ""}></i>`).join("");
      scoreNode.textContent = String(score);
      app.querySelector("[data-lines]").textContent = String(lines);
    };
    const renderNext = () => {
      const preview = app.querySelector("[data-next]");
      const minX = Math.min(...next.cells.map(([x])=>x)), maxX = Math.max(...next.cells.map(([x])=>x));
      const minY = Math.min(...next.cells.map(([,y])=>y)), maxY = Math.max(...next.cells.map(([,y])=>y));
      const offsetX = Math.floor((4-(maxX-minX+1))/2)-minX;
      const offsetY = Math.floor((4-(maxY-minY+1))/2)-minY;
      const set = new Set(next.cells.map(([x,y]) => `${x+offsetX},${y+offsetY}`));
      preview.innerHTML = Array.from({length:16}, (_, i) => {
        const x = i % 4, y = Math.floor(i / 4), filled = set.has(`${x},${y}`);
        return `<i${filled ? ` class="filled" style="background:var(--piece-${next.color})"` : ""}></i>`;
      }).join("");
    };
    const lock = () => {
      piece.cells.forEach(([x,y]) => { const px = piece.x+x, py = piece.y+y; if (py >= 0) matrix[py][px] = piece.color; });
      let cleared = 0;
      for (let y = H - 1; y >= 0; y--) if (matrix[y].every(Boolean)) { matrix.splice(y, 1); matrix.unshift(Array(W).fill(0)); cleared++; y++; }
      if (cleared) { lines += cleared; score += [0,100,300,500,800][cleared] || cleared*200; setStatus(`${cleared} 行清除，继续！`); }
      freshPiece(); render();
    };
    const move = (action) => {
      if (paused || ended) return;
      if (action === "left" && !collides(piece,-1,0,piece.cells)) piece.x--;
      if (action === "right" && !collides(piece,1,0,piece.cells)) piece.x++;
      if (action === "down") { if (!collides(piece,0,1,piece.cells)) { piece.y++; score++; } else lock(); }
      if (action === "rotate") {
        const rotated = piece.cells.map(([x,y])=>[2-y,x]);
        if (!collides(piece,0,0,rotated)) piece.cells = rotated;
      }
      if (action === "drop") { while (!collides(piece,0,1,piece.cells)) { piece.y++; score += 2; } lock(); }
      render();
    };
    const reset = () => {
      stopGravity(); matrix = Array.from({length:H},()=>Array(W).fill(0)); score = 0; lines = 0; paused = false; ended = false; next = shapes[Math.floor(Math.random()*shapes.length)];
      freshPiece(); render(); updatePauseButton();
      if (!ended) setStatus(document.hidden ? "页面在后台。回到页面后开始下落。" : "← → 移动 · ↑ 旋转 · ↓ 加速");
      startGravity();
    };
    app.querySelector("[data-restart]").addEventListener("click", reset);
    pauseButton.addEventListener("click", () => {
      if (ended) return;
      paused = !paused;
      if (paused) {
        stopGravity();
        setStatus("游戏已暂停。点击继续恢复。");
      } else {
        setStatus("游戏继续。← → 移动 · ↑ 旋转 · ↓ 加速");
        startGravity();
      }
      updatePauseButton();
    });
    app.querySelectorAll("[data-move]").forEach((button) => {
      const action = button.dataset.move;
      button.addEventListener("click", () => move(action));
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (paused || ended) return;
        paused = true;
        stopGravity();
        setStatus("页面切到后台，游戏已暂停。回到页面后点击继续。");
        updatePauseButton();
      } else if (!paused && !ended) startGravity();
    });
    document.addEventListener("keydown", (event) => {
      const keys = { ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down", ArrowUp: "rotate", " ": "drop" };
      const action = keys[event.key];
      if (!action || event.target.matches("select,input,textarea")) return;
      const buttonFocused = event.target.matches("button");
      if (event.key.startsWith("Arrow") || (event.key === " " && !buttonFocused)) event.preventDefault();
      if (buttonFocused && event.key === " ") return;
      if (event.repeat && action === "drop") return;
      move(action);
    });
    reset();
  }
})();
