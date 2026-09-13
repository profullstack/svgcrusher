import { Buffer } from 'node:buffer';
import { optimize } from 'svgo';

/** Optimize a standalone SVG without discarding its accessible name or IDs. */
export function crushSvg(source, { precision = 3, keepMetadata = false, path } = {}) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new TypeError('Input must be a non-empty SVG string.');
  }
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) {
    throw new RangeError('Precision must be an integer from 0 to 8.');
  }

  const { data: optimized } = optimize(source, {
    path,
    multipass: true,
    floatPrecision: precision,
    plugins: [
      {
        name: 'requireSvgRoot',
        fn(root) {
          const elements = root.children.filter((node) => node.type === 'element');
          if (elements.length !== 1 || elements[0].name !== 'svg') {
            throw new Error('Input must have exactly one <svg> document root.');
          }
          const xmlns = elements[0].attributes.xmlns;
          if (xmlns && xmlns !== 'http://www.w3.org/2000/svg') {
            throw new Error('The SVG namespace is invalid.');
          }
        },
      },
      {
        name: 'preset-default',
        params: {
          overrides: {
            // IDs can be referenced by ARIA, CSS, fragments, or embedding code.
            cleanupIds: false,
            removeDesc: false,
            removeUnknownsAndDefaults: { keepRoleAttr: true },
            ...(keepMetadata ? { removeMetadata: false } : {}),
          },
        },
      },
    ],
  });

  const inputBytes = Buffer.byteLength(source);
  // A crusher must never inflate an already compact SVG.
  const data = Buffer.byteLength(optimized) < inputBytes ? optimized : source;
  const outputBytes = Buffer.byteLength(data);
  const savedBytes = inputBytes - outputBytes;
  return {
    data,
    inputBytes,
    outputBytes,
    savedBytes,
    savedPercent: Number(((savedBytes / inputBytes) * 100).toFixed(2)),
  };
}
