(function () {
  "use strict";

  const DATA = window.HT_DATA || { meta: {}, species: [] };
  const THIRD_OCTAVE_FREQUENCIES = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
    500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
    6300, 8000, 10000, 12500, 16000, 20000, 25000, 31500, 40000,
  ];
  const HUMAN_THRESHOLDS = {
    20: 78.5, 25: 68.7, 31.5: 59.5, 40: 51.1, 50: 44.0, 63: 37.5,
    80: 31.5, 100: 26.5, 125: 22.1, 160: 17.9, 200: 14.4, 250: 11.4,
    315: 8.6, 400: 6.2, 500: 4.4, 630: 3.0, 800: 2.2, 1000: 2.4,
    1250: 3.5, 1600: 1.7, 2000: -1.3, 2500: -4.2, 3150: -6.0,
    4000: -5.4, 5000: -1.5, 6300: 6.0, 8000: 12.6, 10000: 13.9,
    12500: 12.3, 16000: 18.4, 20000: 40.2, 25000: 55.0,
    31500: 75.0, 40000: 95.0,
  };

  const state = {
    speciesId: DATA.species?.[0]?.id || null,
    campaignId: DATA.species?.[0]?.campaigns?.[0]?.id || null,
    query: "",
    group: "all",
    method: "all",
    coverage: "all",
    chartMode: "measured",
  };

  const $ = (id) => document.getElementById(id);

  function formatNumber(value, maximumFractionDigits = 0) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
    return Number(value).toLocaleString(undefined, { maximumFractionDigits });
  }

  function formatHz(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
    if (value >= 1000) return `${formatNumber(value / 1000, value % 1000 === 0 ? 0 : 1)} kHz`;
    return `${formatNumber(value, value % 1 === 0 ? 0 : 1)} Hz`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeText(value) {
    return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function getSelectedSpecies() {
    return DATA.species.find((species) => species.id === state.speciesId) || DATA.species[0] || null;
  }

  function getSelectedCampaign() {
    const species = getSelectedSpecies();
    if (!species) return null;
    return species.campaigns.find((campaign) => campaign.id === state.campaignId) || species.campaigns[0] || null;
  }

  function allMeasurementsForSpecies(species) {
    return species.campaigns.flatMap((campaign) => campaign.measurements || []);
  }

  function cleanMeasurements(campaign) {
    const buckets = new Map();
    (campaign?.measurements || []).forEach((row) => {
      const frequency = Number(row.frequency);
      const threshold = Number(row.threshold);
      if (!Number.isFinite(frequency) || !Number.isFinite(threshold) || frequency <= 0) return;
      const key = String(frequency);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(threshold);
    });

    return [...buckets.entries()]
      .map(([frequency, thresholds]) => ({
        frequency: Number(frequency),
        threshold: thresholds.reduce((sum, value) => sum + value, 0) / thresholds.length,
        samples: thresholds.length,
      }))
      .sort((a, b) => a.frequency - b.frequency);
  }

  function interpolateLogFrequency(points, targetFrequency) {
    if (!points.length) return null;
    if (targetFrequency < points[0].frequency || targetFrequency > points[points.length - 1].frequency) return null;
    if (points.length === 1) return points[0].threshold;

    for (let index = 0; index < points.length - 1; index += 1) {
      const left = points[index];
      const right = points[index + 1];
      if (targetFrequency === left.frequency) return left.threshold;
      if (targetFrequency === right.frequency) return right.threshold;
      if (targetFrequency > left.frequency && targetFrequency < right.frequency) {
        const logLeft = Math.log10(left.frequency);
        const logRight = Math.log10(right.frequency);
        const t = (Math.log10(targetFrequency) - logLeft) / (logRight - logLeft || 1);
        return left.threshold + (right.threshold - left.threshold) * t;
      }
    }
    return null;
  }

  function buildThirdOctaveCurve(campaign) {
    const points = cleanMeasurements(campaign);
    if (points.length < 2) return [];
    return THIRD_OCTAVE_FREQUENCIES
      .map((frequency) => ({
        frequency,
        threshold: interpolateLogFrequency(points, frequency),
      }))
      .filter((row) => row.threshold !== null);
  }

  function buildEqualizerCurve(campaign) {
    return buildThirdOctaveCurve(campaign)
      .filter((row) => HUMAN_THRESHOLDS[row.frequency] !== undefined)
      .map((row) => ({
        frequency: row.frequency,
        threshold: HUMAN_THRESHOLDS[row.frequency] - row.threshold,
        animalThreshold: row.threshold,
        humanThreshold: HUMAN_THRESHOLDS[row.frequency],
      }));
  }

  function campaignSummary(campaign) {
    const points = cleanMeasurements(campaign);
    const thresholds = points.map((row) => row.threshold);
    const best = points.reduce((current, row) => {
      if (!current || row.threshold < current.threshold) return row;
      return current;
    }, null);

    return {
      points,
      minFrequency: points[0]?.frequency ?? null,
      maxFrequency: points[points.length - 1]?.frequency ?? null,
      minThreshold: thresholds.length ? Math.min(...thresholds) : null,
      maxThreshold: thresholds.length ? Math.max(...thresholds) : null,
      bestFrequency: best?.frequency ?? null,
      bestThreshold: best?.threshold ?? null,
      thirdOctaveCount: buildThirdOctaveCurve(campaign).length,
    };
  }

  function speciesMatchesCoverage(species) {
    if (state.coverage === "all") return true;
    return species.campaigns.some((campaign) => {
      const summary = campaignSummary(campaign);
      if (state.coverage === "human") return summary.minFrequency <= 20000 && summary.maxFrequency >= 20;
      if (state.coverage === "ultrasonic") return summary.maxFrequency > 20000;
      if (state.coverage === "third-octave") return summary.points.length >= 4;
      return true;
    });
  }

  function speciesSearchScore(species, query) {
    if (!query) return 1;
    const fields = [
      species.commonName,
      species.scientificName,
      species.group,
      species.gbifUrl,
      ...(species.taxonomy || []),
      ...(species.seeAlso || []),
      ...species.campaigns.flatMap((campaign) => [campaign.method, campaign.publicationId, campaign.authors, campaign.title, campaign.year]),
    ].map(normalizeText);
    if (fields.some((field) => field === query)) return 4;
    if (fields.some((field) => field.startsWith(query))) return 3;
    if (fields.some((field) => field.includes(query))) return 2;
    return 0;
  }

  function filteredSpecies() {
    const query = normalizeText(state.query.trim());
    return DATA.species
      .map((species) => ({ species, score: speciesSearchScore(species, query) }))
      .filter(({ species, score }) => {
        if (!score) return false;
        if (state.group !== "all" && species.group !== state.group) return false;
        if (state.method !== "all" && !species.campaigns.some((campaign) => campaign.method === state.method)) return false;
        return speciesMatchesCoverage(species);
      })
      .sort((a, b) => b.score - a.score || a.species.scientificName.localeCompare(b.species.scientificName))
      .map(({ species }) => species);
  }

  function populateFilters() {
    const groups = unique(DATA.species.map((species) => species.group)).sort();
    const methods = unique(DATA.species.flatMap((species) => species.campaigns.map((campaign) => campaign.method))).sort();
    $("groupFilter").innerHTML = `<option value="all">All groups</option>${groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("")}`;
    $("methodFilter").innerHTML = `<option value="all">All methods</option>${methods.map((method) => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`).join("")}`;
  }

  function renderDatasetStats() {
    const meta = DATA.meta || {};
    const speciesCount = meta.speciesCount ?? DATA.species.length;
    const campaignCount = meta.campaignCount ?? DATA.species.reduce((sum, species) => sum + species.campaigns.length, 0);
    const measurementCount = meta.measurementCount ?? DATA.species.reduce((sum, species) => sum + species.campaigns.reduce((inner, campaign) => inner + campaign.measurements.length, 0), 0);
    $("navSpecies").textContent = `${formatNumber(speciesCount)} species`;
    $("navCampaigns").textContent = `${formatNumber(campaignCount)} campaigns`;
    $("navMeasurements").textContent = `${formatNumber(measurementCount)} measurements`;
    $("freqRange").textContent = `${formatHz(meta.frequencyMin)} to ${formatHz(meta.frequencyMax)}`;
    $("thresholdRange").textContent = `${formatNumber(meta.thresholdMin, 1)} to ${formatNumber(meta.thresholdMax, 1)} dB SPL`;
    $("methodCount").textContent = formatNumber(meta.methodCount ?? unique(DATA.species.flatMap((species) => species.campaigns.map((campaign) => campaign.method))).length);
    $("sourceFile").textContent = meta.sourceFile || "Generated data.js";
  }

  function renderSpeciesList() {
    const list = $("speciesList");
    const speciesList = filteredSpecies();
    $("speciesCountText").textContent = `${speciesList.length} of ${DATA.species.length} shown`;
    list.innerHTML = "";

    if (!speciesList.length) {
      list.innerHTML = `<div class="empty">No species match the current filters.</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    speciesList.forEach((species) => {
      const measurements = allMeasurementsForSpecies(species);
      const frequencies = measurements.map((row) => row.frequency).filter(Number.isFinite);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `species-item${species.id === state.speciesId ? " active" : ""}`;
      button.innerHTML = `
        <span class="item-common">${escapeHtml(species.commonName || species.group || "Common name unavailable")}</span>
        <strong>${escapeHtml(species.scientificName)}</strong>
        <span>${escapeHtml(species.group || "Animal")} · ${species.campaigns.length} campaign${species.campaigns.length === 1 ? "" : "s"} · ${formatHz(Math.min(...frequencies))}-${formatHz(Math.max(...frequencies))}</span>
      `;
      button.addEventListener("click", () => {
        state.speciesId = species.id;
        state.campaignId = species.campaigns[0]?.id || null;
        renderAll();
      });
      fragment.appendChild(button);
    });
    list.appendChild(fragment);
  }

  function renderSpeciesSummary() {
    const species = getSelectedSpecies();
    if (!species) return;
    const measurements = allMeasurementsForSpecies(species);
    const methods = unique(species.campaigns.map((campaign) => campaign.method));
    const publications = unique(species.campaigns.map((campaign) => campaign.publicationId || campaign.title));
    const gbifBadge = species.gbifUrl
      ? `<a class="badge link-badge" href="${escapeHtml(species.gbifUrl)}" target="_blank" rel="noopener noreferrer">GBIF</a>`
      : "";

    $("commonName").textContent = species.commonName || species.group || "Common name unavailable";
    $("scientificName").textContent = species.scientificName;
    $("taxonomyPath").textContent = (species.taxonomy || []).join(" > ") || "Taxonomy unavailable";
    $("summaryBadges").innerHTML = `
      <span class="badge">${species.campaigns.length} campaigns</span>
      <span class="badge">${measurements.length} points</span>
      <span class="badge">${methods.join(", ") || "Unknown method"}</span>
      <span class="badge">${publications.length} publications</span>
      ${gbifBadge}
    `;
  }

  function renderCampaignSelect() {
    const species = getSelectedSpecies();
    const select = $("campaignSelect");
    select.innerHTML = "";
    if (!species) return;

    species.campaigns.forEach((campaign, index) => {
      const option = document.createElement("option");
      option.value = campaign.id;
      option.textContent = `${campaign.label || campaign.title || campaign.id}${campaign.year ? ` (${campaign.year})` : ""}`;
      select.appendChild(option);
      if (!state.campaignId && index === 0) state.campaignId = campaign.id;
    });
    select.value = getSelectedCampaign()?.id || "";
  }

  function renderCampaignDetails() {
    const campaign = getSelectedCampaign();
    if (!campaign) return;
    const doi = campaign.doi ? `<a href="https://doi.org/${escapeHtml(campaign.doi)}" target="_blank" rel="noopener noreferrer">${escapeHtml(campaign.doi)}</a>` : "Not provided";
    const fields = [
      ["Method", campaign.method || "Unknown"],
      ["Authors", campaign.authors || "Not provided"],
      ["Year", campaign.year || "Not provided"],
      ["Publication ID", campaign.publicationId || "Not provided"],
      ["Title", campaign.title || "Not provided"],
      ["DOI", doi],
    ];

    $("campaignTitle").textContent = campaign.label || campaign.title || campaign.id;
    $("metadataGrid").innerHTML = fields
      .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${key === "DOI" ? value : escapeHtml(String(value))}</dd></div>`)
      .join("");
  }

  function chartRowsForMode(campaign) {
    if (state.chartMode === "thirdOctave") return buildThirdOctaveCurve(campaign);
    if (state.chartMode === "equalizer") return buildEqualizerCurve(campaign);
    return cleanMeasurements(campaign);
  }

  function renderFilterMetrics() {
    const campaign = getSelectedCampaign();
    const species = getSelectedSpecies();
    const summary = campaignSummary(campaign);
    const equalizer = buildEqualizerCurve(campaign);
    const gains = equalizer.map((row) => row.threshold);
    const maxBoost = gains.length ? Math.max(...gains) : null;
    const maxCut = gains.length ? Math.min(...gains) : null;
    const fields = [
      ["Cleaned points", formatNumber(summary.points.length)],
      ["Interpolated bands", formatNumber(summary.thirdOctaveCount)],
      ["Best sensitivity", `${formatHz(summary.bestFrequency)} at ${formatNumber(summary.bestThreshold, 1)} dB SPL`],
      ["Coverage", `${formatHz(summary.minFrequency)} to ${formatHz(summary.maxFrequency)}`],
      ["Equalizer gain range", `${formatNumber(maxCut, 1)} to ${formatNumber(maxBoost, 1)} dB`],
    ];
    $("filterMetrics").innerHTML = fields.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join("");
    const mapLink = $("viewMaps");
    if (mapLink && species && campaign) {
      const params = new URLSearchParams({ species: species.id, campaign: campaign.id });
      mapLink.href = `wind-maps.html?${params.toString()}`;
    }
  }

  function renderMeasurementTable() {
    const rows = cleanMeasurements(getSelectedCampaign());
    const tbody = $("measurementTable");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="2">No measurements available.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((row) => `
        <tr>
          <td>${formatHz(row.frequency)} <span class="muted">(${formatNumber(row.frequency, 1)} Hz${row.samples > 1 ? `, ${row.samples} averaged` : ""})</span></td>
          <td>${formatNumber(row.threshold, 1)} dB SPL</td>
        </tr>
      `)
      .join("");
  }

  function renderChart() {
    const campaign = getSelectedCampaign();
    const rows = chartRowsForMode(campaign);
    const wrap = $("chartWrap");
    const modeLabels = {
      measured: "Measured threshold curve",
      thirdOctave: "Third-octave threshold estimate",
      equalizer: "Animal-to-human equalizer gain",
    };
    const modeNotes = {
      measured: "Original campaign points after numeric cleanup and duplicate-frequency averaging.",
      thirdOctave: "Notebook-inspired filter curve: log-frequency interpolation onto standard third-octave bands inside the measured frequency range.",
      equalizer: "Gain is human threshold minus interpolated animal threshold. Positive values boost frequencies humans hear less easily than the selected animal.",
    };
    $("chartTitle").textContent = modeLabels[state.chartMode];
    $("chartNote").textContent = modeNotes[state.chartMode];

    if (rows.length < 2) {
      wrap.innerHTML = `<div class="empty">At least two valid points are needed to draw this curve.</div>`;
      return;
    }

    const width = 860;
    const height = 430;
    const margin = { top: 26, right: 28, bottom: 58, left: 72 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const freqs = rows.map((row) => row.frequency);
    const values = rows.map((row) => row.threshold);
    const minFreq = Math.min(...freqs);
    const maxFreq = Math.max(...freqs);
    let minY = Math.min(...values);
    let maxY = Math.max(...values);
    const padY = Math.max(5, (maxY - minY) * 0.15);
    minY = Math.floor((minY - padY) / 5) * 5;
    maxY = Math.ceil((maxY + padY) / 5) * 5;
    if (state.chartMode === "equalizer") {
      minY = Math.min(minY, -5);
      maxY = Math.max(maxY, 5);
    }
    if (minY === maxY) maxY = minY + 10;

    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    const x = (frequency) => margin.left + ((Math.log10(frequency) - logMin) / (logMax - logMin || 1)) * plotW;
    const y = (value) => margin.top + ((maxY - value) / (maxY - minY || 1)) * plotH;
    const yTicks = makeLinearTicks(minY, maxY, 6);
    const xTicks = makeFrequencyTicks(minFreq, maxFreq);
    const color = state.chartMode === "equalizer" ? "#047857" : "#1d4ed8";
    const points = rows.map((row) => `${x(row.frequency).toFixed(2)},${y(row.threshold).toFixed(2)}`).join(" ");

    wrap.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <rect width="${width}" height="${height}" fill="#ffffff" />
        ${yTicks.map((tick) => `
          <line x1="${margin.left}" y1="${y(tick)}" x2="${width - margin.right}" y2="${y(tick)}" stroke="#e5e7eb" />
          <text x="${margin.left - 12}" y="${y(tick) + 4}" text-anchor="end" font-size="12" fill="#64748b">${formatNumber(tick, 0)}</text>
        `).join("")}
        ${xTicks.map((tick) => `
          <line x1="${x(tick)}" y1="${margin.top}" x2="${x(tick)}" y2="${height - margin.bottom}" stroke="#f1f5f9" />
          <text x="${x(tick)}" y="${height - margin.bottom + 24}" text-anchor="middle" font-size="12" fill="#64748b">${formatHz(tick)}</text>
        `).join("")}
        ${state.chartMode === "equalizer" && minY < 0 && maxY > 0 ? `<line x1="${margin.left}" y1="${y(0)}" x2="${width - margin.right}" y2="${y(0)}" stroke="#94a3b8" stroke-dasharray="5 5" />` : ""}
        <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#94a3b8" />
        <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#94a3b8" />
        <polyline points="${points}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
        ${rows.map((row, index) => `<circle class="chart-point" data-index="${index}" cx="${x(row.frequency)}" cy="${y(row.threshold)}" r="5" fill="${color}" stroke="#ffffff" stroke-width="2" />`).join("")}
        <text x="${width / 2}" y="${height - 12}" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">Frequency</text>
        <text transform="translate(20 ${height / 2}) rotate(-90)" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">${state.chartMode === "equalizer" ? "Gain (dB)" : "Threshold level (dB SPL)"}</text>
      </svg>
      <div id="chartTooltip" class="tooltip" hidden></div>
    `;

    const tooltip = $("chartTooltip");
    wrap.querySelectorAll(".chart-point").forEach((point) => {
      point.addEventListener("mouseenter", (event) => {
        const row = rows[Number(event.target.getAttribute("data-index"))];
        const details = state.chartMode === "equalizer"
          ? `<br>Animal: ${formatNumber(row.animalThreshold, 1)} dB SPL<br>Human: ${formatNumber(row.humanThreshold, 1)} dB SPL`
          : "";
        tooltip.innerHTML = `<strong>${formatHz(row.frequency)}</strong><br>${formatNumber(row.threshold, 1)} ${state.chartMode === "equalizer" ? "dB gain" : "dB SPL"}${details}`;
        tooltip.hidden = false;
      });
      point.addEventListener("mousemove", (event) => {
        const rect = wrap.getBoundingClientRect();
        tooltip.style.left = `${event.clientX - rect.left}px`;
        tooltip.style.top = `${event.clientY - rect.top}px`;
      });
      point.addEventListener("mouseleave", () => {
        tooltip.hidden = true;
      });
    });
  }

  function makeLinearTicks(min, max, count) {
    const step = (max - min) / Math.max(1, count - 1);
    return Array.from({ length: count }, (_, index) => min + step * index);
  }

  function makeFrequencyTicks(minFreq, maxFreq) {
    const candidates = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 40000, 80000, 120000, 200000];
    const filtered = candidates.filter((value) => value >= minFreq && value <= maxFreq);
    if (filtered.length >= 2) return filtered;
    return [minFreq, maxFreq];
  }

  function downloadSelectedCsv() {
    const species = getSelectedSpecies();
    const campaign = getSelectedCampaign();
    if (!species || !campaign) return;
    const rows = chartRowsForMode(campaign);
    const header = state.chartMode === "equalizer"
      ? ["scientific_name", "campaign_id", "curve_mode", "frequency_hz", "gain_db", "animal_threshold_db_spl", "human_threshold_db_spl"]
      : ["scientific_name", "campaign_id", "curve_mode", "frequency_hz", "threshold_db_spl"];
    const body = rows.map((row) => state.chartMode === "equalizer"
      ? [species.scientificName, campaign.id, state.chartMode, row.frequency, row.threshold, row.animalThreshold, row.humanThreshold]
      : [species.scientificName, campaign.id, state.chartMode, row.frequency, row.threshold]);
    const csv = [header, ...body]
      .map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${species.id}_${campaign.id}_${state.chartMode}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderAll() {
    renderDatasetStats();
    renderSpeciesList();
    renderSpeciesSummary();
    renderCampaignSelect();
    renderCampaignDetails();
    renderFilterMetrics();
    renderMeasurementTable();
    renderChart();
  }

  function init() {
    if (!DATA.species.length) {
      document.body.innerHTML = `<main class="shell legacy-page"><h1>No ontology data found</h1><p>Check that data.js exists and defines window.HT_DATA.</p></main>`;
      return;
    }

    populateFilters();
    $("speciesSearch").addEventListener("input", (event) => {
      state.query = event.target.value;
      renderSpeciesList();
    });
    $("groupFilter").addEventListener("change", (event) => {
      state.group = event.target.value;
      renderSpeciesList();
    });
    $("methodFilter").addEventListener("change", (event) => {
      state.method = event.target.value;
      renderSpeciesList();
    });
    $("coverageFilter").addEventListener("change", (event) => {
      state.coverage = event.target.value;
      renderSpeciesList();
    });
    $("resetFilters").addEventListener("click", () => {
      state.query = "";
      state.group = "all";
      state.method = "all";
      state.coverage = "all";
      $("speciesSearch").value = "";
      $("groupFilter").value = "all";
      $("methodFilter").value = "all";
      $("coverageFilter").value = "all";
      renderSpeciesList();
    });
    $("campaignSelect").addEventListener("change", (event) => {
      state.campaignId = event.target.value;
      renderCampaignDetails();
      renderFilterMetrics();
      renderMeasurementTable();
      renderChart();
    });
    document.querySelectorAll(".mode-tab").forEach((button) => {
      button.addEventListener("click", () => {
        state.chartMode = button.dataset.mode;
        document.querySelectorAll(".mode-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
        renderFilterMetrics();
        renderChart();
      });
    });
    $("downloadCsv").addEventListener("click", downloadSelectedCsv);
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
