// The Omnibar's buttons and Material glyphs are the kit's: its template
// hand-writes no <button> and no Material Symbols span. Its two inline SVG
// glyphs (the mic and the chat row's bubble) are not Material symbols the
// page loads, so they stay as they are drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../views/panels/Omnibar.vue', import.meta.url),
  'utf8',
);
/** The template block: everything outside script and style. */
const template = source.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/g, '');

test('the Omnibar hand-writes no button; each is a UiButton', () => {
  assert.deepEqual(template.match(/<button\b/gi) ?? [], []);
  assert.equal(template.match(/<UiButton\b/g)?.length, 4);
});

test('the locate button is a kit button carrying the my_location glyph', () => {
  const locate = template.match(
    /<UiButton\b[^>]*class="omnibar-locate"[^>]*>[\s\S]*?<\/UiButton>/,
  )?.[0];
  assert.ok(locate, 'a UiButton with class omnibar-locate');
  assert.match(locate, /:label="t\('Go to my location'\)"/);
  assert.match(locate, /<UiIcon name="my_location" :size="null" \/>/);
});

test('the South Africa button is a UiButton with the how_to_vote glyph', () => {
  const sa = template.match(
    /<UiButton\b[^>]*class="omnibar-sa"[^>]*>[\s\S]*?<\/UiButton>/,
  )?.[0];
  assert.ok(sa, 'a UiButton with class omnibar-sa');
  assert.match(sa, /:label="t\('South Africa: 2026 election map'\)"/);
  assert.match(sa, /<UiIcon name="how_to_vote" :size="null" \/>/);
  assert.match(sa, /pressed-class="active"/);
});

test('in dock voice mode the locate button gives way to the waveform with the field', () => {
  const css = readFileSync(
    new URL('../styles/omnibar-dock.css', import.meta.url),
    'utf8',
  );
  // While GEV listens, the field's own parts hide so the waveform shows there.
  const voice = css.match(
    /&:has\(#gev-voice-control\[data-assistant-mode='voice'\]\) #gev-omnibar \{[\s\S]*?:is\(([^)]*)\) \{\s*visibility: hidden;/,
  );
  assert.ok(voice, 'the voice-mode rule that hides the field');
  const hidden = voice[1].split(',').map((part) => part.trim());
  for (const part of ['input', '.omnibar-kbd', '.omnibar-search-icon', '.omnibar-locate', '.omnibar-sa'])
    assert.ok(hidden.includes(part), `${part} hides in voice mode`);
});

test('the Omnibar hand-writes no Material glyph; each is a UiIcon', () => {
  assert.deepEqual(template.match(/material-symbols-outlined/g) ?? [], []);
  const icons = template.match(/<UiIcon\b[^>]*>/g) ?? [];
  assert.equal(icons.length, 5);
  // Without it the kit writes an 18px size that beats the Omnibar's own rules.
  for (const icon of icons) assert.match(icon, /:size="null"/);
});

test('the only inline SVG glyphs are the mic and the chat row bubble', () => {
  const svgs = [...template.matchAll(/<svg\b[\s\S]*?<\/svg\s*>/g)].map(
    (m) => m[0],
  );
  assert.equal(svgs.length, 2);
  assert.match(svgs[0], /<rect x="9" y="3" width="6" height="11" rx="3" \/>/);
  assert.match(svgs[1], /class="omnibar-item-icon"/);
  assert.match(svgs[1], /<path d="M4 5h16v11H9l-5 4z" \/>/);
});
