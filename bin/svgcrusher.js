#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { crushSvg } from '../src/index.js';

const help = `SVGCrusher — SVG optimization for svgcrusher.com

Usage: svgcrusher [input.svg | -] [options]

  -i, --input FILE      Input file (- or piped stdin if omitted)
  -o, --output FILE     Output file (- or stdout if omitted)
      --in-place       Replace the input file after successful optimization
  -p, --precision N    Decimal precision, 0–8 (default: 3)
      --keep-metadata  Keep design/editor metadata
      --json           Write a JSON report to stdout (includes SVG without -o)
  -q, --quiet          Suppress the size report on stderr
  -h, --help           Show help
  -v, --version        Show version

  svgcrusher logo.svg -o favicon.svg
  cat logo.svg | svgcrusher > favicon.svg
  svgcrusher logo.svg -o favicon.svg --json
  fav -i favicon.svg -o ./public/icons
`;

async function writeAtomic(file, data) {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const existing = await stat(target).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    await writeFile(temporary, data, { flag: 'wx', mode: existing?.mode });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: 'string', short: 'i' },
      output: { type: 'string', short: 'o' },
      precision: { type: 'string', short: 'p', default: '3' },
      'in-place': { type: 'boolean' },
      'keep-metadata': { type: 'boolean' },
      json: { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) return process.stdout.write(help);
  if (values.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return process.stdout.write(`${pkg.version}\n`);
  }
  if (positionals.length > 1 || (values.input !== undefined && positionals.length)) {
    throw new Error('Provide one input file, either positional or with --input.');
  }
  const input = values.input ?? positionals[0] ?? '-';
  if (!input || values.output === '') throw new Error('File paths must not be empty.');
  if (values['in-place'] && (input === '-' || values.output !== undefined)) {
    throw new Error('--in-place requires a file input and cannot be combined with --output.');
  }
  if (input === '-' && process.stdin.isTTY) {
    throw new Error('Provide an SVG file or pipe SVG into stdin. See --help.');
  }
  if (!/^[0-8]$/.test(values.precision)) {
    throw new Error('Precision must be an integer from 0 to 8.');
  }
  const output = values['in-place'] ? input : (values.output ?? '-');
  let source;
  if (input === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    source = Buffer.concat(chunks).toString('utf8');
  } else {
    source = await readFile(input, 'utf8');
  }
  const { data, ...stats } = crushSvg(source, {
    precision: Number(values.precision),
    keepMetadata: values['keep-metadata'],
    path: input === '-' ? undefined : input,
  });
  if (output !== '-') await writeAtomic(output, data);
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ input, output, ...stats, ...(output === '-' ? { data } : {}) })}\n`);
  } else {
    if (output === '-') process.stdout.write(data);
    if (!values.quiet) {
      process.stderr.write(`svgcrusher: ${stats.inputBytes} → ${stats.outputBytes} bytes (${stats.savedPercent}% saved)\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`svgcrusher: ${error.message}\n`);
  process.exitCode = 1;
});
