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
    attr[k] = v
  end
  for k, v in pairs(param_lines) do
    for k, v in v:gmatch("(%w+): (%w+)") do
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

  local ojs_source = "webr-evaluate.ojs"
  if (attr.edit) then
    ojs_source = "webr-editor.ojs"
  end

  local file = io.open(ojs_source, "r")
  assert(file)
  local content = file:read("*a")
  table.insert(ojs_definitions.contents, {
    methodName = "interpret",
    cellName = "webr-" .. block_id,
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
    name = 'webr-ojs-codemirror',
    resources = {
      "resources/codemirror/dist/webr-ojs-codemirror.js"
    }
  })

  return doc
end

return {
  CodeBlock = CodeBlock,
  Pandoc = Pandoc
}
