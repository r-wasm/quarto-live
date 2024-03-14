local webr_definitions = pandoc.List({})
local ojs_definitions = {}

local block_id = 0
function CodeBlock(code)
  if not (code.classes:includes("{webr}") or code.classes:includes("webr")) then
    return
  end

  webr_definitions:insert(code.text)
  block_id = block_id + 1
  return pandoc.Div({}, pandoc.Attr("webr-" .. block_id))
end

function Pandoc(doc)
  local file = io.open("webr-setup.ojs", "r")
  assert(file)
  local content = file:read("*a")
  ojs_definitions.contents = {}
  table.insert(ojs_definitions.contents, {
    methodName = "interpretQuiet",
    cellName = "webr-prelude",
    inline = false,
    source = content
  })
  local function json_as_b64(obj)
    local json_string = quarto.json.encode(obj)
    return quarto.base64.encode(json_string)
  end
  doc.blocks:insert(pandoc.Div({}, pandoc.Attr("webr-prelude")))
  doc.blocks:insert(pandoc.RawBlock(
    "html", "<script type=\"ojs-module-contents\">\n" .. json_as_b64(ojs_definitions) .. "\n</script>"))

  local local_block_id = 0
  local webr_blocks = {
    blocks = webr_definitions:map(function(def)
      local_block_id = local_block_id + 1
      return {
        cellName = "webr-" .. local_block_id,
        source = def
      }
    end)
  }
  doc.blocks:insert(pandoc.RawBlock(
    "html", "<script type=\"webr-contents\">\n" .. json_as_b64(webr_blocks) .. "\n</script>"
  ))
  return doc
end

return {
  CodeBlock = CodeBlock,
  Pandoc = Pandoc
}
