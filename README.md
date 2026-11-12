# Wau Terbang

A tap-to-fly game for iPhone. Fly a colourful Malaysian wau kite between tall buildings and storm clouds.

## Play

Host the folder on any HTTPS site (for example GitHub Pages) and open `index.html` in iPhone Safari.

- Tap anywhere to rise. Stop tapping and the kite falls.
- Fly through the gaps. Each gap is +1 point and the game slowly speeds up.
- Hitting a building, a cloud or the ground ends the game. Your best score is saved on the phone.

To install it, tap **Share → Add to Home Screen**. It then opens full screen like an app.

## Files

- `index.html`: the whole game (HTML, CSS and JavaScript, everything drawn on a canvas)
- `manifest.json`: settings for "Add to Home Screen"
- `icon.svg`: app icon, drawn with SVG code

---

# Lipas Smash

A tap game in `lipas/index.html`. Cockroaches crawl across the table towards your fried chicken. Tap them before they get there.

- There are 5 kinds of cockroach: German, American, Brown-banded, Oriental and Hissing. Each one has its own size, speed and points. Oriental takes 2 taps and Hissing takes 3.
- New kinds join the game over time, and more of them come, faster.
- Each cockroach that reaches the plate eats a piece of chicken. Lose all 3 pieces and the game is over.
- Spray cans sometimes appear on the table. Tap one to pick it up (you can hold up to 3), then press the spray button to wipe out every cockroach on screen.
- Your best score is saved on the phone.

Play it at `/lipas/` on the same site, for example https://wosoldgit-maker.github.io/wau-game/lipas/
