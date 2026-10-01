"""robots.txt matching per RFC 9309 (the rules Google documents).

``urllib.robotparser`` ignores ``*`` and ``$`` in paths, so rules real
retailers use, such as Target's ``Disallow: /search/*`` or ``*sortBy=``,
would never match and we'd fetch pages the site asked us not to. This
matcher supports:

* groups picked by our product token (case-insensitive), else ``*``;
* ``*`` wildcards and a ``$`` end anchor, matched against path + query;
* the longest matching rule wins, and ``Allow`` wins a tie;
* ``/robots.txt`` itself is always allowed;
* ``Crawl-delay`` (non-standard but common, e.g. ``Crawl-delay: 10``) is
  read per group and honoured by the polite client as a minimum gap.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit


@dataclass(frozen=True)
class _Rule:
    allow: bool
    pattern: str
    regex: re.Pattern[str]


def _compile(pattern: str) -> re.Pattern[str]:
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    regex = "".join(".*" if ch == "*" else re.escape(ch) for ch in body)
    return re.compile(regex + ("$" if anchored else ""))


@dataclass
class Robots:
    groups: dict[str, list[_Rule]] = field(default_factory=dict)
    delays: dict[str, float] = field(default_factory=dict)

    @classmethod
    def parse(cls, text: str) -> Robots:
        groups: dict[str, list[_Rule]] = {}
        delays: dict[str, float] = {}
        agents: list[str] = []
        in_rules = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            key, value = (p.strip() for p in line.split(":", 1))
            key = key.lower()
            if key == "user-agent":
                if in_rules:  # a new group starts
                    agents, in_rules = [], False
                agents.append(value.lower())
                for a in agents:
                    groups.setdefault(a, [])
            elif key in ("allow", "disallow"):
                in_rules = True
                if not value:  # "Disallow:" with no path = allow everything
                    continue
                pattern = value if value.startswith(("/", "*")) else "/" + value
                rule = _Rule(key == "allow", pattern, _compile(pattern))
                for a in agents:
                    groups.setdefault(a, []).append(rule)
            elif key == "crawl-delay":
                in_rules = True
                try:
                    delay = float(value)
                except ValueError:
                    continue
                for a in agents:
                    delays[a] = max(0.0, min(delay, 120.0))  # cap absurd values; we still wait
        return cls(groups, delays)

    @classmethod
    def disallow_all(cls) -> Robots:
        return cls.parse("User-agent: *\nDisallow: /")

    @classmethod
    def allow_all(cls) -> Robots:
        return cls({})

    @staticmethod
    def _token(user_agent: str) -> str:
        return user_agent.split("/", 1)[0].strip().lower()

    def _rules_for(self, user_agent: str) -> list[_Rule]:
        token = self._token(user_agent)
        specific = [
            rules for agent, rules in self.groups.items() if agent != "*" and agent and agent in token
        ]
        if specific:
            return [r for rules in specific for r in rules]
        return self.groups.get("*", [])

    def crawl_delay(self, user_agent: str) -> float | None:
        """Seconds the site asks between requests (our group, else ``*``)."""
        token = self._token(user_agent)
        specific = [d for agent, d in self.delays.items() if agent != "*" and agent and agent in token]
        if specific:
            return max(specific)
        return self.delays.get("*")

    def can_fetch(self, user_agent: str, url: str) -> bool:
        parts = urlsplit(url)
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        if parts.path == "/robots.txt":
            return True
        best: _Rule | None = None
        for rule in self._rules_for(user_agent):
            if not rule.regex.match(target):
                continue
            if (
                best is None
                or len(rule.pattern) > len(best.pattern)
                or (len(rule.pattern) == len(best.pattern) and rule.allow)
            ):
                best = rule
        return best is None or best.allow
