#!/usr/bin/env node
// Downloads labelled figure pictures for the store-fed collectible lines and
// records them in htdocs/assets/data/collectible-figure-images.json, which the
// API reads to give catalog figures a local image.
//
//   Nommi:      TOYSEZ sells most figures as single listings, each with its own
//               photo on Shopify's CDN (no requests to the storefront itself).
//   SKULLPANDA and POP BEAN: each Pop Mart set page lists its figures with their
//               pictures in the page data (props.pageProps.serverSeoData.commonInfo.toys).
//
// Polite by design: Pop Mart pages are fetched 6-9 s apart, images 1.5 s apart
// per host, and the first 429/403/503 stops the run (files already saved are
// kept; a rerun resumes). Run it under the shared collectibles lock so it never
// overlaps the scheduled store refresher:
//
//   flock -w 1800 /run/lock/wowiekowie-collectibles.lock \
//     node tools/collectible-figure-images.mjs [--brand=nommi|skullpanda] [--dry-run]
//
// --from=<file.json> instead imports researched pictures for any line
// (Sonny Angel included): { "<set id>": { "<figure name>": { "image": url,
// "page": url, "label": "what names the figure there", "source_type": "…" } } }.
// Only pictures whose own label names the figure belong in such a file.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'htdocs/assets/data/collectible-figure-images.json');
const IMAGE_ROOT = join(ROOT, 'htdocs/assets/images/collectibles');
const API = 'https://wowiekowie.com/api/v1/collectibles';
const USER_AGENT = 'wowiekowie.com collectibles catalog (figure pictures; contact via wowiekowie.com)';
const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')).map(([key, value]) => [key, value ?? true]));
const fromFile = args.has('from') ? String(args.get('from')) : null;
const brands = fromFile !== null ? ['from'] : (args.has('brand') ? [String(args.get('brand'))] : ['nommi', 'skullpanda', 'pop-bean']);
const dryRun = args.has('dry-run');

class Refused extends Error {}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lastRequest = new Map();
const politeFetch = async (url, minGapMs, jitterMs = 0) => {
  const host = new URL(url).host;
  const wait = (lastRequest.get(host) ?? 0) + minGapMs + Math.random() * jitterMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest.set(host, Date.now());
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } });
  if ([403, 429, 503].includes(response.status)) throw new Refused(`${host} answered HTTP ${response.status}; stopping (rerun later to resume).`);
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response;
};

// Matching keys: the API attaches pictures by series and normalized figure name.
const figureKey = (name) => String(name).normalize('NFKC')
  .replace(/[‘’`´]/g, "'")
  .replace(/\(\s*(?:super\s+)?secret\s*\)/gi, '')
  .replace(/\s*\(\s*/g, ' (')
  .replace(/\s*\)/g, ')')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
const slug = (text) => figureKey(text).replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figure';

const listings = async (brand) => {
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const response = await politeFetch(`${API}?year=all&brand=${brand}&limit=100&offset=${offset}`, 300);
    const payload = await response.json();
    all.push(...payload.data);
    if (all.length >= payload.meta.total || payload.data.length === 0) return all;
  }
};

// [{ seriesId, name, source, page }]
const nommiFigures = async () => (await listings('nommi'))
  .filter((listing) => listing.listing_kind === 'figure' && listing.series_id && listing.listing_figure
    && typeof listing.image_url === 'string' && new URL(listing.image_url).host === 'cdn.shopify.com')
  .map((listing) => {
    const source = new URL(listing.image_url);
    source.searchParams.set('width', '640');
    return { seriesId: listing.series_id, name: listing.listing_figure, source: source.href, page: listing.product_url };
  });

const popMartFigures = async (brand, known) => {
  const sets = (await listings(brand))
    .filter((listing) => listing.listing_kind === 'series' && listing.series_id && /^https:\/\/www\.popmart\.com\//.test(listing.product_url));
  const figures = [];
  for (const set of sets) {
    const wanted = new Set(set.variants.map((variant) => figureKey(variant.name)));
    if ([...wanted].every((key) => known.has(`${set.series_id}\u0000${key}`))) continue;
    const html = await (await politeFetch(set.product_url, 6000, 3000)).text();
    const data = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    const toys = data ? JSON.parse(data[1])?.props?.pageProps?.serverSeoData?.commonInfo?.toys : null;
    if (!Array.isArray(toys)) {
      console.log(`${set.series_id}: no figure list on ${set.product_url}`);
      continue;
    }
    let matched = 0;
    for (const toy of toys) {
      if (typeof toy?.name !== 'string' || typeof toy?.url !== 'string' || !/^https:\/\/(?:(?:prod-[a-z-]+|global-static)\.popmart\.com|prod-global-static\.oss-us-east-1\.aliyuncs\.com)\//.test(toy.url)) continue;
      const name = toy.name.replace(/[（(]\s*(?:super\s+)?secret\s*[)）]/gi, '').trim();
      if (wanted.has(figureKey(name))) matched += 1;
      // The prod-*.popmart.com image hosts resize on request; the static hosts serve originals.
      const resize = /^https:\/\/prod-[a-z-]+\.popmart\.com\//.test(toy.url) ? '?x-oss-process=image/resize,w_640' : '';
      figures.push({ seriesId: set.series_id, name, source: `${toy.url.split('?')[0]}${resize}`, page: set.product_url });
    }
    console.log(`${set.series_id}: ${toys.length} pictured figures, ${matched} match the shelf's figure names`);
  }
  return figures;
};

// [{ seriesId, name, source, page, label, sourceType }] from a research file.
const researchedFigures = (file) => Object.entries(JSON.parse(readFileSync(file, 'utf8')))
  .flatMap(([seriesId, figures]) => Object.entries(figures).map(([name, entry]) => ({
    seriesId,
    name,
    source: entry.image,
    page: entry.page,
    label: entry.label,
    sourceType: entry.source_type,
  })))
  .filter((figure) => /^(?:sonny-angel|skullpanda|nommi|pop-bean):[a-z0-9-]+$/.test(figure.seriesId)
    && /^https:\/\//.test(String(figure.source)) && /^https:\/\//.test(String(figure.page)));

const manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
  : { schemaVersion: 1, checkedAt: null, note: '', images: {} };
// Keys follow figureKey(); re-key in case its rules changed since the last run.
manifest.images = Object.fromEntries(Object.entries(manifest.images)
  .map(([seriesId, figures]) => [seriesId, Object.fromEntries(Object.values(figures).map((entry) => [figureKey(entry.name), entry]))]));
manifest.note = 'Figure pictures downloaded by tools/collectible-figure-images.mjs from the store page cited as each picture\'s page; converted to 320px WebP.';
const known = new Set(Object.entries(manifest.images).flatMap(([seriesId, figures]) => Object.keys(figures).map((key) => `${seriesId}\u0000${key}`)));
let saved = 0;
let stopped = null;
try {
  for (const brand of brands) {
    const figures = brand === 'from' ? researchedFigures(fromFile) : (brand === 'nommi' ? await nommiFigures() : await popMartFigures(brand, known));
    for (const figure of figures) {
      const key = figureKey(figure.name);
      if (known.has(`${figure.seriesId}\u0000${key}`)) continue;
      const [brandKey, seriesSlug] = figure.seriesId.split(':');
      const relative = `/assets/images/collectibles/${brandKey}/${slug(seriesSlug)}/${slug(figure.name)}.webp`;
      const file = join(ROOT, 'htdocs', relative);
      if (dryRun) {
        console.log(`would save ${relative} from ${figure.source}`);
        continue;
      }
      if (!existsSync(file)) {
        const body = Buffer.from(await (await politeFetch(figure.source, 1500)).arrayBuffer());
        mkdirSync(dirname(file), { recursive: true });
        const download = `${file}.download`;
        writeFileSync(download, body);
        try {
          execFileSync('convert', [download, '-resize', '320x320>', '-strip', '-quality', '80', `webp:${file}`]);
        } finally {
          rmSync(download, { force: true });
        }
      }
      manifest.images[figure.seriesId] ??= {};
      manifest.images[figure.seriesId][key] = {
        name: figure.name,
        path: relative,
        source: figure.source,
        page: figure.page,
        ...(figure.label ? { label: figure.label } : {}),
        ...(figure.sourceType ? { sourceType: figure.sourceType } : {}),
      };
      known.add(`${figure.seriesId}\u0000${key}`);
      saved += 1;
      if (saved % 10 === 0) console.log(`${saved} pictures saved`);
    }
  }
} catch (error) {
  if (!(error instanceof Refused)) throw error;
  stopped = error.message;
} finally {
  if (!dryRun) {
    manifest.checkedAt = new Date().toISOString().slice(0, 10);
    manifest.images = Object.fromEntries(Object.entries(manifest.images).sort(([left], [right]) => left.localeCompare(right))
      .map(([seriesId, figures]) => [seriesId, Object.fromEntries(Object.entries(figures).sort(([left], [right]) => left.localeCompare(right)))]));
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}
console.log(`${saved} new pictures recorded.${stopped ? ` ${stopped}` : ''}`);
if (stopped) process.exitCode = 2;
