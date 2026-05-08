"""
add_gbif_links.py
=================
Zoekt voor elk owl:Class in een Turtle (.owl) bestand de corresponderende
GBIF-soortpagina op en voegt `rdfs:seeAlso gbif:<usageKey>` toe.

Gebruik:
    python add_gbif_links.py Ontology.owl -o Ontology_gbif.owl

Vereisten:
    pip install requests
"""

import re
import time
import argparse
import sys

try:
    import requests
except ImportError:
    print("Installeer eerst 'requests':  pip install requests")
    sys.exit(1)

GBIF_MATCH_URL = "https://api.gbif.org/v1/species/match"
GBIF_PREFIX = "gbif"
GBIF_BASE = "https://www.gbif.org/species/"

# ── helpers ──────────────────────────────────────────────────────────────────

def gbif_lookup(name: str) -> dict | None:
    """
    Zoek een taxon op naam op in de GBIF backbone-taxonomie.
    Geeft een dict terug met 'usageKey', 'matchType', 'confidence', 'rank', …
    of None als er geen hit is.
    """
    try:
        resp = requests.get(
            GBIF_MATCH_URL,
            params={"name": name, "verbose": "false"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("matchType", "NONE") == "NONE":
            return None
        if "usageKey" not in data:
            return None
        return data
    except Exception as exc:
        print(f"  [WARN] GBIF request failed for '{name}': {exc}")
        return None


def ensure_gbif_prefix(content: str) -> str:
    """
    Voeg `@prefix gbif: <https://www.gbif.org/species/> .` toe als het er
    nog niet in staat, direct na de laatste bestaande @prefix-regel.
    """
    if f"@prefix {GBIF_PREFIX}:" in content:
        return content  # al aanwezig

    # Zoek de laatste @prefix-regel en voeg erna in
    last_prefix = None
    for m in re.finditer(r"^@prefix .+\.$", content, re.MULTILINE):
        last_prefix = m
    if last_prefix:
        insert_pos = last_prefix.end()
        addition = f"\n@prefix {GBIF_PREFIX}: <{GBIF_BASE}> ."
        content = content[:insert_pos] + addition + content[insert_pos:]
    else:
        # Geen prefix-blok gevonden — prepend
        content = f"@prefix {GBIF_PREFIX}: <{GBIF_BASE}> .\n\n" + content
    return content


# ── main logic ───────────────────────────────────────────────────────────────

def process_owl(input_path: str, output_path: str, min_confidence: int = 80,
                dry_run: bool = False, verbose: bool = False) -> None:

    with open(input_path, encoding="utf-8") as fh:
        content = fh.read()

    # Vind alle owl:Class-blokken: van "ex:Name a owl:Class ;" tot de afsluitende punt
    # Elk blok begint op een nieuwe regel met ex:<identifier>
    block_pattern = re.compile(
        r"(ex:(\w+)\s+a\s+owl:Class\s*;[^.]+\.)",
        re.DOTALL,
    )

    replacements: list[tuple[str, str]] = []  # (origineel_blok, nieuw_blok)
    stats = {"found": 0, "skipped_existing": 0, "no_hit": 0, "low_confidence": 0}

    all_blocks = block_pattern.findall(content)
    print(f"Gevonden classes: {len(all_blocks)}")

    for original_block, identifier in all_blocks:
        # Haal de rdfs:label op – dat is de meest betrouwbare naam
        label_match = re.search(r'rdfs:label\s+"([^"]+)"', original_block)
        taxon_name = label_match.group(1) if label_match else identifier.replace("_", " ")

        # Sla over als er al een seeAlso in dit blok staat
        if "rdfs:seeAlso" in original_block:
            if verbose:
                print(f"  [SKIP]  {taxon_name}  – seeAlso al aanwezig")
            stats["skipped_existing"] += 1
            continue

        print(f"  Opzoeken: {taxon_name} …", end=" ", flush=True)
        result = gbif_lookup(taxon_name)
        time.sleep(0.15)  # beleefd wachten

        if result is None:
            print("geen GBIF-hit")
            stats["no_hit"] += 1
            continue

        confidence = result.get("confidence", 0)
        usage_key = result["usageKey"]
        rank = result.get("rank", "?")

        if confidence < min_confidence:
            print(f"te laag vertrouwen ({confidence}% < {min_confidence}%)")
            stats["low_confidence"] += 1
            continue

        print(f"✓  key={usage_key}  rank={rank}  conf={confidence}%")
        stats["found"] += 1

        if dry_run:
            continue

        # Voeg rdfs:seeAlso in vóór de afsluitende punt van het blok.
        # We zoeken de plek net vóór de laatste "." van het blok.
        # Strategie: vervang de laatste "." door de seeAlso-regel + " ."
        new_block = re.sub(
            r"\s*\.$",
            f" ;\n    rdfs:seeAlso {GBIF_PREFIX}:{usage_key} .",
            original_block.rstrip(),
        )
        replacements.append((original_block, new_block))

    # ── pas alle vervangingen toe ─────────────────────────────────────────
    if not dry_run:
        for original, replacement in replacements:
            content = content.replace(original, replacement, 1)

        # Voeg gbif-prefix toe als die ontbreekt
        if replacements:
            content = ensure_gbif_prefix(content)

        with open(output_path, "w", encoding="utf-8") as fh:
            fh.write(content)
        print(f"\nOpgeslagen: {output_path}")
    else:
        print("\n[DRY RUN] Geen bestanden geschreven.")

    # ── samenvatting ─────────────────────────────────────────────────────
    print("\n── Samenvatting ──────────────────────────────────")
    print(f"  Links toegevoegd      : {stats['found']}")
    print(f"  Al aanwezig (overgeslagen): {stats['skipped_existing']}")
    print(f"  Geen GBIF-hit         : {stats['no_hit']}")
    print(f"  Vertrouwen te laag    : {stats['low_confidence']}")
    print("──────────────────────────────────────────────────")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Voeg rdfs:seeAlso GBIF-links toe aan een Turtle OWL-bestand."
    )
    parser.add_argument("input", help="Pad naar het invoer-OWL-bestand (Turtle)")
    parser.add_argument(
        "-o", "--output",
        help="Pad voor het uitvoer-OWL-bestand (standaard: input_gbif.owl)",
    )
    parser.add_argument(
        "--min-confidence", type=int, default=80,
        help="Minimale GBIF-trefzekerheid in %% (standaard: 80)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Zoek op maar schrijf geen bestanden",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true",
        help="Toon ook overgeslagen blokken",
    )
    args = parser.parse_args()

    output = args.output or args.input.replace(".owl", "_gbif.owl")
    if output == args.input:
        output = args.input + ".gbif.owl"

    process_owl(
        input_path=args.input,
        output_path=output,
        min_confidence=args.min_confidence,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
