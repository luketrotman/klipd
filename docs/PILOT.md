# Running a pilot game, start to finish

1. **Add players** (`/admin/players`): paste `Name, email` lines from the booking. Players who sign in with that email are linked automatically.
2. **Create the game** (`/admin/matches/new`): title, kick-off, pitch, Vimeo video URL, and the roster (add `H` or `A` after the email to set the team).
3. **Analyse**: on the match page press **Run REAL pipeline**. The worker picks it up, runs detection and re-identification, and uploads results (about 45 to 55 minutes for a 40 minute game on an M1 Pro).
4. **Check** (`Train` on the match): open **Review AI calls** and press y, n, or p for each. Tag anything missed with Space. Answer "Who is this?" so identities are linked to real players. About 30 minutes per game while accuracy is being proven.
5. **Publish** (panel at the top of the Train page): **Publish and notify players**. Players get a push notification, and clip files are rendered (queued for the worker).
6. **Measure**: `python3 ai/evaluate.py --match <id>` gives precision and recall per event type from your reviews.

Players only ever see moments you approved or tagged yourself (Reviewed mode). Auto mode releases confident, unreviewed AI calls; use it only once the numbers justify it.
