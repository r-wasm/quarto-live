import math
from matplotlib.backend_bases import FigureCanvasBase, FigureManagerBase, _Backend
from matplotlib_pyodide.html5_canvas_backend import RendererHTMLCanvas
from IPython.display import display
from js import ImageData, OffscreenCanvas
from pyodide.ffi import create_proxy

class RichImageBitmapOutput():
    def __init__(self, figure):
        self.image = figure._imagebitmap
        self.title = figure._title

    def _repr_mimebundle_(self, include, exclude):
        return { "application/html-imagebitmap": self.image }, { "title": self.title }
        

class FigureCanvasWorker(FigureCanvasBase):
    def __init__(self, *args, **kwargs):
        FigureCanvasBase.__init__(self, *args, **kwargs)
        self._idle_scheduled = False
        self._id = "matplotlib_" + hex(id(self))[2:]
        self._title = ""
        self._ratio = 2

        width, height = self.get_width_height()
        width *= self._ratio
        height *= self._ratio

        self._canvas = OffscreenCanvas.new(width, height)
        self._context = self._canvas.getContext("2d")
        self._imagebitmap = None

    def show(self, *args, **kwargs):
        self.close()
        self.draw()
        self._imagebitmap = self._canvas.transferToImageBitmap()
        display(RichImageBitmapOutput(self))

    def draw(self):
        self._idle_scheduled = True
        orig_dpi = self.figure.dpi
        if self._ratio != 1:
            self.figure.dpi *= self._ratio
        try:
            width, height = self.get_width_height()
            if self._canvas is None:
                return
            renderer = RendererHTMLCanvasWorker(self._context, width, height, self.figure.dpi, self)
            self.figure.draw(renderer)
        except Exception as e:
            raise RuntimeError("Rendering failed") from e
        finally:
            self.figure.dpi = orig_dpi
            self._idle_scheduled = False

    def set_window_title(self, title):
        self._title = title

    def close(self):
        if (self._imagebitmap):
            self._imagebitmap.close()
            self._imagebitmap = None

    def destroy(self, *args, **kwargs):
        self.close()

# Tweaked methods from pyodide/matplotlib_pyodide/html5_canvas_backend.py
# for OffscreenCanvas and under Web Worker
class RendererHTMLCanvasWorker(RendererHTMLCanvas):
    def draw_image(self, gc, x, y, im, transform=None):
        import numpy as np
        im = np.flipud(im)
        h, w, d = im.shape
        y = self.ctx.height - y - h
        im = np.ravel(np.uint8(np.reshape(im, (h * w * d, -1)))).tobytes()
        pixels_proxy = create_proxy(im)
        pixels_buf = pixels_proxy.getBuffer("u8clamped")
        img_data = ImageData.new(pixels_buf.data, w, h)
        self.ctx.save()
        in_memory_canvas = OffscreenCanvas.new(w, h)
        in_memory_canvas_context = in_memory_canvas.getContext("2d")
        in_memory_canvas_context.putImageData(img_data, 0, 0)
        self.ctx.drawImage(in_memory_canvas, x, y, w, h)
        self.ctx.restore()
        pixels_proxy.destroy()
        pixels_buf.release()

    def draw_text(self, gc, x, y, s, prop, angle, ismath=False, mtext=None):
        if ismath:
            self._draw_math_text(gc, x, y, s, prop, angle)
            return

        angle = math.radians(angle)
        width, height, descent = self.get_text_width_height_descent(s, prop, ismath)
        x -= math.sin(angle) * descent
        y -= math.cos(angle) * descent - self.ctx.height
        font_size = self.points_to_pixels(prop.get_size_in_points())

        font_property_string = "{} {} {:.3g}px {}, {}".format(
            prop.get_style(),
            prop.get_weight(),
            font_size,
            prop.get_name(),
            prop.get_family()[0],
        )
        if angle != 0:
            self.ctx.save()
            self.ctx.translate(x, y)
            self.ctx.rotate(-angle)
            self.ctx.translate(-x, -y)
        self.ctx.font = font_property_string
        self.ctx.fillStyle = self._matplotlib_color_to_CSS(
            gc.get_rgb(), gc.get_alpha(), gc.get_forced_alpha()
        )
        self.ctx.fillText(s, x, y)
        self.ctx.fillStyle = "#000000"
        if angle != 0:
            self.ctx.restore()

class FigureManagerHTMLCanvas(FigureManagerBase):
    def __init__(self, canvas, num):
        super().__init__(canvas, num)
        self.set_window_title("Figure %d" % num)

    def show(self, *args, **kwargs):
        self.canvas.show(*args, **kwargs)

    def destroy(self, *args, **kwargs):
        self.canvas.destroy(*args, **kwargs)

    def resize(self, w, h):
        pass

    def set_window_title(self, title):
        self.canvas.set_window_title(title)


@_Backend.export
class _BackendWasmCoreAgg(_Backend):
    FigureCanvas = FigureCanvasWorker
    FigureManager = FigureManagerHTMLCanvas

    @staticmethod
    def show(*args, **kwargs):
        from matplotlib import pyplot as plt
        plt.gcf().canvas.show(*args, **kwargs)

    @staticmethod
    def destroy(*args, **kwargs):
        from matplotlib import pyplot as plt
        plt.gcf().canvas.destroy(*args, **kwargs)
