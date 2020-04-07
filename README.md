# js-module-renderer

![Github Actions Status](https://github.com/blois/js-module-renderer/workflows/Build/badge.svg)

[![Binder Logo](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/blois/js-module-renderer/master?urlpath=lab%2Ftree%tests.ipynb)

See https://github.com/Quansight-Labs/jupyter-output-spec.



## Requirements

* JupyterLab >= 2.0

## Install

```bash
jupyter labextension install js-module-renderer
```

## Contributing

### Install

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment
# Move to js-module-renderer directory

# Install dependencies
jlpm
# Build Typescript source
jlpm build
# Link your development version of the extension with JupyterLab
jupyter labextension link .
# Rebuild Typescript source after making changes
jlpm build
# Rebuild JupyterLab after making any changes
jupyter lab build
```

You can watch the source directory and run JupyterLab in watch mode to watch for changes in the extension's source and automatically rebuild the extension and application.

```bash
# Watch the source directory in another terminal tab
jlpm watch
# Run jupyterlab in watch mode in one terminal tab
jupyter lab --watch
```

### Uninstall

```bash

jupyter labextension uninstall js-module-renderer
```
