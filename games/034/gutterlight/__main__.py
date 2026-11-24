"""Command-line entry point for Gutterlight Relay."""

import argparse
from pathlib import Path
import secrets
import sys

from .battle import Battle, DEFAULT_LIMIT, MAX_TICKS, Mode, Setup, Side, TICKS_PER_SECOND, check_seed
from .cards import DECKS, resolve_deck
from .cup import cup_table, run_cup
from .display import board, catalog, deck_sheet, event_line
from .draft import draft_decks, draft_offers, draft_receipt, draft_sheet
from .pilot import Pilot, finish
from .practice import practice_start, study_orders, study_table
from .recording import load, save
from .report import scouting_report
from .sessions import pick_draft, play_live, replay_board, watch
from .terminal import Terminal, interactive


def _deck_argument(value: str) -> tuple[str, ...]:
    try:
        return resolve_deck(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"invalid choice: {error}") from error


def _add_seed(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--seed", type=int, help="Seed for repeatable play (0 to 4294967295).")


def _add_match_options(parser: argparse.ArgumentParser) -> None:
    _add_seed(parser)
    parser.add_argument("--seconds", type=int, default=DEFAULT_LIMIT // TICKS_PER_SECOND,
                        help=f"Match clock, 1 to {MAX_TICKS // TICKS_PER_SECOND} seconds (default 90).")
    parser.add_argument("--mode", choices=[mode.value for mode in Mode], default=Mode.CLASSIC.value,
                        help="Fight for towers, beacon charge, or a cart delivery (default classic).")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gutterlight",
        description="Gutterlight Relay | A real-time, two-lane terminal card battler.",
    )
    commands = parser.add_subparsers(dest="command")
    deck_help = f"Choose {', '.join(DECKS)}, or eight comma-separated card keys."
    for name, help_text in (("play", "Command Amber against the Indigo pilot."),
                            ("simulate", "Run two pilots to the finish at full speed.")):
        match = commands.add_parser(name, help=help_text, description=help_text)
        match.add_argument("--save", type=Path, metavar="FILE", help="Write a JSON replay to FILE.")
        _add_match_options(match)
        match.add_argument("--deck", type=_deck_argument, metavar="DECK",
                           help=f"Amber deck (default awning). {deck_help}")
        match.add_argument("--opponent-deck", type=_deck_argument, metavar="DECK",
                           help=f"Indigo deck (default trestle). {deck_help}")
        if name == "play":
            match.add_argument("--draft", nargs="?", const=True, metavar="PICKS",
                               help="Pick from eight pairs before kickoff, or supply eight 1/2 digits.")
        else:
            match.add_argument("--draft", metavar="PICKS",
                               help="Split eight pairs using eight 1/2 digits. Preview them with 'draft'.")

    draft = commands.add_parser("draft", help="Inspect eight seeded card pairs and build both decks.")
    _add_seed(draft)
    draft.add_argument("--picks", metavar="PICKS", help="Show both deck lists for eight 1/2 digits.")

    practice = commands.add_parser("practice", help="Take over Amber at a beat from a saved replay.")
    practice.add_argument("file", type=Path, metavar="FILE")
    practice.add_argument("--tick", type=int, metavar="N",
                          help="Start after beat N. Defaults to the end of a partial tape "
                               "or the opening of a completed match.")
    practice.add_argument("--auto", action="store_true", help="Let both pilots play the continuation.")
    practice.add_argument("--save", type=Path, metavar="FILE", help="Write the practice replay to FILE.")

    study = commands.add_parser("study", help="Play out every legal next order from a replay beat.")
    study.add_argument("file", type=Path, metavar="FILE")
    study.add_argument("--tick", type=int, required=True, metavar="N", help="Study the order after beat N.")
    study.add_argument("--side", choices=[s.name.lower() for s in Side], default="amber",
                       help="Which hand to try (default amber).")
    study.add_argument("--save-pick", nargs=2, metavar=("PICK", "FILE"),
                       help="Save a complete branch. Use PASS or a slot and lane such as 2C.")

    cup = commands.add_parser("cup", help="Run a round-robin deck cup with both seats for every pair.")
    cup.add_argument("decks", nargs="*", type=_deck_argument, metavar="DECK",
                     help=f"Enter two or more decks. Defaults to all presets. {deck_help}")
    cup.add_argument("--rounds", type=int, default=1, help="Pairs of fixtures per matchup (default 1).")
    cup.add_argument("--save-game", nargs=2, metavar=("N", "FILE"),
                     help="Save fixture N as a replay. Fixture numbers start at 1.")
    _add_match_options(cup)

    replay = commands.add_parser("replay", help="Open a recorded match in the terminal viewer.")
    replay.add_argument("file", type=Path, metavar="FILE")
    view = replay.add_mutually_exclusive_group()
    view.add_argument("--tick", type=int, metavar="N", help="Print the board at beat N and exit.")
    view.add_argument("--events", action="store_true", help="Print the timestamped relay wire.")
    view.add_argument("--frames", action="store_true", help="Print every board in order.")
    view.add_argument("--highlights", action="store_true", help="List turning points with beat numbers.")
    replay.add_argument("--stats", action="store_true",
                        help="Print the scouting report through --tick N or the last recorded beat.")
    cards = commands.add_parser("cards", help="List the catalog or inspect an eight-card deck.")
    cards.add_argument("--deck", type=_deck_argument, metavar="DECK", help=deck_help)
    return parser


def _seed(value: int | None) -> int:
    seed = secrets.randbits(32) if value is None else value
    check_seed(seed)
    return seed


def _match_settings(args: argparse.Namespace) -> tuple[int, int, Mode]:
    if not 1 <= args.seconds <= MAX_TICKS // TICKS_PER_SECOND:
        raise ValueError(f"Choose a match length from 1 to {MAX_TICKS // TICKS_PER_SECOND} seconds.")
    return _seed(args.seed), args.seconds * TICKS_PER_SECOND, Mode(args.mode)


def _save_match(battle: Battle, path: Path) -> None:
    save(battle, path)
    print(f"Saved replay to {path}")


def _branch_destination(source: Path, destination: Path | None) -> None:
    if destination is not None and destination.resolve() == source.resolve():
        raise ValueError("Choose a different file to save the new replay.")


def _study(args: argparse.Namespace) -> None:
    pick, path = None, None
    if args.save_pick:
        pick, destination = args.save_pick
        path = Path(destination)
        _branch_destination(args.file, path)
    study = study_orders(load(args.file), args.tick, Side[args.side.upper()], keep_pick=pick)
    print(study_table(study))
    if path is not None:
        assert study.selected_game is not None
        _save_match(study.selected_game, path)


def _draft(args: argparse.Namespace) -> None:
    seed = _seed(args.seed)
    offers = draft_offers(seed)
    if args.picks is None:
        print(draft_sheet(seed, offers))
    else:
        print(draft_receipt(seed, args.picks, draft_decks(offers, args.picks)))


def _cup(args: argparse.Namespace) -> None:
    seed, limit, mode = _match_settings(args)
    keep = None
    if args.save_game:
        try:
            keep = int(args.save_game[0])
        except ValueError as error:
            raise ValueError("Fixture number must be an integer.") from error
    cup = run_cup(args.decks or tuple(DECKS), seed, limit_ticks=limit,
                  mode=mode, rounds=args.rounds, keep_game=keep)
    print(cup_table(cup))
    if cup.selected_game is not None:
        _save_match(cup.selected_game, Path(args.save_game[1]))


def _new_match(args: argparse.Namespace) -> Battle | None:
    seed, limit, mode = _match_settings(args)
    if args.draft is None:
        decks = (args.deck or "awning", args.opponent_deck or "trestle")
    else:
        if args.deck is not None or args.opponent_deck is not None:
            raise ValueError("--draft builds both decks. Choose either the draft or named decks.")
        offers = draft_offers(seed)
        picks = args.draft
        if picks is True:
            if not interactive():
                raise ValueError("Live drafting needs an interactive terminal. Preview the pairs with 'draft'.")
            with Terminal() as terminal:
                picks = pick_draft(seed, offers, terminal)
            if picks is None:
                print("Draft closed before the opening deal.")
                return None
        decks = draft_decks(offers, picks)
        print(draft_receipt(seed, picks, decks))
    return Battle(Setup.deal(seed, limit, *decks, mode=mode))


def _match(args: argparse.Namespace) -> None:
    if args.command == "practice":
        _branch_destination(args.file, args.save)
        replay = load(args.file)
        tick = args.tick
        if tick is None:
            tick = replay.end if replay.frames[-1].outcome is None else 0
        battle, amber, indigo = practice_start(replay, tick)
        automatic = args.auto
        print(f"Practice from beat {tick}/{replay.end}    Seed {battle.setup.seed}")
    else:
        battle = _new_match(args)
        if battle is None:
            return
        amber, indigo = (Pilot(battle.setup.seed, side) for side in Side)
        automatic = args.command == "simulate"

    if automatic:
        finish(battle, amber, indigo)
    else:
        if not interactive():
            raise ValueError("Live play needs an interactive terminal. "
                             "Use 'simulate' or 'practice FILE --auto' for an unattended match.")
        with Terminal() as terminal:
            play_live(battle, terminal, opponent=indigo)

    print(board(battle.frame(), "FINAL" if battle.outcome else "STOPPED"))
    if battle.outcome is None:
        print("Match left in progress.")
    print(f"Orders played  {len(battle.dispatches)}")
    if args.save is not None:
        _save_match(battle, args.save)


def _replay(args: argparse.Namespace) -> None:
    if args.stats and (args.frames or args.highlights or args.events):
        raise ValueError("--stats can be combined with --tick only.")
    replay = load(args.file)
    if args.stats:
        print(scouting_report(replay, replay.end if args.tick is None else args.tick))
    elif args.events:
        print(f"GUTTERLIGHT RELAY  /  EVENT LOG     Seed {replay.frames[0].seed}")
        for event in replay.events:
            print(event_line(event))
        if replay.frames[-1].outcome is None:
            print("END OF RECORDING  Match left in progress.")
    elif args.frames:
        for tick in range(replay.end + 1):
            if tick:
                print()
            print(replay_board(replay, tick))
    elif args.highlights:
        print(f"GUTTERLIGHT RELAY  /  HIGHLIGHTS     Seed {replay.setup.seed}")
        for event in replay.highlights():
            print(f"Beat {event.tick:>3}  {event_line(event)}")
    elif args.tick is not None:
        print(replay_board(replay, args.tick))
    elif interactive():
        with Terminal() as terminal:
            tick = watch(replay, terminal)
        print(f"Replay closed at beat {tick}/{replay.end}.")
    else:
        print(replay_board(replay, replay.end))


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        if args.command in ("play", "simulate", "practice"):
            _match(args)
        elif args.command == "cup":
            _cup(args)
        elif args.command == "draft":
            _draft(args)
        elif args.command == "study":
            _study(args)
        elif args.command == "replay":
            _replay(args)
        elif args.command == "cards":
            print(deck_sheet(args.deck) if args.deck is not None else catalog())
        else:
            parser.print_help()
    except BrokenPipeError:
        return 0
    except (ValueError, OSError) as error:
        print(f"gutterlight: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
