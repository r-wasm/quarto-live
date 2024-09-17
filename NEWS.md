# Quarto Live (development version)

## New features

* Setup blocks may now be attached to multiple exercises by providing a list for the `exercise` cell option.

## Bug fixes

* Ensure that JavaScript scripts that have been dynamically added via HTML output are executed.

* Fixed building deep subdirectory structure when copying resources into the WebAssembly virtual filesystem (#53).

* Fixed layering of shared execution environments in Pyodide exercises (#63).

* Ensure variables defined at the top level of the the grading environment are available as globals when executing grading algorithms with Pyodide (#63).

* Better handle `echo: false` and `include: false` cell options (#62).

# Quarto Live 0.1.1

Initial release.
