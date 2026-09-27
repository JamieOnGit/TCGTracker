from __future__ import annotations

from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"
RESEARCH = Path(__file__).parents[2] / "docs" / "research"


@pytest.fixture
def fixtures() -> Path:
    return FIXTURES
