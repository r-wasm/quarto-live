local ojs_definitions = {
  contents = {},
}
local block_id = 0

local function json_as_b64(obj)
  local json_string = quarto.json.encode(obj)
  return quarto.base64.encode(json_string)
end

function CodeBlock(code)
  if not (code.classes:includes("{webr}") or code.classes:includes("webr")) then
    return
  end

  local attr = {}
  local param_lines = {}
  local code_lines = {}
  for line in code.text:gmatch("([^\r\n]*)[\r\n]?") do
    local param_line = string.find(line, "^#|")
    if (param_line ~= nil) then
      table.insert(param_lines, string.sub(line, 4))
    else
      table.insert(code_lines, line)
    end
  end
  local r_code = table.concat(code_lines, "\n")
  local param_yaml = table.concat(param_lines, "\n")

  -- TODO: Parse yaml parameters more robustly
  for k, v in pairs(code.attributes) do
    attr[k] = tostring(v)
  end
  for k, v in pairs(param_lines) do
    for k, v in v:gmatch("([^:]+): (.+)") do
      attr[k] = v
    end
  end

  local block = {
    code = r_code,
    attr = attr
  }
  block_id = block_id + 1

  if (attr.output == "asis") then
    quarto.log.warning(
      "Execution option `output: asis` is unsupported for `webr` code blocks."
    )
  end

  -- Render appropriate OJS for the type of client-side block we're working with
  local ojs_source = "webr-evaluate.ojs"
  if (attr.edit) then
    ojs_source = "webr-editor.ojs"
  elseif (attr.exercise) then
    ojs_source = "webr-exercise.ojs"
  end

  local file = io.open(ojs_source, "r")
  assert(file)
  local content = file:read("*a")

  table.insert(ojs_definitions.contents, 1, {
    methodName = "interpret",
    cellName = "webr-" .. block_id,
    inline = false,
    source = string.gsub(content, "{{block_id}}", block_id),
  })

  -- Render any HTMLWidgets after HTML output has been added to the DOM
  file = io.open("webr-widget.ojs", "r")
  assert(file)
  content = file:read("*a")

  table.insert(ojs_definitions.contents, 1, {
    methodName = "interpretQuiet",
    cellName = "webr-widget-" .. block_id,
    inline = false,
    source = string.gsub(content, "{{block_id}}", block_id),
  })

  return pandoc.Div({
    pandoc.Div({}, pandoc.Attr("webr-" .. block_id)),
    pandoc.RawBlock(
      "html",
      "<script type=\"webr-" .. block_id .. "-contents\">\n" ..
      json_as_b64(block) .. "\n</script>"
    )
  })
end

function Pandoc(doc)
  local file = io.open("webr-setup.ojs", "r")
  assert(file)
  local content = file:read("*a")
  table.insert(ojs_definitions.contents, {
    methodName = "interpretQuiet",
    cellName = "webr-prelude",
    inline = false,
    source = content
  })
  doc.blocks:insert(pandoc.RawBlock(
    "html", "<script type=\"ojs-module-contents\">\n" ..
    json_as_b64(ojs_definitions) .. "\n</script>"))

  quarto.doc.add_html_dependency({
    name = 'webr-ojs-runtime',
    scripts = {
      "resources/webr-ojs-runtime/dist/webr-ojs-runtime.js"
    },
    stylesheets = {
      "resources/webr-ojs-runtime/dist/codemirror-themes-html.css"
    }
  })

  return doc
end

return {
  CodeBlock = CodeBlock,
  Pandoc = Pandoc
}
