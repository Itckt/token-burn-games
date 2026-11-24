# Friday, Filed

A single-player freelance job board game for the terminal. Three clients post briefs each morning. Pick what fits on your desk, decide whose paperwork to trust, and get paid before the week runs out. One commission might send you editing an HKBU sound walk in Kowloon Tong. Another needs a pocket score slip that six arena players can actually write on.

**Win by Friday at 17:00** with at least **HK$1,200** in paid fees, a public rating of **4.5/5** or higher, and **one confirmed scam report**. The clock advances when you act. Take as long as you like to read a brief or plan your day.

## Play

From this folder, run the game with Python 3.11. It uses only the standard library and runs entirely offline.

```console
python play.py
```

The opening board shows each job's ID, fee, workload and deadline. Type `brief 01` to read the first job or `help` for the desk guide. `board` brings back the schedule at any point. A fresh game draws a new week, and its printed seed lets you replay the same notices and client files.

### Try a first commission

Start a repeatable week with this command.

```console
python play.py --seed 42
```

Then enter these commands one line at a time at the game prompt.

```text
brief 03
check 03 funds
check 03 terms
take 03
work 03
polish 03
journal
```

The pocket arena score slip takes one block to lay out. A second block buys a final proof. At Mon 13:00, Quiet Valve has paid HK$210 and left a five-star review. Two work blocks remain that day.

## How the desk works

**Time and deadlines.** Monday through Friday each have four two-hour blocks, from 09:00 to 17:00. Keep up to two contracts at once. An unclaimed notice leaves at its deadline or that day's close, whichever comes first, unless you use an overnight hold. Booked jobs stay on your desk across days until their printed deadline. The desk warns if the combined workload exceeds the time available.

**Handoffs and reviews.** Each `work` finishes one step in the brief. A ready draft can ship immediately for four stars or take one more block of polish for five. A draft that becomes ready exactly at its deadline ships automatically, as does any ready draft still waiting at its cutoff. An unfinished genuine booking earns one star and no fee. Two or more public reviews averaging at least 4.5 unlock a HK$60 referral bonus on new bookings. Taking a job locks its quoted fee.

**Client checks.** You have two fresh checks per day. The funds slip tells you who is paying and what is actually funded. The terms slip tells you what the client gets and how payment is released. Compare the slips with the advertised promise. A first-time client or a rush deadline can be perfectly genuine. Evidence you opened stays readable for the life of that notice or contract.

**Reporting.** Cite the specific slip that demonstrates a broken promise. Filing uses one work block. A confirmed case pulls the job and frees its slot if you already booked it. An unsupported citation spends the block and leaves the job open until its normal cutoff. Completing a scam job costs the time you spent, pays zero and produces no public review. The week journal records the reason.

| Command | Effect | Cost |
| --- | --- | --- |
| `board`, `brief ID`, `journal`, `help` | Read the schedule, a notice, your record, or the desk guide | Free |
| `check ID funds`, `check ID terms` | Open a payment or agreement slip | One daily check on the first read |
| `take ID` | Book the job at its current fee | One desk slot |
| `work ID` | Complete the next production step | One block |
| `deliver ID` | Send a ready draft | Free |
| `polish ID` | Give a ready draft a final pass and send it | One block |
| `report ID funds`, `report ID terms` | File a case citing a slip you have read | One block |
| `wait`, `end` | Pass one block or the rest of the current day | Time passed |
| `save`, `quit` | Save your place or leave the desk | Free |

## Save and resume

Type `save` to replace the single local save slot, `friday-filed.save.json`, beside `play.py`. Type `quit` to leave. Saving is manual. To pick up at the same block with the same active jobs and evidence, run this command.

```console
python play.py --resume
```

## Run the tests

From the project folder, run the standard-library test suite.

```console
python -m unittest discover -s tests -v
```

The suite exercises clock and deadline boundaries, concurrent bookings, payment and review rules, evidence checks, reporting, save recovery and seeded board generation. It also plays winning and losing weeks through the real terminal entry point. Save-file tests use temporary folders inside the project.

## Round 2

| Command | What it changes at the desk |
| --- | --- |
| `plan`, `plan ID` | See the work and handoff commands for your bookings in deadline order. Add an open notice's ID to try it alongside your current work. The preview is free, uses each available template at most once, and shows the first cutoff you would miss if the jobs clash. |
| `portfolio`, `reuse ID` | A polished, paid handoff earns a template in its field. Keep one each for Audio, Copy, Data and Design. Spend a matching template on a booked job with at least two unfinished steps to finish both in one block. That can make a last-minute booking feasible. |
| `extend ID` | Once per week, trade HK$40 of a booked fee per extra block for up to two more blocks. Read the exact offer in `brief ID` before signing. The amendment takes effect immediately, and Friday at 17:00 is the latest possible handoff. |
| `audit ID` | Spend one work block to open every missing slip on a notice or booking. You keep your daily checks and still choose which slip to cite. The file must stay open after the audit block so you can use the evidence. |

### Put the score-slip grid to work

After the first commission in the seed 42 walkthrough, Quiet Valve's pocket score slip has earned you a Design template. Try it on Tuesday's clay glaze reference.

```text
end
portfolio
plan 04
take 04
brief 04
extend 04
audit 06
reuse 04
```

At Tue 13:00, one glaze step remains. Your revised booking pays HK$410 and is due Wed 11:00. Both slips for job 06 are on file. There's time to file a case, finish the glaze reference and polish it by handoff.

Existing saves replay in the same slot, including templates earned from earlier five-star handoffs. The board and planner share one workload calculation, so a template promised to two jobs counts once. Clash warnings now respect the two available desk slots. Save loading also enforces the 64 KiB limit on disk bytes, including Windows line endings.

## Round 3

**Hold a notice overnight.** From Monday through Thursday, `hold ID` keeps one open notice on the board past closing. Pick a gig due on a later day. Its slips stay on file until its deadline or the next close, whichever comes first. A hold is free even with both desk slots full. The fee locks when you book. Signing uses that day's hold even if you take or report the job before closing.

**Hear from paying clients again.** A paid public handoff through Thursday earns a funded, two-step follow-up in the same field. Type `inbox` to see who's coming back. Their offer joins the board the next morning, starts at HK$300 plus any booking-time referral bonus, and is due at that day's close. Use its new ID with `brief`, `plan`, and `take`. Templates and extensions work on return briefs. Each public handoff earns at most one follow-up.

**Recover an unpaid invoice.** The `journal` keeps the locked fee and copies of any slips you opened before an unpaid handoff. Use `claim ID funds` or `claim ID terms` to cite one. Each filing takes a block. An unsupported citation uses that block and leaves the weekly payment available. A slip already ruled on stays ruled on. Once per week an upheld claim recovers half the locked fee, rounded down to whole dollars and capped at HK$150. The payment counts towards the cash target and the ruling counts as a confirmed report. The invoice carries no public review.

### Two Tuesday handoffs

Continue from Mon 13:00 after polishing Quiet Valve's pocket arena score slip in the seed 42 walkthrough.

```text
hold 02
inbox
end
take 02
work 02
work 02
plan 18
take 18
reuse 18
polish 18
```

The held oral history reel ships at Tue 13:00 for HK$340. Its review unlocks the referral rate just in time to book Quiet Valve's pocket-size reprint for HK$360. Reusing the score-slip grid leaves a block to polish the reprint. You open Wednesday with HK$910 and three client reviews.

Booked briefs now show the original step count and the planner's remaining blocks, including which job gets a shared template. A full desk still shows when an unbooked notice leaves, and last-block audit advice accounts for spent checks. Saves in the existing slot replay holds, return offers and claim rulings. The tests cover handoffs at closing versus the next opening, simultaneous deadlines, and filing in Friday's last block.
