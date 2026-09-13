# SVGCrusher

The automation-first CLI and reusable optimizer for **svgcrusher.com**. The web
application is a future consumer of this package; this release provides the CLI.

## Local setup

```sh
npm ci
npm link
svgcrusher ~/logo.svg -o favicon.svg --json
fav -i favicon.svg -o ./public/icons
```

Install `@profullstack/favicon-generator` to get `fav`. SVGCrusher never converts
the source to a bitmap; `fav` renders the PNG, ICO, Apple, and PWA fallbacks from
the optimized SVG. Use the SVG as your preferred browser favicon:

```html
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="icon" type="image/svg+xml" sizes="any" href="/icons/favicon.svg">
```

## Automation

```sh
cat logo.svg | svgcrusher > favicon.svg
svgcrusher -i logo.svg -o public/favicon.svg --quiet
svgcrusher logo.svg --in-place
svgcrusher logo.svg --precision 4 --keep-metadata --json
```

Output defaults to stdout. Reports go to stderr; `--quiet` suppresses them.
`--json` sends one JSON object to stdout, including `data` when no output file
is given, and byte counts plus the percentage saved. Invalid input and unknown
options exit with status 1. File writes are staged beside the destination and
renamed only after optimization succeeds. No TTY prompts or network calls.

Uses [SVGO's default preset](https://svgo.dev/docs/preset-default/) with multipass
optimization and configurable decimal precision (default 3). Preserves the
viewBox, dimensions, IDs, title, description, and ARIA attributes. Comments and
metadata are stripped by default; `--keep-metadata` retains metadata. If the
result would grow, the original is returned. Keep an editable master separately.
SVGO optimization is not sanitization; use trusted source artwork.

## API

```js
import { crushSvg } from '@profullstack/svgcrusher';

const { data, inputBytes, outputBytes, savedBytes, savedPercent } = crushSvg(svg, {
  precision: 3,
  keepMetadata: false,
});
```

## Development

```sh
npm test
npm run check
npm pack
```

NicheDB bundles the unpublished package as a tarball in `vendor/` so clean
checkouts can run `bun run build:brand` without a sibling repository. After
changing this package, pack it again, replace that tarball, and refresh
NicheDB's dependency lockfile.
