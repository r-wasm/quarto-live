import sys
import os
import pyodide_http  # type: ignore[attr-defined]
pyodide_http.patch_all()
sys.path.insert(0, "/pyodide/")
os.mkdir(os.path.expanduser("~/.matplotlib"))
f = open(os.path.expanduser("~/.matplotlib/matplotlibrc"), "a")
f.write("backend: module://matplotlib_display")
f.close()
