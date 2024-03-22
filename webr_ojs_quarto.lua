local webr_definitions = pandoc.List({})
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

  webr_definitions:insert(code.text)
  block_id = block_id + 1

  local file = io.open("webr-evaluate.ojs", "r")
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
      "<script type=\"webr-" .. block_id .. "-contents\">\n" .. quarto.base64.encode(code.text) .. "\n</script>"
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
    "html", "<script type=\"ojs-module-contents\">\n" .. json_as_b64(ojs_definitions) .. "\n</script>"))
  return doc
end

return {
  CodeBlock = CodeBlock,
  Pandoc = Pandoc
}
