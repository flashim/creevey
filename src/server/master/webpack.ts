import { rmdirSync } from 'fs';
import path from 'path';
import webpack, { Configuration } from 'webpack';
import nodeExternals from 'webpack-node-externals';
import EventHooksPlugin from 'event-hooks-webpack-plugin';
import { emitMessage, extensions as fallbackExtensions, subscribeOn } from '../../utils';
import { Config, WebpackMessage, Options, noop } from '../../types';

// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import loadStorybookWebpackConfig from '@storybook/core/dist/server/config';

let isInitiated = false;
let filePath = 'storybook.js';
const supportedFrameworks = [
  'react',
  'vue',
  'angular',
  'marionette',
  'mithril',
  'marko',
  'html',
  'svelte',
  'riot',
  'ember',
  'preact',
  'rax',
  'aurelia',
  'server',
  'web-components',
];

function tryDetectStorybookFramework(): string | undefined {
  return supportedFrameworks.find((framework) => {
    try {
      return require.resolve(`@storybook/${framework}`);
    } catch (_) {
      return false;
    }
  });
}

// TODO Output summary of success builds
function handleWebpackBuild(error: Error, stats: webpack.Stats): void {
  if (error || !stats || stats.hasErrors()) {
    emitMessage<WebpackMessage>({ type: isInitiated ? 'rebuild failed' : 'failed' });
    console.error('=> Failed to build the preview'); // TODO Change message

    if (error) return console.error(error.message);
    if (stats && (stats.hasErrors() || stats.hasWarnings())) {
      const { warnings, errors } = stats.toJson();

      errors.forEach((e) => console.error(e));
      warnings.forEach((e) => console.error(e));

      return;
    }
  }
  stats.toJson().warnings.forEach((e) => console.warn(e));

  if (!isInitiated) {
    isInitiated = true;
    emitMessage<WebpackMessage>({ type: 'ready', payload: { filePath } });
  } else {
    emitMessage<WebpackMessage>({ type: 'rebuild succeeded' });
  }

  return;
}

export default async function compile(config: Config, { debug }: Options): Promise<void> {
  const storybookCorePath = require.resolve('@storybook/core');
  const [storybookParentDirectory] = storybookCorePath.split('@storybook');
  const storybookFramework = tryDetectStorybookFramework();

  if (!storybookFramework)
    throw new Error(
      "Couldn't detect used Storybook framework. Please ensure that you install `@storybook/<framework>` package",
    );

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { default: storybookFrameworkOptions } = require(`@storybook/${storybookFramework}/dist/server/options`);

  // TODO Move into node_modules/.cache
  const outputDir = path.join(config.reportDir, 'storybook');
  filePath = path.join(outputDir, path.basename(filePath));

  try {
    rmdirSync(outputDir, { recursive: true });
  } catch (_) {
    /* noop */
  }

  const storybookWebpackConfig: Configuration = await loadStorybookWebpackConfig({
    quiet: true,
    configType: 'PRODUCTION',
    outputDir,
    cache: {},
    corePresets: [require.resolve('@storybook/core/dist/server/preview/preview-preset')],
    overridePresets: [require.resolve('@storybook/core/dist/server/preview/custom-webpack-preset')],
    ...storybookFrameworkOptions,
    configDir: config.storybookDir,
  });

  const extensions = storybookWebpackConfig.resolve?.extensions ?? fallbackExtensions;

  delete storybookWebpackConfig.optimization;
  delete storybookWebpackConfig.devtool;
  storybookWebpackConfig.mode = 'development';
  storybookWebpackConfig.target = 'node';
  storybookWebpackConfig.output = {
    ...storybookWebpackConfig.output,
    filename: path.basename(filePath),
  };
  // Exclude addons
  // TODO Figure why it loading
  // TODO exclude all addons from configs before loadStorybookWebpackConfig
  storybookWebpackConfig.entry = Array.isArray(storybookWebpackConfig.entry)
    ? storybookWebpackConfig.entry.filter((entry) => !entry.includes('@storybook/addon'))
    : storybookWebpackConfig.entry;
  storybookWebpackConfig.module?.rules.unshift({
    enforce: 'pre',
    test: new RegExp(`\\.(${extensions.map((x) => x.slice(1))?.join('|')})$`),
    exclude: /node_modules/,
    use: { loader: require.resolve('./loader'), options: { debug } },
  });
  storybookWebpackConfig.externals = [
    nodeExternals(),
    // TODO Don't work well with monorepos
    nodeExternals({ modulesDir: storybookParentDirectory }),
  ];
  storybookWebpackConfig.plugins?.push(
    new EventHooksPlugin({
      invalid() {
        emitMessage<WebpackMessage>({ type: 'rebuild started' });
      },
    }),
  );

  const storybookWebpackCompiler = webpack(storybookWebpackConfig);
  const watcher = storybookWebpackCompiler.watch({}, handleWebpackBuild);

  subscribeOn('shutdown', () => {
    console.log('[CreeveyWebpack]: Stop watching and shuting down');
    watcher.close(noop);
    process.on('exit', () => console.log('[CreeveyWebpack]: process exiting'));
  });
}
