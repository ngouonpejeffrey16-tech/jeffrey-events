import sqlite3
import tempfile
import unittest
from pathlib import Path

from report import build_markdown, channel_stats, event_stats, generate, partner_stats

SCHEMA = """
CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT, description TEXT DEFAULT '', venue TEXT, city TEXT,
  starts_at TEXT, capacity INTEGER, price_eur REAL DEFAULT 0, cover_url TEXT DEFAULT '', published INTEGER DEFAULT 1,
  created_at TEXT DEFAULT '2026-01-01');
CREATE TABLE partners (id INTEGER PRIMARY KEY, name TEXT, platform TEXT, code TEXT, created_at TEXT DEFAULT '');
CREATE TABLE registrations (id INTEGER PRIMARY KEY, event_id INTEGER, first_name TEXT, last_name TEXT, email TEXT,
  phone TEXT DEFAULT '', source TEXT, partner_id INTEGER, status TEXT, ticket_code TEXT, checked_in_at TEXT,
  created_at TEXT);
"""


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "test.db"
        conn = sqlite3.connect(self.db)
        conn.executescript(SCHEMA)
        conn.execute("INSERT INTO events VALUES (1,'Soirée','','Salle','Bordeaux','2026-10-10T20:00:00Z',4,10,'',1,'')")
        conn.execute("INSERT INTO partners VALUES (1,'Léa','tiktok','LEA10','')")
        regs = [
            (1, "instagram", None, "confirmed", "2026-10-01T10:00:00Z", "2026-09-01"),
            (2, "tiktok", None, "confirmed", None, "2026-09-01"),
            (3, "influenceur", 1, "confirmed", None, "2026-09-02"),
            (4, "influenceur", 1, "confirmed", None, "2026-09-02"),
            (5, "instagram", None, "waitlist", None, "2026-09-03"),
            (6, "instagram", None, "cancelled", None, "2026-09-03"),
        ]
        for i, source, partner, status, checked, created in regs:
            conn.execute(
                "INSERT INTO registrations VALUES (?,1,'A','B',?, '', ?, ?, ?, ?, ?, ?)",
                (i, f"p{i}@x.fr", source, partner, status, f"JE-{i}", checked, created),
            )
        conn.commit()
        conn.close()
        self.conn = sqlite3.connect(self.db)
        self.conn.row_factory = sqlite3.Row

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_event_stats(self):
        (e,) = event_stats(self.conn)
        self.assertEqual((e.confirmed, e.waitlist, e.cancelled, e.checked_in), (4, 1, 1, 1))
        self.assertEqual(e.fill_rate, 100.0)
        self.assertEqual(e.show_rate, 25.0)
        self.assertEqual(e.revenue_eur, 40.0)

    def test_channels_exclude_cancelled(self):
        channels = {c.source: c for c in channel_stats(self.conn)}
        self.assertEqual(channels["instagram"].registrations, 2)
        self.assertEqual(sum(c.registrations for c in channels.values()), 5)

    def test_partner_ranking(self):
        (p,) = partner_stats(self.conn)
        self.assertEqual((p.code, p.registrations, p.confirmed), ("LEA10", 2, 2))

    def test_markdown_and_files(self):
        md = build_markdown(event_stats(self.conn), channel_stats(self.conn), partner_stats(self.conn))
        self.assertIn("liste d'attente : Soirée", md)
        out = Path(self.tmp.name) / "out"
        generate(self.db, out)
        for name in ["rapport-inscriptions.md", "evenements.csv", "canaux.csv", "partenaires.csv"]:
            self.assertTrue((out / name).exists(), name)


if __name__ == "__main__":
    unittest.main()
