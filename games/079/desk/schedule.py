"""Working hours, booking terms and a read-only forecast of the desk."""

from collections.abc import Collection, Iterable
from dataclasses import dataclass

from .catalog import Brief, PaperTrail


DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri")
BLOCKS_PER_DAY = 4
WEEK = len(DAYS) * BLOCKS_PER_DAY
EXTENSION_BLOCKS = 2
EXTENSION_RATE = 40


def blocks(count: int) -> str:
    return f"{count} block" + ("" if count == 1 else "s")


def day_close(clock: int) -> int:
    """Closing tick of the day currently open for business."""
    return min(WEEK, (clock // BLOCKS_PER_DAY + 1) * BLOCKS_PER_DAY)


def due_label(tick: int) -> str:
    day, slot = divmod(tick - 1, BLOCKS_PER_DAY)
    return f"{DAYS[day]} {11 + 2 * slot:02}:00"


def clock_label(tick: int) -> str:
    if tick == WEEK:
        return due_label(tick)
    day, slot = divmod(tick, BLOCKS_PER_DAY)
    return f"{DAYS[day]} {9 + 2 * slot:02}:00"


@dataclass(frozen=True)
class Gig:
    number: int
    client: str
    brief: Brief
    fee: int
    due: int
    trail: PaperTrail
    repeat_of: int | None = None


@dataclass
class Contract:
    gig: Gig
    fee: int
    finished: int = 0
    extra_blocks: int = 0

    @property
    def remaining(self) -> int:
        return self.gig.brief.blocks - self.finished

    @property
    def due(self) -> int:
        return self.gig.due + self.extra_blocks

    def can_reuse(self, templates: Collection[str]) -> bool:
        return self.remaining >= 2 and self.gig.brief.field in templates

    def blocks_needed(self, templates: Collection[str]) -> int:
        return self.remaining - int(self.can_reuse(templates))

    def workload(self, templates: Collection[str]) -> str:
        if self.can_reuse(templates):
            return f"{self.remaining} steps ({blocks(self.blocks_needed(templates))} with reuse)"
        return blocks(self.remaining)

    def extension_terms(self) -> tuple[int, int]:
        """Extra working blocks available and the fee after that amendment."""
        extra = min(EXTENSION_BLOCKS, WEEK - self.due)
        return extra, self.fee - extra * EXTENSION_RATE


@dataclass(frozen=True)
class PlannedJob:
    gig: Gig
    due: int
    start: int
    work_blocks: int
    reuse: bool

    @property
    def finish(self) -> int:
        return self.start + self.work_blocks


def plan_jobs(clock: int, jobs: Iterable[Contract], templates: Collection[str]) -> list[PlannedJob]:
    """Ship ready work now, then schedule by deadline, spending each template once."""
    fields = set(templates)
    cursor = clock
    plan = []
    for job in sorted(jobs, key=lambda c: (c.remaining != 0, c.due, c.gig.number)):
        effort = job.blocks_needed(fields)
        reuse = effort < job.remaining
        if reuse:
            fields.remove(job.gig.brief.field)
        row = PlannedJob(job.gig, job.due, cursor, effort, reuse)
        plan.append(row)
        cursor = row.finish
    return plan


def schedule_warning(clock: int, plan: list[PlannedJob]) -> str:
    for row in plan:
        if row.finish > row.due:
            needed = sum(item.work_blocks for item in plan if item.due <= row.due)
            return (f"Schedule clash. {blocks(needed)} of work due by {due_label(row.due)}, "
                    f"with {blocks(row.due - clock)} available.")
    return ""
