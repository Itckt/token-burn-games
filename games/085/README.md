# Study Break Blackjack

Run a basic-strategy bot against a six-deck dealer. Each round starts with a one-unit bet. The simulator tracks individual hands, whole rounds and net profit, so you can see the effect of splits, doubles and blackjack payouts.

## Run a simulation

Run these commands from the project folder with Python 3.11. The project uses only the standard library.

For a quick run between HKBU lectures in Kowloon Tong, try 20 rounds. Share seed `852` with your 3v3 crew and everyone can replay the same deals over milk tea.

```sh
python -m blackjack --rounds 20 --seed 852
```

```text
Study Break Blackjack  |  seed 852
Rounds  20  (8 won, 11 lost, 1 even)
Hands   21  (8 won, 12 lost, 1 pushed)
Round win rate       40.00%
Hand win rate        38.10%
Paid blackjacks      1
Total wagered        22 units
Net profit           -2.5 units
Net / total wagered  -11.36%
```

`python -m blackjack` plays 10,000 rounds and prints a generated seed. `--rounds` accepts any positive integer. Reuse the seed and round count with the same code and Python version to reproduce a run. `python -m blackjack --help` lists the options.

## Read the results

**Round win rate** is the fraction of all rounds that finish ahead after adding the payouts from every hand. If one split hand wins a unit and the other loses a unit, the round breaks even. Doubling the winning hand turns that result into a one-unit profit.

**Hand win rate** counts each split hand separately. The denominator includes wins, losses and pushes. A paid blackjack counts as one win. Two opening blackjacks push.

**Net profit** includes every gain and loss. A winning one-unit natural adds 1.5 units. **Net / total wagered** divides profit by all stakes, including extra units committed to splits and doubles. The rates in the example describe those 20 rounds and will vary across seeds.

## Default table rules

| At the table | How the engine plays |
| --- | --- |
| Shoe | Six standard decks, shuffled together and dealt without replacement. With 78 or fewer cards left, the next round starts with a fresh shuffled shoe. |
| Deal | Deal to the player, dealer, player, dealer. The first dealer card is visible. The dealer checks for blackjack with an ace or ten showing before the player acts. |
| Scoring | Count every ace as one, then count one ace as eleven if the total stays at or below 21. Face cards count as ten. The dealer hits through 16 and stands on every 17, including soft 17. |
| Settlement | An opening ace and ten pay 3:2 against a dealer without blackjack. Other wins pay 1:1. Equal live totals push. A busted hand loses immediately. |
| Double | Double the stake on any initial two cards, including after a non-ace split. Draw exactly one more card. |
| Split | Split equal-value cards for a second stake. Finish the left hand before dealing to the right. Repeated splits can produce up to four hands. Split aces receive one card each, even if another ace arrives. A winning 21 after a split pays even money. |
| Options | The table plays without insurance, surrender or side bets. |

The bot checks pairs first, then uses the soft or hard total against the dealer's upcard. A soft hand has an ace currently counted as eleven. For example, ace-seven doubles against a dealer six. A three-card soft 18 stands against that six because doubling requires two cards.

## Use the engine in Python

Keep one `Shoe` across calls to deal successive rounds. Cards use `1` for an ace and `10` for any ten-valued rank.

```python
from random import Random

from blackjack.engine import Shoe, play_round
from blackjack.strategy import basic_strategy

shoe = Shoe(Random(852))
result = play_round(shoe, basic_strategy)
print("Dealer", result.dealer)
for hand in result.hands:
    print(hand.cards, hand.outcome.name, hand.net_units)
```

A custom strategy receives `(cards, upcard, legal_actions)` and returns an `Action` from the supplied set. To compare strategies in bulk, call `simulate(rounds, seed, strategy)` from `blackjack.simulation`. It accumulates results as it plays, so memory use stays bounded as the round count grows.

## Run the tests

```sh
python -m unittest discover -v
```

The suite checks each strategy chart against all ten dealer upcards, enumerates ace valuations and deals scripted rounds to verify draw order, action limits and payouts. Seeded runs check the win-rate arithmetic, reshuffles and command-line replay.

## Round 2

### Choose the table rules

With `--hit-soft-17`, the dealer draws on soft 17 and stands on hard 17. The bot uses the matching six-deck chart. For example, it doubles ace-eight against a six when it can and stands when it cannot.

With `--no-double-after-split`, doubling is available only on the opening hand. The bot also adjusts which pairs to split. For example, it hits a pair of fours against six. The two rule switches work independently.

### Play with a bankroll

`--bankroll 12.5` starts a session with 12½ units. Each round opens with a one-unit stake. A split or double needs another whole unit available, and every stake stays committed until the round settles. When less than one unit remains, the session ends. The report gives the ending balance and maximum drawdown. Drawdown measures the largest drop from a previous balance, counting the starting balance and each round's settlement. A session with zero deals shows `n/a` for its rates.

### Replay a round

For a deck review on the MTR home from Kowloon Tong, give your 3v3 crew round 12 and see who spots the break-even split first.

```sh
python -m blackjack --rounds 20 --seed 852 --hit-soft-17 --no-double-after-split --bankroll 12.5 --replay 12
```

Round 12 opens with 7.5 units and a pair of twos against a six. The dealer draws a ten on soft 17 and finishes on hard 17. The left hand loses on 12 and the right wins on soft 19. After all 20 rounds the balance is 13 units, with a maximum drawdown of 5.

`--replay` takes a round number starting at one. It shows the cards, legal moves and chosen action at each decision, followed by the dealer's draws, hand payouts and round net. Earlier rounds use the same shoe and bankroll as usual. Only the selected round's decisions are kept. Reuse the seed, rules, starting balance and round count to repeat a session. Both the CLI and Python now require integer seeds when you supply one.

```python
from blackjack.simulation import simulate
from blackjack.table import TableRules

rules = TableRules(hit_soft_17=True, double_after_split=False)
session = simulate(20, seed=852, rules=rules, bankroll=12.5, replay_round=12)
print(session.ending_bankroll, session.replay.result.net_units)  # 13 0
```

If the session stops before the selected deal, `session.replay` is `None`. For a single deal, `play_round` also accepts `rules`, a whole-unit `wager_limit`, and an `on_decision` callback. Omitting the strategy uses the basic-strategy bot for the selected rules.

## Round 3

### Compare opening moves

Over lunch in Kowloon Tong, let each member of your 3v3 team call a move for eights against a ten. Then try every legal choice on the same 2,000 deals.

```sh
python -m blackjack --analyze 8 8 10 --late-surrender --rounds 2000 --seed 852
```

`--analyze` takes two player cards and the dealer upcard. Use `A` or `1` for an ace and `10`, `J`, `Q` or `K` for a ten. Each trial starts with a fresh six-deck shoe, removes the visible cards, and samples a hole card consistent with the dealer having cleared the blackjack check. Each opening move gets the same hole card and remaining draw order. The basic-strategy bot plays all subsequent decisions. With `--bankroll`, each branch starts each trial with the specified balance.

**Net/round** is the average profit per opening unit, including all split and double stakes. **Vs chart** is the average difference from the bot's opening move on those same deals. **Paired SE** is the standard error of that difference, in units per round. It takes at least two trials to estimate. In the example, splitting averaged −0.491 units and surrender lost exactly half a unit each time. The measured gap of 0.009 units was smaller than its standard error of 0.0414.

### Play with late surrender

`--late-surrender` lets the player give up the original two-card hand after the dealer checks for blackjack. Half the stake comes back immediately and the dealer draws no more cards. The report counts one unit wagered, a half-unit loss and one surrender. The move is available even with just one unit at the table.

The bot surrenders hard 15 against ten and hard 16 against nine, ten or ace. It prefers to split eights when it can. Against an ace at a hit-soft-17 table, it surrenders hard 15 through 17, including paired eights.

### See results by dealer upcard

```sh
python -m blackjack --rounds 100 --seed 852 --late-surrender --by-upcard --replay 42
```

`--by-upcard` groups settled rounds by the dealer's visible rank. A split counts as one round in its row, with every stake and payout included. The win rate uses all rounds in the row, and **Net/wager** divides its profit by its total stakes. A rank with zero deals shows `n/a` for both rates. In this session, round 42 shows a hard 16 surrendering against nine.

```python
from blackjack.analysis import analyze_opening
from blackjack.simulation import simulate
from blackjack.table import Action, TableRules

rules = TableRules(late_surrender=True)
study = analyze_opening((8, 8), 10, trials=2000, seed=852, rules=rules)
print(study.moves[Action.SPLIT].mean_net)  # -0.491
session = simulate(100, seed=852, rules=rules, by_upcard=True)
print(session.surrenders, session.by_upcard[9].rounds.total)  # 4 surrenders, rounds facing nine
```

### Calculate exact odds for standing

```sh
python -m blackjack --odds 10 8 A --hit-soft-17
```

With a ten and an eight facing an ace, 95 of the 309 unseen cards give the dealer blackjack. That is a 30.744% chance **before the peek**. Once the dealer clears the check, standing on 18 wins 28.422%, pushes 20.819% and loses 50.759% at this table. Its expected net is −0.22338 units per opening unit.

`--odds` removes the three visible cards from a fresh six-deck shoe and counts every possible dealer finish without replacement. The table lists 17 through 21 and bust. Of the table switches, only `--hit-soft-17` changes these probabilities. A player natural settles before a stand decision. In Python, `stand_odds(cards, upcard, rules=...)` in `blackjack.analysis` returns the probabilities and expected net as exact fractions.

### Practise the opening decision

```sh
python -m blackjack --practice pairs --rounds 3 --seed 852 --late-surrender
```

Pass the keyboard around the HKBU canteen table, one opening call per teammate. This seed starts with two aces against a nine. Type a listed move to see how it compares with the chart. Use `q` to finish early. The score counts answered questions, and an unavailable move gives you another try.

Choose `hard`, `soft`, `pairs` or the default `mixed`. Each pass covers every distinct pair of player ranks in the group against all ten upcards, in shuffled order. Pairs of aces belong to the pairs group. The mixed deck has 540 positions. The drill defaults to ten questions. All table switches apply, and `--bankroll` sets the funds available afresh for each opening. For a noninteractive drill, `blackjack.practice.practice_questions` yields the cards, upcard, legal moves and chart answer.

### Measure how long a bankroll lasts

```sh
python -m blackjack --sessions 120 --rounds 40 --bankroll 12.5 --seed 852
```

Each session starts with its own shuffle seed and the full 12.5 units. In this run, 59 sessions finished ahead, 55 behind and six even. Fourteen stopped before the 40th deal. One more finished the final deal with less than a unit, bringing the total unable to fund another round to 15 of 120.

The 10th, 50th and 90th percentile ending balances were 0.5, 12.5 and 24.5 units. Each percentile uses the nearest rank in the sorted balances, including early stops. The report prints the first session seed that reached the lowest ending balance. Reuse that seed with the same balance, round count and rules to inspect an individual deal.

```sh
python -m blackjack --rounds 40 --bankroll 12.5 --seed 14466268189425422891 --replay 26
```

Python callers can use `blackjack.bankroll.simulate_sessions(120, 40, seed=852, bankroll=12.5)`. The study retains one ending balance per session. Its `depleted` count includes final-deal losses, and `stopped_early` counts sessions that fell short of the requested round count.

The engine now checks table rules, strategies and decision callbacks before dealing, including on opening blackjacks. Sessions starting below one unit skip the shuffle. The tests check exact odds against every physical card order of a small shoe and replay individual sessions to verify the bankroll statistics.
