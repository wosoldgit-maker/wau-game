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

---

# Jom Baca Iqra

A flashcard game in `iqra/index.html` that helps kids learn to read Iqra and short surahs of the Al-Quran.

- Pick a deck: Iqra 1 to 5 (letters, joined letters, mad, baris, tanwin, sukun, alif lam, sabdu) or a short surah (Al-Fatihah, Al-Ikhlas, Al-Falaq, An-Nas, Al-Kauthar), one ayat per card.
- The child reads the card, then presses **🔊 Semak** to hear the correct reading and see the rumi spelling.
- Then press **✅ Betul** or **❌ Salah**.
- At the end, press **🔁 Ulang yang salah** to go through only the wrong cards again. The home screen also has **🔁 Ulang Kad Salah**, which collects every wrong card from every deck. A card leaves the list when it is marked Betul.
- Each Iqra card has its own audio file in `iqra/audio/`. They were made with `tools/make_iqra_audio.py`, which tells a computer voice exactly which sounds to say, so بَ is read "ba" (not the letter name) and كَتَبَ is read "kataba" (not "katab"). If you change the Iqra cards, run that script again.
- Surah ayat play a real recitation by Syeikh Mahmud Khalil Al-Husary (from everyayah.com, needs internet).
- If a file can't play, the phone's Arabic voice is used instead.
- Options: shuffle cards, slow voice. Progress is saved on the phone.

Play it at `/iqra/` on the same site, for example https://wosoldgit-maker.github.io/wau-game/iqra/

---

# Jom Taekwondo

A learning app in `taekwondo/index.html` for kids who are starting taekwondo. It teaches the Korean words used in the dojang, the basic techniques and the first poomsae.

- **📖 Belajar**: flashcards in 9 groups (counting 1–10, dojang commands, things in the dojang, target areas, stances, blocks, punches and strikes, kicks, and the 5 tenets). Each card shows the Hangul, the rumi spelling, the Malay meaning and how to do the move. Press **🔊 Dengar** to hear it, or swipe to change card.
- **❓ Kuiz**: 10 questions from one group or all of them. Questions are mixed: Korean → Malay, Malay → Korean, and listen → choose. The right answer is always shown so the child learns from mistakes.
- **⚡ Arahan Sabeomnim**: the coach calls out a command and the child taps the meaning before the timer runs out. It gets faster each round, and after round 15 it is listen-only. 3 lives.
- **🥋 Poomsae Taegeuk Il Jang**: all 18 moves, one at a time, with a floor map showing where to stand and which way to face. **▶ Main** plays through the moves on its own.
- **🏅 Tali Pinggang**: points from the quiz and the reflex game move the child up from white to black belt in the app.
- Sounds use the phone's Korean voice. On iPhone, add it in Settings → Accessibility → Spoken Content → Voices → Korean if it is missing.
- Options: slow voice, start again. Progress is saved on the phone.

Play it at `/taekwondo/` on the same site, for example https://wosoldgit-maker.github.io/wau-game/taekwondo/

---

# BOP Desk

A study game in `cbop/index.html` for BNM's policy document *External Sector Statistics (ESS) System – Submission of International Transactions and External Position Information* (BNM/RH/PD 028-58, issued 22 June 2026, effective 1 September 2026). You play a new ESS Officer, and the cases are built around the fine distinctions in the rules, not just the headline facts.

- **🗂️ Career: 14 desks**: 180 cases covering Parts A–J. Every answer explains why and gives the paragraph reference. Cases marked 🪤 are built around common mistakes, for example:
  - FC between banks: the bank with the Resident reports. Ringgit between banks: the bank with the Non-resident raises the partial.
  - Same-bank FC deals are Khas, but same-bank ringgit deals are not.
  - When a Resident buys a Resident company's shares from a Non-resident, it is 35200 *liquidation*, with R1 being the company whose shares were sold.
  - Short-term workers do not go on Statement M.
  - The UBO RM1m threshold is per depositor, not per account.
  - FCP and NR-to-NR amendments need the HOR *and* an independent reviewer.
  - An AOO's dealing type is recorded from the AOO's side.
- **⚡ Month-End Rush**: 20 mixed cases, 25 seconds each, with streak bonuses. Three wrong or late answers count as BNM prompt letters, and the report becomes a "non-submission".
- **🎚️ Threshold Sorter**: 60 seconds of sorting tickets into Form P/R, BP/BR, Statement M or OP/OR, including the edge amounts (RM10,000.99 / RM10,001.00 / RM200,000.99 / RM200,001.00), 31- vs 32-day placements and FX between financial institutions.
- **📒 Reconcile E**: 5 randomly generated Statement E ledgers. Work out the closing balance the system expects, or the discrepancy, without counting the memorandum items.
- **🔁 Review mistakes**: every case you get wrong is saved, and leaves the list once you get it right.
- Stars and ranks (Trainee Clerk → Head of Reporting) and best scores are saved on the device.
- The cases are in `cbop/cases.js`, so you can edit or add cases without touching the game code.

For study only. The policy document is the authority.

Play it at `/cbop/` on the same site, for example https://wosoldgit-maker.github.io/wau-game/cbop/

---

# Jom Bola

A 3D football game in `bola/` for playing with friends over a link, in the style of a TV football match. Up to 11 people a side; computer players fill every empty place.

**Play:** press **Create game**, then send the link (or the 5-letter code) with **🔗 Invite**. Friends open the link and press **Join game**. Hold the phone sideways: the match is played in landscape.

**The match**
- 11 v 11 by default, on a full-size pitch with real formations (4-3-3). The host can switch to 7 or 5 a side and choose the match length (3, 5, 8 or 12 minutes) from the **☰** menu.
- Two halves, and the teams swap ends at half time. The clock counts 0' to 90'.
- Throw-ins, corners and goal kicks when the ball goes out; free kicks for a slide tackle that takes the player instead of the ball.
- The ball goes into the air: long passes are lofted, wingers cross, players head the ball, and shots rise. Hit one too hard and it can fly over the bar, or clip the post or bar.
- Keepers dive, catch and parry; a parried shot can give away a corner.

**Controls** (joystick on the left, buttons on the right)
- With the ball: **PASS** (tap = short pass, hold = longer; long ones are lofted), **SHOOT** (hold for power), **SPRINT**.
- Without the ball: **TACKLE** (close = standing tackle, a few metres away = slide), **SWITCH** to the player nearest the ball, **SPRINT**.
- Keyboard: arrows or WASD to move, Shift to sprint, J pass / tackle, K or Space shoot / switch.
- While you hold PASS, a ring and dashed line show who will get the ball; while you hold SHOOT, a line shows where it is aimed. Passing to a teammate gives you control of them. When a computer teammate wins the ball, you take control of them.

**On screen:** the player you control has a yellow ring and a marker with your name; friends' players show their names. The ball carrier has a ring in their team colour. A radar at the bottom shows every player, and the scoreboard at the top left shows the score and minute.

**Look and sound:** the TV camera sits high in the stand and follows the ball. The stadium has floodlights, a crowd, advertising boards for the other games on this site, and goals with nets. Players run, kick, slide, dive and head the ball. The crowd murmurs, swells on chances and roars for goals; the referee blows for kick-offs, restarts, half time and full time.

**How it works:** there is no game server. The host's browser runs the match and sends it to everyone over WebRTC (PeerJS; the PeerJS server only helps browsers find each other). Players who join see their own player move instantly and are kept in line with the host. The 3D is drawn with three.js. Both libraries are copied into `bola/` (`three.min.js`, `peerjs.min.js`) so the game doesn't depend on a CDN. The code is in `bola/game.js`.

- **The host must keep the game open on screen.** If the host closes it or switches apps, the game stops for everyone.
- Players who don't send anything for 6 seconds (for example, a locked phone) are removed and can open the link again to rejoin.
- Some strict school or office networks block WebRTC, and then a player can't join.

Play it at `/bola/` on the same site, for example https://wosoldgit-maker.github.io/wau-game/bola/
