
import pyodide # type: ignore[attr-defined]
import sys

# Cleanup any leftover matplotlib plots
try:
  import matplotlib.pyplot as plt
  plt.close("all")
except ModuleNotFoundError:
  pass

from IPython.utils import capture
from IPython.display import display
from IPython.core.interactiveshell import InteractiveShell
InteractiveShell().instance()

with capture.capture_output() as output:
  value = None
  try:
    value = pyodide.code.eval_code(code, globals = environment) # type: ignore[attr-defined]
  except Exception as err:
    print(err, file=sys.stderr)
  if (value is not None):
    display(value)

{
  "value": value,
  "stdout": output.stdout,
  "stderr": output.stderr,
  "outputs": output.outputs,
}
