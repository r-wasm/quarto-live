local tinyyaml = require "resources/tinyyaml"

local ojs_definitions = {
  contents = {},
}
local block_id = 0

local function json_as_b64(obj)
  local json_string = quarto.json.encode(obj)
  return quarto.base64.encode(json_string)
end

function WebRCodeBlock(code)
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
  if (param_yaml ~= "") then
    attr = tinyyaml.parse(param_yaml)
  end

  for k, v in pairs(code.attributes) do
    local function toboolean(v)
      return string.lower(v) == "true"
    end

    local convert = { 
      autorun = toboolean,
      echo = toboolean,
      edit = toboolean,
      error = toboolean,
      eval = toboolean,
      include = toboolean,
      output = toboolean,
      startover = toboolean,
      solution = toboolean,
      warning = toboolean,
      timelimit = tonumber,
    }

    if (convert[k]) then
      attr[k] = convert[k](v)
    else
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

  -- If this is a hint return it as a non-interactive code block
  if (attr.exercise and (attr.hint or attr.solution)) then
    -- Build a simple code block from the R source
    local block = pandoc.CodeBlock(r_code, pandoc.Attr('', {'r', 'cell-code'}))

    if (attr.hint) then
      -- Wrap code block in a div and process as a markdown exercise hint
      local container = pandoc.Div(
        {
          pandoc.Strong({"Hint:"}),
          pandoc.Div({block}, pandoc.Attr('', {'p-0'})),
        },
        pandoc.Attr('', {'hint'}, {exercise = attr.exercise})
      )
      return Div(container)
    else
      local container = pandoc.Div(
        pandoc.Div({block}, pandoc.Attr('', {'p-0'})),
        pandoc.Attr('', {'solution'}, {exercise = attr.exercise})
      )
      return Div(container)
    end
  end

  -- Render appropriate OJS for the type of client-side block we're working with
  local ojs_source = "webr-evaluate.ojs"
  if (attr.edit) then
    ojs_source = "webr-editor.ojs"
  elseif (attr.exercise and attr.check) then
    ojs_source = "webr-exercise-check.ojs"
  elseif (attr.exercise and attr.setup) then
    ojs_source = "webr-exercise-setup.ojs"
  elseif (attr.exercise) then
    ojs_source = "webr-exercise.ojs"
  end

  local file = io.open(ojs_source, "r")
  assert(file)
  local content = file:read("*a")

  local input = "{" .. table.concat(attr.input or {}, ", ") .. "}"
  local source = string.gsub(content, "{{block_id}}", block_id)
  if (attr.exercise) then
    source = string.gsub(source, "{{exercise_id}}", attr.exercise)
  end
  source = string.gsub(source, "{{block_input}}", input)

  table.insert(ojs_definitions.contents, 1, {
    methodName = "interpret",
    cellName = "webr-" .. block_id,
    inline = false,
    source = source,
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

function InterpolatedRBlock(code)
  block_id = block_id + 1

  -- Reactively render OJS variables in codeblocks
  file = io.open("webr-interpolate.ojs", "r")
  assert(file)
  content = file:read("*a")

  -- Build map of OJS variable names to JS template literals
  local map = "{\n"
  for var in code.text:gmatch("${([a-zA-Z_$][%w_$]+)}") do
    map = map .. var .. ",\n"
  end
  map = map .. "}"

  -- We add this OJS block for its side effect of updating the HTML element
  content = string.gsub(content, "{{block_id}}", block_id)
  content = string.gsub(content, "{{def_map}}", map)
  table.insert(ojs_definitions.contents, {
    methodName = "interpretQuiet",
    cellName = "webr-" .. block_id,
    inline = false,
    source = content,
  })

  code.identifier = "webr-interpolate-" .. block_id
  return code
end

function CodeBlock(code)
  if (code.classes:includes("{webr}") or code.classes:includes("webr")) then
    -- Client side R code block
    return WebRCodeBlock(code)
  end

  if (code.classes:includes("r") and string.match(code.text, "${[a-zA-Z_$][%w_$]+}")) then
    -- Non-interactive code block containing OJS variables
    return InterpolatedRBlock(code)
  end
end

function Div(block)
  -- Render exercise hints with display:none
  if (block.classes:includes("hint") and block.attributes["exercise"] ~= nil) then
    block.classes:insert("webr-ojs-exercise")
    block.classes:insert("exercise-hint")
    block.classes:insert("d-none")
    return block
  end
end

function Proof(block)
  -- Quarto wraps solution blocks in a Proof structure
  -- Dig into the expected shape and look for our own exercise solutions
  if(block["type"] == "Solution") then
    local content = block["__quarto_custom_node"]
    local container = content.c[1]
    if (container) then
      local solution = container.c[1]
      if (solution) then
        if (solution.attributes["exercise"] ~= nil) then
          solution.classes:insert("webr-ojs-exercise")
          solution.classes:insert("exercise-solution")
          solution.classes:insert("d-none")
          return solution
        end
      end
    end
  end
end

function Pandoc(doc)
  local file = io.open("webr-setup.ojs", "r")
  assert(file)
  local content = file:read("*a")

  local webr_pkgs = {"evaluate", "knitr", "htmltools"}
  for _, pkg in pairs(doc.meta.webr.packages) do
    table.insert(webr_pkgs, pandoc.utils.stringify(pkg))
  end
  table.insert(ojs_definitions.contents, {
    methodName = "interpretQuiet",
    cellName = "webr-prelude",
    inline = false,
    source = content,
  })

  -- List of webR R packages to install
  doc.blocks:insert(pandoc.RawBlock(
    "html",
    "<script type=\"webr-packages\">\n" .. json_as_b64(webr_pkgs) .. "\n</script>"
  ))

  -- OJS block definitions
  doc.blocks:insert(pandoc.RawBlock(
    "html",
    "<script type=\"ojs-module-contents\">\n" .. json_as_b64(ojs_definitions) .. "\n</script>"
  ))

  -- Exercise runtime dependencies
  quarto.doc.add_html_dependency({
    name = 'webr-ojs-runtime',
    scripts = {
      "resources/webr-ojs-runtime/dist/webr-ojs-runtime.js"
    },
    stylesheets = {
      "resources/webr-ojs-evaluate.css",
      "resources/webr-ojs-runtime/dist/codemirror-themes-html.css"
    }
  })

  return doc
end

return {
  Div = Div,
  Proof = Proof,
  CodeBlock = CodeBlock,
  Pandoc = Pandoc
}
