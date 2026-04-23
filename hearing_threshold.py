from rdflib import Graph, Namespace, RDF, RDFS, XSD, URIRef, Literal
from rdflib.namespace import OWL, RDF, RDFS
from rdflib.namespace import RDFS


g = Graph()

# Namespaces
EX = Namespace("https://github.com/dbotteld/HearingThreshold/blob/main/")
GBIF = Namespace("https://www.gbif.org/species/")

g.bind("ex", EX)
g.bind("gbif", GBIF)

# Creates classes
g.add((EX.Animal, RDF.type, OWL.Class))
g.add((EX.Animal, RDFS.label,  Literal("Animal", lang="en")))

g.add((EX.Aves, RDF.type, OWL.Class))
g.add((EX.Aves, RDFS.label, Literal("Birds (Aves)", lang="en")))
g.add((EX.Aves, RDFS.subClassOf, EX.Animal))

g.add((EX.Robin, RDF.type, OWL.Class))
g.add((EX.Robin, RDFS.subClassOf, EX.Aves))
g.add((EX.Robin, RDFS.label, Literal("Robin", lang="en")))
g.add((EX.Robin, RDFS.seeAlso, URIRef("https://www.gbif.org/species/2492462")))

# --- measurement campaign related
g.add((EX.HearingThresholdMeasurementCampaign, RDF.type, OWL.Class))
g.add((EX.HearingThresholdMeasurementCampaign, RDFS.label, Literal("Hearing Threshold Measurement Campaign", lang="en")))
g.add((EX.HearingThresholdMeasurement, RDF.type, OWL.Class))
g.add((EX.HearingThresholdMeasurement, RDFS.label, Literal("Hearing Threshold Measurement", lang="en")))
g.add((EX.MeasurementMethod, RDF.type, OWL.Class))
g.add((EX.MeasurementMethod, RDFS.label, Literal("Measurement Method", lang="en")))

# object properties
g.add((EX.hasHearingThresholdCampaign, RDF.type, OWL.ObjectProperty))
g.add((EX.hasHearingThresholdCampaign, RDFS.label, Literal("has HT Measurement Campaign", lang="en")))
g.add((EX.hasHearingThresholdCampaign, RDFS.domain, EX.Animal))
g.add((EX.hasHearingThresholdCampaign, RDFS.range, EX.HearingThresholdMeasurementCampaign))

g.add((EX.hasMeasurement, RDF.type, OWL.ObjectProperty))
g.add((EX.hasMeasurement, RDFS.label, Literal("contain frequency-level pair", lang="en")))

g.add((EX.usesMeasurementMethod, RDF.type, OWL.ObjectProperty))
g.add((EX.usesMeasurementMethod, RDFS.label, Literal("uses Measurement Method", lang="en")))
g.add((EX.usesMeasurementMethod, RDFS.domain, EX.HearingThresholdMeasurementCampaign))
g.add((EX.usesMeasurementMethod, RDFS.range, EX.MeasurementMethod))

g.add((EX.partOf, RDF.type, OWL.ObjectProperty))
g.add((EX.partOf, RDFS.label, Literal("is part of", lang="en")))
g.add((EX.partOf, RDFS.domain, EX.HearingThresholdMeasurement))
g.add((EX.partOf, RDFS.range, EX.HearingThresholdMeasurementCampaign))

g.add((EX.measuredOnTaxon, RDF.type, OWL.ObjectProperty))
g.add((EX.measuredOnTaxon, RDFS.label, Literal("is measured on Taxon", lang="en")))
g.add((EX.measuredOnTaxon, RDFS.domain, EX.HearingThresholdMeasurementCampaign))
g.add((EX.measuredOnTaxon, RDFS.range, EX.Animal)) 

# data properties
g.add((EX.frequency, RDF.type, OWL.DatatypeProperty))
g.add((EX.frequency, RDFS.label, Literal("frequency [Hz]", lang="en")))
g.add((EX.thresholdLevel, RDF.type, OWL.DatatypeProperty))
g.add((EX.thresholdLevel, RDFS.label, Literal("threshold [dB]", lang="en")))

g.add((EX.frequency, RDFS.domain, EX.HearingThresholdMeasurement))
g.add((EX.frequency, RDFS.range, XSD.double))

g.add((EX.thresholdLevel, RDFS.domain, EX.HearingThresholdMeasurement))
g.add((EX.thresholdLevel, RDFS.range, XSD.double))


# Measurement method
g.add((EX.ABR, RDF.type, EX.MeasurementMethod))
g.add((EX.ABR, RDFS.label,
       Literal("Auditory Brainstem Response", lang="en")))

# test adding a Measurement campaign
campaign = EX.Campaign_Robin_ABR_2021
g.add((campaign, RDF.type, EX.HearingThresholdMeasurementCampaign))
g.add((campaign, RDFS.label,
       Literal("Robin ABR hearing study (2021)", lang="en")))

# Link campaign to the Robin CLASS 
g.add((campaign, EX.measuredOnTaxon, EX.Robin))
g.add((EX.Robin, EX.hasHearingThresholdCampaign, campaign))
g.add((campaign, EX.usesMeasurementMethod, EX.ABR))

# Measurement points
measurements = [
    (1000, 20),
    (2000, 15),
    (4000, 25)
]

for f, t in measurements:
    m = URIRef(f"{EX}HT_{f}Hz")
    g.add((m, RDF.type, EX.HearingThresholdMeasurement))
    g.add((m, EX.frequency, Literal(f, datatype=XSD.double)))
    g.add((m, EX.thresholdLevel, Literal(t, datatype=XSD.double)))
    g.add((campaign, EX.hasMeasurement, m))
    g.add((m, EX.partOf, campaign))

# Serialize
g.serialize("hearing_thresholds.owl", format="turtle")
