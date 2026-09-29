"""Rapport d'analyse des inscriptions JEFFREY EVENTS.

Lit la base SQLite de la plateforme (en lecture seule) et produit :
  - un rapport Markdown (remplissage, taux de présence, canaux d'acquisition, influenceurs) ;
  - des exports CSV prêts à être chargés dans Power BI ou Excel.

Utilisation :
    python analytics/report.py --db data/jeffrey-events.db --out reports/
"""

from __future__ import annotations

import argparse
import csv
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

SOURCE_LABELS = {
    "instagram": "Instagram",
    "tiktok": "TikTok",
    "influenceur": "Influenceur",
    "bouche-a-oreille": "Bouche-à-oreille",
    "site-web": "Site web",
    "autre": "Autre",
}


@dataclass
class EventStats:
    event_id: int
    title: str
    starts_at: str
    capacity: int
    confirmed: int
    waitlist: int
    cancelled: int
    checked_in: int
    revenue_eur: float

    @property
    def fill_rate(self) -> float:
        return round(100 * self.confirmed / self.capacity, 1) if self.capacity else 0.0

    @property
    def show_rate(self) -> float | None:
        """Part des confirmés réellement venus (None si l'événement n'a pas encore eu lieu)."""
        if not self.confirmed or not self.checked_in:
            return None
        return round(100 * self.checked_in / self.confirmed, 1)

    @property
    def cancel_rate(self) -> float:
        total = self.confirmed + self.waitlist + self.cancelled
        return round(100 * self.cancelled / total, 1) if total else 0.0


@dataclass
class ChannelStats:
    source: str
    registrations: int
    share_pct: float
    checked_in: int


@dataclass
class PartnerStats:
    code: str
    name: str
    platform: str
    registrations: int
    confirmed: int


def connect_readonly(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise FileNotFoundError(f"Base introuvable : {db_path} (lancez d'abord `npm run seed`)")
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def event_stats(conn: sqlite3.Connection) -> list[EventStats]:
    rows = conn.execute(
        """
        SELECT e.id, e.title, e.starts_at, e.capacity, e.price_eur,
               SUM(r.status = 'confirmed')            AS confirmed,
               SUM(r.status = 'waitlist')             AS waitlist,
               SUM(r.status = 'cancelled')            AS cancelled,
               SUM(r.checked_in_at IS NOT NULL)       AS checked_in
        FROM events e
        LEFT JOIN registrations r ON r.event_id = e.id
        GROUP BY e.id
        ORDER BY e.starts_at
        """
    ).fetchall()
    return [
        EventStats(
            event_id=r["id"],
            title=r["title"],
            starts_at=r["starts_at"],
            capacity=r["capacity"],
            confirmed=r["confirmed"] or 0,
            waitlist=r["waitlist"] or 0,
            cancelled=r["cancelled"] or 0,
            checked_in=r["checked_in"] or 0,
            revenue_eur=round((r["confirmed"] or 0) * r["price_eur"], 2),
        )
        for r in rows
    ]


def channel_stats(conn: sqlite3.Connection) -> list[ChannelStats]:
    rows = conn.execute(
        """
        SELECT source, COUNT(*) AS n, SUM(checked_in_at IS NOT NULL) AS checked_in
        FROM registrations
        WHERE status <> 'cancelled'
        GROUP BY source
        ORDER BY n DESC
        """
    ).fetchall()
    total = sum(r["n"] for r in rows) or 1
    return [
        ChannelStats(
            source=r["source"],
            registrations=r["n"],
            share_pct=round(100 * r["n"] / total, 1),
            checked_in=r["checked_in"] or 0,
        )
        for r in rows
    ]


def partner_stats(conn: sqlite3.Connection) -> list[PartnerStats]:
    rows = conn.execute(
        """
        SELECT p.code, p.name, p.platform,
               COUNT(r.id) FILTER (WHERE r.status <> 'cancelled') AS registrations,
               COUNT(r.id) FILTER (WHERE r.status = 'confirmed')  AS confirmed
        FROM partners p
        LEFT JOIN registrations r ON r.partner_id = p.id
        GROUP BY p.id
        ORDER BY registrations DESC, p.name
        """
    ).fetchall()
    return [PartnerStats(**dict(r)) for r in rows]


def daily_registrations(conn: sqlite3.Connection) -> list[tuple[str, int]]:
    rows = conn.execute(
        "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM registrations GROUP BY day ORDER BY day"
    ).fetchall()
    return [(r["day"], r["n"]) for r in rows]


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{value:.1f} %".replace(".", ",")


def _eur(value: float) -> str:
    return f"{value:,.2f} €".replace(",", " ").replace(".", ",")


def build_markdown(events: list[EventStats], channels: list[ChannelStats], partners: list[PartnerStats]) -> str:
    now = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    total_confirmed = sum(e.confirmed for e in events)
    total_capacity = sum(e.capacity for e in events)
    total_revenue = sum(e.revenue_eur for e in events)
    top_channel = channels[0] if channels else None

    lines = [
        "# Rapport des inscriptions — JEFFREY EVENTS",
        "",
        f"_Généré le {now}_",
        "",
        "## Synthèse",
        "",
        f"- **{total_confirmed}** inscriptions confirmées pour **{total_capacity}** places "
        f"({_pct(100 * total_confirmed / total_capacity if total_capacity else 0)} de remplissage global)",
        f"- Chiffre d'affaires billetterie estimé : **{_eur(total_revenue)}**",
    ]
    if top_channel:
        lines.append(
            f"- Premier canal d'acquisition : **{SOURCE_LABELS.get(top_channel.source, top_channel.source)}** "
            f"({_pct(top_channel.share_pct)} des inscriptions)"
        )
    full = [e.title for e in events if e.waitlist > 0]
    if full:
        lines.append(f"- Événements complets avec liste d'attente : {', '.join(full)} → envisager une jauge plus grande")

    lines += [
        "",
        "## Événements",
        "",
        "| Événement | Date | Confirmés / places | Remplissage | Attente | Annulations | Présence | CA estimé |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for e in events:
        date = e.starts_at[:10]
        lines.append(
            f"| {e.title} | {date} | {e.confirmed} / {e.capacity} | {_pct(e.fill_rate)} | {e.waitlist} "
            f"| {_pct(e.cancel_rate)} | {_pct(e.show_rate)} | {_eur(e.revenue_eur)} |"
        )

    lines += ["", "## Canaux d'acquisition", "", "| Canal | Inscriptions | Part | Présents |", "|---|---|---|---|"]
    for c in channels:
        lines.append(f"| {SOURCE_LABELS.get(c.source, c.source)} | {c.registrations} | {_pct(c.share_pct)} | {c.checked_in} |")

    lines += ["", "## Partenaires & influenceurs", "", "| Partenaire | Plateforme | Code | Inscriptions | Confirmées |", "|---|---|---|---|---|"]
    for p in partners:
        lines.append(f"| {p.name} | {p.platform} | `{p.code}` | {p.registrations} | {p.confirmed} |")

    return "\n".join(lines) + "\n"


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=";")
        writer.writeheader()
        writer.writerows(rows)


def generate(db_path: Path, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    with connect_readonly(db_path) as conn:
        events = event_stats(conn)
        channels = channel_stats(conn)
        partners = partner_stats(conn)
        daily = daily_registrations(conn)

    report = out_dir / "rapport-inscriptions.md"
    report.write_text(build_markdown(events, channels, partners), encoding="utf-8")

    write_csv(
        out_dir / "evenements.csv",
        [{**asdict(e), "fill_rate": e.fill_rate, "show_rate": e.show_rate, "cancel_rate": e.cancel_rate} for e in events],
    )
    write_csv(out_dir / "canaux.csv", [asdict(c) for c in channels])
    write_csv(out_dir / "partenaires.csv", [asdict(p) for p in partners])
    write_csv(out_dir / "inscriptions-par-jour.csv", [{"jour": d, "inscriptions": n} for d, n in daily])
    return report


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Rapport d'analyse des inscriptions JEFFREY EVENTS")
    parser.add_argument("--db", type=Path, default=root / "data" / "jeffrey-events.db")
    parser.add_argument("--out", type=Path, default=root / "reports")
    args = parser.parse_args()
    report = generate(args.db, args.out)
    print(f"Rapport généré : {report}")
    print(f"Exports CSV : {args.out}")


if __name__ == "__main__":
    main()
