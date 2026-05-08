(function () {
  "use strict";

  const DATA = window.HT_DATA || { meta: {}, species: [] };
  const state = {
    speciesId: DATA.species?.[0]?.id || null,
    campaignId: DATA.species?.[0]?.campaigns?.[0]?.id || null,
    query: "",
  };

  const $ = (id) => document.getElementById(id);

  function formatNumber(value, maximumFractionDigits = 0) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
    return Number(value).toLocaleString(undefined, { maximumFractionDigits });
  }

  function formatHz(value) {
    if (value === null || value === undefined) return "-";
    if (value >= 1000) return `${formatNumber(value / 1000, value % 1000 === 0 ? 0 : 1)} kHz`;
    return `${formatNumber(value, 0)} Hz`;
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

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function renderHeroStats() {
    const meta = DATA.meta || {};
    $("heroSpecies").textContent = formatNumber(meta.speciesCount ?? DATA.species.length);
    $("heroCampaigns").textContent = formatNumber(meta.campaignCount ?? DATA.species.reduce((s, x) => s + x.campaigns.length, 0));
    $("heroMeasurements").textContent = formatNumber(
      meta.measurementCount ?? DATA.species.reduce((sum, s) => sum + s.campaigns.reduce((inner, c) => inner + c.measurements.length, 0), 0)
    );
    $("sourceFile").textContent = meta.sourceFile || "Generated data.js";
    $("freqRange").textContent = `${formatHz(meta.frequencyMin)} - ${formatHz(meta.frequencyMax)}`;
    $("thresholdRange").textContent = `${formatNumber(meta.thresholdMin, 1)} - ${formatNumber(meta.thresholdMax, 1)} dB SPL`;
    $("methodCount").textContent = formatNumber(meta.methodCount || unique(DATA.species.flatMap((s) => s.campaigns.map((c) => c.method))).length);
  }

  function filterSpecies() {
    const q = state.query.trim().toLowerCase();
    if (!q) return DATA.species;
    return DATA.species.filter((species) => {
      const haystack = [
        species.scientificName,
        species.commonName,
        species.group,
        species.gbifUrl,
        ...(species.taxonomy || []),
        ...(species.seeAlso || []),
        ...species.campaigns.map((campaign) => campaign.method),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  function renderSpeciesList() {
    const list = $("speciesList");
    const speciesList = filterSpecies();
    $("speciesCountText").textContent = `${speciesList.length} of ${DATA.species.length} species shown`;
    list.innerHTML = "";

    if (!speciesList.length) {
      list.innerHTML = `<div class="empty">No species matched your search.</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    speciesList.forEach((species) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `species-item${species.id === state.speciesId ? " active" : ""}`;
      button.innerHTML = `
        <div class="common">${escapeHtml(species.commonName || species.group || "Common name not provided")}</div>
        <div class="scientific">${escapeHtml(species.scientificName)}</div>
        <div class="count">${species.campaigns.length} campaign${species.campaigns.length === 1 ? "" : "s"}</div>
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

    $("commonName").textContent = species.commonName || species.group || "Common name not provided";
    $("scientificName").textContent = species.scientificName;
    $("taxonomyPath").textContent = (species.taxonomy || []).join(" > ") || "Taxonomy not provided";
    $("selectedSpeciesStat").textContent = species.scientificName;

    const gbifBadge = species.gbifUrl
      ? `<a class="badge" href="${escapeHtml(species.gbifUrl)}" target="_blank" rel="noopener noreferrer">GBIF</a>`
      : "";

    $("summaryBadges").innerHTML = `
      <span class="badge">${species.campaigns.length} campaign${species.campaigns.length === 1 ? "" : "s"}</span>
      <span class="badge">${measurements.length} points</span>
      <span class="badge">${methods.length} method${methods.length === 1 ? "" : "s"}</span>
      <span class="badge">${publications.length} publication${publications.length === 1 ? "" : "s"}</span>
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

    $("campaignTitle").textContent = campaign.label || campaign.title || campaign.id;

    const fields = [
      ["Method", campaign.method || "Unknown"],
      ["Authors", campaign.authors || "Not provided"],
      ["Year", campaign.year || "Not provided"],
      ["Publication ID", campaign.publicationId || "Not provided"],
      ["Title", campaign.title || "Not provided"],
      ["DOI", campaign.doi || "Not provided"],
    ];

    $("metadataGrid").innerHTML = fields
      .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`)
      .join("");
  }

  function renderMeasurementTable() {
    const campaign = getSelectedCampaign();
    const tbody = $("measurementTable");
    const rows = campaign?.measurements || [];

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="2">No measurements available.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((row) => `
        <tr>
          <td>${formatHz(row.frequency)} <span class="muted">(${formatNumber(row.frequency, 1)} Hz)</span></td>
          <td>${formatNumber(row.threshold, 1)} dB SPL</td>
        </tr>
      `)
      .join("");
  }

  function renderChart() {
    const campaign = getSelectedCampaign();
    const wrap = $("chartWrap");
    const rows = (campaign?.measurements || []).filter((row) => row.frequency > 0 && row.threshold !== null && row.threshold !== undefined);

    if (rows.length < 2) {
      wrap.innerHTML = `<div class="empty">At least two measurement points are needed to draw a curve.</div>`;
      return;
    }

    const width = 820;
    const height = 420;
    const margin = { top: 26, right: 26, bottom: 56, left: 66 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const freqs = rows.map((row) => row.frequency);
    const thresholds = rows.map((row) => row.threshold);
    const minFreq = Math.min(...freqs);
    const maxFreq = Math.max(...freqs);
    let minY = Math.min(...thresholds);
    let maxY = Math.max(...thresholds);
    const padY = Math.max(5, (maxY - minY) * 0.15);
    minY = Math.floor((minY - padY) / 5) * 5;
    maxY = Math.ceil((maxY + padY) / 5) * 5;
    if (minY === maxY) maxY = minY + 10;

    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    const x = (freq) => margin.left + ((Math.log10(freq) - logMin) / (logMax - logMin || 1)) * plotW;
    const y = (threshold) => margin.top + ((maxY - threshold) / (maxY - minY || 1)) * plotH;

    const linePoints = rows.map((row) => `${x(row.frequency).toFixed(2)},${y(row.threshold).toFixed(2)}`).join(" ");
    const yTicks = makeLinearTicks(minY, maxY, 6);
    const xTicks = makeFrequencyTicks(minFreq, maxFreq);

    const grid = [
      ...yTicks.map((tick) => `
        <line x1="${margin.left}" y1="${y(tick)}" x2="${width - margin.right}" y2="${y(tick)}" stroke="#e2e8f0" />
        <text x="${margin.left - 12}" y="${y(tick) + 4}" text-anchor="end" font-size="12" fill="#64748b">${formatNumber(tick, 0)}</text>
      `),
      ...xTicks.map((tick) => `
        <line x1="${x(tick)}" y1="${margin.top}" x2="${x(tick)}" y2="${height - margin.bottom}" stroke="#edf2f7" />
        <text x="${x(tick)}" y="${height - margin.bottom + 24}" text-anchor="middle" font-size="12" fill="#64748b">${formatHz(tick)}</text>
      `),
    ].join("");

    const points = rows.map((row, index) => `
      <circle class="chart-point" data-index="${index}" cx="${x(row.frequency)}" cy="${y(row.threshold)}" r="5.5" fill="#2563eb" stroke="#ffffff" stroke-width="2" />
    `).join("");

    wrap.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
        ${grid}
        <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#94a3b8" />
        <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#94a3b8" />
        <polyline points="${linePoints}" fill="none" stroke="#2563eb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        ${points}
        <text x="${width / 2}" y="${height - 12}" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">Frequency</text>
        <text transform="translate(18 ${height / 2}) rotate(-90)" text-anchor="middle" font-size="13" font-weight="700" fill="#334155">Threshold level (dB SPL)</text>
      </svg>
      <div id="chartTooltip" class="tooltip" hidden></div>
    `;

    const tooltip = $("chartTooltip");
    wrap.querySelectorAll(".chart-point").forEach((point) => {
      point.addEventListener("mouseenter", (event) => {
        const index = Number(event.target.getAttribute("data-index"));
        const row = rows[index];
        tooltip.innerHTML = `<strong>${formatHz(row.frequency)}</strong><br>${formatNumber(row.threshold, 1)} dB SPL`;
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
    const candidates = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];
    const filtered = candidates.filter((value) => value >= minFreq && value <= maxFreq);
    if (filtered.length >= 2) return filtered;
    return [minFreq, maxFreq];
  }

  function downloadSelectedCsv() {
    const species = getSelectedSpecies();
    const campaign = getSelectedCampaign();
    if (!species || !campaign) return;

    const header = [
      "scientific_name",
      "common_name",
      "campaign_id",
      "campaign_label",
      "method",
      "authors",
      "year",
      "doi",
      "gbif_url",
      "frequency_hz",
      "threshold_db_spl",
    ];

    const rows = campaign.measurements.map((measurement) => [
      species.scientificName,
      species.commonName,
      campaign.id,
      campaign.label,
      campaign.method,
      campaign.authors,
      campaign.year,
      campaign.doi,
      species.gbifUrl,
      measurement.frequency,
      measurement.threshold,
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${species.id}_${campaign.id}_measurements.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderAll() {
    renderHeroStats();
    renderSpeciesList();
    renderSpeciesSummary();
    renderCampaignSelect();
    renderCampaignDetails();
    renderMeasurementTable();
    renderChart();
  }

  function init() {
    if (!DATA.species.length) {
      document.body.innerHTML = `<main class="shell" style="padding:60px 0"><div class="card" style="padding:28px"><h1>No data found</h1><p>Check that data.js exists and defines window.HT_DATA.</p></div></main>`;
      return;
    }

    $("speciesSearch").addEventListener("input", (event) => {
      state.query = event.target.value;
      renderSpeciesList();
    });

    $("clearSearch").addEventListener("click", () => {
      state.query = "";
      $("speciesSearch").value = "";
      renderSpeciesList();
    });

    $("campaignSelect").addEventListener("change", (event) => {
      state.campaignId = event.target.value;
      renderCampaignDetails();
      renderMeasurementTable();
      renderChart();
    });

    $("downloadCsv").addEventListener("click", downloadSelectedCsv);

    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
