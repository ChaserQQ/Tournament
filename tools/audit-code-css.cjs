const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = {
  index: "index.html",
  app: "src/app.js",
  css: "src/styles/app.css",
  build: "src/core/build.js",
  verify: "tools/verify-static.js"
};

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractCssClasses(cssText) {
  const classes = new Map();
  const clean = stripCssComments(cssText);
  const pattern = /\.(-?[_a-zA-Z][-_a-zA-Z0-9]*)\b/g;
  let match;
  while ((match = pattern.exec(clean))) {
    const className = match[1];
    const list = classes.get(className) || [];
    list.push(lineOf(cssText, match.index));
    classes.set(className, list);
  }
  return classes;
}

function extractSelectors(cssText) {
  const clean = stripCssComments(cssText);
  const selectors = [];
  let buffer = "";
  let depth = 0;
  let start = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (char === "{") {
      const selector = buffer.trim();
      if (selector && !selector.startsWith("@")) {
        selectors.push({ selector, line: lineOf(clean, start) });
      }
      buffer = "";
      depth += 1;
      start = i + 1;
      continue;
    }
    if (char === "}") {
      buffer = "";
      depth = Math.max(0, depth - 1);
      start = i + 1;
      continue;
    }
    if (depth === 0) buffer += char;
  }
  return selectors;
}

function evalBuildMeta(buildJs) {
  const sandbox = { window: {}, document: { documentElement: { setAttribute() {} } }, console };
  vm.runInNewContext(buildJs, sandbox, { filename: files.build });
  return sandbox.window.MINI4WD_BUILD_META || {};
}

function count(pattern, text) {
  return (text.match(pattern) || []).length;
}

function topEntries(items, limit = 20) {
  return items.slice(0, limit);
}

function main() {
  const index = read(files.index);
  const app = read(files.app);
  const css = read(files.css);
  const build = read(files.build);
  const verify = read(files.verify);
  const sourceText = [index, app, verify].join("\n");
  const buildMeta = evalBuildMeta(build);

  const cssClasses = extractCssClasses(css);
  const selectors = extractSelectors(css);
  const selectorCounts = new Map();
  selectors.forEach(({ selector, line }) => {
    const list = selectorCounts.get(selector) || [];
    list.push(line);
    selectorCounts.set(selector, list);
  });

  const cssOnlyVersioned = [];
  cssClasses.forEach((lines, className) => {
    if (!/-v\d{2,3}$/.test(className)) return;
    if (sourceText.includes(className)) return;
    cssOnlyVersioned.push({ className, lines: topEntries([...new Set(lines)], 5) });
  });
  cssOnlyVersioned.sort((a, b) => a.lines[0] - b.lines[0] || a.className.localeCompare(b.className));

  const duplicatedSelectors = [...selectorCounts.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([selector, lines]) => ({ selector, lines }))
    .sort((a, b) => b.lines.length - a.lines.length || a.selector.localeCompare(b.selector));

  const longSelectors = selectors
    .filter(item => item.selector.length > 220)
    .map(item => ({ line: item.line, length: item.selector.length, selector: item.selector.slice(0, 260) }))
    .sort((a, b) => b.length - a.length);

  const broadSelectors = selectors
    .filter(item => /body\[class\*=["']surface-|html body\[class\*=["']surface-|\*|:where\(|:is\(/.test(item.selector))
    .map(item => ({ line: item.line, selector: item.selector.slice(0, 220) }));

  const importantCount = count(/!important\b/g, css);
  const inlineHandlerCount = count(/\son(?:click|change|input|blur|submit|keydown)=/g, app);
  const wrapperRuntimeHits = [];
  const wrapperPattern = /\b(original[A-Za-z0-9]+V\d+|[A-Za-z0-9]+WrappedV\d+|__v\d+Wrapped)\b/g;
  let wrapperMatch;
  while ((wrapperMatch = wrapperPattern.exec(app))) {
    wrapperRuntimeHits.push({ name: wrapperMatch[1], line: lineOf(app, wrapperMatch.index) });
  }

  const cssVersionComments = [];
  const commentPattern = /\/\*[^*]*\bv\d{2,3}\b[\s\S]*?\*\//g;
  let commentMatch;
  while ((commentMatch = commentPattern.exec(css))) {
    cssVersionComments.push({
      line: lineOf(css, commentMatch.index),
      text: commentMatch[0].replace(/\s+/g, " ").slice(0, 120)
    });
  }

  const hardProblems = [];
  if ((css.match(/{/g) || []).length !== (css.match(/}/g) || []).length) {
    hardProblems.push("CSS brace count is not balanced.");
  }
  if (!Number.isInteger(buildMeta.version) || !buildMeta.assets) {
    hardProblems.push("Build metadata could not be evaluated.");
  }
  if (!index.includes(`src/styles/app.css?v=${buildMeta.assets && buildMeta.assets.css}`)) {
    hardProblems.push("index.html CSS query string does not match build metadata.");
  }
  if (!index.includes(`src/app.js?v=${buildMeta.assets && buildMeta.assets.app}`)) {
    hardProblems.push("index.html app query string does not match build metadata.");
  }
  if (!index.includes(`src/core/build.js?v=${buildMeta.assets && buildMeta.assets.build}`)) {
    hardProblems.push("index.html build query string does not match build metadata.");
  }
  if (cssOnlyVersioned.length) {
    hardProblems.push(`CSS-only versioned classes found: ${cssOnlyVersioned.map(item => item.className).join(", ")}`);
  }

  const report = {
    build: { version: buildMeta.version, label: buildMeta.label, assets: buildMeta.assets },
    files: {
      appLines: app.split(/\r?\n/).length,
      cssLines: css.split(/\r?\n/).length
    },
    counts: {
      cssClasses: cssClasses.size,
      cssSelectors: selectors.length,
      cssImportant: importantCount,
      inlineHandlers: inlineHandlerCount,
      wrapperRuntimeHits: wrapperRuntimeHits.length,
      cssVersionComments: cssVersionComments.length,
      cssOnlyVersionedClasses: cssOnlyVersioned.length,
      duplicatedSelectors: duplicatedSelectors.length,
      longSelectors: longSelectors.length,
      broadSelectors: broadSelectors.length
    },
    focus: {
      cssOnlyVersionedClasses: topEntries(cssOnlyVersioned, 80),
      duplicatedSelectors: topEntries(duplicatedSelectors, 30),
      longSelectors: topEntries(longSelectors, 20),
      broadSelectors: topEntries(broadSelectors, 30),
      wrapperRuntimeHits: topEntries(wrapperRuntimeHits, 40),
      cssVersionComments: topEntries(cssVersionComments, 40)
    },
    hardProblems
  };

  console.log(JSON.stringify(report, null, 2));
  if (hardProblems.length) process.exit(1);
}

main();
