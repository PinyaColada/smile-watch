"""SQLite observations: UTC timestamp, local session, actual expiry, tenor and quality."""

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
 session TEXT NOT NULL, timestamp TEXT NOT NULL, expiry TEXT NOT NULL,
 tenor INTEGER NOT NULL, minute INTEGER NOT NULL, series TEXT NOT NULL,
 value REAL, flags TEXT NOT NULL, synthetic INTEGER NOT NULL CHECK(synthetic IN (0,1)),
 PRIMARY KEY(session, timestamp, expiry, series)
);
CREATE INDEX IF NOT EXISTS baseline_lookup ON observations(tenor, series, minute, session);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.executescript(SCHEMA)
    return db


def write_rows(db: sqlite3.Connection, rows) -> None:
    db.executemany("INSERT OR REPLACE INTO observations VALUES (?,?,?,?,?,?,?,?,?)", rows)
    db.commit()
