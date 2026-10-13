# Class poll

A small poll for lectures, with three poll types:

- **Number** — students type a number; the instructor sees the distribution.
- **Rating** — students rate three items from 0 to 10, one at a time.
- **Ranking** — students pick the better item in each of three pairs.

Rating and ranking polls on the same three items can be compared. Static site on GitHub Pages, data in
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

## Rating vs ranking

1. **New poll** → type **Rating**. Write the question and the three items A, B,
   C. Keep **Also create a ranking poll…** ticked: this makes the matching
   ranking poll (closed) at the same time. Click **Create and open**.
2. Students see the three items one at a time, in a random order per student,
   and rate each from 0 to 10. The three ratings must all differ (a rating used
   for one item is greyed out for the others), so every student gives a strict
   order.
3. Close the rating poll. Open the ranking poll from the list.
4. Students see the pairs A–B, A–C, B–C in a random order per student, each
   with random left/right sides, and pick the better item in each pair.
5. Close it. Under **Compare a rating poll with a ranking poll**, pick the two
   polls (the ranking poll with the same items is picked for you) and click
   **Compare**, then **Present full screen**.

### Full-screen views for rating and ranking polls

**Present full screen** starts with the question, QR code and answer count.
The buttons under it choose what the class sees:

| Button | Shows | Poll type |
|---|---|---|
| **Show averages** | the mean rating of each item, except items unticked under *Averages view shows* in the results view (saved with the poll) | rating |
| **Show agreement** | the share who gave the most popular order; the order itself is under blurred glass | rating, ranking |
| **Reveal order** (or click the glass) | the most popular order | rating |
| **Show top two orders** (or click the glass) | the two most popular orders with their shares | ranking |
| **Show all results** | the share of every order | all |
| **Hide results** | back to the answer count | all |

## Mock run

**Mock run** (top of the instructor page) reloads the page in practice mode
(`admin.html?mock=1`). It copies your polls — questions, items, settings, no
answers — into this browser. Every button works as in class, but nothing is
sent online and the real polls do not change. Extra buttons:

- **Add 10 simulated answers to the open poll** / **Add 1** — simulated
  students with some disagreement, so the views have data.
- **Open student view (new tab)** — answer the open mock poll yourself
  (`?mock=1`, same browser only; a phone scanning the mock QR code sees an
  empty mock).
- **Start over** — clear mock answers and close all mock polls.
- **Exit mock run** — back to the real page.

Each student's answers give one order of A, B, C, best first. A rating gives it
by sorting the three ratings. A ranking gives it by counting pair wins (2, 1, 0);
when each item wins once (A > B, B > C, C > A) there is no order, and the answer
counts as a **cycle**. Per poll the page shows the most popular order and the
share of students who gave exactly that order. The share is out of everyone who
answered, so cycles count as not agreeing. The comparison shows both shares, the
most popular order of each poll, whether they match, and the share of every
order side by side.

## What is stored

Per poll: the type, the question, the range and unit (number polls) or the
three items (rating and ranking polls), open or closed. Per answer: the number,
or the three ratings or pair choices with the order they were shown in, plus a
random browser ID and a timestamp. No names, no accounts, no IP
addresses in the tables. **Delete** on the instructor page removes a poll and
all its answers.

## Security model

The publishable API key in `assets/config.js` is public by design. It does not
protect the data; the database does.

- The tables are in a `private` schema that the Supabase Data API does not
  expose. Row level security is on with no policies, and all table grants to
  `anon` and `authenticated` are revoked.
- A browser can only call eleven `SECURITY DEFINER` functions
  (`supabase/001_init.sql` to `supabase/003_hidden_items.sql`). Each one checks the key it is given against a
  bcrypt hash before it does anything. The student key can read the open
  poll and submit; only the instructor key can create, open, close, delete,
  read results or change keys.
- Only the hashes are stored. The keys are not in this repository.
- The key in the QR link is in the URL fragment (`#k=…`), which browsers do not
  send to GitHub or Supabase. The student page removes it from the address bar.
- Answers must be inside the poll's range (ratings: whole numbers 0–10, all
  different; ranking: one item of each pair), and a poll takes at most 1,000
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
assets/stats.js     summary statistics, histogram bins, orders from ratings and rankings
assets/histogram.js SVG histogram and order-share chart
assets/student.js   student page logic
assets/admin.js     instructor page logic
assets/mock.js      mock run: the RPC functions in the browser, simulated students
assets/style.css    styles, light and dark
supabase/*.sql      database schema and functions, in order (no keys)
```

No build step. To run locally: `python3 -m http.server 8770`, then open
<http://localhost:8770/>. The local copy talks to the same Supabase project.
