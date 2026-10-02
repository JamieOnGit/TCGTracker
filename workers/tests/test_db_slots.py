"""The process-wide cap on open database connections (tcgworkers.db)."""

from __future__ import annotations

import threading
import time

from tcgworkers import db


def test_slots_cap_concurrent_connections() -> None:
    peak = 0
    current = 0
    lock = threading.Lock()

    def work() -> None:
        nonlocal peak, current
        with db._slot():
            with lock:
                current += 1
                peak = max(peak, current)
            time.sleep(0.02)
            with lock:
                current -= 1

    threads = [threading.Thread(target=work) for _ in range(db.MAX_CONNECTIONS * 3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert peak == db.MAX_CONNECTIONS


def test_nested_slot_on_one_thread_takes_one_slot() -> None:
    done = threading.Event()

    def nested() -> None:
        def go(depth: int) -> None:
            with db._slot():
                if depth < db.MAX_CONNECTIONS + 2:
                    go(depth + 1)

        go(0)
        done.set()

    t = threading.Thread(target=nested, daemon=True)
    t.start()
    t.join(timeout=2)
    assert done.is_set()
