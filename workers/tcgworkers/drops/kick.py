"""Wake-ups between the drop monitor and the alert dispatcher (same process).

The monitor sets ``DISPATCH`` the moment it commits a new drop event, so the
dispatcher runs at once instead of on its next poll. The poll stays as a
fallback for events written elsewhere (member sightings confirmed on the
website) and for Free members' delayed deliveries falling due.
"""

from __future__ import annotations

import threading

DISPATCH = threading.Event()


def wake_dispatcher() -> None:
    DISPATCH.set()
