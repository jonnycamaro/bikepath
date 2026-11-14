// Vite plugin: collects the licences of every npm package that ends up in the built app
// and writes them to licenses.json, which the app shows under Profil → Rechtliches.
// MIT, BSD, ISC and Apache-2.0 all require the copyright notice and licence text to travel
// with the code; the minifier keeps only a few of those comments.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NOTICE_FILES = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

function readPackage(dir) {
  const pkgFile = join(dir, 'package.json');
  if (!existsSync(pkgFile)) return null;
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  if (!pkg.name) return null;
  const files = readdirSync(dir).filter((f) => NOTICE_FILES.test(f)).sort();
  let text = files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n');
  // a few packages ship no licence file: name the licence, the author and where the full text is
  if (!text && typeof pkg.license === 'string') {
    const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
    text = `${pkg.license}${author ? `\nCopyright (c) ${author}` : ''}\nVolltext: https://spdx.org/licenses/${pkg.license}.html`;
  }
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'siehe Lizenztext',
    url: pkg.homepage ?? repo?.replace(/^git\+/, '').replace(/\.git$/, '') ?? `https://www.npmjs.com/package/${pkg.name}`,
    text,
  };
}

/** runtime dependencies of a package, recursively (for packages that ship pre-bundled code) */
function depsOf(name, out = new Set()) {
  const dir = join(process.cwd(), 'node_modules', name);
  if (out.has(dir) || !existsSync(join(dir, 'package.json'))) return out;
  out.add(dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const d of Object.keys(pkg.dependencies ?? {})) if (!d.startsWith('@types/')) depsOf(d, out);
  return out;
}

/**
 * @param {{ extra?: string[], prebundled?: string[] }} options
 *   extra: packages not bundled by Rollup (the service worker runtime);
 *   prebundled: packages whose published file already contains their dependencies (maplibre-gl)
 */
export default function thirdPartyLicenses({ extra = [], prebundled = [] } = {}) {
  return {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle() {
      const dirs = new Set();
      for (const id of this.getModuleIds()) {
        const m = id.replace(/\\/g, '/').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//);
        if (m) dirs.add(m[1]);
      }
      for (const name of extra) dirs.add(join(process.cwd(), 'node_modules', name));
      for (const name of prebundled) for (const d of depsOf(name)) dirs.add(d);
      const seen = new Map();
      for (const dir of dirs) {
        const p = existsSync(dir) ? readPackage(dir) : null;
        if (p) seen.set(`${p.name}@${p.version}`, p);
      }
      const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
      this.emitFile({ type: 'asset', fileName: 'licenses.json', source: JSON.stringify(list) });
    },
  };
}
