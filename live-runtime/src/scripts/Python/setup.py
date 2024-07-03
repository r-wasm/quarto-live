import pyodide_http # type: ignore[attr-defined]
pyodide_http.patch_all()

try:
    import matplotlib
    import sys
    sys.path.insert(0, "/pyodide/")
    matplotlib.use("module://matplotlib_display")
except ModuleNotFoundError:
    pass

