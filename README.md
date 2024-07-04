# Quarto Live

This extension embeds WebAssembly powered code blocks and exercises for both the R and Python languages into [Quarto](https://quarto.org) documents using HTML-based output formats. The [webR](https://docs.r-wasm.org/webr/latest/) and [Pyodide](https://pyodide.org/en/stable/) WebAssembly engines are used to dynamically execute code in the user's web browser, so only a static web service (such as [GitHub Pages](https://pages.github.com), [Quarto Pub](https://quartopub.com), or [Netlify](https://www.netlify.com)) is required.

The `quarto-live` extension focuses on providing:
 * Interactive "sandbox" R and Python code blocks.
 * Exercises with optional hints, solutions, and custom grading algorithms.
 * Rich client-side output such as interactive plots, images, and HTML widgets.
 * A customisable CodeMirror-based editor with automatic theming, syntax highlighting, autocomplete, local browser storage, and autorun capabilities.
 * Integration with Quarto's OJS engine so that `quarto-live` code cells update reactively with `{ojs}` cells.

## Installation

```
quarto add r-wasm/quarto-live
```

## Basic Setup

Set the `live` custom format in your Quarto document's yaml header. For ReactJs slides, use `format: live-revealjs`.

```yaml
---
title: A Quarto Live Document
format: live-html
---
```

## Usage

Add an interactive code block into your document using the `{webr}` (for R code) or `{pyodide}` (for Python code) code block types:

````markdown
---
title: A Quarto Live Document
format: live-html
---

```{webr}
fit = lm(mpg ~ am, data = mtcars)
summary(fit)
plot(fit)
```
````

### Using the `knitr` engine

The `quarto-live` extension works with both the `knitr` and `jupyter` engine. If Quarto fails to run, showing errors about a missing `jypyter` or `python` installation, explicitly select the `knitr` engine using `engine: knitr`.

Additionally, when using `knitr`, either the following Quarto shortcode should be added to your document (after the yaml header):

```
{{< include ./_extensions/r-wasm/live/_knitr.qmd >}}
```

or `quarto-live` code block types should be given with a leading `.` character:

````
```{.webr}
fit = lm(mpg ~ am, data = mtcars)
summary(fit)
plot(fit)
```
````

These requirements are temporary and will no longer be required in a future release of `quarto-live`.

## Documentation

With this pre-release version, documentation is currently incomplete. However, a Quarto website showing some examples of how to use `quarto-live` can be found in the `docs` directory.

The website output can be found here: https://quarto-live-dev.netlify.app, but the Quarto source code is likely to be more useful for the moment.

Documentation will be rewritten and expanded before public release.
