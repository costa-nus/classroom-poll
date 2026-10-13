# Class poll

A small number poll for lectures. Students type a number on their phone; the
instructor sees the distribution live. Static site on GitHub Pages, data in
Supabase.

- Students: <https://costa-nus.github.io/classroom-poll/>
- Instructor: <https://costa-nus.github.io/classroom-poll/admin.html>

## Running a poll

1. Open the instructor page and sign in with the instructor key.
2. The first time, type the student key under **Student link** and click
   **Save**. It is kept in this browser only and goes into the QR code.
3. Under **New poll**, write the question, set the lowest and highest allowed
   answer, a unit, and whether answers must be whole numbers. Click
   **Create and open**. Opening a poll closes any other open poll.
4. Click **Present full screen**. The screen shows the question, a QR code, the
   class key and the number of answers. The distribution stays hidden until you
   click **Show distribution**, so early answers do not steer later ones.
5. Click **Close poll** to stop answers. The results stay; you can reopen it.

Students scan the QR code (the key is in the link) or open the student page and
type the key. Each browser has one answer per poll; submitting again replaces it.

## What is stored

Per poll: the question, the range, the unit, open or closed. Per answer: the
number, a random browser ID and a timestamp. No names, no accounts, no IP
addresses in the tables. **Delete** on the instructor page removes a poll and
all its answers.

## Security model

The publishable API key in `assets/config.js` is public by design. It does not
protect the data; the database does.

- The tables are in a `private` schema that the Supabase Data API does not
  expose. Row level security is on with no policies, and all table grants to
  `anon` and `authenticated` are revoked.
- A browser can only call nine `SECURITY DEFINER` functions
  (`supabase/schema.sql`). Each one checks the key it is given against a
  bcrypt hash before it does anything. The student key can read the open
  poll and submit; only the instructor key can create, open, close, delete,
  read results or change keys.
- Only the hashes are stored. The keys are not in this repository.
- The key in the QR link is in the URL fragment (`#k=…`), which browsers do not
  send to GitHub or Supabase. The student page removes it from the address bar.
- Answers must be inside the poll's range, and a poll takes at most 1,000
  answers.

The Supabase security advisor reports these functions as "callable without
signing in" and the tables as "RLS enabled, no policy". Both are intended.

## Changing a key

Instructor page → **Change a key**. The old key stops working at once. The
student key needs at least 4 characters, the instructor key at least 12.

## Free-tier pause

The Supabase project is on the free plan, which pauses after about a week
without traffic. A paused project shows "The poll server is paused". Resume it
from the Supabase dashboard (project `classroom-poll`) a few minutes before
class.

## Files

```
index.html          student page
admin.html          instructor page
assets/config.js    Supabase URL and publishable key
assets/api.js       RPC calls, storage, number formatting
assets/stats.js     summary statistics and histogram bins
assets/histogram.js SVG histogram
assets/student.js   student page logic
assets/admin.js     instructor page logic
assets/style.css    styles, light and dark
supabase/schema.sql database schema and functions (no keys)
```

No build step. To run locally: `python3 -m http.server 8770`, then open
<http://localhost:8770/>. The local copy talks to the same Supabase project.
