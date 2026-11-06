/* Torus PWA front end: terminal rendering, touch input, menus, storage. */
'use strict';

(function () {
  const E = window.TorusEngine;
  const { LINES, COLS } = E;

  /* ---------------- settings ---------------- */
  const SETTINGS_KEY = 'torus.settings.v1';
  const DEFAULTS = {
    name: 'ANON', topology: 'toral', wimpy: false, all_moves: false, moveable_heaps: true,
    show_highscore: true, theme: 'sun', speed: 'normal', sound: true, vibrate: true,
    boardTouch: true,
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const settings = Object.assign({}, DEFAULTS, store.get(SETTINGS_KEY, {}));
  const saveSettings = () => store.set(SETTINGS_KEY, settings);
  const TOPO = {
    toral:   { hsew: true,  vsew: true,  label: 'Torus (wraps both ways)' },
    hannulus:{ hsew: true,  vsew: false, label: 'Annulus (wraps left/right)' },
    vannulus:{ hsew: false, vsew: true,  label: 'Annulus (wraps top/bottom)' },
    planar:  { hsew: false, vsew: false, label: 'Plane (no wrapping)' },
  };
  const SPEEDS = { slow: 140, normal: 70, fast: 30 };

  /* ---------------- terminal rendering ---------------- */
  const canvas = document.getElementById('term');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('term-wrap');
  let cellW = 10, cellH = 20, fontPx = 16, dpr = 1;
  let colors = { bg: '#fff', fg: '#000', glow: false };
  let blinkOn = true, dirty = true, lastCursorKey = '';

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    const cs = getComputedStyle(document.documentElement);
    colors = { bg: cs.getPropertyValue('--bg').trim(), fg: cs.getPropertyValue('--fg').trim(),
               glow: settings.theme === 'green' || settings.theme === 'amber' };
    document.querySelector('meta[name=theme-color]').content = colors.bg;
    dirty = true;
  }

  function fontSpec(px) {
    return `${px}px ${getComputedStyle(document.body).fontFamily}`;
  }

  function resize() {
    const r = wrap.getBoundingClientRect();
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const W = r.width - 12;
    const H = portrait ? window.innerHeight * 0.62 : r.height - 12;
    const ASPECT = 1.9;                       /* cell height / width */
    cellW = Math.max(3, Math.min(W / COLS, H / (LINES * ASPECT)));
    cellH = cellW * ASPECT;
    dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${cellW * COLS}px`;
    canvas.style.height = `${cellH * LINES}px`;
    canvas.width = Math.round(cellW * COLS * dpr);
    canvas.height = Math.round(cellH * LINES * dpr);
    ctx.font = fontSpec(100);
    const w100 = ctx.measureText('M').width || 60;
    fontPx = Math.min(cellH * 0.86, (100 * cellW * 0.98) / w100);
    dirty = true;
  }

  function draw() {
    const scr = E.screen();
    const cur = E.cursor();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, cellW * COLS, cellH * LINES);
    ctx.font = fontSpec(fontPx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.fg;
    if (colors.glow) { ctx.shadowColor = colors.fg; ctx.shadowBlur = fontPx * 0.35; }
    for (let y = 0; y < LINES; y++) {
      const row = scr[y];
      for (let x = 0; x < COLS; x++) {
        const c = row[x];
        if (c !== ' ') ctx.fillText(c, (x + 0.5) * cellW, (y + 0.54) * cellH);
      }
    }
    ctx.shadowBlur = 0;
    if (cur.visible && blinkOn) {             /* block cursor, reverse video */
      ctx.fillStyle = colors.fg;
      ctx.fillRect(cur.x * cellW, cur.y * cellH, cellW, cellH);
      const c = scr[cur.y][cur.x];
      if (c !== ' ') {
        ctx.fillStyle = colors.bg;
        ctx.fillText(c, (cur.x + 0.5) * cellW, (cur.y + 0.54) * cellH);
      }
    }
  }

  function frame() {
    const cur = E.cursor();
    const key = `${cur.x},${cur.y},${cur.visible}`;
    if (key !== lastCursorKey) { lastCursorKey = key; blinkOn = true; resetBlink(); dirty = true; }
    if (dirty) { dirty = false; draw(); }
    requestAnimationFrame(frame);
  }
  let blinkTimer = null;
  function resetBlink() {
    clearInterval(blinkTimer);
    blinkTimer = setInterval(() => { blinkOn = !blinkOn; dirty = true; }, 530);
  }

  /* ---------------- sound / haptics ---------------- */
  let actx = null;
  function beep() {
    if (settings.vibrate && navigator.vibrate) navigator.vibrate(40);
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.06, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.12);
      o.connect(g).connect(actx.destination);
      o.start(); o.stop(actx.currentTime + 0.13);
    } catch (e) {}
  }

  /* ---------------- hints on the keypad ---------------- */
  function showHint(ans) {
    document.querySelectorAll('#controls .good').forEach((b) => b.classList.remove('good'));
    if (!ans) return;
    for (const ch of ans) {
      const b = document.querySelector(`#controls button[data-k="${ch}"]`);
      if (b) b.classList.add('good');
    }
  }

  /* ---------------- input ---------------- */
  const modal = document.getElementById('modal');
  const modalOpen = () => !modal.hidden;
  const ctrlOf = (ch) => String.fromCharCode(ch.charCodeAt(0) & 0o37);

  function send(k) {
    if (modalOpen()) return;
    if (actx && actx.state === 'suspended') actx.resume();
    if (k === '^W') k = ctrlOf('w');
    E.pushKey(k);
  }
  const RUN = { y: 1, k: 1, u: 1, h: 1, l: 1, b: 1, j: 1, n: 1 };

  /* keypad: tap = step, long press = run (^dir), long press on centre = ^W */
  document.querySelectorAll('#controls button[data-k]').forEach((btn) => {
    const k = btn.dataset.k;
    let timer = null, fired = false, armed = null;
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('pressed');
      fired = false;
      if (btn.classList.contains('dir')) {
        timer = setTimeout(() => {
          fired = true;
          if (settings.vibrate && navigator.vibrate) navigator.vibrate(15);
          send(k === '.' ? '^W' : ctrlOf(k));
        }, 420);
      }
    });
    const end = (e, cancel) => {
      btn.classList.remove('pressed');
      clearTimeout(timer);
      if (cancel || fired) return;
      if (btn.dataset.confirm) {          /* last stand needs a second tap */
        if (!armed) {
          const label = btn.innerHTML;
          btn.classList.add('confirm');
          btn.innerHTML = '<b>s</b> sure?';
          armed = setTimeout(() => { btn.classList.remove('confirm'); btn.innerHTML = label; armed = null; }, 2500);
          btn._label = label;
          return;
        }
        clearTimeout(armed); armed = null;
        btn.classList.remove('confirm'); btn.innerHTML = btn._label;
      }
      send(k);
    };
    btn.addEventListener('pointerup', (e) => end(e, false));
    btn.addEventListener('pointercancel', (e) => end(e, true));
  });

  /* board: tap = step towards the tap, tap on yourself = wait, swipe = run */
  let down = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    down = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const d = down; down = null;
    if (E.mode() !== 'command') { send(' '); return; }
    if (!settings.boardTouch) return;
    const rect = canvas.getBoundingClientRect();
    const cw = rect.width / COLS, ch = rect.height / LINES;
    const sx = e.clientX - d.x, sy = e.clientY - d.y;
    const swipe = Math.hypot(sx, sy) > Math.max(36, cw * 4);
    let dx, dy;
    if (swipe) { dx = sx; dy = sy; }
    else {
      const p = E.player();
      dx = d.x - (rect.left + (p.x + 0.5) * cw);
      dy = d.y - (rect.top + (p.y + 0.5) * ch);
      if (Math.abs(dx) <= cw * 0.9 && Math.abs(dy) <= ch * 0.65) { send('.'); return; }
    }
    const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    const dir = { 0: 'l', 1: 'n', 2: 'j', 3: 'b', 4: 'h', '-4': 'h', '-3': 'y', '-2': 'k', '-1': 'u' }[sector];
    send(swipe ? ctrlOf(dir) : dir);
  });
  canvas.addEventListener('pointercancel', () => { down = null; });

  /* physical keyboard, just like the original */
  window.addEventListener('keydown', (e) => {
    if (modalOpen()) { if (e.key === 'Escape') closeModal(); return; }
    if (e.key === 'Escape') { openMenu(); e.preventDefault(); return; }
    if (e.ctrlKey && /^[a-z]$/i.test(e.key)) { send(ctrlOf(e.key.toLowerCase())); e.preventDefault(); return; }
    if (e.altKey || e.metaKey) return;
    if (e.key === 'Enter') { send('\r'); e.preventDefault(); return; }
    const arrows = { ArrowLeft: 'h', ArrowRight: 'l', ArrowUp: 'k', ArrowDown: 'j',
                     Home: 'y', PageUp: 'u', End: 'b', PageDown: 'n', Clear: '.' };
    if (arrows[e.key]) { send(arrows[e.key]); e.preventDefault(); return; }
    if (e.key.length === 1) { send(e.key); e.preventDefault(); }
  });

  /* ---------------- modal panels ---------------- */
  const body = document.getElementById('panel-body');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function openModal(html) { body.innerHTML = html; modal.hidden = false; body.scrollTop = 0; }
  function closeModal() { modal.hidden = true; }
  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeModal(); });
  document.getElementById('menu-btn').addEventListener('click', () => openMenu());

  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

  function openMenu() {
    openModal(`
      <h2>TORUS</h2>
      <div class="menu">
        <button data-a="resume">Resume game</button>
        <button data-a="new">New game (counts as "ducked out")</button>
        <button data-a="scores">High scores</button>
        <button data-a="settings">Options</button>
        <button data-a="help">How to play</button>
        ${installEvt ? '<button data-a="install">Install as app</button>' : ''}
      </div>`);
    body.querySelectorAll('button[data-a]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'resume') closeModal();
      else if (a === 'new') confirmNew();
      else if (a === 'scores') openScores(TOPO[settings.topology].hsew && TOPO[settings.topology].vsew, false);
      else if (a === 'settings') openSettings();
      else if (a === 'help') openHelp();
      else if (a === 'install') { installEvt.prompt(); installEvt = null; closeModal(); }
    }));
  }

  function confirmNew() {
    openModal(`<h2>NEW GAME</h2>
      <p>Abandon the current game? Your score is recorded as "ducked out", as if you had hit ^C.</p>
      <div class="row"><button data-a="yes">Yes, quit</button><button data-a="no">Cancel</button></div>`);
    body.querySelector('[data-a=yes]').onclick = () => { closeModal(); E.requestQuit(); };
    body.querySelector('[data-a=no]').onclick = () => openMenu();
  }

  function openScores(isToral, temp) {
    const lines = E.scoreTable(isToral, temp);
    const empty = lines.length <= 3 ? '\n   (no scores yet)' : '';
    openModal(`<h2>HIGH SCORES</h2>
      <div class="tabs">
        <button data-t="1" data-w="0" class="${isToral && !temp ? 'on' : ''}">Toral, all time</button>
        <button data-t="1" data-w="1" class="${isToral && temp ? 'on' : ''}">Toral, this week</button>
        <button data-t="0" data-w="0" class="${!isToral && !temp ? 'on' : ''}">Non-toral, all time</button>
        <button data-t="0" data-w="1" class="${!isToral && temp ? 'on' : ''}">Non-toral, this week</button>
      </div>
      <pre>${esc(lines.join('\n') + empty)}</pre>
      <div class="row"><button data-a="back">Back</button></div>`);
    body.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => openScores(b.dataset.t === '1', b.dataset.w === '1'));
    body.querySelector('[data-a=back]').onclick = () => openMenu();
  }

  function openSettings() {
    const opt = (obj, cur) => Object.entries(obj).map(([k, v]) =>
      `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.label)}</option>`).join('');
    const chk = (k, label) => `<label><input type="checkbox" data-s="${k}" ${settings[k] ? 'checked' : ''}> ${label}</label>`;
    openModal(`<h2>OPTIONS</h2>
      <fieldset><legend>Game rules — take effect in the next game</legend>
        <label class="col">Your name (for the score table)
          <input type="text" data-s="name" maxlength="16" value="${esc(settings.name)}"></label>
        <label class="col">Board
          <select data-s="topology">${opt(TOPO, settings.topology)}</select></label>
        ${chk('moveable_heaps', 'Scrap heaps can be pushed (moveheaps)')}
        ${chk('wimpy', 'Wimpy mode: allow hints ("?") — marked "wimpy" in scores')}
        ${chk('show_highscore', 'Always show the score tables after a game')}
      </fieldset>
      <fieldset><legend>Interface</legend>
        ${chk('all_moves', 'Show safe moves every turn (wimpy mode only, "M")')}
        <label class="col">Terminal
          <select data-s="theme">${opt({ sun: 'Sun workstation (black on white)', classic: 'White on black',
            green: 'Green phosphor', amber: 'Amber phosphor' }, settings.theme)}</select></label>
        <label class="col">Speed of runs and last stands
          <select data-s="speed">${opt({ slow: 'Slow', normal: 'Normal', fast: 'Fast' }, settings.speed)}</select></label>
        ${chk('boardTouch', 'Tap / swipe on the board to move')}
        ${chk('sound', 'Beep on illegal moves')}
        ${chk('vibrate', 'Vibrate')}
      </fieldset>
      <div class="row"><button data-a="back">Done</button></div>`);
    body.querySelectorAll('[data-s]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.s;
      settings[k] = el.type === 'checkbox' ? el.checked : el.value.trim() || DEFAULTS[k];
      saveSettings();
      if (k === 'theme') applyTheme();
      if (k === 'all_moves') E.setAllMoves(settings.all_moves);
    }));
    body.querySelector('[data-a=back]').onclick = () => openMenu();
  }

  function openHelp() {
    openModal(`<h2>HOW TO PLAY</h2>
      <p>You are the <b>I</b>. Robots (<b>+</b>) move one square towards you every turn;
      fast robots (<b>#</b>) move two. When robots collide they become a scrap heap (<b>@</b>),
      and any robot that walks into a heap is destroyed. Destroy every robot to clear the level.
      If a robot reaches you: <b>*</b> MUNCH!</p>
      <p>The board is a <b>torus</b>: walk off one edge and you come back on the opposite side —
      and the robots take the short way round too. Walk into a heap to push it (if the square
      behind it is free).</p>
      <ul>
        <li><b>Tap the board</b> to step one square towards the tap. Tap on yourself to wait a turn.</li>
        <li><b>Swipe the board</b> or <b>hold a keypad arrow</b> to run in that direction until a robot or heap
          gets close (^H ^J ^K ...). Tap anything to stop a run.</li>
        <li>The keypad is the original <kbd>y k u</kbd> / <kbd>h . l</kbd> / <kbd>b j n</kbd> layout.</li>
        <li><b>t</b> teleport: a <i>safe</i> teleport while you have free ones, otherwise random.
          The bottom line shows <kbd>&lt;free&gt;</kbd>, e.g. <kbd>&lt;2+1&gt;</kbd> = 2 this level + 1 saved.</li>
        <li><b>r</b> random teleport: never uses a free one.</li>
        <li><b>a</b> antimatter: destroys every robot next to you, costs one free teleport.</li>
        <li><b>^W</b> wait (or hold the centre key): wait until robots get close.</li>
        <li><b>s</b> last stand (tap twice): stand still until the level is over — one way or the other.</li>
        <li><b>d</b> dots: mark the squares around you (radius 1, 2, off).</li>
        <li><b>?</b> hint: show safe moves on the keypad — only in wimpy mode; otherwise "Be a stud!".</li>
      </ul>
      <p>Each robot is worth the <i>value</i> on the status line (fast robots 1.5×). Free teleports
      you don't use carry over, and the number you get per level grows (up to 3) when you save them.</p>
      <p>A keyboard works too: <kbd>hjklyubn</kbd>, <kbd>HJKL…</kbd> to run blindly, <kbd>Ctrl</kbd>+direction
      to run safely, a number prefix to repeat, <kbd>t r a s d ? M q</kbd>, <kbd>Esc</kbd> for this menu.</p>
      <p style="opacity:.7">Robots (Torus) by Allan Black, Graeme Lunt, Julian Onions, Tad White;
      Linux port by Tom Wilson. Ported to the browser from the original C source.</p>
      <div class="row"><button data-a="back">Back</button></div>`);
    body.querySelector('[data-a=back]').onclick = () => openMenu();
  }

  /* ---------------- boot ---------------- */
  applyTheme();
  resize();
  /* re-measure after the layout has settled (the flex layout flips on rotation) */
  const relayout = () => { resize(); setTimeout(resize, 80); setTimeout(resize, 350); };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  resetBlink();
  requestAnimationFrame(frame);
  window.torusRedraw = draw;               /* handy for debugging */

  E.start({
    render() { dirty = true; },
    beep,
    hint: showHint,
    runDelay: () => SPEEDS[settings.speed] || 70,
    rules: () => ({
      hsew: TOPO[settings.topology].hsew, vsew: TOPO[settings.topology].vsew,
      wimpy: settings.wimpy, all_moves: settings.all_moves, moveable_heaps: settings.moveable_heaps,
      show_highscore: settings.show_highscore, name: settings.name,
    }),
    loadScores: (f) => store.get(`torus.scores.${f}`, []),
    saveScores: (f, s) => store.set(`torus.scores.${f}`, s),
  });

  if (!store.get('torus.seenHelp', false)) { store.set('torus.seenHelp', true); openHelp(); }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
