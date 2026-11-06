# Torus — robots on a doughnut, for touch screens

A browser/PWA port of the 1980s/90s UNIX game **torus** (robots with wrap-around
edges, fast robots, pushable scrap heaps, antimatter and free safe teleports).

The game logic in `torus.js` is a line-by-line translation of the original C
source (`main.c`, `robot.c`, `user.c`, `good.c`, `score.c`), including the
curses screen it used to keep its state, the original random number generator,
the scoring rules and the "Top Ten ... Scores for this Week / of All Time" tables.

## Files

| file | what |
|---|---|
| `index.html`, `style.css` | page, layout, themes |
| `torus.js` | the game (C port + tiny curses emulation) |
| `app.js` | terminal rendering, touch/keyboard input, menus, settings, storage |
| `sw.js`, `manifest.webmanifest`, `icons/` | makes it an installable, offline PWA |
| `tools/make-icons.js` | regenerates the icons (`node tools/make-icons.js`) |

## Playing on an Android tablet

A PWA has to be served over **https** to be installable. Any static host works;
two free options:

**GitHub Pages**
1. Create a repository (e.g. `torus`) on github.com and upload all files in this folder.
2. Settings → Pages → *Deploy from a branch* → `main` / root.
3. Open `https://<your-user>.github.io/torus/` in Chrome on the tablet.

**Netlify Drop** — drag this folder onto <https://app.netlify.com/drop> and open the URL it gives you.

Then in Chrome: ⋮ menu → **Add to Home screen / Install app**. It launches
full-screen, works offline, and remembers a game in progress if Android kills it.

To try it on the PC first:

```bash
python -m http.server 8765
```

and open <http://localhost:8765>.

## Controls

* **Tap the board** — step one square towards the tap (tap yourself = wait).
* **Swipe the board** / **hold a keypad arrow** — run until something gets close (the original `^H ^J ...`).
* Keypad is the original `y k u / h . l / b j n`.
* `t` teleport (safe while you have free ones), `r` random teleport, `a` antimatter,
  `^W` wait, `s` last stand (tap twice), `d` dots, `?` hint (wimpy mode only), ☰ menu.
* A hardware keyboard works exactly like the original, including counts and `Ctrl`+direction.

Options (☰ → Options) cover the original command-line / `ROBOTOPTS` settings:
board topology (toral / annular / planar), wimpy vs studly, moveable heaps, your
name for the score table, plus the terminal look (Sun black-on-white, white-on-black,
green or amber phosphor).

## Credits

Robots (Torus): Allan Black, Graeme Lunt, Julian Onions, Tad White; Linux port by
Tom Wilson. "Provided free as long as you don't make money from it!"
