/*
 *	R O B O T S   ( T O R U S )   --  JavaScript port
 *
 *	A faithful port of the C sources (main.c, robot.c, user.c, good.c,
 *	score.c) to the browser.  The original game kept its state in the
 *	curses screen itself (it uses inch() to look at what is where), so this
 *	port carries a small curses emulation (an 80x24 character screen with
 *	move/addch/inch/...) and translates the C routines almost line for line.
 *
 *	Original history:
 *	  Original Implementation   Allan Black <allan@cs.strath.ac.uk>
 *	  Fast robots, moveable heaps, ROBOTOPTS, antimatter, portability
 *	                            Graeme Lunt, Julian Onions (Nottingham)
 *	  Topological modifications Tad White <tadpole@math.ucla.edu>
 *	  Linux port                Tom Wilson
 *	"Provided free as long as you don't make money from it!"
 */
'use strict';

(function (global) {

  /* ---------------- robots.h ---------------- */
  const LINES = 24, COLS = 80;
  const MIN_ROBOTS = 10;    /* no. of robots you start with */
  const MAX_ROBOTS = 500;   /* maximum robots on a screen   */
  const MIN_VALUE = 10;     /* what each robot is worth to begin */
  const MAX_FREE = 3;       /* max free teleports per level */
  const FASTEST = 2;        /* the fastest robot (dont fiddle) */

  const VERT = '|', HORIZ = '-', ROBOT = '+', FROBOT = '#', SCRAP = '@';
  const ME = 'I', MUNCH = '*', DOT = '.';

  const MSGPOS = 35, RVPOS = 47;
  const WIDTH = COLS - 2, HEIGHT = LINES - 3;

  const NUMSCORES = 10, NUMNAME = 'Ten';
  const TEMP_DAYS = 7, TEMP_NAME = 'Week';
  const MULT = 1.5;
  const SECSPERDAY = 86400;

  const ctrl = (c) => c.charCodeAt(0) & 0o37;
  const sign = (x) => (x < 0 ? -1 : x > 0 ? 1 : 0);
  const abs = Math.abs;
  const idiv = (a, b) => Math.trunc(a / b);

  /* ---------------- curses emulation ---------------- */
  const scr = [];
  for (let y = 0; y < LINES; y++) scr.push(new Array(COLS).fill(' '));
  let cy = 0, cx = 0;
  let leaveok_flag = false;
  let shown = { y: 0, x: 0, visible: true };

  function move(y, x) {                 /* curses: ERR, cursor unchanged */
    if (y < 0 || y >= LINES || x < 0 || x >= COLS) return;
    cy = y; cx = x;
  }
  function inch() { return cx < COLS ? scr[cy][cx] : ' '; }
  function addch(c) {
    if (cx >= COLS) return;
    scr[cy][cx] = c;
    if (++cx >= COLS && cy < LINES - 1) { cx = 0; cy++; }
  }
  function mvaddch(y, x, c) { move(y, x); addch(c); }
  function addstr(s) { for (const ch of String(s)) addch(ch); }
  function mvaddstr(y, x, s) { move(y, x); addstr(s); }
  function clrtoeol() { for (let x = cx; x < COLS; x++) scr[cy][x] = ' '; }
  function clear() {
    for (let y = 0; y < LINES; y++) scr[y].fill(' ');
    cy = cx = 0;
  }
  function leaveok(b) { leaveok_flag = b; }
  function refresh() {
    shown = { y: cy, x: cx < COLS ? cx : COLS - 1, visible: !leaveok_flag };
    hooks.render();
  }

  const lpad = (v, n) => { v = String(v); return v.length >= n ? v : ' '.repeat(n - v.length) + v; };
  const rpad = (v, n) => { v = String(v); return v.length >= n ? v : v + ' '.repeat(n - v.length); };

  /* ---------------- I/O plumbing ---------------- */
  let hooks = {
    render() {}, beep() {}, hint() {}, runDelay() { return 50; },
    rules() { return {}; }, loadScores() { return []; }, saveScores() {},
  };
  const inputQueue = [];
  let waiter = null;
  let mode = 'busy';              /* 'command' | 'anykey' | 'busy' */
  let quitRequested = false;
  const RESTART = { restart: true };

  function pushKey(code) {
    if (typeof code === 'string') code = code.charCodeAt(0);
    if (waiter) { const w = waiter; waiter = null; w(code); }
    else inputQueue.push(code);
  }
  function readchar() {
    if (inputQueue.length) return Promise.resolve(inputQueue.shift());
    return new Promise((r) => { waiter = r; });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitAnyKey() {        /* touch friendly "press a key" */
    if (quitRequested) return 0;
    await sleep(300);
    inputQueue.length = 0;
    if (quitRequested) return 0;
    mode = 'anykey';
    const c = await readchar();
    mode = 'busy';
    return c;
  }

  /* ---------------- globals (main.c) ---------------- */
  let whoami = 'ANON';
  let cmd_ch = '';
  let dead = false, last_stand = false;
  let show_highscore = true;
  let adjacent = false, first_move = false, bad_move = false, waiting = false;
  let moveable_heaps = true;
  let hsew = true, vsew = true, toral = true;
  let wimpy = false, all_moves = false;

  let my_x = 0, my_y = 0, new_x = 0, new_y = 0;
  let level = 0, free_teleports = 0, old_free = -1, free_per_level = 1;
  let count = 0, dots = 0;
  let robot_value = MIN_VALUE, max_robots = MIN_ROBOTS;
  let nrobots_alive = 0, scrap_heaps = 1;
  let score = 0;
  let seed = 0;
  let tels = '';

  const rbt_list = [];
  for (let i = 0; i <= MAX_ROBOTS; i++) rbt_list.push({ alive: false, x: 0, y: 0, speed: 1 });

  function rnd(mod) {
    if (mod <= 0) return 0;
    seed = (Math.imul(seed, 11109) + 13849) | 0;
    return ((seed >> 16) & 0xffff) % mod;
  }
  const rndx = () => rnd(COLS - 2) + 1;
  const rndy = () => rnd(LINES - 3) + 1;

  function applyRules() {
    const r = hooks.rules() || {};
    hsew = r.hsew !== undefined ? !!r.hsew : true;
    vsew = r.vsew !== undefined ? !!r.vsew : true;
    wimpy = !!r.wimpy;
    all_moves = !!r.all_moves;
    moveable_heaps = r.moveable_heaps !== undefined ? !!r.moveable_heaps : true;
    show_highscore = r.show_highscore !== undefined ? !!r.show_highscore : true;
    whoami = (r.name || 'ANON').slice(0, 40);
  }

  /* ---------------- save / resume ---------------- */
  const SAVE_KEY = 'torus.savedgame.v1';
  function saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        scr: scr.map((r) => r.join('')), seed, level, free_teleports, free_per_level,
        score, robot_value, max_robots, nrobots_alive, scrap_heaps, my_x, my_y, dots,
        all_moves, last_stand,
        robots: rbt_list.slice(0, max_robots).map((r) => [r.alive ? 1 : 0, r.x, r.y, r.speed]),
        rules: { hsew, vsew, wimpy, moveable_heaps, show_highscore, whoami },
      }));
    } catch (e) { /* storage unavailable: no resume */ }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function loadGame() {
    let s;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || !Array.isArray(s.scr) || s.scr.length !== LINES) return false;
    for (let y = 0; y < LINES; y++) scr[y] = rpad(s.scr[y], COLS).slice(0, COLS).split('');
    ({ seed, level, free_teleports, free_per_level, score, robot_value, max_robots,
       nrobots_alive, scrap_heaps, my_x, my_y, dots, all_moves, last_stand } = s);
    s.robots.forEach((r, i) => { Object.assign(rbt_list[i], { alive: !!r[0], x: r[1], y: r[2], speed: r[3] }); });
    ({ hsew, vsew, wimpy, moveable_heaps, show_highscore, whoami } = s.rules);
    count = 0; adjacent = waiting = first_move = false; dead = false; old_free = -1;
    leaveok(last_stand);
    return true;
  }
  function hasSavedGame() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }

  /* ---------------- main.c ---------------- */
  async function main() {
    for (;;) {
      try {
        await play();
      } catch (e) {
        if (e !== RESTART) throw e;
      }
    }
  }

  async function play() {
    let resume = loadGame();
    quitRequested = false;
    if (!resume) {
      applyRules();
      seed = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 65536)) | 0;
      dead = false;
      free_teleports = 0;
      level = 0;
      free_per_level = 1;
      scrap_heaps = 1;
      score = 0;
      robot_value = MIN_VALUE;
      max_robots = MIN_ROBOTS;
    }
    for (;;) {
      if (!resume) {
        count = 0;
        adjacent = false;
        waiting = false;
        last_stand = false;
        old_free = -1;
        if (rnd(free_per_level) < free_teleports) {
          free_per_level++;
          if (free_per_level > MAX_FREE) free_per_level = MAX_FREE;
        }
        free_teleports += free_per_level;
        leaveok(false);
        draw_screen();
        put_robots();
        do {
          my_x = rndx();
          my_y = rndy();
          move(my_y, my_x);
        } while (inch() !== ' ');
        addch(ME);
        if (dots) put_dots();
        saveGame();
      }
      resume = false;
      for (;;) {
        scorer();
        if (nrobots_alive === 0) break;
        await command();
        for (let i = 1; i <= FASTEST; i++) robots(i);
        if (dead) { await munch(); return; }
        saveGame();
      }
      msg(`${max_robots} robots are now ${scrap_heaps} scrap heaps`);
      leaveok(false);
      move(my_y, my_x);
      refresh();
      await waitAnyKey();
      level++;
    }
  }

  function draw_screen() {
    clear();
    for (let y = 1; y < LINES - 2; y++) {
      mvaddch(y, 0, VERT);
      mvaddch(y, COLS - 1, VERT);
    }
    for (let x = 0; x < COLS; x++) {
      mvaddch(0, x, HORIZ);
      mvaddch(LINES - 2, x, HORIZ);
    }
  }

  function put_dots() {
    for (let x = my_x - dots; x <= my_x + dots; x++)
      for (let y = my_y - dots; y <= my_y + dots; y++) {
        tmove(y, x);
        if (inch() === ' ') addch(DOT);
      }
  }

  function erase_dots() {
    for (let x = my_x - dots; x <= my_x + dots; x++)
      for (let y = my_y - dots; y <= my_y + dots; y++) {
        tmove(y, x);
        if (inch() === DOT) addch(' ');
      }
  }

  function xinc(dir) {
    switch (dir) {
      case 'h': case 'y': case 'b': return -1;
      case 'l': case 'u': case 'n': return 1;
      default: return 0;
    }
  }

  function yinc(dir) {
    switch (dir) {
      case 'k': case 'y': case 'u': return -1;
      case 'j': case 'b': case 'n': return 1;
      default: return 0;
    }
  }

  function vbound(y /*, x */) {   /* for toral robots: converts y to lie within boundary */
    let t_y = y;
    if (vsew) {
      if (y >= LINES - 2) t_y = y - (LINES - 3);
      if (y <= 0) t_y = y + (LINES - 3);
    }
    return t_y;
  }

  function hbound(y, x) {
    let t_x = x;
    if (hsew) {
      if (x >= COLS - 1) t_x = x - (COLS - 2);
      if (x <= 0) t_x = x + (COLS - 2);
    }
    return t_x;
  }

  function tmove(y, x) {           /* move with wrap-around, if edge identifications made. */
    move(vbound(y, x), hbound(y, x));
  }

  async function munch() {
    scorer();
    msg("MUNCH! You're robot food");
    leaveok(false);
    mvaddch(my_y, my_x, MUNCH);
    move(my_y, my_x);
    refresh();
    clearSave();
    await waitAnyKey();
    await scoring(true);
  }

  async function quitGame() {      /* 'q' -- recorded as "ducked out" (like ^C) */
    quitRequested = false;
    clearSave();
    await scoring(false);
    throw RESTART;
  }

  function msg(message) {
    mvaddstr(LINES - 1, MSGPOS, message);
    clrtoeol();
    refresh();
  }

  /* ---------------- robot.c ---------------- */
  function put_robots() {          /* place some robots */
    robot_value += level * (5 + idiv(max_robots, Math.max(1, scrap_heaps)));
    max_robots += level * 3 + rnd(level * 5);
    if (max_robots > MAX_ROBOTS) max_robots = MAX_ROBOTS;
    nrobots_alive = max_robots;
    scrap_heaps = 0;               /* number of scrap heaps created */
    for (let i = 0; i < max_robots; i++) {
      const r = rbt_list[i];
      let x, y;
      for (;;) {
        x = rndx();
        y = rndy();
        move(y, x);
        if (inch() === ' ') break;
      }
      r.x = x;
      r.y = y;
      r.alive = true;
      r.speed = 1 + (rnd(10) > 6 ? 1 : 0);
      addch(r.speed === 2 ? FROBOT : ROBOT);
    }
  }

  function worth(r) { return r.speed === 2 ? MULT * robot_value : robot_value; }
  function addScore(r) { score = Math.trunc(score + worth(r)); }

  function robots(speed) {         /* Troops, Troooooops advance! */
    const end = max_robots;
    for (let i = 0; i < end; i++) {
      const r = rbt_list[i];
      if (r.alive && r.speed >= speed) mvaddch(r.y, r.x, ' ');
    }
    for (let i = 0; i < end; i++) {
      const r = rbt_list[i];
      if (r.alive && r.speed >= speed) {
        let x_inc = sign(my_x - r.x);
        let y_inc = sign(my_y - r.y);
        if (hsew && abs(my_x - r.x) > idiv(COLS - 2, 2)) x_inc *= -1;
        if (vsew && abs(my_y - r.y) > idiv(LINES - 3, 2)) y_inc *= -1;
        r.y = vbound(r.y + y_inc, r.x + x_inc);
        r.x = hbound(r.y + y_inc, r.x + x_inc);
        move(r.y, r.x);
        switch (inch()) {
          case ME:                 /* robot eat me */
            addch(MUNCH);
            dead = true;
            break;
          case SCRAP:              /* robot walks into scrap heap */
            r.alive = false;
            addScore(r);
            nrobots_alive--;
            break;
          case FROBOT:
          case ROBOT:              /* two robots form scrap heap */
            collision(r, end);
            r.alive = false;
            addch(SCRAP);
            addScore(r);
            nrobots_alive -= 2;
            scrap_heaps++;
            break;
          case MUNCH:
            break;
          default:
            addch(r.speed === 2 ? FROBOT : ROBOT);
        }
      }
    }
  }

  function collision(r, end) {     /* do two robots collide - if so - which two */
    for (let i = 0; i < end; i++) {
      const find = rbt_list[i];
      if (find.alive && r !== find && r.x === find.x && r.y === find.y) {
        find.alive = false;
        addScore(find);
        return;
      }
    }
  }

  function screwdriver() {         /* dismantle those robots ... */
    const moves = 'hjklyubn.';
    const end = max_robots;
    for (const m of moves) {       /* let's see if there is a robot */
      const test_x = hbound(my_y + yinc(m), my_x + xinc(m));
      const test_y = vbound(my_y + yinc(m), my_x + xinc(m));
      move(test_y, test_x);
      switch (inch()) {
        case FROBOT:
        case ROBOT:                /* OK so there is now let's look for it */
          for (let i = 0; i < end; i++) {
            const find = rbt_list[i];
            if (find.alive && test_x === find.x && test_y === find.y) {
              find.alive = false;
              addScore(find);
            }
          }
          addch(' ');
          nrobots_alive--;
          break;
      }
    }
    free_teleports--;
  }

  /* ---------------- user.c ---------------- */
  async function command() {       /* whats the user trying to tell us */
    for (;;) {                     /* retry: */
      if (quitRequested) await quitGame();
      if (all_moves && wimpy) good_moves();
      move(my_y, my_x);
      refresh();
      if (last_stand) { await sleep(hooks.runDelay()); return; }
      bad_move = false;
      cmd_ch = await read_com();
      hooks.hint(null);
      if (quitRequested) await quitGame();
      switch (cmd_ch) {
        case '.': case 'h': case 'j': case 'k': case 'l':
        case 'y': case 'u': case 'b': case 'n': case 'w':
          do_move(cmd_ch);
          break;
        case 't': case 'r': case 'T': case 'R': {
          let tries = 0;
          for (;;) {               /* teleport: */
            new_x = rndx();
            new_y = rndy();
            move(new_y, new_x);
            const c = inch();
            if (c === FROBOT || c === ROBOT || c === SCRAP || c === ME) continue;
            if (free_teleports > 0 && (cmd_ch === 't' || cmd_ch === 'T')) {
              /* (the original loops forever if there is no safe square) */
              if (!isgood(new_y, new_x) && ++tries < 50000) continue;
              if (tries < 50000) free_teleports--;
            }
            break;
          }
          break;
        }
        case 's': case 'S': case 'W':
          last_stand = true;
          leaveok(true);
          return;
        case 'M':
          all_moves = !all_moves;
          continue;
        case 'm': case '?':
          if (wimpy) good_moves();
          else mvaddstr(LINES - 1, MSGPOS, 'Be a stud!');
          continue;
        case 'd': case 'D':
          if (dots < 2) {
            dots++;
            put_dots();
          } else {
            erase_dots();
            dots = 0;
          }
          continue;
        case 'q': case 'Q':
          await quitGame();
          break;
        case 'a': case 'A':        /* Antimatter - sonic screwdriver */
          if (free_teleports) {
            new_x = my_x;
            new_y = my_y;
            screwdriver();
          } else continue;
          break;
        case String.fromCharCode(ctrl('R')):
          continue;
        default:
          bad_move = true;
      }
      if (bad_move) {
        hooks.beep();
        count = 0;
        adjacent = false;
        waiting = false;
        first_move = false;
        continue;
      }
      break;
    }
    first_move = false;
    if (dots) erase_dots();
    mvaddch(my_y, my_x, ' ');
    my_x = new_x;
    my_y = new_y;
    move(my_y, my_x);
    if (inch() === ROBOT || inch() === FROBOT) dead = true;
    else {
      if (dots) put_dots();
      mvaddch(my_y, my_x, ME);
      refresh();
    }
  }

  let com = 0;
  const isdigit = (c) => c >= 48 && c <= 57;

  async function read_com() {
    if (count > 0) {               /* repeated command: let the player watch */
      await sleep(hooks.runDelay());
      if (quitRequested) return '\0';
      if (inputQueue.length) {     /* a tap during a run stops it */
        inputQueue.length = 0;
        count = 0; adjacent = false; waiting = false; first_move = false;
      }
    }
    if (count === 0) {
      mode = 'command';
      com = await readchar();
      mode = 'busy';
      if (isdigit(com)) {
        count = com - 48;
        while (isdigit(com = await readchar()))
          count = count * 10 + com - 48;
      } else {
        switch (com) {
          case ctrl('W'):
            waiting = true;
            /* fall through */
          case ctrl('H'): case ctrl('J'): case ctrl('K'): case ctrl('L'):
          case ctrl('Y'): case ctrl('U'): case ctrl('B'): case ctrl('N'):
            com |= 0o100;
            adjacent = true;
            first_move = true;
        }
        switch (String.fromCharCode(com)) {
          case 'H': case 'L':
            count = WIDTH;
            com |= 0o40;
            first_move = true;
            break;
          case 'J': case 'K':
            count = HEIGHT;
            com |= 0o40;
            first_move = true;
            break;
          case 'Y': case 'U': case 'N': case 'B': case 'W': {
            /* set count to the least common multiple of WIDTH and HEIGHT */
            let w = WIDTH, h = HEIGHT, t;
            while (w > h) {
              t = w - h;
              if (t < h) { w = h; h = t; } else w = t;
            }
            count = idiv(WIDTH, w) * HEIGHT;
            com |= 0o40;
            first_move = true;
            break;
          }
          default:
            count = 0;
            break;
        }
      }
    }
    if (count > 0) count--;
    return String.fromCharCode(com);
  }

  function do_move(dir) {          /* implement the users move */
    new_x = hbound(my_y + yinc(dir), my_x + xinc(dir));
    new_y = vbound(my_y + yinc(dir), my_x + xinc(dir));
    if (adjacent && !first_move) {
      for (let x = -2; x <= 2; x++) {
        for (let y = -2; y <= 2; y++) {
          tmove(new_y + y, new_x + x);
          switch (inch()) {
            case SCRAP:
              if (waiting) break;
              /* fall through */
            case ROBOT:
              if (abs(x) < 2 && abs(y) < 2) {
                bad_move = true;
                return;
              } else break;
            case FROBOT:
              if (waiting && blocked(new_y, new_x, y, x)) break;
              bad_move = true;
              return;
          }
        }
      }
    }
    move(new_y, new_x);            /* already bounded */
    switch (inch()) {
      case SCRAP:
        if (moveable_heaps && move_heap(dir)) break;
        bad_move = true;
        return;
      case VERT:
        if (hsew) break;
        bad_move = true;
        return;
      case HORIZ:
        if (vsew) break;
        bad_move = true;
        return;
    }
  }

  function move_heap(dir) {        /* push a scrap heap */
    const x = hbound(new_y + yinc(dir), new_x + xinc(dir));
    const y = vbound(new_y + yinc(dir), new_x + xinc(dir));
    move(y, x);
    switch (inch()) {
      case VERT: case HORIZ: case SCRAP: case ROBOT: case FROBOT:
        return false;
    }
    addch(SCRAP);
    mvaddch(new_y, new_x, ' ');
    return true;
  }

  /* ---------------- good.c ---------------- */
  function good_moves() {
    const moves = 'hjklyubn.a';
    let ans = '';
    let i;
    for (i = 0; moves[i] !== 'a'; i++) {
      const m = moves[i];
      const test_x = hbound(my_y + yinc(m), my_x + xinc(m));
      const test_y = vbound(my_y + yinc(m), my_x + xinc(m));
      move(test_y, test_x);
      switch (inch()) {
        case ' ': case DOT: case ME:
          if (isgood(test_y, test_x)) ans += m;
          break;
        case SCRAP:
          if (moveable_heaps) {
            const nscrap_x = hbound(test_y + yinc(m), test_x + xinc(m));
            const nscrap_y = vbound(test_y + yinc(m), test_x + xinc(m));
            move(nscrap_y, nscrap_x);
            const savechar = inch();
            if (savechar === DOT || savechar === ' ') {
              addch(SCRAP);
              if (isgood(test_y, test_x)) ans += m;
              move(nscrap_y, nscrap_x);
              addch(savechar);
            }
          }
          break;
      }
    }
    /* now lets do the antimatter case */
    if (free_teleports) {
      let notsilly = 0;            /* silly to do it if not get robots */
      const savebuf = new Array(9);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          tmove(my_y + a, my_x + b);
          const sc = inch();
          if (sc === FROBOT || sc === ROBOT) {
            savebuf[(a + 1) * 3 + b + 1] = sc;
            addch(' ');
            notsilly = 1;
          } else savebuf[(a + 1) * 3 + b + 1] = ' ';
        }
      if (notsilly && isgood(my_y, my_x)) ans += 'a';
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          tmove(my_y + a, my_x + b);
          const sc = savebuf[(a + 1) * 3 + b + 1];
          if (sc === FROBOT || sc === ROBOT) addch(sc);
        }
    }
    const text = ans || 'Forget it!';
    mvaddstr(LINES - 1, MSGPOS, rpad(text, RVPOS - MSGPOS).slice(0, RVPOS - MSGPOS));
    hooks.hint(ans);
  }

  function isgood(ty, tx) {
    for (let x = -2; x <= 2; x++) {
      for (let y = -2; y <= 2; y++) {
        if (abs(x) > 1 || abs(y) > 1) {   /* we are 2 steps out */
          if (blocked(ty, tx, y, x)) continue;
          tmove(ty + y, tx + x);
          if (abs(x) === 2 && abs(y) === 2 && inch() === FROBOT) return false;
          if (x === -1 && scan(ty + y, tx + x, 0, 1)) return false;
          if (y === -1 && scan(ty + y, tx + x, 1, 0)) return false;
        } else {
          tmove(ty + y, tx + x);
          switch (inch()) {
            case FROBOT:
            case ROBOT:            /* robot next to you */
              return false;
          }
        }
      }
    }
    return true;
  }

  function scan(y, x, yi, xi) {    /* scan along this line looking for collision conditions */
    let rcount = 0;
    for (let ctr = 0; ctr <= 2; ctr++) {
      tmove(y + ctr * yi, x + ctr * xi);
      switch (inch()) {
        case FROBOT: rcount += 4; break;
        case ROBOT: rcount++; break;
      }
    }
    return rcount === 4;
  }

  function blocked(my, mx, y, x) {
    if (x < 0) x++;
    if (y < 0) y++;
    if (x > 0) x--;
    if (y > 0) y--;
    tmove(my + y, mx + x);
    return inch() === SCRAP;
  }

  /* ---------------- score.c ---------------- */
  function topoName(h, v) { return h ? (v ? 'toral' : 'annular') : (v ? 'annular' : 'planar'); }

  function scoreFile(t, temp) { return (t ? 'torus' : 'robots2') + (temp ? '_tmp' : '_hof'); }

  async function scoring(eaten) {
    toral = hsew && vsew;
    const week = do_score(eaten, scoreFile(toral, true), TEMP_DAYS, `for this ${TEMP_NAME}`, score);
    const all = do_score(eaten, scoreFile(toral, false), 0, 'of All Time', score);
    if (week.isNew || show_highscore) {
      showText(week.lines.concat(['', '[Press return to continue]']));
      await waitAnyKey();
    }
    if (all.isNew || show_highscore) {
      showText(all.lines.concat(['', '[Press return to continue]']));
      await waitAnyKey();
    }
  }

  function showText(lines) {
    leaveok(false);
    clear();
    lines.slice(0, LINES).forEach((l, y) => mvaddstr(y, 0, l.slice(0, COLS)));
    const last = lines.slice(0, LINES);
    move(last.length - 1, last[last.length - 1].length);
    refresh();
  }

  function emptyEntry() {
    return { s_uid: 0, s_score: 0, s_name: '', s_eaten: false, s_level: 0,
             s_hsew: false, s_vsew: false, s_wimpy: false, s_days: 0 };
  }

  function do_score(eaten, fname, max_days, type_str, the_score, tor) {
    const isToral = tor === undefined ? toral : tor;
    const this_day = max_days ? Math.floor(Date.now() / 1000 / SECSPERDAY) : 0;
    const limit = this_day - max_days;
    const stored = hooks.loadScores(fname) || [];
    const sfile = [];
    for (let i = 0; i < NUMSCORES; i++) sfile.push(Object.assign(emptyEntry(), stored[i] || {}));
    const eof = NUMSCORES;
    let thisIdx = -1;
    if (the_score > 0) {
      const uid = 0;
      let oldest = -1;
      let x = limit;
      for (let p = eof - 1; p >= 0; p--)
        if (sfile[p].s_days < x) { x = sfile[p].s_days; oldest = p; }
      let position = -1, remove;
      for (remove = 0; remove < eof; remove++)
        if (position < 0 && the_score > sfile[remove].s_score) position = remove;
      /* ALLSCORES is defined, so remove == eof here */
      if (oldest >= 0) {
        remove = oldest;
        if (position < 0) position = eof - 1;
        else if (remove < position) position--;
      } else if (position >= 0) {
        remove = eof - 1;
      }
      if (position >= 0) {
        if (remove < position) {
          while (remove < position) { sfile[remove] = sfile[remove + 1]; remove++; }
        } else {
          while (remove > position) { sfile[remove] = sfile[remove - 1]; remove--; }
        }
        sfile[position] = {
          s_uid: uid, s_score: the_score, s_name: whoami, s_eaten: eaten,
          s_level: level + 1, s_hsew: hsew, s_vsew: vsew, s_wimpy: wimpy, s_days: this_day,
        };
        thisIdx = position;
        hooks.saveScores(fname, sfile);
      }
    }
    const lines = ['', `Top ${NUMNAME} ${isToral ? 'Toral' : 'Non-Toral'} Scores ${type_str}:`,
                   'Rank     Score    Name'];
    for (let p = 0; p < eof; p++) {
      const s = sfile[p];
      if (s.s_score === 0) break;
      lines.push(
        (p === thisIdx ? '>' : ' ') +
        (s.s_days < limit ? '*' : ' ') +
        lpad(p + 1, 2) + ' ' + lpad(s.s_score, 10) + '  ' + lpad(s.s_name, 8) + ': ' +
        (s.s_eaten ? 'robot food' : 'ducked out') + ' on ' + lpad(s.s_wimpy ? 'wimpy' : 'studly', 6) +
        ' ' + lpad(topoName(s.s_hsew, s.s_vsew), 7) + ` level ${s.s_level}.` +
        (p === thisIdx ? '<' : ''));
    }
    return { isNew: thisIdx >= 0, lines };
  }

  function scorer() {
    if (free_teleports !== old_free) {
      if (free_teleports > free_per_level)
        tels = `${free_per_level}+${free_teleports - free_per_level}`;
      else tels = `${free_teleports}`;
      old_free = free_teleports;
    }
    move(LINES - 1, 0);
    clrtoeol();
    addstr(`<${tels}> level: ${level + 1}    score: ${score}`);
    mvaddstr(LINES - 1, RVPOS,
      `heaps:${lpad(scrap_heaps, 3)} robots:${lpad(nrobots_alive, 3)} value: ${robot_value}`);
    clrtoeol();
  }

  /* ---------------- public interface ---------------- */
  let started = false;
  global.TorusEngine = {
    LINES, COLS,
    start(h) {
      Object.assign(hooks, h);
      if (started) return;
      started = true;
      main().catch((e) => { console.error(e); });
    },
    pushKey,
    requestQuit() { quitRequested = true; pushKey(0); },
    screen: () => scr,
    cursor: () => shown,
    player: () => ({ x: my_x, y: my_y }),
    mode: () => mode,
    inGame: () => hasSavedGame(),
    setAllMoves(b) { all_moves = !!b; },
    scoreTable(isToral, temp) {
      return do_score(false, scoreFile(isToral, temp), temp ? TEMP_DAYS : 0,
        temp ? `for this ${TEMP_NAME}` : 'of All Time', 0, isToral).lines;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
