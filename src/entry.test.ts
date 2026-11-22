import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

function redirectScript(html: string): string {
  const open = html.indexOf('<script>');
  const close = open < 0 ? -1 : html.indexOf('</script>', open + 8);
  if (open < 0 || close < 0) throw new Error('root redirect script missing');
  return html.slice(open + '<script>'.length, close);
}

function rootLanding(href: string): string | null {
  const body = redirectScript(readFileSync('index.html', 'utf8'));
  const loc = new URL(href);
  let landed: string | null = null;
  const location = {
    pathname: loc.pathname,
    search: loc.search,
    hash: loc.hash,
    replace(url: string) { landed = url; },
  };
  new Function('location', body)(location);
  return landed;
}

describe('site root', () => {
  it('opens /v2/index.html and keeps the project path, query, and hash', () => {
    expect(rootLanding('https://missionaryj.github.io/patrol-radar/?backend=mock#settings'))
      .toBe('/patrol-radar/v2/index.html?backend=mock#settings');
    expect(rootLanding('https://missionaryj.github.io/patrol-radar/index.html?notour=1#chat'))
      .toBe('/patrol-radar/v2/index.html?notour=1#chat');
    expect(rootLanding('https://missionaryj.github.io/patrol-radar')).toBe('/patrol-radar/v2/index.html');
    expect(rootLanding('http://localhost:5173/')).toBe('/v2/index.html');
    expect(rootLanding('https://localhost/index.html#help')).toBe('/v2/index.html#help');
    expect(rootLanding('https://localhost/v2/#updates')).toBe('/v2/index.html#updates');
    expect(rootLanding('https://localhost/v2?chatdemo=1')).toBe('/v2/index.html?chatdemo=1');
    expect(rootLanding('https://localhost/v2/index.html#sheet')).toBeNull();
  });

  it('is a redirect only, with the app and Android start path still at /v2/index.html', () => {
    const root = readFileSync('index.html', 'utf8');
    const app = readFileSync('v2/index.html', 'utf8');
    const config = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(root).not.toContain('/src/main.ts');
    expect(root).not.toContain('Classic');
    expect(root).not.toContain('try the new UI');
    expect(app).toContain('/src/v2/main.ts');
    expect(app).not.toContain('Classic UI');
    expect(app).not.toContain('/src/main.ts');
    expect(config.server.appStartPath).toBe('/v2/index.html');
    expect(manifest.start_url).toBe('./v2/index.html');
    expect(manifest.scope).toBe('./');
    const manifestUrl = 'https://missionaryj.github.io/patrol-radar/manifest.webmanifest';
    const start = new URL(manifest.start_url, manifestUrl);
    const scope = new URL(manifest.scope, manifestUrl);
    expect(start.pathname.startsWith(scope.pathname)).toBe(true);
    expect(existsSync('src/main.ts')).toBe(false);
    expect(existsSync('src/style.css')).toBe(false);
    expect(existsSync('docs/play-store/screenshots/03-classic.png')).toBe(false);
  });
});
