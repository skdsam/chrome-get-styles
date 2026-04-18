const state = {
  analysis: null,
  scanInProgress: false
};

const dom = {
  scanButton: document.getElementById("scanButton"),
  copyThemeButton: document.getElementById("copyThemeButton"),
  copyJsonButton: document.getElementById("copyJsonButton"),
  statusMessage: document.getElementById("statusMessage"),
  colorCount: document.getElementById("colorCount"),
  fontCount: document.getElementById("fontCount"),
  elementCount: document.getElementById("elementCount"),
  pageTitle: document.getElementById("pageTitle"),
  pageLink: document.getElementById("pageLink"),
  paletteMeta: document.getElementById("paletteMeta"),
  fontMeta: document.getElementById("fontMeta"),
  colorList: document.getElementById("colorList"),
  fontList: document.getElementById("fontList"),
  colorCardTemplate: document.getElementById("colorCardTemplate"),
  fontCardTemplate: document.getElementById("fontCardTemplate")
};

const COLOR_ROLE_TO_CSS_PROPERTY = {
  text: "color",
  background: "background-color",
  border: "border-color",
  outline: "outline-color",
  decoration: "text-decoration-color",
  fill: "fill",
  stroke: "stroke",
  caret: "caret-color"
};

document.addEventListener("DOMContentLoaded", () => {
  dom.scanButton.addEventListener("click", () => void scanActivePage());
  dom.copyThemeButton.addEventListener("click", () => void copyThemeCss());
  dom.copyJsonButton.addEventListener("click", () => void copyJson());
  void scanActivePage();
});

async function scanActivePage() {
  if (state.scanInProgress) {
    return;
  }

  setBusyState(true, "Scanning the active tab for colors and font styles...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      throw new Error("No active tab was available to scan.");
    }

    ensureSupportedUrl(tab.url);

    const executionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: analyzePage
    });

    const rawAnalysis = executionResults?.[0]?.result;

    if (!rawAnalysis) {
      throw new Error("The current page did not return any style information.");
    }

    const enrichedAnalysis = await hydrateFontSources(rawAnalysis);
    const formattedAnalysis = formatAnalysis(enrichedAnalysis, tab);

    state.analysis = formattedAnalysis;
    renderAnalysis(formattedAnalysis);
    setBusyState(false, `Captured ${formattedAnalysis.colors.length} colors and ${formattedAnalysis.fonts.length} font stacks.`, false, true);
  } catch (error) {
    console.error(error);
    state.analysis = null;
    renderErrorState();
    setBusyState(false, error.message || "Unable to scan this page.", true, false);
  }
}

function ensureSupportedUrl(url) {
  const blockedProtocols = ["chrome:", "edge:", "about:", "moz-extension:", "chrome-extension:"];
  const isBlocked = !url || blockedProtocols.some((protocol) => url.startsWith(protocol));

  if (isBlocked) {
    throw new Error("Chrome restricts extensions from scanning internal browser pages. Open a normal website tab instead.");
  }
}

function setBusyState(isBusy, message, isError = false, isSuccess = false) {
  state.scanInProgress = isBusy;
  dom.scanButton.disabled = isBusy;
  dom.copyThemeButton.disabled = isBusy || !state.analysis;
  dom.copyJsonButton.disabled = isBusy || !state.analysis;
  dom.scanButton.textContent = isBusy ? "Scanning..." : "Scan Page";
  dom.statusMessage.textContent = message;
  dom.statusMessage.className = "status";

  if (isError) {
    dom.statusMessage.classList.add("error");
  }

  if (isSuccess) {
    dom.statusMessage.classList.add("success");
  }
}

function renderErrorState() {
  dom.colorCount.textContent = "0";
  dom.fontCount.textContent = "0";
  dom.elementCount.textContent = "0";
  dom.pageTitle.textContent = "Scan unavailable";
  dom.pageLink.textContent = "Current tab";
  dom.pageLink.href = "#";
  dom.paletteMeta.textContent = "No palette available";
  dom.fontMeta.textContent = "No font data available";
  dom.colorList.className = "list empty-state";
  dom.colorList.textContent = "Try scanning a standard website tab with visible text and styles.";
  dom.fontList.className = "list empty-state";
  dom.fontList.textContent = "Theme Scout cannot read browser internal pages or blocked tabs.";
}

function renderAnalysis(analysis) {
  dom.colorCount.textContent = String(analysis.colors.length);
  dom.fontCount.textContent = String(analysis.fonts.length);
  dom.elementCount.textContent = String(analysis.meta.totalElements);
  dom.pageTitle.textContent = analysis.meta.title;
  dom.pageLink.textContent = analysis.meta.url;
  dom.pageLink.href = analysis.meta.url;
  dom.paletteMeta.textContent = `${analysis.colors.length} reusable values`;
  dom.fontMeta.textContent = `${analysis.fonts.filter((font) => font.loaded).length} loaded font families detected`;

  renderColorCards(analysis.colors);
  renderFontCards(analysis.fonts);
}

function renderColorCards(colors) {
  dom.colorList.innerHTML = "";

  if (!colors.length) {
    dom.colorList.className = "list empty-state";
    dom.colorList.textContent = "No distinct colors were detected on this page.";
    return;
  }

  dom.colorList.className = "list";

  colors.forEach((color) => {
    const fragment = dom.colorCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".color-card");
    const swatch = fragment.querySelector(".swatch");
    const title = fragment.querySelector(".card-title");
    const subtitle = fragment.querySelector(".card-subtitle");
    const usage = fragment.querySelector(".usage");
    const selectorList = fragment.querySelector(".selector-list");
    const roles = fragment.querySelector(".roles");
    const copyButton = fragment.querySelector(".copy-button");

    swatch.style.background = color.previewValue;
    title.textContent = color.previewValue;
    subtitle.textContent = color.alpha < 1 ? `${color.hex} at ${Math.round(color.alpha * 100)}% opacity` : color.rgb;
    usage.textContent = `Used ${color.usageCount} times, mostly as ${color.dominantRole}.`;
    selectorList.textContent = color.selectors.join(" • ");
    copyButton.addEventListener("click", () => void copyToClipboard(color.cssSnippet, `Copied ${color.previewValue} CSS.`));

    color.roles.forEach((role) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = role;
      roles.appendChild(chip);
    });

    card.dataset.color = color.previewValue;
    dom.colorList.appendChild(fragment);
  });
}

function renderFontCards(fonts) {
  dom.fontList.innerHTML = "";

  if (!fonts.length) {
    dom.fontList.className = "list empty-state";
    dom.fontList.textContent = "No font styles were detected on this page.";
    return;
  }

  dom.fontList.className = "list";

  fonts.forEach((font) => {
    const fragment = dom.fontCardTemplate.content.cloneNode(true);
    const title = fragment.querySelector(".card-title");
    const subtitle = fragment.querySelector(".card-subtitle");
    const preview = fragment.querySelector(".font-preview");
    const metrics = fragment.querySelector(".metrics");
    const usage = fragment.querySelector(".usage");
    const selectorList = fragment.querySelector(".selector-list");
    const linkBlock = fragment.querySelector(".link-block");
    const linkList = fragment.querySelector(".link-list");
    const copyButton = fragment.querySelector(".copy-button");

    title.textContent = font.primaryFamily;
    subtitle.textContent = font.stack;
    preview.style.fontFamily = font.stack;
    preview.textContent = font.sampleText || preview.textContent;
    usage.textContent = `Used ${font.usageCount} times${font.loaded ? " and currently loaded on the page." : "."}`;
    selectorList.textContent = font.selectors.join(" • ");
    copyButton.addEventListener("click", () => void copyToClipboard(font.cssSnippet, `Copied CSS for ${font.primaryFamily}.`));

    font.metrics.forEach((metric) => {
      const chip = document.createElement("span");
      chip.className = "chip metric";
      chip.textContent = metric;
      metrics.appendChild(chip);
    });

    if (font.loadedLinks.length) {
      font.loadedLinks.forEach((linkInfo) => {
        const anchor = document.createElement("a");
        anchor.className = "link-pill";
        anchor.href = linkInfo.url;
        anchor.target = "_blank";
        anchor.rel = "noreferrer noopener";
        anchor.textContent = linkInfo.label;
        linkList.appendChild(anchor);
      });
    } else {
      linkBlock.style.display = "none";
    }

    dom.fontList.appendChild(fragment);
  });
}

async function copyThemeCss() {
  if (!state.analysis) {
    return;
  }

  await copyToClipboard(state.analysis.themeCss, "Theme CSS copied.");
}

async function copyJson() {
  if (!state.analysis) {
    return;
  }

  await copyToClipboard(state.analysis.exportJson, "JSON summary copied.");
}

async function copyToClipboard(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    setBusyState(false, successMessage, false, true);
  } catch (error) {
    console.error(error);
    setBusyState(false, "Clipboard access failed. Chrome may have blocked the copy request.", true, false);
  }
}

function formatAnalysis(analysis, tab) {
  const colors = analysis.colors
    .map((color) => {
      const roles = Object.entries(color.roleCounts)
        .sort((left, right) => right[1] - left[1])
        .map(([role]) => role);
      const dominantRole = roles[0] || "text";
      const cssProperty = COLOR_ROLE_TO_CSS_PROPERTY[dominantRole] || "color";
      const previewValue = color.alpha < 1 ? color.rgba : color.hex;

      return {
        ...color,
        roles,
        dominantRole,
        previewValue,
        cssSnippet: `${cssProperty}: ${previewValue};`
      };
    })
    .sort((left, right) => right.usageCount - left.usageCount || left.previewValue.localeCompare(right.previewValue));

  const fonts = analysis.fonts
    .map((font) => {
      const metrics = [
        `size ${font.topSize}`,
        `weight ${font.topWeight}`,
        `line-height ${font.topLineHeight}`,
        `style ${font.topStyle}`,
        `letter-spacing ${font.topLetterSpacing}`
      ];

      return {
        ...font,
        metrics,
        cssSnippet: [
          `font-family: ${font.stack};`,
          `font-size: ${font.topSize};`,
          `font-weight: ${font.topWeight};`,
          `font-style: ${font.topStyle};`,
          `line-height: ${font.topLineHeight};`,
          `letter-spacing: ${font.topLetterSpacing};`
        ].join("\n")
      };
    })
    .sort((left, right) => right.usageCount - left.usageCount || left.primaryFamily.localeCompare(right.primaryFamily));

  return {
    meta: {
      title: analysis.meta.title || tab.title || "Untitled page",
      url: analysis.meta.url || tab.url || "",
      totalElements: analysis.meta.totalElements
    },
    colors,
    fonts,
    themeCss: buildThemeCss(colors, fonts),
    exportJson: JSON.stringify(
      {
        meta: analysis.meta,
        colors: colors.map(({ previewValue, cssSnippet, ...color }) => ({
          ...color,
          value: previewValue,
          cssSnippet
        })),
        fonts: fonts.map(({ cssSnippet, ...font }) => ({
          ...font,
          cssSnippet
        }))
      },
      null,
      2
    )
  };
}

function buildThemeCss(colors, fonts) {
  const lines = [":root {"];
  const roleIndexes = {};

  colors.forEach((color) => {
    roleIndexes[color.dominantRole] = (roleIndexes[color.dominantRole] || 0) + 1;
    const variableName = `--${slugify(color.dominantRole)}-${roleIndexes[color.dominantRole]}`;
    lines.push(`  ${variableName}: ${color.previewValue};`);
  });

  fonts.forEach((font, index) => {
    lines.push(`  --font-${index + 1}: ${font.stack};`);
  });

  lines.push("}");
  lines.push("");

  fonts.forEach((font, index) => {
    lines.push(`.font-style-${index + 1} {`);
    lines.push(`  font-family: var(--font-${index + 1});`);
    lines.push(`  font-size: ${font.topSize};`);
    lines.push(`  font-weight: ${font.topWeight};`);
    lines.push(`  font-style: ${font.topStyle};`);
    lines.push(`  line-height: ${font.topLineHeight};`);
    lines.push(`  letter-spacing: ${font.topLetterSpacing};`);
    lines.push("}");
    lines.push("");
  });

  return lines.join("\n").trim();
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function hydrateFontSources(analysis) {
  const remoteFontFaces = await collectRemoteFontFaces(analysis.stylesheetLinks || []);
  const fontFaceRecords = mergeFontFaceCollections(analysis.fontFaceRules || [], remoteFontFaces);
  const fontResources = new Set((analysis.loadedFontResources || []).map(normalizeUrl));
  const loadedFamilyStates = new Map(
    (analysis.loadedFamilies || []).map((item) => [normalizeFamilyName(item.family), item.loaded])
  );

  const fonts = analysis.fonts.map((font) => {
    const primaryFamilyKey = normalizeFamilyName(font.primaryFamily);
    const matchingRecord = fontFaceRecords.get(primaryFamilyKey);
    const fileLinks = dedupe((matchingRecord?.fontFiles || []).filter((url) => fontResources.has(normalizeUrl(url))));
    const stylesheetLinks = dedupe(matchingRecord?.stylesheets || []);
    const loaded = Boolean(font.loaded || loadedFamilyStates.get(primaryFamilyKey) || fileLinks.length);
    const loadedLinks = loaded
      ? (
        fileLinks.length
          ? fileLinks.map((url) => ({ url, label: labelUrl(url, "Font file") }))
          : stylesheetLinks.map((url) => ({ url, label: labelUrl(url, "Stylesheet") }))
      )
      : [];

    return {
      ...font,
      loaded,
      loadedLinks
    };
  });

  return {
    ...analysis,
    fonts
  };
}

function mergeFontFaceCollections(...collections) {
  const records = new Map();

  collections.flat().forEach((record) => {
    const familyKey = normalizeFamilyName(record.family);

    if (!familyKey) {
      return;
    }

    if (!records.has(familyKey)) {
      records.set(familyKey, {
        family: record.family,
        fontFiles: [],
        stylesheets: []
      });
    }

    const existing = records.get(familyKey);
    existing.fontFiles = dedupe(existing.fontFiles.concat(record.fontFiles || []));
    existing.stylesheets = dedupe(existing.stylesheets.concat(record.stylesheets || []));
  });

  return records;
}

async function collectRemoteFontFaces(stylesheetLinks) {
  const queue = dedupe(stylesheetLinks).slice(0, 16);
  const visited = new Set();
  const fontFaces = [];

  while (queue.length) {
    const stylesheetUrl = queue.shift();

    if (!stylesheetUrl || visited.has(stylesheetUrl)) {
      continue;
    }

    visited.add(stylesheetUrl);

    try {
      const cssText = await fetchCss(stylesheetUrl);
      fontFaces.push(...parseFontFaces(cssText, stylesheetUrl));

      parseImports(cssText, stylesheetUrl).forEach((importedUrl) => {
        if (!visited.has(importedUrl)) {
          queue.push(importedUrl);
        }
      });
    } catch (error) {
      console.debug("Unable to fetch stylesheet", stylesheetUrl, error);
    }
  }

  return fontFaces;
}

async function fetchCss(url) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "omit"
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    return await response.text();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function parseImports(cssText, baseUrl) {
  const importedUrls = [];
  const importPattern = /@import\s+(?:url\()?["']?([^"'()\s]+)["']?\)?/gi;
  let match;

  while ((match = importPattern.exec(cssText))) {
    try {
      importedUrls.push(new URL(match[1], baseUrl).href);
    } catch (error) {
      console.debug("Could not resolve @import URL", match[1], error);
    }
  }

  return importedUrls;
}

function parseFontFaces(cssText, stylesheetUrl) {
  const fontFaces = [];
  const fontFacePattern = /@font-face\s*{([\s\S]*?)}/gi;
  let blockMatch;

  while ((blockMatch = fontFacePattern.exec(cssText))) {
    const block = blockMatch[1];
    const familyMatch = block.match(/font-family\s*:\s*([^;]+);/i);

    if (!familyMatch) {
      continue;
    }

    const srcMatch = block.match(/src\s*:\s*([^;]+);/i);
    const family = cleanupFamilyName(familyMatch[1]);
    const fontFiles = srcMatch ? extractUrls(srcMatch[1], stylesheetUrl) : [];

    fontFaces.push({
      family,
      fontFiles,
      stylesheets: stylesheetUrl ? [stylesheetUrl] : []
    });
  }

  return fontFaces;
}

function extractUrls(sourceValue, baseUrl) {
  const urls = [];
  const urlPattern = /url\(([^)]+)\)/gi;
  let match;

  while ((match = urlPattern.exec(sourceValue))) {
    const rawValue = match[1].trim().replace(/^['"]|['"]$/g, "");

    try {
      urls.push(new URL(rawValue, baseUrl).href);
    } catch (error) {
      console.debug("Could not resolve font URL", rawValue, error);
    }
  }

  return dedupe(urls);
}

function labelUrl(url, fallbackLabel) {
  try {
    const parsedUrl = new URL(url);
    const lastPathSegment = parsedUrl.pathname.split("/").filter(Boolean).pop();
    return `${fallbackLabel}: ${lastPathSegment || parsedUrl.hostname}`;
  } catch (error) {
    return `${fallbackLabel}: ${url}`;
  }
}

function normalizeUrl(url) {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.hash = "";
    return parsedUrl.href;
  } catch (error) {
    return url;
  }
}

function normalizeFamilyName(family) {
  return cleanupFamilyName(family).toLowerCase();
}

function cleanupFamilyName(family) {
  return String(family || "").trim().replace(/^['"]|['"]$/g, "");
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function analyzePage() {
  const COLOR_PROPERTIES = [
    ["color", "text"],
    ["backgroundColor", "background"],
    ["borderTopColor", "border"],
    ["borderRightColor", "border"],
    ["borderBottomColor", "border"],
    ["borderLeftColor", "border"],
    ["outlineColor", "outline"],
    ["textDecorationColor", "decoration"],
    ["caretColor", "caret"],
    ["fill", "fill"],
    ["stroke", "stroke"]
  ];

  const colorMap = new Map();
  const fontMap = new Map();
  const stylesheetLinks = new Set();
  const fontFaceRules = [];
  const loadedFamilyStates = new Map();
  const elements = collectElements();

  if (document.styleSheets) {
    Array.from(document.styleSheets).forEach((sheet) => {
      if (sheet.href) {
        stylesheetLinks.add(sheet.href);
      }

      try {
        collectFontFaceRules(sheet.cssRules, sheet.href || document.location.href, fontFaceRules, stylesheetLinks);
      } catch (error) {
        // Cross-origin stylesheets often block cssRules access; remote fetch fallback handles these.
      }
    });
  }

  if (document.fonts && document.fonts.values) {
    Array.from(document.fonts.values()).forEach((fontFace) => {
      const family = cleanupFamilyName(fontFace.family);

      if (!family) {
        return;
      }

      loadedFamilyStates.set(family, loadedFamilyStates.get(family) || fontFace.status === "loaded");
    });
  }

  elements.forEach((element) => {
    const styles = window.getComputedStyle(element);
    const seenColorKeys = new Set();

    COLOR_PROPERTIES.forEach(([property, role]) => {
      const parsedColor = parseColor(styles[property]);

      if (!parsedColor) {
        return;
      }

      const colorKey = `${role}:${parsedColor.rgba}`;

      if (seenColorKeys.has(colorKey)) {
        return;
      }

      seenColorKeys.add(colorKey);
      registerColor(colorMap, parsedColor, role, element);
    });

    const fontFamily = styles.fontFamily?.trim();

    if (fontFamily) {
      registerFont(fontMap, {
        stack: fontFamily,
        primaryFamily: extractPrimaryFamily(fontFamily),
        size: styles.fontSize || "inherit",
        weight: styles.fontWeight || "400",
        style: styles.fontStyle || "normal",
        lineHeight: styles.lineHeight || "normal",
        letterSpacing: styles.letterSpacing || "normal",
        selector: describeElement(element),
        sampleText: extractSampleText(element),
        loaded: isFontLoaded(fontFamily)
      });
    }
  });

  return {
    meta: {
      title: document.title || "Untitled page",
      url: document.location.href,
      totalElements: elements.length
    },
    colors: finalizeColorMap(colorMap),
    fonts: finalizeFontMap(fontMap),
    fontFaceRules,
    stylesheetLinks: Array.from(stylesheetLinks),
    loadedFontResources: collectLoadedFontResources(),
    loadedFamilies: Array.from(loadedFamilyStates, ([family, loaded]) => ({ family, loaded }))
  };

  function collectElements() {
    const found = new Set();
    const candidates = [document.documentElement, document.body, ...Array.from(document.querySelectorAll("*"))];

    return candidates.filter((element) => {
      if (!element || found.has(element)) {
        return false;
      }

      found.add(element);
      return true;
    });
  }

  function collectFontFaceRules(cssRules, sourceUrl, fontFaceAccumulator, stylesheetAccumulator) {
    if (!cssRules) {
      return;
    }

    Array.from(cssRules).forEach((rule) => {
      if (rule.href) {
        stylesheetAccumulator.add(rule.href);
      }

      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const family = cleanupFamilyName(rule.style.getPropertyValue("font-family"));
        const sourceValue = rule.style.getPropertyValue("src");

        fontFaceAccumulator.push({
          family,
          fontFiles: extractUrls(sourceValue, sourceUrl),
          stylesheets: sourceUrl ? [sourceUrl] : []
        });
        return;
      }

      if (rule.styleSheet?.href) {
        stylesheetAccumulator.add(rule.styleSheet.href);
      }

      if (rule.cssRules) {
        collectFontFaceRules(rule.cssRules, rule.href || sourceUrl, fontFaceAccumulator, stylesheetAccumulator);
      }
    });
  }

  function registerColor(targetMap, parsedColor, role, element) {
    if (!targetMap.has(parsedColor.rgba)) {
      targetMap.set(parsedColor.rgba, {
        hex: parsedColor.hex,
        rgb: parsedColor.rgb,
        rgba: parsedColor.rgba,
        alpha: parsedColor.alpha,
        usageCount: 0,
        selectors: [],
        roleCounts: {}
      });
    }

    const record = targetMap.get(parsedColor.rgba);
    record.usageCount += 1;
    record.roleCounts[role] = (record.roleCounts[role] || 0) + 1;

    const selector = describeElement(element);

    if (selector && !record.selectors.includes(selector) && record.selectors.length < 5) {
      record.selectors.push(selector);
    }
  }

  function registerFont(targetMap, fontDetails) {
    if (!targetMap.has(fontDetails.stack)) {
      targetMap.set(fontDetails.stack, {
        stack: fontDetails.stack,
        primaryFamily: fontDetails.primaryFamily,
        usageCount: 0,
        selectors: [],
        sampleText: "",
        sizes: {},
        weights: {},
        styles: {},
        lineHeights: {},
        letterSpacings: {},
        loaded: false
      });
    }

    const record = targetMap.get(fontDetails.stack);
    record.usageCount += 1;
    record.loaded = record.loaded || fontDetails.loaded;
    incrementCounter(record.sizes, fontDetails.size);
    incrementCounter(record.weights, fontDetails.weight);
    incrementCounter(record.styles, fontDetails.style);
    incrementCounter(record.lineHeights, fontDetails.lineHeight);
    incrementCounter(record.letterSpacings, fontDetails.letterSpacing);

    if (fontDetails.selector && !record.selectors.includes(fontDetails.selector) && record.selectors.length < 5) {
      record.selectors.push(fontDetails.selector);
    }

    if (!record.sampleText && fontDetails.sampleText) {
      record.sampleText = fontDetails.sampleText;
    }
  }

  function finalizeColorMap(targetMap) {
    return Array.from(targetMap.values());
  }

  function finalizeFontMap(targetMap) {
    return Array.from(targetMap.values()).map((font) => ({
      stack: font.stack,
      primaryFamily: font.primaryFamily,
      usageCount: font.usageCount,
      selectors: font.selectors,
      sampleText: font.sampleText,
      topSize: getTopCounterValue(font.sizes),
      topWeight: getTopCounterValue(font.weights),
      topStyle: getTopCounterValue(font.styles),
      topLineHeight: getTopCounterValue(font.lineHeights),
      topLetterSpacing: getTopCounterValue(font.letterSpacings),
      loaded: font.loaded
    }));
  }

  function incrementCounter(counter, value) {
    const key = value || "normal";
    counter[key] = (counter[key] || 0) + 1;
  }

  function getTopCounterValue(counter) {
    const entries = Object.entries(counter);

    if (!entries.length) {
      return "normal";
    }

    entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    return entries[0][0];
  }

  function parseColor(rawValue) {
    if (!rawValue || rawValue === "transparent" || rawValue === "currentcolor") {
      return null;
    }

    const rgbMatch = rawValue.match(/rgba?\(([^)]+)\)/i);

    if (!rgbMatch) {
      return null;
    }

    const channels = rgbMatch[1]
      .split(",")
      .map((value) => value.trim())
      .map((value) => value.endsWith("%") ? String(Math.round((Number.parseFloat(value) / 100) * 255)) : value);

    const red = Number.parseFloat(channels[0]);
    const green = Number.parseFloat(channels[1]);
    const blue = Number.parseFloat(channels[2]);
    const alpha = channels[3] !== undefined ? Number.parseFloat(channels[3]) : 1;

    if ([red, green, blue, alpha].some((value) => Number.isNaN(value)) || alpha <= 0) {
      return null;
    }

    const hex = `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
    const rgb = `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`;
    const rgba = alpha < 1
      ? `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${trimNumber(alpha)})`
      : rgb;

    return {
      hex,
      rgb,
      rgba,
      alpha
    };
  }

  function toHex(value) {
    return Math.round(value).toString(16).padStart(2, "0").toUpperCase();
  }

  function trimNumber(value) {
    return Number.parseFloat(Number(value).toFixed(3)).toString();
  }

  function describeElement(element) {
    const tagName = element.tagName ? element.tagName.toLowerCase() : "node";
    const id = element.id ? `#${element.id}` : "";
    const classNames = element.classList ? Array.from(element.classList).slice(0, 2).map((name) => `.${name}`).join("") : "";
    return `${tagName}${id}${classNames}`;
  }

  function extractPrimaryFamily(stack) {
    return cleanupFamilyName(String(stack).split(",")[0]);
  }

  function extractSampleText(element) {
    const text = element.textContent ? element.textContent.replace(/\s+/g, " ").trim() : "";

    if (!text) {
      return "";
    }

    return text.slice(0, 110);
  }

  function isFontLoaded(fontStack) {
    if (!document.fonts || !document.fonts.check) {
      return false;
    }

    try {
      return document.fonts.check(`16px ${fontStack}`);
    } catch (error) {
      return false;
    }
  }

  function collectLoadedFontResources() {
    if (!window.performance || !performance.getEntriesByType) {
      return [];
    }

    return Array.from(performance.getEntriesByType("resource"))
      .map((entry) => entry.name)
      .filter((name) => /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(name));
  }

  function extractUrls(sourceValue, baseUrl) {
    const urls = [];
    const urlPattern = /url\(([^)]+)\)/gi;
    let match;

    while ((match = urlPattern.exec(sourceValue || ""))) {
      const rawValue = match[1].trim().replace(/^['"]|['"]$/g, "");

      try {
        urls.push(new URL(rawValue, baseUrl).href);
      } catch (error) {
        // Ignore invalid URLs inside font-face blocks.
      }
    }

    return Array.from(new Set(urls));
  }

  function cleanupFamilyName(family) {
    return String(family || "").trim().replace(/^['"]|['"]$/g, "");
  }
}
