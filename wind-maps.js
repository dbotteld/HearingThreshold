(function () {
  "use strict";

  const DATA = window.HT_DATA || { species: [] };
  const state = {
    options: null,
    speciesId: new URLSearchParams(location.search).get("species") || DATA.species?.[0]?.id || "",
    campaignId: new URLSearchParams(location.search).get("campaign") || "",
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
