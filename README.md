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

A football game in `bola/index.html` for 2 to 10 people, each on their own phone or computer. Anyone who has the link can play.

- Press **Create game**. You get a link and a 5-letter code. Send the link with **Copy link** or **Share…**.
- Friends open the link, type a name and press **Join game**. They can also type the code on the start screen.
- Players are put into Red and Blue teams in turn (up to 5 a side; anyone after that watches). Change team from the **☰** menu.
- It is always 5 against 5. Computer players fill every empty place: a goalkeeper, two defenders, a winger and a striker. When a friend joins, they take a computer player's place. With only two people it is still 5v5, each with 4 computer teammates. The host can turn computer players off in the **☰** menu.
- The match starts straight away. With computer players off, it waits until each team has at least one person, and goals don't count during the warm-up.
- Players are drawn from above as footballers in kit, with head, arms, legs and boots. They run with a stride, face where they are going and swing a leg when they kick. Keepers wear green (Red) or orange (Blue). People have their name under them and a yellow ring for you; computer players show their shirt number.
- After a goal, the team that let it in kicks off. The goal is credited to the player who shot it, or shown as an own goal.
- Controls work like a console football game:
  - **Run**: drag anywhere on the left half of the screen (arrow keys or WASD on a computer). All the buttons sit together in the bottom-right corner for your right thumb.
  - **PASS** (hold J or X): hold to fill the blue power bar, then let go. A short hold passes to a nearby teammate, a long hold to one further away, in the direction you are pointing. If that teammate is a computer player, you take control of them so you can carry on the move, and they step across to meet the ball.
  - **SHOOT** (hold Space or K): hold to fill the power bar, let go to shoot. Point roughly at the goal and the shot is aimed at the corner you lean towards. Full power can fly wide.
  - **⇄ Switch** (Q or L): take control of the teammate nearest the ball.
  - Without the ball, the buttons change: **TACKLE** is a slide tackle along the grass at the ball (miss it and you need a moment to get back up), and holding **PRESS** runs you at the ball for you.
- The game runs at a calmer pace (`PACE` in the code, 0.7 = 70% speed) so it is easier to control on a phone.
- The ball stays at your feet while you dribble and leaves from the kicking foot. Players swing their leg back while you charge a shot and through the ball when they kick. Keepers dive with their arms out, and an opponent who gets close can poke the ball away.
- Hold the phone upright or sideways. Upright, the pitch turns so Red attacks up the screen.
- Computer players only run on the host's phone, so they don't add lag for anyone.
- The host can set the match length (2, 3, 5 or 10 minutes) and restart the match from the **☰** menu.

How it works: there is no game server. The host's browser runs the match and sends it straight to each player's browser over WebRTC. The free PeerJS server only helps the browsers find each other. `bola/peerjs.min.js` is a copy of PeerJS 1.5.4, so the game doesn't depend on a CDN. This means:

- **The host must keep the game open on screen.** If the host closes the tab or switches to another app, the game stops or ends for everyone.
- Players who don't send anything for 6 seconds (for example, their phone locked) are removed. They can open the link again to rejoin.
- Some strict school or office networks block WebRTC, and then a player can't join.

Play it at `/bola/` on the same site, for example https://wosoldgit-maker.github.io/wau-game/bola/
