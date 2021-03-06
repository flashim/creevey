# creevey

Pretty easy visual testing with magic

[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)

## How to use

- `npm install -D creevey`
- Add `withCreevey` as top-level storybook decorator
- Run tests `yarn creevey --gridUrl "<gridUrl>/wd/hub"`

## What's storybook decorator?

[Using Decorators](https://storybook.js.org/docs/basics/writing-stories/#using-decorators)

```ts
// .storybook/preview.js or .storybook/config.js
import { addDecorator, addParameters } from '@storybook/react';
import { withCreevey } from 'creevey';

addParameters({ creevey: { captureElement: '#root' } });
addDecorator(withCreevey());

/* ... */
```

## Also you can define `creevey.config.ts`

```ts
import path from 'path';
import { CreeveyConfig } from 'creevey';

const config: CreeveyConfig = {
  gridUrl: '<gridUrl>/wd/hub',
  storybookUrl: 'http://localhost:6006',
  storybookDir: path.join(__dirname, '.storybook'),
  screenDir: path.join(__dirname, 'images'),
  reportDir: path.join(__dirname, 'report'),
  diffOptions: { threshold: 0.1 },
  maxRetries: 2,
  browsers: {
    chrome: true,
    ff: 'firefox',
    ie11: {
      browserName: 'internet explorer',
      gridUrl: '<anotherGridUrl>/wd/hub',
      limit: 2,
      /* capabilities */
    },
    otherChrome: {
      browserName: 'chrome',
      storybookUrl: 'http://mystoryhost:6007',
      viewport: { width: 1024, height: 720 },
    },
  },
};

export default config;
```

## Creevey CLI options

- `--config` — Specify path to config file. Default `./creevey.config`
- `--reporter` — Use another reporter for mocha instead of default `spec`
- `--gridUrl` — Specify selenium grid url, work only in zero-config
- `--ui` — Start web server
- `--update` — Approve all images from `report` directory
- `--port` — Specify port for web server. Default `3000`
- `--reportDir` — Path where reports will be stored
- `--screenDir` — Path where reference images are located
- `--debug` — Enable debug output

## Creevey storybook parameters

You can specify storybook parameters on various levels of stories:

```tsx
// Global parameters can be defined in storybook config
addParameters({
  creevey: {
    captureElement: '#root',
    tests: {
      /* see examples below */
    },
    skip: {
      /* see examples below */
    },
  },
});
```

```tsx
// For new `Component Story Format` (CSF) https://storybook.js.org/docs/formats/component-story-format/
// Kind-level parameters work for all stories inside
export default {
  title: 'Views',
  parameters: {
    creevey: {
      /* ... */
    },
  },
};

// Story-level parameters work only for that story
export const simple = () => <MyComponent />;
simple.story = {
  parameters: {
    creevey: {
      /* ... */
    },
  },
};
```

```tsx
// For Old `StoriesOf` API (Storybook version < 5.2)
storiesOf('Views', module)
  .addParameters({
    creevey: {
      /* ... */
    },
  }) // Kind-level
  .add('simple', () => <MyComponent />, {
    creevey: {
      /* ... */
    },
  }); // Story-level
```

NOTE: Parameters for story will be deep-merged with parameters from higher levels.

## `tests` option examples:

`tests` option is a plain object where key used as test name and value is a test function.
Under the hood of `creevey` is used `mocha+chai` and for `chai` additionally defined `matchImage` assertion.

```tsx
import React from 'react';
import { CSFStory } from 'creevey';

export default { title: 'MyComponent' };

export const Simple: CSFStory<JSX.Element> = () => <MyComponent />;
Simple.story = {
  parameters: {
    creevey: {
      captureElement: '#root',
      tests: {
        async click() {
          await this.browser.actions().click(this.captureElement).perform();

          await this.expect(await this.takeScreenshot()).to.matchImage('clicked component');
        },
      },
    },
  },
};
```

## `skip` option examples:

- Skip all stories for all browsers:
  - `skip: 'Skip reason message'`
  - `skip: { reason: 'Skip reason message' }`
- Skip all stories for specific browsers:
  - `skip: { in: 'ie11' }`
  - `skip: { in: ['ie11', 'chrome'] }`
  - `skip: { in: /^fire.*/ }`
- Skip all stories in specific kinds:
  - `skip: { kinds: 'Button' }`
  - `skip: { kinds: ['Button', 'Input'] }`
  - `skip: { kinds: /.*Modal$/ }`
- Skip all tests in specific stories:
  - `skip: { stories: 'simple' }`
  - `skip: { stories: ['simple', 'special'] }`
  - `skip: { stories: /.*large$/ }`
- Skip specific tests:
  - `skip: { tests: 'click' }`
  - `skip: { tests: ['hover', 'click'] }`
  - `skip: { tests: /^press.*$/ }`
- Multiple skip options: `skip: [{ /* ... */ }]`

NOTE: If you try to skip stories by story name, the storybook name format will be used (For more info see [storybook-export-vs-name-handling](https://storybook.js.org/docs/formats/component-story-format/#storybook-export-vs-name-handling))

## FAQ

### Get error `Cannot find module '/path/to/project/creevey.config'` with CRA

CRA don't have `@babel/register` nor `ts-node` in deps, that used to load TypeScript modules in runtime. So you need to install one of those packages explicitly

### Get `SyntaxError: ...` while loading storybook config

I try to figure out what transpiler I should register to load storybook config and stories in your project, but I can't cover all cases. So, if you stuck with this issue, please specify correct require hooks and options on top of creevey config.

### How to use `Creevey` with other framework (WIP, this maybe change in future)

#### Angular

Please see [this guide](docs/angular.md)
