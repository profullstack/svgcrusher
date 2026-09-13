import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { crushSvg } from '../src/index.js';

const source = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-labelledby="title desc">
  <title id="title">An amber tile</title>
  <desc id="desc">A softly rounded square.</desc>
  <metadata>Editable design contract</metadata>
  <!-- A deliberately editable master -->
  <defs>
    <linearGradient id="paint" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#FFE3A0"/>
      <stop offset="1" stop-color="#F29932"/>
    </linearGradient>
  </defs>
  <rect id="tile" x="2" y="2" width="60" height="60" rx="12" fill="url(#paint)"/>
</svg>`;
const cli = fileURLToPath(new URL('../bin/svgcrusher.js', import.meta.url));
const run = (args = [], options = {}) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', input: source, ...options,
});

test('crushes markup without losing the viewBox, role, labels or local references', () => {
  const result = crushSvg(source);
  assert.ok(result.outputBytes < result.inputBytes);
  assert.equal(result.inputBytes, Buffer.byteLength(source));
  assert.equal(result.outputBytes, Buffer.byteLength(result.data));
  for (const fragment of ['viewBox="0 0 64 64"', 'width="64"', 'height="64"', 'role="img"',
    'aria-labelledby="title desc"', 'id="title"', 'id="desc"', 'id="paint"', 'url(#paint)', 'id="tile"']) {
    assert.ok(result.data.includes(fragment), fragment);
  }
  assert.ok(!result.data.includes('<metadata'));
  assert.ok(!result.data.includes('<!--'));
  assert.ok(crushSvg(source, { keepMetadata: true }).data.includes('Editable design contract'));
});

test('preserves the rendered pixels at favicon and logo sizes', async () => {
  const { data } = crushSvg(source);
  for (const size of [16, 32, 512]) {
    const render = (svg) => sharp(Buffer.from(svg)).resize(size, size).ensureAlpha().raw().toBuffer();
    const [before, after] = await Promise.all([render(source), render(data)]);
    assert.deepEqual(after, before, `render at ${size}px`);
  }
});

test('rejects empty, malformed and non-SVG input and invalid precision', () => {
  for (const svg of ['', '<svg><path></svg>', '<html/>', '<svg/><svg/>', '<svg xmlns="wrong"/>']) {
    assert.throws(() => crushSvg(svg));
  }
  for (const precision of [-1, 9, 1.5, NaN, '3']) {
    assert.throws(() => crushSvg(source, { precision }), /Precision/);
  }
});

test('is deterministic and never expands an already crushed SVG', () => {
  const first = crushSvg(source);
  assert.deepEqual(crushSvg(source), first);
  const second = crushSvg(first.data);
  assert.equal(second.data, first.data);
  assert.equal(second.savedBytes, 0);
  const compact = '<svg/>';
  assert.equal(crushSvg(compact).data, compact);
});

test('pipes only SVG to stdout and reports size on stderr', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, crushSvg(source).data);
  assert.match(result.stderr, /bytes.*saved/);
  assert.equal(run(['--quiet']).stderr, '');
  const json = run(['--json']);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(json.stderr, '');
  assert.equal(JSON.parse(json.stdout).data, crushSvg(source).data);
});

test('writes files and JSON stats, supports in-place, and leaves outputs intact on failure', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'svgcrusher-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'source with spaces.svg');
  const output = join(dir, 'nested', 'favicon.svg');
  await writeFile(input, source);
  const result = run(['-i', input, '-o', output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.outputBytes, Buffer.byteLength(await readFile(output)));
  assert.equal(report.data, undefined);
  assert.equal(await readFile(input, 'utf8'), source);
  assert.equal(run([input, '--in-place', '--quiet']).status, 0);
  assert.equal(await readFile(input, 'utf8'), crushSvg(source).data);

  await writeFile(input, '<svg><bad></svg>');
  const prior = await readFile(output, 'utf8');
  const bad = run([input, '-o', output]);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.equal(await readFile(output, 'utf8'), prior);
  assert.equal(run([input, '--in-place']).status, 1);
  assert.equal(await readFile(input, 'utf8'), '<svg><bad></svg>');
});

test('CLI rejects bad arguments and missing files without prompting', () => {
  for (const args of [['--wat'], ['-o'], ['--precision', 'no'], ['--precision', ''],
    ['--precision', '3.5'], ['--in-place'], ['a.svg', '-i', 'b.svg'],
    ['a.svg', 'b.svg'], ['a.svg', '--in-place', '-o', 'b.svg'], ['/does/not/exist.svg']]) {
    const result = run(args);
    assert.equal(result.status, 1, args.join(' '));
    assert.equal(result.stdout, '');
  }
  assert.equal(run([], { input: '' }).status, 1);
  assert.match(run(['--help']).stdout, /fav -i favicon.svg/);
  assert.match(run(['--version']).stdout, /^0\.1\.0\n$/);
});
