# Hearing Threshold Ontology Browser

This is a static GitHub Pages website. It does not need Python or a backend server to run online.

## Files to upload to GitHub

Upload these files to the root of a GitHub repository:

```text
index.html
styles.css
app.js
data.js
```

Then open **Repository -> Settings -> Pages** and set:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/root`

GitHub will give you a public website URL.

## How the data works

The website reads `data.js`, which contains a browser-friendly version of the ontology data.

The website currently supports:

- homepage/database overview
- search by scientific name or common name
- species selection
- campaign selection
- publication/method metadata
- frequency-threshold chart
- raw table
- CSV download for the selected campaign

## Updating the data from Ontology_gbif.owl

If you update `Ontology_gbif.owl`, regenerate `data.js` locally using:

```bash
pip install rdflib
python build_data_from_ontology.py Ontology_gbif.owl data.js
```

Then upload the new `data.js` to GitHub. If the ontology file itself should also be public and citable, upload `Ontology_gbif.owl` as well.

## Important note

GitHub Pages is static, so it cannot run Python as a backend. Python is only used locally to convert the ontology into `data.js`.
