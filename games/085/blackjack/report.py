"""Plain-text reports for simulations, replays and opening-hand studies."""

from decimal import Decimal, localcontext
from fractions import Fraction

from .analysis import OpeningAnalysis, StandOdds
from .bankroll import BankrollStudy
from .engine import Outcome
from .simulation import RoundReplay, SimulationResult, UpcardStats
from .table import ACE, DEFAULT_RULES, Action, Cards, TableRules, score


def format_units(amount: int | float | Fraction, spec: str = ",") -> str:
    if isinstance(amount, Fraction):
        numerator = Decimal(amount.numerator)
        with localcontext() as context:
            # Preserve every whole unit and a trailing half when formatting large bankrolls.
            context.prec = max(context.prec, numerator.adjusted() + 2)
            number = format(numerator / amount.denominator, spec)
    else:
        number = format(amount, spec)
    unit = "unit" if abs(amount) == 1 else "units"
    return f"{number} {unit}"


def format_rules(rules: TableRules) -> str:
    soft_17 = "hits" if rules.hit_soft_17 else "stands on"
    das = "allowed" if rules.double_after_split else "disabled"
    text = f"dealer {soft_17} soft 17, double after split {das}"
    return text + ", late surrender allowed" if rules.late_surrender else text


def _table(header: tuple[str, ...], rows: list[tuple[str, ...]]) -> str:
    widths = [max(map(len, column)) for column in zip(header, *rows, strict=True)]
    return "\n".join(
        "  ".join(
            cell.ljust(widths[i]) if i == 0 else cell.rjust(widths[i])
            for i, cell in enumerate(row)
        )
        for row in (header, *rows)
    )


def _upcard_table(groups: dict[int, UpcardStats]) -> str:
    rows = []
    for rank, group in groups.items():
        tally = group.rounds
        roi = f"{group.net_units / group.units_wagered:+.2%}" if group.units_wagered else "n/a"
        rows.append((
            format_rank(rank), f"{tally.total:,}", f"{tally.wins:,}", f"{tally.losses:,}",
            f"{tally.ties:,}", f"{tally.win_rate:.2%}" if tally.total else "n/a",
            f"{group.units_wagered:,}", f"{group.net_units:+,.1f}", roi,
        ))
    return _table(("Upcard", "Rounds", "Won", "Lost", "Even", "Win rate", "Wagered", "Net", "Net/wager"), rows)


def format_report(result: SimulationResult) -> str:
    rounds, hands = result.rounds, result.hands
    round_rate = f"{rounds.win_rate:.2%}" if rounds.total else "n/a"
    hand_rate = f"{hands.win_rate:.2%}" if hands.total else "n/a"
    roi = result.return_on_wager
    wager_rate = f"{roi:+.2%}" if roi is not None else "n/a"
    lines = [
        f"Study Break Blackjack  |  seed {result.seed}",
        f"Rounds  {rounds.total:,}  ({rounds.wins:,} won, {rounds.losses:,} lost, {rounds.ties:,} even)",
        f"Hands   {hands.total:,}  ({hands.wins:,} won, {hands.losses:,} lost, {hands.ties:,} pushed)",
        f"Round win rate       {round_rate}",
        f"Hand win rate        {hand_rate}",
        f"Paid blackjacks      {result.paid_blackjacks:,}",
        f"Total wagered        {format_units(result.units_wagered)}",
        f"Net profit           {format_units(result.net_units, '+,.1f')}",
        f"Net / total wagered  {wager_rate}",
    ]
    if result.rules.late_surrender or result.surrenders:
        lines.append(f"Surrenders           {result.surrenders:,}")
    if result.rules != DEFAULT_RULES:
        lines.append(f"Table rules          {format_rules(result.rules)}")
    balance = result.ending_bankroll
    if result.starting_bankroll is not None and balance is not None:
        lines.extend((
            f"Starting bankroll    {format_units(result.starting_bankroll)}",
            f"Ending bankroll      {format_units(balance)}",
            f"Maximum drawdown     {format_units(result.max_drawdown, ',.1f')}",
        ))
        if result.requested_rounds is not None and rounds.total < result.requested_rounds:
            lines.append(
                f"Session stopped      {rounds.total:,} of {result.requested_rounds:,} rounds dealt"
                " (less than one unit left)"
            )
    if result.by_upcard is not None:
        lines.extend(("", "Rounds by dealer upcard", _upcard_table(result.by_upcard)))
    return "\n".join(lines)


def format_rank(card: int) -> str:
    return "A" if card == ACE else str(card)


def format_hand(cards: Cards) -> str:
    total, soft = score(cards)
    value = f"soft {total}" if soft else str(total)
    if total > 21:
        value = f"{total}, bust"
    return f"[{' '.join(map(format_rank, cards))}] ({value})"


def format_analysis(analysis: OpeningAnalysis) -> str:
    lines = [
        f"Study Break Blackjack  |  seed {analysis.seed}",
        f"Opening              {format_hand(analysis.cards)} against dealer {format_rank(analysis.upcard)}",
        f"Trials per move      {analysis.trials:,} with dealer blackjack ruled out",
        f"Table rules          {format_rules(analysis.rules)}",
        f"Basic strategy       {analysis.chart_action.value}",
    ]
    if analysis.bankroll is not None:
        lines.append(f"Bankroll per trial   {format_units(analysis.bankroll)}")
    rows = []
    for action, move in analysis.moves.items():
        tally = move.rounds
        error = move.paired_standard_error
        rows.append((
            action.value, f"{tally.wins:,}", f"{tally.losses:,}", f"{tally.ties:,}",
            f"{tally.win_rate:.2%}", f"{move.mean_net:+.4f}", f"{move.mean_difference:+.4f}",
            f"{error:.4f}" if error is not None else "n/a",
        ))
    header = ("First move", "Won", "Lost", "Even", "Win rate", "Net/round", "Vs chart", "Paired SE")
    lines.extend(("", _table(header, rows)))
    return "\n".join(lines)


def format_replay(replay: RoundReplay) -> str:
    result = replay.result
    opening = replay.decisions[0].cards if replay.decisions else result.hands[0].cards[:2]
    lines = [
        f"Round {replay.number:,} replay",
        f"Opening              {format_hand(opening)} against dealer {format_rank(result.dealer[0])}",
    ]
    if replay.bankroll_before is not None:
        lines.append(f"Bankroll at deal     {format_units(replay.bankroll_before)}")
    for choice in replay.decisions:
        legal = ", ".join(move.value for move in Action if move in choice.legal_actions)
        lines.append(
            f"  Hand {choice.hand_number}  {format_hand(choice.cards)} -> {choice.action.value}"
            f"  (legal moves {legal})"
        )
    if not replay.decisions:
        lines.append("  An opening blackjack settled the round.")
    elif result.hands[0].outcome is Outcome.SURRENDER:
        lines.append("  Surrender returned half the opening stake.")
    elif all(score(hand.cards).total > 21 for hand in result.hands):
        lines.append("  All player hands busted before the dealer played.")
    for index in range(2, len(result.dealer)):
        lines.append(f"  Dealer  {format_hand(result.dealer[:index])} -> hit {format_rank(result.dealer[index])}")
    lines.append(f"Dealer               {format_hand(result.dealer)}")
    for number, hand in enumerate(result.hands, start=1):
        lines.append(
            f"Hand {number}               {format_hand(hand.cards)}  {hand.outcome.name.lower()},"
            f" wager {hand.wager}, net {hand.net_units:+g}"
        )
    lines.append(f"Round net            {format_units(result.net_units, '+g')}")
    return "\n".join(lines)


def format_odds(odds: StandOdds) -> str:
    rule = "hits" if odds.rules.hit_soft_17 else "stands on"
    rows = [(str(total), f"{float(p):.3%}") for total, p in odds.dealer_totals.items()]
    rows.append(("Bust", f"{float(odds.dealer_bust):.3%}"))
    return "\n".join((
        f"Exact stand odds  |  {format_hand(odds.cards)} against dealer {format_rank(odds.upcard)}",
        f"Six decks, dealer {rule} soft 17",
        f"Dealer blackjack before peek    {float(odds.blackjack_before_peek):.3%}",
        "", "After dealer blackjack is ruled out",
        _table(("Dealer finish", "Probability"), rows),
        "",
        f"Stand win / push / loss    {float(odds.win):.3%} / {float(odds.push):.3%} / {float(odds.loss):.3%}",
        f"Stand net per unit         {float(odds.expected_net):+.5f}",
    ))


def format_bankroll_study(study: BankrollStudy) -> str:
    outcomes = study.outcomes
    return "\n".join((
        f"Bankroll study  |  seed {study.seed}",
        f"Sessions             {outcomes.total:,}",
        f"Rounds per session   {study.rounds_per_session:,} maximum",
        f"Starting bankroll    {format_units(study.starting_bankroll)} per session",
        f"Table rules          {format_rules(study.rules)}",
        f"Rounds dealt         {study.rounds_dealt:,}",
        f"Session finishes     {outcomes.wins:,} ahead, {outcomes.losses:,} behind, {outcomes.ties:,} even",
        f"Finished ahead       {outcomes.win_rate:.2%}",
        f"Stopped early        {study.stopped_early:,} of {outcomes.total:,}",
        f"Ended below 1 unit   {study.depleted:,} of {outcomes.total:,} ({study.depleted / outcomes.total:.2%})",
        "",
        _table(("Percentile", "Ending balance"), [
            (f"P{p}", format_units(study.percentile(p))) for p in (10, 50, 90)
        ]),
        f"Lowest finish        {format_units(study.ending_balances[0])}  |  session seed {study.lowest_seed}",
    ))
