import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { createRequire } from 'node:module';
import dts from 'rollup-plugin-dts';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const input = 'src/index.ts';

/** Runtime deps stay external for the ESM/CJS builds so consumers dedupe them. */
const external = [...Object.keys(pkg.dependencies ?? {}), /^rxjs\//, /^node:/];

const banner = `/*! ${pkg.name} v${pkg.version} | ${pkg.license} License | ${pkg.repository.url} */`;

/**
 * `tsc -p tsconfig.build.json` emits raw declarations into .types-tmp, which the final
 * config below rolls up into a single dist/index.d.ts. Bundling them means the published
 * types carry no relative imports, which would otherwise need explicit `.js` extensions
 * to satisfy consumers on moduleResolution node16/nodenext. So every rollup JS pass
 * compiles types-off.
 */
const ts = () =>
  typescript({
    tsconfig: './tsconfig.build.json',
    compilerOptions: {
      declaration: false,
      declarationDir: undefined,
      emitDeclarationOnly: false,
      outDir: undefined,
    },
  });

/** UMD is self-contained: axios/rxjs/lru-cache are inlined so a bare <script> tag works. */
const umd = (minified) => ({
  input,
  plugins: [
    nodeResolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    ts(),
    ...(minified ? [terser({ format: { comments: /^!/ } })] : []),
  ],
  output: {
    file: `dist/index.umd${minified ? '.min' : ''}.js`,
    format: 'umd',
    name: 'OverpassClient',
    exports: 'named',
    sourcemap: false,
    banner,
  },
});

export default [
  {
    input,
    external,
    plugins: [ts()],
    output: [
      { file: 'dist/index.js', format: 'es', sourcemap: false, banner },
      { file: 'dist/index.cjs', format: 'cjs', exports: 'named', sourcemap: false, banner },
    ],
  },
  umd(false),
  umd(true),
  {
    input: '.types-tmp/index.d.ts',
    external,
    plugins: [dts()],
    output: { file: 'dist/index.d.ts', format: 'es', banner },
  },
];
