import shutil
import uuid
from contextlib import contextmanager
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "stories" / "eleventh_morning.json"


@contextmanager
def work_directory():
    """Give each test a fresh directory inheriting the workspace permissions."""
    directory = ROOT / f".adventure-test-{uuid.uuid4().hex}"
    directory.mkdir()
    try:
        yield directory
    finally:
        if directory.resolve().parent != ROOT:
            raise RuntimeError("Unexpected test directory location.")
        shutil.rmtree(directory)


def small_story():
    """A second setting with different units, a one-way exit and optional fields."""
    return {
        "id": "last-post",
        "title": "Last Post",
        "intro": "There is time for one more delivery.",
        "resource": "stamps",
        "budget": 7,
        "days": 2,
        "start": "hall",
        "flags": {"parcel": "the parcel", "delivered": "a signed receipt"},
        "rooms": {
            "hall": {
                "name": "Hall",
                "description": "A parcel waits on the stairs.",
                "exits": ["loft"],
                "actions": {
                    "collect": {
                        "name": "Collect the parcel", "cost": 7,
                        "gives": ["parcel"], "result": "The postage is paid.",
                    }
                },
            },
            "loft": {
                "name": "Loft",
                "description": "A letterbox rattles.",
                "actions": {
                    "deliver": {
                        "name": "Deliver the parcel", "requires": ["parcel"],
                        "gives": ["delivered"], "result": "A hand takes the parcel.",
                    }
                },
            },
        },
        "endings": [
            {"id": "signed", "title": "Signed for", "requires": ["delivered"], "text": "Mail delivered."},
            {"id": "late", "title": "Too late", "text": "The post has closed."},
        ],
    }


def counter_story():
    """A postal counter with a two-day booking and two people who share a topic ID."""
    data = small_story()
    data.update(days=4, items={"slip": "paper slip", "seal": "brass seal"},
                starting_items={"slip": 3})
    hall = data["rooms"]["hall"]
    hall["people"] = {
        "clerk": {
            "name": "Clerk", "greeting": "Have you brought your slips?",
            "topics": {
                "collect": {"name": "Borrow a seal", "produces": {"seal": 1},
                            "result": "The clerk opens the till."},
            },
        },
    }
    hall["actions"]["collect"].update(days=2, window=[2, 3],
                                      consumes={"slip": 2, "seal": 1}, produces={"slip": 1})
    data["rooms"]["loft"]["people"] = {
        "porter": {
            "name": "Porter", "greeting": "Let me see the parcel.",
            "topics": {
                "collect": {"name": "Collect the return seal", "requires": ["parcel"],
                            "produces": {"seal": 1}, "result": "A seal rattles down the chute."},
            },
        },
    }
    return data


def batch_story():
    """A postal press delivers a proof that opens the upstairs counter."""
    data = small_story()
    data.update(days=4, budget=10, items={"paper": "sheet", "proof": "stamped proof"},
                starting_items={"paper": 2})
    data["flags"].update({"pass": "the counter pass", "printed": "a printed proof", "retired": "a retired plate"})
    hall = data["rooms"]["hall"]
    hall["exit_requires"] = {"loft": ["printed"]}
    hall["actions"]["collect"].update(days=3, cost=3)
    hall["people"] = {
        "clerk": {
            "name": "Clerk", "greeting": "Press day today.",
            "topics": {
                "pass": {"name": "Sign in", "gives": ["pass"], "result": "You sign the book."},
                "retire": {"name": "Retire the plate", "gives": ["retired"], "result": "Plate retired."},
            },
        },
    }
    hall["batches"] = {
        "run": {"name": "Pull the proof", "result": "The proof is dry.", "nights": 2, "cost": 4,
                "requires": ["pass"], "unless": ["retired"], "gives": ["printed"],
                "consumes": {"paper": 1}, "produces": {"proof": 2}},
    }
    data["rooms"]["loft"]["batches"] = {
        "spare": {"name": "Cut a spare sheet", "result": "Fresh paper arrives.", "nights": 1,
                  "produces": {"paper": 1}},
    }
    data["endings"].insert(1, {"id": "in-print", "title": "In print", "requires": ["printed"],
                               "text": "The press kept its promise."})
    return data
