(function () {
  "use strict";

  let DATA = { meta: {}, species: [] };
  const EX = "https://github.com/dbotteld/HearingThreshold/blob/main/";
  const ONTOLOGY_SOURCE = window.HT_ONTOLOGY_SOURCE || "newHT6.owl";
  const params = new URLSearchParams(location.search);
  const state = {
    options: null,
    speciesId: params.get("species") || "",
    campaignId: params.get("campaign") || "",
    mode: "broadband",
    layers: [],
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatHz(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    if (number >= 1000) {
      const khz = number / 1000;
      return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
    }
    return `${Number.isInteger(number) ? number.toFixed(0) : number.toFixed(1)} Hz`;
  }

  function formatDb(value) {
    return `${Number(value).toFixed(1)} dB`;
  }

  function cleanValue(value) {
    const text = String(value ?? "").trim();
    return ["", "nan", "none", "null"].includes(text.toLowerCase()) ? "" : text;
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function localName(uri) {
    const text = String(uri ?? "");
    if (!text) return "";
    if (text.includes("#")) return text.split("#").pop();
    return text.replace(/\/$/, "").split("/").pop();
  }

  function bindingValue(binding, key) {
    return binding.get(key)?.value || "";
  }

  async function loadOntologySource() {
    const candidates = unique([ONTOLOGY_SOURCE]);
    let lastError = null;

    for (const source of candidates) {
      try {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return {
          label: source,
          comunicaSource: {
            type: "serialized",
            value: await response.text(),
            mediaType: "text/turtle",
            baseIRI: EX,
          },
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`Could not load ontology source: ${lastError?.message || "unknown error"}`);
  }

  async function queryRows(engine, source, query) {
    const rows = [];
    const bindings = await engine.queryBindings(query, { sources: [source] });
    for await (const binding of bindings) rows.push(binding);
    return rows;
  }

  function taxonomyPathFor(uri, classMap) {
    const path = [];
    const seen = new Set();
    let current = uri;

    while (current && !seen.has(current)) {
      seen.add(current);
      const record = classMap.get(current);
      if (!record) break;
      path.unshift(record.label || localName(current).replaceAll("_", " "));
      current = record.parent;
    }

    return path;
  }

  function buildOntologyData(sourceFile, classRows, campaignRows, measurementRows) {
    const classMap = new Map();
    classRows.forEach((row) => {
      const uri = bindingValue(row, "class");
      if (!uri) return;
      if (!classMap.has(uri)) classMap.set(uri, { label: "", commonName: "", parent: "", seeAlso: [] });
      const record = classMap.get(uri);
      record.label ||= cleanValue(bindingValue(row, "label")) || localName(uri).replaceAll("_", " ");
      record.commonName ||= cleanValue(bindingValue(row, "common"));
      record.parent ||= bindingValue(row, "parent");
      const gbif = bindingValue(row, "gbif");
      if (gbif && !record.seeAlso.includes(gbif)) record.seeAlso.push(gbif);
    });

    const measurementsByCampaign = new Map();
    const seenMeasurements = new Set();
    measurementRows.forEach((row) => {
      const measurement = bindingValue(row, "measurement");
      const campaign = bindingValue(row, "campaign");
      const frequency = Number(bindingValue(row, "frequency"));
      const threshold = Number(bindingValue(row, "threshold"));
      if (!campaign || !Number.isFinite(frequency) || !Number.isFinite(threshold) || frequency <= 0) return;
      const key = `${campaign}|${measurement || frequency + "|" + threshold}`;
      if (seenMeasurements.has(key)) return;
      seenMeasurements.add(key);
      if (!measurementsByCampaign.has(campaign)) measurementsByCampaign.set(campaign, []);
      measurementsByCampaign.get(campaign).push({ frequency, threshold });
    });

    const speciesByUri = new Map();
    campaignRows.forEach((row) => {
      const speciesUri = bindingValue(row, "species");
      const campaignUri = bindingValue(row, "campaign");
      if (!speciesUri || !campaignUri) return;
      const speciesRecord = classMap.get(speciesUri) || { label: localName(speciesUri).replaceAll("_", " "), commonName: "", parent: "", seeAlso: [] };
      const taxonomy = taxonomyPathFor(speciesUri, classMap);

      if (!speciesByUri.has(speciesUri)) {
        speciesByUri.set(speciesUri, {
          id: localName(speciesUri),
          iri: speciesUri,
          scientificName: speciesRecord.label,
          commonName: speciesRecord.commonName,
          group: taxonomy[1] || "Animal",
          taxonomy,
          gbifUrl: speciesRecord.seeAlso.find((link) => link.toLowerCase().includes("gbif.org")) || "",
          seeAlso: [...speciesRecord.seeAlso],
          campaigns: [],
        });
      }

      const methodUri = bindingValue(row, "method");
      const methodLabel = cleanValue(bindingValue(row, "methodLabel"));
      speciesByUri.get(speciesUri).campaigns.push({
        id: localName(campaignUri),
        iri: campaignUri,
        label: cleanValue(bindingValue(row, "campaignLabel")) || localName(campaignUri).replaceAll("_", " "),
        method: methodLabel || (methodUri ? localName(methodUri).replaceAll("_", " ") : "Unknown method"),
        publicationId: cleanValue(bindingValue(row, "pubID")),
        authors: cleanValue(bindingValue(row, "pubAuthor")),
        year: cleanValue(bindingValue(row, "pubYear")),
        title: cleanValue(bindingValue(row, "pubTitle")),
        doi: cleanValue(bindingValue(row, "pubDOI")),
        measurements: (measurementsByCampaign.get(campaignUri) || []).sort((a, b) => a.frequency - b.frequency),
      });
    });

    const species = [...speciesByUri.values()].sort((a, b) => a.scientificName.localeCompare(b.scientificName));
    species.forEach((item) => item.campaigns.sort((a, b) => a.label.localeCompare(b.label)));
    return { meta: { sourceFile }, species };
  }

  async function loadOntologyData() {
    if (!window.Comunica?.QueryEngine) throw new Error("Comunica query engine is not loaded.");
    const { label: sourceFile, comunicaSource } = await loadOntologySource();
    const engine = new Comunica.QueryEngine();
    const prefixes = `
      PREFIX ex: <https://github.com/dbotteld/HearingThreshold/blob/main/>
      PREFIX owl: <http://www.w3.org/2002/07/owl#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    `;

    const [classRows, campaignRows, measurementRows] = await Promise.all([
      queryRows(engine, comunicaSource, `${prefixes}
        SELECT ?class ?label ?common ?parent ?gbif WHERE {
          ?class a owl:Class .
          OPTIONAL { ?class rdfs:label ?label . }
          OPTIONAL { ?class ex:commonName ?common . }
          OPTIONAL { ?class rdfs:subClassOf ?parent . }
          OPTIONAL { ?class rdfs:seeAlso ?gbif . }
        }
      `),
      queryRows(engine, comunicaSource, `${prefixes}
        SELECT ?species ?campaign ?campaignLabel ?method ?methodLabel ?pubID ?pubAuthor ?pubYear ?pubTitle ?pubDOI WHERE {
          ?species ex:hasHearingThresholdCampaign ?campaign .
          ?campaign a ex:HearingThresholdMeasurementCampaign .
          OPTIONAL { ?campaign rdfs:label ?campaignLabel . }
          OPTIONAL {
            ?campaign ex:usesMeasurementMethod ?method .
            OPTIONAL { ?method rdfs:label ?methodLabel . }
          }
          OPTIONAL { ?campaign ex:pubID ?pubID . }
          OPTIONAL { ?campaign ex:pubAuthor ?pubAuthor . }
          OPTIONAL { ?campaign ex:pubYear ?pubYear . }
          OPTIONAL { ?campaign ex:pubTitle ?pubTitle . }
          OPTIONAL { ?campaign ex:pubDOI ?pubDOI . }
        }
      `),
      queryRows(engine, comunicaSource, `${prefixes}
        SELECT ?measurement ?campaign ?frequency ?threshold WHERE {
          ?measurement a ex:HearingThresholdMeasurement ;
            ex:frequency ?frequency ;
            ex:thresholdLevel ?threshold .
          { ?measurement ex:partOf ?campaign . }
          UNION
          { ?campaign ex:hasMeasurement ?measurement . }
        }
      `),
    ]);

    return buildOntologyData(sourceFile, classRows, campaignRows, measurementRows);
  }

  function selectedSpecies() {
    return DATA.species.find((species) => species.id === state.speciesId) || DATA.species[0] || null;
  }

  function selectedCampaign() {
    const species = selectedSpecies();
    if (!species) return null;
    return species.campaigns.find((campaign) => campaign.id === state.campaignId) || species.campaigns[0] || null;
  }

  function setStatus(message, isError = false) {
    $("mapStatus").textContent = message;
    $("mapStatus").classList.toggle("error", isError);
  }

  function populateSpecies() {
    $("speciesSelect").innerHTML = DATA.species
      .map((species) => `<option value="${escapeHtml(species.id)}">${escapeHtml(species.scientificName)}${species.commonName ? ` (${escapeHtml(species.commonName)})` : ""}</option>`)
      .join("");
    $("speciesSelect").value = selectedSpecies()?.id || "";
    populateCampaigns();
  }

  function populateCampaigns() {
    const species = selectedSpecies();
    const campaigns = species?.campaigns || [];
    if (!campaigns.some((campaign) => campaign.id === state.campaignId)) {
      state.campaignId = campaigns[0]?.id || "";
    }
    $("campaignSelect").innerHTML = campaigns
      .map((campaign) => `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.label || campaign.title || campaign.id)}</option>`)
      .join("");
    $("campaignSelect").value = state.campaignId;
    renderWeightingSummary();
  }

  function populateMapOptions() {
    const options = state.options;
    $("siteSelect").innerHTML = options.sites.map((site) => `<option value="${site}">${site}</option>`).join("");
    $("hubSelect").innerHTML = options.hubs.map((hub) => `<option value="${hub}">${hub}</option>`).join("");
    $("receiverSelect").innerHTML = options.receivers.map((receiver) => `<option value="${receiver}">${receiver.replace("p", ".")}</option>`).join("");
    $("frequencySelect").innerHTML = options.frequencies.map((frequency) => `<option value="${frequency}">${formatHz(frequency)}</option>`).join("");
    $("frequencySelect").value = options.frequencies.includes(1000) ? "1000" : String(options.frequencies[0]);
    $("multiFrequencyField").innerHTML = options.frequencies
      .map((frequency) => `
        <label>
          <input type="checkbox" value="${frequency}" ${frequency >= 100 && frequency <= 10000 ? "checked" : ""} />
          <span>${formatHz(frequency)}</span>
        </label>
      `)
      .join("");
  }

  function renderWeightingSummary() {
    const species = selectedSpecies();
    const campaign = selectedCampaign();
    if (!species || !campaign) return;
    $("mapSubtitle").textContent = species.scientificName;
    $("weightingSummary").textContent = `${species.scientificName}${species.commonName ? ` (${species.commonName})` : ""}, ${campaign.label || campaign.id}. The preview applies the selected animal-to-human weighting directly to the wind-turbine sound pressure raster.`;
  }

  function currentFrequencyList() {
    if (state.mode === "frequency") return [$("frequencySelect").value];
    if (state.mode === "multi") {
      return [...document.querySelectorAll("#multiFrequencyField input:checked")].map((input) => input.value);
    }
    return [];
  }

  function currentLayerRequest() {
    const species = selectedSpecies();
    const campaign = selectedCampaign();
    const frequencies = currentFrequencyList();
    const labelBits = [
      $("siteSelect").value,
      $("hubSelect").value,
      $("receiverSelect").value.replace("p", "."),
    ];
    let label = "";
    if (state.mode === "broadband") label = `Weighted broadband - ${labelBits.join(" - ")}`;
    if (state.mode === "overall") label = `Unweighted broadband - ${labelBits.join(" - ")}`;
    if (state.mode === "frequency") label = `${formatHz(frequencies[0])} weighted - ${labelBits.join(" - ")}`;
    if (state.mode === "multi") label = `${frequencies.length} bands weighted - ${labelBits.join(" - ")}`;

    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label,
      speciesId: species.id,
      speciesName: species.scientificName,
      campaignId: campaign.id,
      mode: state.mode,
      site: $("siteSelect").value,
      hub: $("hubSelect").value,
      receiver: $("receiverSelect").value,
      frequencies,
      checked: true,
      meta: null,
    };
  }

  function layerQuery(layer, endpoint) {
    const params = new URLSearchParams({
      species: layer.speciesId,
      campaign: layer.campaignId,
      mode: layer.mode,
      site: layer.site,
      hub: layer.hub,
      receiver: layer.receiver,
      freqs: layer.frequencies.join(","),
    });
    if (endpoint === "render_png") params.set("layer", layer.id);
    return `/api/${endpoint}?${params.toString()}`;
  }

  async function addSelectedLayer() {
    if (!selectedSpecies() || !selectedCampaign()) return;
    if ((state.mode === "frequency" || state.mode === "multi") && currentFrequencyList().length === 0) {
      setStatus("Select at least one frequency.", true);
      return;
    }

    const layer = currentLayerRequest();
    state.layers.unshift(layer);
    state.layers.forEach((item, index) => {
      item.checked = index === 0 ? true : item.checked;
    });
    renderLayerList();
    await showTopCheckedLayer();
  }

  async function showTopCheckedLayer() {
    const layer = state.layers.find((item) => item.checked);
    if (!layer) {
      $("weightedPreview").removeAttribute("src");
      $("downloadActiveTiff").removeAttribute("href");
      $("legendPane").hidden = true;
      $("previewTitle").textContent = "Weighted raster";
      setStatus("No layer is checked.");
      return;
    }

    try {
      setStatus("Rendering weighted raster...");
      const metaResponse = await fetch(layerQuery(layer, "render_meta"));
      if (!metaResponse.ok) throw new Error(await metaResponse.text());
      layer.meta = await metaResponse.json();
      $("weightedPreview").src = layerQuery(layer, "render_png");
      $("downloadActiveTiff").href = layerQuery(layer, "download_tiff");
      $("previewTitle").textContent = layer.label;
      renderLegend(layer);
      renderLayerList();
      setStatus(`Showing ${layer.label}`);
    } catch (error) {
      setStatus(error.message || "Could not render layer.", true);
    }
  }

  function renderLayerList() {
    const list = $("layerList");
    if (!state.layers.length) {
      list.innerHTML = `<div class="empty">No raster layers added yet.</div>`;
      return;
    }
    list.innerHTML = state.layers
      .map((layer, index) => `
        <article class="layer-row">
          <label>
            <input type="checkbox" data-layer-check="${layer.id}" ${layer.checked ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(layer.label)}</strong>
              <small>${escapeHtml(layer.speciesName)}${layer.meta ? ` - ${formatDb(layer.meta.min)} to ${formatDb(layer.meta.max)}` : ""}</small>
            </span>
          </label>
          <div class="layer-actions">
            <button type="button" data-layer-up="${layer.id}" ${index === 0 ? "disabled" : ""}>Up</button>
            <a href="${layerQuery(layer, "download_tiff")}" download>TIFF</a>
            <button type="button" data-layer-remove="${layer.id}">Remove</button>
          </div>
        </article>
      `)
      .join("");

    list.querySelectorAll("[data-layer-check]").forEach((input) => {
      input.addEventListener("change", () => {
        const layer = state.layers.find((item) => item.id === input.dataset.layerCheck);
        if (layer) layer.checked = input.checked;
        showTopCheckedLayer();
      });
    });
    list.querySelectorAll("[data-layer-up]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = state.layers.findIndex((item) => item.id === button.dataset.layerUp);
        if (index > 0) {
          const [layer] = state.layers.splice(index, 1);
          state.layers.splice(index - 1, 0, layer);
          renderLayerList();
          showTopCheckedLayer();
        }
      });
    });
    list.querySelectorAll("[data-layer-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        state.layers = state.layers.filter((item) => item.id !== button.dataset.layerRemove);
        renderLayerList();
        showTopCheckedLayer();
      });
    });
  }

  function renderLegend(layer) {
    if (!layer.meta) return;
    $("legendPane").hidden = false;
    $("legendTitle").textContent = layer.label;
    $("legendMin").textContent = formatDb(layer.meta.min);
    $("legendMax").textContent = formatDb(layer.meta.max);
    const canvas = $("legendCanvas");
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    [
      [0, "#00007f"],
      [0.125, "#0000ff"],
      [0.375, "#00ffff"],
      [0.625, "#ffff00"],
      [0.875, "#ff0000"],
      [1, "#7f0000"],
    ].forEach(([stop, color]) => gradient.addColorStop(stop, color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function updateModeFields() {
    $("singleFrequencyField").hidden = state.mode !== "frequency";
    $("multiFrequencyField").hidden = state.mode !== "multi";
  }

  async function loadOptions() {
    try {
      const response = await fetch("/api/map-options");
      if (!response.ok) throw new Error(await response.text());
      state.options = await response.json();
      populateMapOptions();
      setStatus("Rendering default weighted raster...");
      return true;
    } catch (error) {
      setStatus("Map API is not running. Start it with: python wind_map_server.py", true);
      return false;
    }
  }

  async function init() {
    try {
      DATA = await loadOntologyData();
    } catch (error) {
      setStatus(error.message || "Could not load ontology data.", true);
      return;
    }
    if (!state.speciesId) state.speciesId = DATA.species?.[0]?.id || "";
    populateSpecies();
    const loaded = await loadOptions();
    updateModeFields();
    renderLayerList();

    $("speciesSelect").addEventListener("change", () => {
      state.speciesId = $("speciesSelect").value;
      populateCampaigns();
    });
    $("campaignSelect").addEventListener("change", () => {
      state.campaignId = $("campaignSelect").value;
      renderWeightingSummary();
    });
    document.querySelectorAll("input[name='mapMode']").forEach((input) => {
      input.addEventListener("change", () => {
        state.mode = input.value;
        updateModeFields();
      });
    });
    $("refreshLayer").addEventListener("click", addSelectedLayer);
    $("clearLayers").addEventListener("click", () => {
      state.layers = [];
      renderLayerList();
      showTopCheckedLayer();
    });

    if (loaded) {
      await addSelectedLayer();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
