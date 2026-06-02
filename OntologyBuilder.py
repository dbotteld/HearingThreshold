import argparse
import re

import pandas as pd
from rdflib import Graph, Literal, Namespace, RDF, RDFS, XSD
from rdflib.namespace import OWL

import requests

EX = Namespace("https://github.com/dbotteld/HearingThreshold/blob/main/")
GBIF = Namespace("https://www.gbif.org/species/")


def to_safe_id(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", str(text).strip()).strip("_")


def ensure_class(g, uri, label, parent=None, rank=None):
    if (uri, RDF.type, OWL.Class) not in g:
        g.add((uri, RDF.type, OWL.Class))
        g.add((uri, RDFS.label, Literal(label, lang="en")))
        if parent:
            g.add((uri, RDFS.subClassOf, parent))
        if rank:
            g.add((uri, EX.rank, Literal(rank, lang="en")))


def ensure_individual(g, uri, rdf_type, label):
    if (uri, RDF.type, OWL.NamedIndividual) not in g:
        g.add((uri, RDF.type, OWL.NamedIndividual))
        g.add((uri, RDF.type, rdf_type))
        g.add((uri, RDFS.label, Literal(label, lang="en")))
        return True
    return False


def ensure_method(g, method_name):
    uri = EX[to_safe_id(method_name)]
    ensure_individual(g, uri, EX.MeasurementMethod, method_name)
    return uri


def bootstrap_schema(g):
    g.bind("ex", EX)
    g.bind("gbif", GBIF)

    for uri, label in [
        (EX.Animal, "Animal"),
        (EX.HearingThresholdMeasurementCampaign, "Hearing Threshold Measurement Campaign"),
        (EX.HearingThresholdMeasurement, "Hearing Threshold Measurement"),
        (EX.MeasurementMethod, "Measurement Method"),
    ]:
        if (uri, RDF.type, OWL.Class) not in g:
            g.add((uri, RDF.type, OWL.Class))
            g.add((uri, RDFS.label, Literal(label, lang="en")))

    obj_props = [
        #(
        #    EX.hasHearingThresholdCampaign,
        #    "has HT Measurement Campaign",
        #    EX.Animal,
        #    EX.HearingThresholdMeasurementCampaign,
        #),
        (
            EX.measuredOnTaxon,
            "is measured on Taxon",
            EX.HearingThresholdMeasurementCampaign,
            EX.Animal,
        ),
        (
            EX.usesMeasurementMethod,
            "uses Measurement Method",
            EX.HearingThresholdMeasurementCampaign,
            EX.MeasurementMethod,
        ),
        (
            EX.hasMeasurement,
            "contains frequency-level pair",
            EX.HearingThresholdMeasurementCampaign,
            EX.HearingThresholdMeasurement,
        ),
        (
            EX.partOf,
            "is part of",
            EX.HearingThresholdMeasurement,
            EX.HearingThresholdMeasurementCampaign,
        ),
             
 #       (EX.measuredWithMethod, "measured with Method", EX.Animal, EX.MeasurementMethod),
    ]
    for uri, label, domain, range_ in obj_props:
        if (uri, RDF.type, OWL.ObjectProperty) not in g:
            g.add((uri, RDF.type, OWL.ObjectProperty))
            g.add((uri, RDFS.label, Literal(label, lang="en")))
            g.add((uri, RDFS.domain, domain))
            g.add((uri, RDFS.range, range_))

    data_props = [
        (EX.frequency, "frequency [Hz]", XSD.double, EX.HearingThresholdMeasurement),
        (EX.thresholdLevel, "threshold [dB]", XSD.double, EX.HearingThresholdMeasurement),
        (EX.pubID, "publication ID", XSD.string, EX.HearingThresholdMeasurementCampaign),
        (EX.pubAuthor, "publication author", XSD.string, EX.HearingThresholdMeasurementCampaign),
        (EX.pubYear, "publication year", XSD.integer, EX.HearingThresholdMeasurementCampaign),
        (EX.pubDOI, "publication DOI", XSD.string, EX.HearingThresholdMeasurementCampaign),
        (EX.pubTitle, "publication title", XSD.string, EX.HearingThresholdMeasurementCampaign),
#        (EX.commonName, "common name", XSD.string, EX.Animal),
#        (EX.rank, "rank", XSD.string, EX.Animal),
    ]
    for uri, label, dtype, domain in data_props:
        if (uri, RDF.type, OWL.DatatypeProperty) not in g:
            g.add((uri, RDF.type, OWL.DatatypeProperty))
            g.add((uri, RDFS.label, Literal(label, lang="en")))
            g.add((uri, RDFS.domain, domain))
            g.add((uri, RDFS.range, dtype))

    annotation_props = [
        (EX.rank, "taxonomic rank", EX.Animal, XSD.string),
        (EX.commonName, "common name", EX.Animal, XSD.string),
        (EX.hasHearingThresholdCampaign, "has HT Measurement Campaign", EX.Animal, EX.HearingThresholdMeasurementCampaign)
    ]
    for uri, label, domain, dtype in annotation_props:
        if (uri, RDF.type, OWL.AnnotationProperty) not in g:
            g.add((uri, RDF.type, OWL.AnnotationProperty))
            g.add((uri, RDFS.label, Literal(label, lang="en")))
            g.add((uri, RDFS.domain, domain))
            g.add((uri, RDFS.range, dtype))



def build_taxonomy(g, row):
    parent = EX.Animal
    for col in ("TAX_CLASS", "TAX_ORDER", "TAX_FAMILY", "TAX_GENUS"):
        val = row.get(col)
        if pd.isna(val) or str(val).strip() == "":
            continue
        uri = EX[to_safe_id(val)]
        ensure_class(g, uri, str(val).strip(), parent)
        parent = uri

    genus_class_uri = parent
    species_name = str(row["TAX_LAT"]).strip()
    species_uri = EX[to_safe_id(species_name)]
    english_name = str(row.get("TAX_ENG", "")).strip() or species_name

    if (species_uri, RDF.type, OWL.NamedIndividual) not in g:
        g.add((species_uri, RDF.type, OWL.NamedIndividual))
        g.add((species_uri, RDF.type, genus_class_uri))
        g.add((species_uri, RDFS.label, Literal(species_name, lang="en")))
        g.add((species_uri, EX.commonName, Literal(english_name, datatype=XSD.string)))

    return species_uri

def get_common_name(name):
    name = name.strip()
    # ✅ Query GBIF species API
    match_url = "https://api.gbif.org/v1/species/match"
    r = requests.get(match_url, params={"name": name})

    if r.status_code != 200:
        print(f"GBIF lookup failed for {name}")
        return Literal(" ", lang="en")

    data = r.json()
    if "usageKey" not in data:
        print(f"No GBIF match for {name}")
        return Literal(" ", lang="en")

    usage_key = data["usageKey"]

    # ✅ get vernacular (common) names
    vernacular_url = f"https://api.gbif.org/v1/species/{usage_key}/vernacularNames"
    r3 = requests.get(vernacular_url)

    common_name = None

    if r3.status_code == 200:
        vernaculars = r3.json().get("results", [])

    # ✅ prefer English name if available
        for v in vernaculars:
            if v.get("language") == "eng":
                common_name = v.get("vernacularName")
                break

    # fallback: take first available
        if not common_name and vernaculars:
            common_name = vernaculars[0].get("vernacularName")
    print(common_name)
    return Literal(common_name, lang="en")
    
def find_taxonomy(g, species_name: str):
    species_name = species_name.strip()
    species_uri = EX[to_safe_id(species_name)]

    # ✅ 1. Already in ontology?
    if (species_uri, RDF.type, OWL.Class) in g:
        return species_uri

    # ✅ 2. Query GBIF species API
    match_url = "https://api.gbif.org/v1/species/match"
    r = requests.get(match_url, params={"name": species_name})

    if r.status_code != 200:
        print(f"GBIF lookup failed for {species_name}")
        return None

    data = r.json()
    if "usageKey" not in data:
        print(f"No GBIF match for {species_name}")
        return None

    usage_key = data["usageKey"]

    # ✅ 3. Get full taxonomy
    species_url = f"https://api.gbif.org/v1/species/{usage_key}"
    r2 = requests.get(species_url)
    if r2.status_code != 200:
        return None

    tax = r2.json()

    # ✅ 4. Extract hierarchy (top-down)
    hierarchy = [
        ("class", tax.get("class")),
        ("order", tax.get("order")),
        ("family", tax.get("family")),
        ("genus", tax.get("genus")),
    ]

    parent = EX.Animal

    for rank, value in hierarchy:
        if not value:
            continue

        uri = EX[to_safe_id(value)]
        ensure_class(g, uri, value, parent=parent, rank=rank)
        g.add((uri, EX.commonName, get_common_name(value)))
        parent = uri

    # ✅ 5. Add species as individual of lowest available rank --> replaced by lowest class; campaign is individual
    #if parent:
        #g.add((species_uri, RDF.type, OWL.NamedIndividual))
        #g.add((species_uri, RDF.type, parent))
    #    g.add((species_uri, RDFS.label, Literal(species_name, lang="en")))
    ensure_class(g, species_uri, species_name, parent)
    g.add((species_uri, EX.commonName, get_common_name(species_name)))
    # ✅ 6. Link to GBIF resource (very useful!)
    g.add((species_uri, RDFS.seeAlso, GBIF[str(usage_key)]))

    return species_uri
       


def build_campaign(g, audiogram_id, row, species_uri):
    pub_id = str(row.get("PUB_ID", "")).strip()
    campaign_uri = EX[f"Campaign_{to_safe_id(audiogram_id)}"]

    if (campaign_uri, RDF.type, OWL.NamedIndividual) in g:
        return campaign_uri

    label = f"{str(row.get('TAX_LAT', '?')).strip()} {row.get('METHOD_GROUPED') or row.get('METHOD', '')} {pub_id}"
    g.add((campaign_uri, RDF.type, OWL.NamedIndividual))
    g.add((campaign_uri, RDF.type, EX.HearingThresholdMeasurementCampaign))
    g.add((campaign_uri, RDFS.label, Literal(label, lang="en")))
    g.add((campaign_uri, EX.measuredOnTaxon, species_uri))
    g.add((species_uri, EX.hasHearingThresholdCampaign, campaign_uri))

    method_val = row.get("METHOD_GROUPED") or row.get("METHOD")
    if pd.notna(method_val) and str(method_val).strip():
        method_uri = ensure_method(g, str(method_val).strip())
        g.add((campaign_uri, EX.usesMeasurementMethod, method_uri))
        #g.add((species_uri, EX.measuredWithMethod, method_uri))

    for col, prop, dtype in [
        ("PUB_ID", EX.pubID, XSD.string),
        ("PUB_AUTHOR", EX.pubAuthor, XSD.string),
        ("PUB_YEAR", EX.pubYear, XSD.integer),
        ("PUB_DOI", EX.pubDOI, XSD.string),
        ("PUB_TITLE", EX.pubTitle, XSD.string),
    ]:
        val = row.get(col)
        if pd.notna(val) and str(val).strip():
            try:
                lit = (
                    Literal(int(float(val)), datatype=dtype)
                    if dtype == XSD.integer
                    else Literal(str(val).strip(), datatype=dtype)
                )
                g.add((campaign_uri, prop, lit))
            except (ValueError, TypeError):
                pass

    return campaign_uri


def build_measurement(g, row, campaign_uri, audiogram_id):
    freq_val = row.get("SOUND_FREQ")
    db_val = row.get("THRESHOLD_DB_MEAN")

    if pd.isna(freq_val) or pd.isna(db_val):
        return

    freq = float(freq_val)
    db = float(db_val)

    dim = str(row.get("SOUND_DIMENSION") or "").strip().lower()
    if dim == "khz":
        freq *= 1000

    freq_id = str(int(freq)) if freq == int(freq) else str(freq).replace(".", "_")
    m_uri = EX[f"HT_{to_safe_id(audiogram_id)}_{freq_id}Hz"]

    if (m_uri, RDF.type, OWL.NamedIndividual) in g:
        return

    g.add((m_uri, RDF.type, OWL.NamedIndividual))
    g.add((m_uri, RDF.type, EX.HearingThresholdMeasurement))
    g.add((m_uri, EX.frequency, Literal(freq, datatype=XSD.double)))
    g.add((m_uri, EX.thresholdLevel, Literal(db, datatype=XSD.double)))
    g.add((m_uri, EX.partOf, campaign_uri))
    g.add((campaign_uri, EX.hasMeasurement, m_uri))


def main():
    parser = argparse.ArgumentParser(
        description="Import taxonomy, campaigns, and measurements from xlsx into an OWL file."
    )
    parser.add_argument("xlsx", help="Path to data_export_ghent.xlsx")
    parser.add_argument("owl", help="Path to the OWL file")
    parser.add_argument(
        "--sheet",
        default="Data - Sources, Taxonomy, Audio",
        help="Worksheet name to read",
    )
    args = parser.parse_args()

    g = Graph()
    try:
        g.parse(args.owl, format="turtle")
        print(f"Loaded existing OWL file: {args.owl} ({len(g)} triples)")
    except FileNotFoundError:
        print(f"No existing OWL file found, creating one: {args.owl}")

    bootstrap_schema(g)

    df = pd.read_excel(
        args.xlsx,
        sheet_name=args.sheet,
        dtype=str,
        engine="openpyxl",
    )
    df = df.dropna(subset=["TAX_LAT", "AUDIOGRAMM_ID"])

    seen_campaigns: set = set()
    n_measurements = 0

    for _, row in df.iterrows():
        audiogram_id = str(row["AUDIOGRAMM_ID"]).strip()
        species_uri = find_taxonomy(g, row.get("TAX_LAT"))
        campaign_uri = build_campaign(g, audiogram_id, row, species_uri)

        build_measurement(g, row, campaign_uri, audiogram_id)
        n_measurements += 1
        seen_campaigns.add(audiogram_id)

    g.serialize(args.owl, format="turtle")
    print(
        f"Saved: {args.owl} ({len(g)} triples, "
        f"{len(seen_campaigns)} campaigns, {n_measurements} measurements)"
    )


if __name__ == "__main__":
    main()
