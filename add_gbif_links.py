import argparse
import re
import sys
import time

try:
    import requests
except ImportError:
    print("Install 'requests' first: pip install requests")
    sys.exit(1)

GBIF_MATCH_URL = "https://api.gbif.org/v1/species/match"
GBIF_PREFIX = "gbif"
GBIF_BASE = "https://www.gbif.org/species/"


def gbif_lookup(name: str) -> dict | None:
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
    if f"@prefix {GBIF_PREFIX}:" in content:
        return content

    last_prefix = None
    for match in re.finditer(r"^@prefix .+\.$", content, re.MULTILINE):
        last_prefix = match

    if last_prefix:
        insert_pos = last_prefix.end()
        addition = f"\n@prefix {GBIF_PREFIX}: <{GBIF_BASE}> ."
        return content[:insert_pos] + addition + content[insert_pos:]

    return f"@prefix {GBIF_PREFIX}: <{GBIF_BASE}> .\n\n" + content


def process_owl(
    input_path: str,
    output_path: str,
    min_confidence: int = 80,
    dry_run: bool = False,
    verbose: bool = False,
) -> None:
    with open(input_path, encoding="utf-8") as fh:
        content = fh.read()

    block_pattern = re.compile(
        r"(ex:(\w+)\s+a\s+owl:Class\s*;[^.]+\.)",
        re.DOTALL,
    )

    replacements: list[tuple[str, str]] = []
    stats = {"found": 0, "skipped_existing": 0, "no_hit": 0, "low_confidence": 0}

    all_blocks = block_pattern.findall(content)
    print(f"Found classes: {len(all_blocks)}")

    for original_block, identifier in all_blocks:
        label_match = re.search(r'rdfs:label\s+"([^"]+)"', original_block)
        taxon_name = label_match.group(1) if label_match else identifier.replace("_", " ")

        if "rdfs:seeAlso" in original_block:
            if verbose:
                print(f"  [SKIP]  {taxon_name} already has seeAlso")
            stats["skipped_existing"] += 1
            continue

        print(f"  Looking up: {taxon_name}...", end=" ", flush=True)
        result = gbif_lookup(taxon_name)
        time.sleep(0.15)

        if result is None:
            print("no GBIF match")
            stats["no_hit"] += 1
            continue

        confidence = result.get("confidence", 0)
        usage_key = result["usageKey"]
        rank = result.get("rank", "?")

        if confidence < min_confidence:
            print(f"low confidence ({confidence}% < {min_confidence}%)")
            stats["low_confidence"] += 1
            continue

        print(f"OK  key={usage_key}  rank={rank}  conf={confidence}%")
        stats["found"] += 1

        if dry_run:
            continue

        new_block = re.sub(
            r"\s*\.$",
            f" ;\n    rdfs:seeAlso {GBIF_PREFIX}:{usage_key} .",
            original_block.rstrip(),
        )
        replacements.append((original_block, new_block))

    if not dry_run:
        for original, replacement in replacements:
            content = content.replace(original, replacement, 1)

        if replacements:
            content = ensure_gbif_prefix(content)

        with open(output_path, "w", encoding="utf-8") as fh:
            fh.write(content)
        print(f"\nSaved: {output_path}")
    else:
        print("\n[DRY RUN] No files written.")

    print("\nSummary")
    print(f"  Links added     : {stats['found']}")
    print(f"  Already present : {stats['skipped_existing']}")
    print(f"  No GBIF match   : {stats['no_hit']}")
    print(f"  Low confidence  : {stats['low_confidence']}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Add rdfs:seeAlso GBIF links to a Turtle OWL file."
    )
    parser.add_argument("input", help="Input OWL file path")
    parser.add_argument("-o", "--output", help="Output OWL file path")
    parser.add_argument(
        "--min-confidence",
        type=int,
        default=80,
        help="Minimum GBIF confidence percentage",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Look up matches without writing files",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Show skipped blocks")
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
