import random
from itertools import combinations, product
from unittest import TestCase

from pinchline.arena import COURTS, EAST_MARKS, FLOOR, WEST_MARKS, lane_distance
from pinchline.battle import MODES, Battle
from pinchline.render import frame, match_report
from pinchline.roster import CHARGE_CAP, COPPER, INDIGO, ROSTER, START_CHARGE, Art


class MatchTests(TestCase):
    def test_opening_deals_six_full_health_heroes_on_their_own_pads(self):
        for seed in (0, 17, 852, -9):
            with self.subTest(seed=seed):
                game = Battle(seed)
                self.assertEqual("".join(f.token for f in game.fighters), "ABCxyz")
                self.assertEqual({f.pos for f in game.fighters if f.team == COPPER}, set(WEST_MARKS))
                self.assertEqual({f.pos for f in game.fighters if f.team == INDIGO}, set(EAST_MARKS))
                for fighter in game.fighters:
                    self.assertEqual((fighter.hp, fighter.charge, fighter.ward),
                                     (fighter.hero.hp, START_CHARGE, 0))

    def test_drafts_assign_tokens_in_order_and_allow_mirror_matches(self):
        draft = ("HUSHSPOOL", "Darnlet", "tucklark")
        game = Battle(3, draft, draft)
        cards = [f.hero.name for f in game.fighters]
        self.assertEqual(cards, ["Hushspool", "Darnlet", "Tucklark"] * 2)
        self.assertIsNot(game.fighters[0], game.fighters[3])

    def test_rejects_invalid_drafts_and_limits(self):
        for draft in [("pleatram",), ("pleatram", "inkrill", "Darnlet", "tucklark"),
                      ("inkrill", "INKRILL", "darnlet"), ("inkrill", "darnlet", "unknown")]:
            with self.subTest(draft=draft), self.assertRaises(ValueError):
                Battle(0, indigo=draft)
        with self.assertRaisesRegex(ValueError, "positive"):
            Battle(0, limit=0)
        with self.assertRaisesRegex(ValueError, "unknown mode"):
            Battle(0, mode="sprint")
        with self.assertRaisesRegex(ValueError, "unknown court"):
            Battle(0, court="roof")

    def test_interleaved_seeded_replays_agree_on_every_frame(self):
        first, second, other = Battle(852), Battle(852), Battle(17)
        for _ in range(first.limit + 1):
            self.assertEqual(frame(first), frame(second))
            if first.result is not None:
                break
            first.step()
            other.step()
            second.step()
        self.assertIsNotNone(first.result)
        self.assertEqual(first.result, second.result)

    def test_seed_changes_the_opening_and_can_change_the_winning_crew(self):
        openings, winners = set(), set()
        for seed in range(24):
            game = Battle(seed)
            openings.add(tuple(f.pos for f in game.fighters))
            winners.add(game.run().winner)
        self.assertGreater(len(openings), 1)
        self.assertIn(COPPER, winners)
        self.assertIn(INDIGO, winners)

    def test_match_leaves_global_random_state_alone(self):
        before = random.getstate()
        Battle(404).run()
        self.assertEqual(before, random.getstate())

    def test_deck_matches_replay_on_every_court_and_mode(self):
        for court, mode in product(COURTS, MODES):
            with self.subTest(court=court, mode=mode):
                options = dict(court=court, mode=mode, copper_deck=("prime", "patch", "screen"),
                               indigo_deck=("screen", "patch", "prime"))
                game, replay = Battle(852, **options), Battle(852, **options)
                held_beats = 0
                for _ in range(game.limit + 1):
                    self.assertEqual(frame(game), frame(replay))
                    self.assertTrue(frame(game).isascii())
                    self.assertLessEqual(max(map(len, frame(game).splitlines())), 80)
                    living = [f for f in game.fighters if f.alive]
                    self.assertEqual(len({f.pos for f in living}), len(living))
                    self.assertTrue(all(f.pos in game.court.floor for f in living))
                    if game.courier is not None:
                        run = game.courier
                        if run.carrier is None:
                            self.assertIn(run.loose_at, game.court.floor)
                            self.assertTrue(game.zone.contains(run.loose_at))
                        else:
                            held_beats += 1
                            self.assertIn(run.carrier, living)
                            self.assertIsNone(run.loose_at)
                        self.assertEqual(sum(f.stats.carry_beats for f in game.fighters), held_beats)
                    if game.result is not None:
                        break
                    game.step()
                    replay.step()
                self.assertIsNotNone(game.result)
                self.assertEqual(game.result, replay.result)
                self.assertEqual(match_report(game), match_report(replay))

    def test_every_pair_of_three_hero_drafts_finishes_with_legal_state(self):
        trios = list(combinations(ROSTER, 3))
        self.assertEqual(len(trios), 20)
        for seed, (copper, indigo) in enumerate(product(trios, repeat=2)):
            with self.subTest(seed=seed, copper=copper, indigo=indigo):
                game = Battle(seed, copper, indigo)
                for _ in range(game.limit):
                    before = [(f.pos, f.alive) for f in game.fighters]
                    game.step()
                    occupied = set()
                    for fighter, (pos, was_alive) in zip(game.fighters, before):
                        self.assertTrue(0 <= fighter.hp <= fighter.hero.hp)
                        self.assertTrue(0 <= fighter.charge <= CHARGE_CAP)
                        self.assertTrue(0 <= fighter.ward <= ROSTER["pleatram"].art_power)
                        self.assertIn(fighter.pos, FLOOR)
                        if not was_alive:
                            self.assertFalse(fighter.alive)
                            self.assertEqual(fighter.pos, pos)
                        if not fighter.alive:
                            self.assertEqual((fighter.charge, fighter.ward), (0, 0))
                            continue
                        self.assertNotIn(fighter.pos, occupied)
                        occupied.add(fighter.pos)
                        max_move = 2 if fighter.hero.art is Art.HOP else 1
                        self.assertLessEqual(lane_distance(pos, fighter.pos), max_move)
                        if game.zone.contains(pos):
                            self.assertTrue(game.zone.contains(fighter.pos))
                    if game.result is not None:
                        break
                self.assertIsNotNone(game.result)
                if game.beat < game.limit:
                    self.assertEqual(min(game.score(COPPER)[0], game.score(INDIGO)[0]), 0)
                for_west, for_east = game.score(COPPER), game.score(INDIGO)
                if for_west == for_east:
                    self.assertIsNone(game.result.winner)
                else:
                    self.assertEqual(game.result.winner, COPPER if for_west > for_east else INDIGO)
