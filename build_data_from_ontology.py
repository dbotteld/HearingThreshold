from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

from rdflib import Graph, Namespace, RDF, RDFS, OWL

EX = Namespace("https://github.com/dbotteld/HearingThreshold/blob/main/")
ANIMAL = EX.Animal


def clean_literal(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in {"nan", "none", "null"}:
        return ""
    return text


def local_name(uri: Any) -> str:
    text = str(uri)
    if "#" in text:
        return text.rsplit("#", 1)[-1]
    return text.rstrip("/").rsplit("/", 1)[-1]


def label(g: Graph, uri: Any) -> str:
    return clean_literal(next(g.objects(uri, RDFS.label), None)) or local_name(uri).replace("_", " ")


def number_literal(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(str(value))
        if math.isnan(number):
            return None
        return number
    except Exception:
        return None


def campaign_measurement_uris(g: Graph, campaign_uri: Any) -> list[Any]:
    uris: list[Any] = []
    seen = set()

    for measurement_uri in g.objects(campaign_uri, EX.hasMeasurement):
        if measurement_uri not in seen:
            seen.add(measurement_uri)
            uris.append(measurement_uri)

    for measurement_uri in g.subjects(EX.partOf, campaign_uri):
        if measurement_uri not in seen:
            seen.add(measurement_uri)
            uris.append(measurement_uri)

    return uris


def cleaned_measurements(g: Graph, campaign_uri: Any) -> list[dict[str, float]]:
    buckets: dict[float, list[float]] = {}

    for measurement_uri in campaign_measurement_uris(g, campaign_uri):
        frequency = number_literal(next(g.objects(measurement_uri, EX.frequency), None))
        threshold = number_literal(next(g.objects(measurement_uri, EX.thresholdLevel), None))
        if frequency is None or threshold is None or frequency <= 0:
            continue
        buckets.setdefault(frequency, []).append(threshold)

    return [
        {
            "frequency": frequency,
            "threshold": sum(thresholds) / len(thresholds),
        }
        for frequency, thresholds in sorted(buckets.items())
    ]


def class_ancestors(g: Graph, class_uri: Any) -> list[Any]:
    ancestors: list[Any] = []
    seen = set()
    current = class_uri

    while current and current not in seen:
        seen.add(current)
        ancestors.append(current)
        parents = list(g.objects(current, RDFS.subClassOf))
        if not parents:
            break
        current = parents[0]

    return ancestors


def is_taxon_class(g: Graph, uri: Any) -> bool:
    return uri == ANIMAL or ANIMAL in class_ancestors(g, uri)


def species_taxon_class(g: Graph, species_uri: Any) -> Any | None:
    if (species_uri, RDF.type, OWL.Class) in g:
        return species_uri

    typed_classes = [
        type_uri
        for type_uri in g.objects(species_uri, RDF.type)
        if type_uri != OWL.NamedIndividual and is_taxon_class(g, type_uri)
    ]
    if typed_classes:
        return sorted(typed_classes, key=lambda uri: len(class_ancestors(g, uri)), reverse=True)[0]

    return None


def taxonomy_path(g: Graph, species_uri: Any) -> list[str]:
    path: list[str] = []
    taxon_class = species_taxon_class(g, species_uri)
    class_path = class_ancestors(g, taxon_class) if taxon_class else []

    for uri in reversed(class_path):
        current_label = label(g, uri)
        if current_label and current_label not in path:
            path.append(current_label)

    species_label = label(g, species_uri)
    if species_label and species_label not in path:
        path.append(species_label)

    return path


def see_also_links(g: Graph, species_uri: Any) -> list[str]:
    links: list[str] = []
    candidates = [species_uri]
    taxon_class = species_taxon_class(g, species_uri)
    if taxon_class:
        candidates.extend(class_ancestors(g, taxon_class))

    for uri in candidates:
        for link in g.objects(uri, RDFS.seeAlso):
            text = str(link)
            if text not in links:
                links.append(text)

    return links


def parse_ontology(input_path: Path) -> dict[str, Any]:
    g = Graph()

    errors: list[str] = []
    for fmt in ["turtle", "xml", "n3"]:
        try:
            g.parse(input_path, format=fmt)
            break
        except Exception as exc:
            errors.append(f"{fmt}: {exc}")
    else:
        raise RuntimeError("Could not parse ontology. Tried Turtle, RDF/XML, and N3.\n" + "\n".join(errors))

    species_items: list[dict[str, Any]] = []

    species_uris = set(g.subjects(EX.hasHearingThresholdCampaign, None))

    for species_uri in sorted(species_uris, key=lambda u: label(g, u).lower()):
        campaign_uris = list(g.objects(species_uri, EX.hasHearingThresholdCampaign))
        if not campaign_uris:
            continue

        common_name = clean_literal(next(g.objects(species_uri, EX.commonName), None))
        scientific_name = label(g, species_uri)
        tax_path = taxonomy_path(g, species_uri)
        group = tax_path[1] if len(tax_path) > 1 else "Animal"
        links = see_also_links(g, species_uri)

        campaigns: list[dict[str, Any]] = []
        for campaign_uri in sorted(campaign_uris, key=lambda u: label(g, u).lower()):
            method_uri = next(g.objects(campaign_uri, EX.usesMeasurementMethod), None)
            method = label(g, method_uri) if method_uri else "Unknown method"

            measurements = cleaned_measurements(g, campaign_uri)

            campaigns.append({
                "id": local_name(campaign_uri),
                "label": label(g, campaign_uri),
                "method": method,
                "publicationId": clean_literal(next(g.objects(campaign_uri, EX.pubID), None)),
                "authors": clean_literal(next(g.objects(campaign_uri, EX.pubAuthor), None)),
                "year": clean_literal(next(g.objects(campaign_uri, EX.pubYear), None)),
                "title": clean_literal(next(g.objects(campaign_uri, EX.pubTitle), None)),
                "doi": clean_literal(next(g.objects(campaign_uri, EX.pubDOI), None)),
                "measurements": measurements,
            })

        if campaigns:
            species_items.append({
                "id": local_name(species_uri),
                "iri": str(species_uri),
                "scientificName": scientific_name,
                "commonName": common_name,
                "group": group,
                "taxonomy": tax_path,
                "gbifUrl": next((link for link in links if "gbif.org" in link.lower()), ""),
                "seeAlso": links,
                "campaigns": campaigns,
            })

    total_campaigns = sum(len(s["campaigns"]) for s in species_items)
    total_measurements = sum(len(c["measurements"]) for s in species_items for c in s["campaigns"])

    all_freqs = [m["frequency"] for s in species_items for c in s["campaigns"] for m in c["measurements"]]
    all_thresholds = [m["threshold"] for s in species_items for c in s["campaigns"] for m in c["measurements"]]
    methods = sorted(set(c["method"] for s in species_items for c in s["campaigns"] if c["method"]))

    return {
        "meta": {
            "sourceFile": input_path.name,
            "speciesCount": len(species_items),
            "campaignCount": total_campaigns,
            "measurementCount": total_measurements,
            "methodCount": len(methods),
            "frequencyMin": min(all_freqs) if all_freqs else None,
            "frequencyMax": max(all_freqs) if all_freqs else None,
            "thresholdMin": min(all_thresholds) if all_thresholds else None,
            "thresholdMax": max(all_thresholds) if all_thresholds else None,
            "methods": methods,
        },
        "species": species_items,
    }


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python build_data_from_ontology.py newHT6.owl ontology_data.json", file=sys.stderr)
        raise SystemExit(2)

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    data = parse_ontology(input_path)

    output_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {output_path} with {data['meta']['speciesCount']} species.")


if __name__ == "__main__":
    main()
