"""The week's pool of commissions, clients, and independently drawn paper trails."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Brief:
    title: str
    field: str
    scope: str
    steps: tuple[str, ...]
    praise: str

    @property
    def blocks(self) -> int:
        return len(self.steps)


BRIEFS = (
    Brief(
        "Seed packet lettering", "Design",
        "Fit a variety name and planting depth onto a packet the size of a matchbox.",
        ("Set the lettering and checked the fold.",),
        "Even the tiny planting depth reads cleanly on the folded packet.",
    ),
    Brief(
        "Last-call announcement", "Audio",
        "Cut a closing announcement that stays intelligible above a busy market.",
        ("Balanced the voice against a recording of the market.",),
        "I could hear the last word from the back of the hall.",
    ),
    Brief(
        "Two-line window menu", "Copy",
        "Give a cha chaan teng two lines of window copy. The lunch queue should spot "
        "the set price before anyone has to put down an umbrella.",
        ("Trimmed the menu to fit the narrow pane.",),
        "People can read today's special from across the street.",
    ),
    Brief(
        "Colour swatch index", "Data",
        "Fix duplicate labels in a dyer's sample index before the new rolls arrive.",
        ("Reconciled the labels against the sample cards.",),
        "Our cutter found the right shade on the first try.",
    ),
    Brief(
        "Night ferry captions", "Copy",
        "Caption six stills for a photographer's small exhibition of ferry crossings.",
        ("Paired each still with its crossing and caption.",),
        "The captions leave just enough room for the photos to speak.",
    ),
    Brief(
        "Pocket arena score slip", "Design",
        "Lay out a pocket score slip for an original three-a-side tabletop brawler.",
        ("Fit both trios and the tie-break box onto one slip.",),
        "Six names, one tie-break, and nobody has to write in the margin.",
    ),
    Brief(
        "Borrowers' shelf map", "Design",
        "Draw a shelf guide for a lending library that keeps its odd-sized tools upstairs.",
        ("Traced the shelves and stairwell.", "Proofed the guide at counter size."),
        "A first-time borrower found the upstairs drill shelf unaided.",
    ),
    Brief(
        "Oral history selects", "Audio",
        "Pull a short listening reel from a retired sign painter's afternoon interview.",
        ("Marked the interview selects.", "Cut room tone between the chosen passages."),
        "You kept the pause before the story about the first shop sign.",
    ),
    Brief(
        "Raincoat size table", "Data",
        "Turn a tailor's handwritten raincoat measurements into a consistent size table.",
        ("Transcribed the measurements.", "Checked the units against the paper chart."),
        "The sleeve measurements match the patterns down to the last mark.",
    ),
    Brief(
        "Listening walk handout", "Copy",
        "Edit directions for an HKBU student sound walk starting in Kowloon Tong.",
        ("Walked through the route notes.", "Cut the directions to one folded sheet."),
        "We found the quiet courtyard before the next group arrived.",
    ),
    Brief(
        "Repair bench tickets", "Design",
        "Design a numbered repair ticket with room for a fault description and pickup date.",
        ("Laid out the claim stub.", "Checked that both halves carry the same number."),
        "The customer and the bench finally have matching stubs.",
    ),
    Brief(
        "Moth survey cards", "Data",
        "Turn an evening field survey into observation cards grouped by sighting time.",
        ("Sorted the field notes by time.", "Matched the sightings to their cards."),
        "We can trace every card back to the original evening notes.",
    ),
    Brief(
        "Theatre cue booklet", "Design",
        "Make a low-light cue booklet for a tiny theatre's opening night.",
        ("Mapped the scene changes.", "Set the cue pages.", "Proofed the page turns."),
        "Every page turn lands in a rest. The stage manager kept the proof.",
    ),
    Brief(
        "Tape archive sampler", "Audio",
        "Build a short sampler from three labelled boxes of neighbourhood recordings.",
        ("Logged the tape boxes.", "Cut the sampler.", "Matched the playback levels."),
        "The tram bell and the whispered interview both sit at the right level.",
    ),
    Brief(
        "Workshop booking ledger", "Data",
        "Reconcile a month of workshop bookings against attendance slips and refunds.",
        ("Entered the slips.", "Matched the refunds.", "Reconciled the closing total."),
        "The closing total matches the till for the first time this month.",
    ),
    Brief(
        "Small press catalogue", "Copy",
        "Write a bookseller's one-sheet for a press with five very different first editions.",
        ("Read the title notes.", "Drafted five descriptions.", "Proofed the one-sheet."),
        "Each book sounds distinct and the whole list fits on one sheet.",
    ),
    Brief(
        "Clay glaze reference", "Design",
        "Make a studio reference sheet from test tiles fired in three different kilns.",
        ("Sorted the tiles.", "Set the comparison grid.", "Checked the kiln labels."),
        "We can see how the very same glaze shifts between kilns.",
    ),
    Brief(
        "Rain room sound loop", "Audio",
        "Piece together a seamless rain loop for a one-room listening installation.",
        ("Found a clean rain bed.", "Built the loop.", "Auditioned the seam on repeat."),
        "I listened through three loops before I noticed the track had restarted.",
    ),
)

CLIENTS = (
    "Thimble Yard", "Ninefold Studio", "Quiet Valve", "Margin Finch",
    "Little Hem Office", "Loose Leaf Room", "Ochre Window", "Second Bell Works",
    "Ink Buoy", "Pocket Lintel", "Rookery Annex", "Woven Gauge",
    "Fern Dial", "Tin Sill Bureau", "Cloud Bobbin", "South Spindle",
    "Open Apron", "Paper Wick", "Canopy Tray", "Pencil Orchard",
)


TEMPLATE_NAMES = {
    "Audio": "Track routing sheet",
    "Copy": "House style sheet",
    "Data": "Reconciliation worksheet",
    "Design": "Pocket layout grid",
}


# Return briefs use the approved work as their source material.
RETURN_BRIEFS = {
    "Audio": Brief(
        "Listening copy", "Audio",
        "Make a single-speaker listening copy from the approved master. Keep the quiet passages audible.",
        ("Folded the mix down to one channel.", "Checked the quietest passage on a small speaker."),
        "We heard every word on the little speaker at the counter.",
    ),
    "Copy": Brief(
        "Countertop reading copy", "Copy",
        "Adapt the signed-off text for a narrow counter stand. Leave room for the opening hours.",
        ("Cut the text to the display width.", "Read the proof at arm's length."),
        "People can read it while the queue keeps moving.",
    ),
    "Data": Brief(
        "Change register", "Data",
        "Give the client a change register for the approved records, including one worked example.",
        ("Set up the dated change columns.", "Traced a sample edit back to its source."),
        "Our next shift could tell exactly which entry had changed.",
    ),
    "Design": Brief(
        "Pocket-size reprint", "Design",
        "Refit the approved layout to a pocket fold. Keep the small type and trim marks clear.",
        ("Refit the layout to the smaller sheet.", "Folded a proof and checked the trim."),
        "I unfolded it on the train to Kowloon Tong. Every label cleared the crease.",
    ),
}


@dataclass(frozen=True)
class PaperTrail:
    pitch: str
    funds: str
    terms: str
    breach: str = ""
    finding: str = ""


RETURN_TRAIL = PaperTrail(
    "The first piece is in use. Could you adapt that approved version for us?",
    "The returning client has reserved the full cash fee for this follow-up.",
    "The signed addendum covers one adaptation. Delivery releases the reserved fee.",
)


CLEAR_TRAILS = (
    PaperTrail(
        "First time posting here. I can send the production notes straight away.",
        "The board holds the full quoted fee against this booking number.",
        "One paid delivery. The client receives usage rights when you are paid.",
    ),
    PaperTrail(
        "We lost a production day. Is there room on your desk this week?",
        "A cleared reservation names this client, this brief, and the quoted fee.",
        "The rush date and the single deliverable match the public brief.",
    ),
    PaperTrail(
        "Our treasurer handles payment. I'll look after the creative side.",
        "The treasurer is a registered payer on this account. The full fee is reserved.",
        "The treasurer and the client signed the same cash fee and release date.",
    ),
    PaperTrail(
        "It's a small pilot. We'd like to book just this piece for now.",
        "The pilot has its own funded booking for the advertised amount.",
        "This pilot is a paid commission. Any later pieces need a fresh agreement.",
    ),
    PaperTrail(
        "I'm on the road most afternoons. All our approvals are in the job file.",
        "The billing record matches the booking. The balance is held on the board.",
        "Approval is recorded in the job file. Delivery releases the agreed fee.",
    ),
    PaperTrail(
        "Please keep the piece under wraps until our little launch on Friday.",
        "The booked amount has cleared in full under the client's billing name.",
        "The publicity embargo covers sharing the piece. Payment is due on delivery.",
    ),
)

RISK_TRAILS = (
    PaperTrail(
        "Finance has attached a receipt. We hope you can start this afternoon.",
        "The attached receipt names a different booking. This job's balance is zero.",
        "The scope lists one delivery and the same date as the notice.",
        "funds", "The receipt belonged to another booking. This one was never funded.",
    ),
    PaperTrail(
        "It's your first booking with our office. The usual onboarding slip is attached.",
        "The payment slip requires a deposit from the freelancer to release the fee.",
        "The delivery list and handoff date both match the notice.",
        "funds", "The payment offer depended on the freelancer sending a deposit.",
    ),
    PaperTrail(
        "Our editor has approved your place on the shortlist. The pilot is ready to go.",
        "The payer's billing identity is verified. It has an active project budget.",
        "The signed price for the whole first delivery is zero. The quote covers a possible sequel.",
        "terms", "The agreement treated the entire commissioned piece as an unpaid audition.",
    ),
    PaperTrail(
        "The quoted amount has already been approved in our studio budget.",
        "A budget entry for the advertised amount appears under the client's own name.",
        "The settlement box converts the entire advertised cash fee into studio shop credit.",
        "terms", "The settlement clause replaced the cash fee with studio credit.",
    ),
    PaperTrail(
        "The office has set aside the fee. You'll find both slips in the file.",
        "The supposed transfer is marked as a demonstration. Its payable value is zero.",
        "The rights and handoff clauses match the advertised commission.",
        "funds", "The supplied transfer was a demonstration slip with no payable value.",
    ),
    PaperTrail(
        "We have a simple handoff agreement. The purchasing desk has signed it already.",
        "The purchasing desk has an established billing account and an open budget.",
        "The handoff clause refunds the full fee to the buyer as soon as they download the work.",
        "terms", "The signed handoff returned the fee to the buyer on delivery.",
    ),
)
