local tinyyaml = require "resources/tinyyaml"

local webr_cell_options = { edit = true }
local ojs_definitions = {
  contents = {},
}
local block_id = 0

local function json_as_b64(obj)
  local json_string = quarto.json.encode(obj)
  return quarto.base64.encode(json_string)
end

local function tree(root)
  function isdir(path)
    -- Is there a better OS agnostic way to do this?
    local ok, err, code = os.rename(path .. "/", path .. "/")
    if not ok then
       if code == 13 then
          -- Permission denied, but it exists
          return true
       end
    end
    return ok, err
  end
  function gather(path, list)
    if (isdir(path)) then
      -- For each item in this dir, recurse for subdir content
      local items = pandoc.system.list_directory(path)
      for _, item in pairs(items) do
        gather(path .. "/" .. item, list)
      end
    else
      -- This is a file, add it to the table directly
      table.insert(list, path)
    end
    return list
  end
  return gather(root, {})
end

function WebRParseBlock(code)
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

  -- Include cell-options defaults
  for k, v in pairs(webr_cell_options) do
    attr[k] = v
  end

  -- Parse quarto-style yaml attributes
  local param_yaml = table.concat(param_lines, "\n")
  if (param_yaml ~= "") then
    param_attr = tinyyaml.parse(param_yaml)
    for k, v in pairs(param_attr) do
      attr[k] = v
    end
  end

  -- Parse traditional knitr-style attributes
  for k, v in pairs(code.attributes) do
    local function toboolean(v)
      return string.lower(v) == "true"
    end

    local convert = {
      autorun = toboolean,
      runbutton = toboolean,
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
      ["fig-width"] = tonumber,
      ["fig-height"] = tonumber,
    }

    if (convert[k]) then
      attr[k] = convert[k](v)
    else
      attr[k] = v
    end
  end

  return {
    code = r_code,
    attr = attr
  }
end

function WebRCodeBlock(code)
  block_id = block_id + 1

  function append_ojs_template(template, template_vars)
    local file = io.open(quarto.utils.resolve_path("templates/" .. template), "r")
    assert(file)
    local content = file:read("*a")
    for k, v in pairs(template_vars) do
      content = string.gsub(content, "{{" .. k .. "}}", v)
    end
  
    table.insert(ojs_definitions.contents, 1, {
      methodName = "interpret",
      cellName = "webr-" .. block_id,
      inline = false,
      source = content,
    })
  end

  function assertBlockExercise(type, block)
    if (not block.attr.exercise) then
      error("Can't create `webr` ".. type .." block, `exercise` not defined in cell options.")
    end
  end

  -- Parse codeblock contents for YAML header and R code body
  local block = WebRParseBlock(code)

  if (block.attr.output == "asis") then
    quarto.log.warning(
      "For `webr` code blocks, using `output: asis` renders R output as HTML.",
      "Markdown rendering is not currently supported."
    )
  end

  -- Supplementary execise blocks: setup, check, hint, solution
  if (block.attr.setup) then
    assertBlockExercise("setup", block)
    return pandoc.RawBlock(
        "html",
        "<script type=\"webr-setup-" .. block.attr.exercise .. "-contents\">\n" ..
        json_as_b64(block) .. "\n</script>"
      )
  end

  if (block.attr.check) then
    assertBlockExercise("check", block)
    return pandoc.RawBlock(
        "html",
        "<script type=\"webr-check-" .. block.attr.exercise .. "-contents\">\n" ..
        json_as_b64(block) .. "\n</script>"
      )
  end

  if (block.attr.hint) then
    assertBlockExercise("hint", block)
    return pandoc.Div(
      pandoc.CodeBlock(block.code, pandoc.Attr('', {'r', 'cell-code'})),
      pandoc.Attr('',
        { 'webr-ojs-exercise', 'exercise-hint', 'd-none' },
        { exercise = block.attr.exercise }
      )
    )
  end

  if (block.attr.solution) then
    assertBlockExercise("solution", block)
    local plaincode = pandoc.Code(block.code, pandoc.Attr('', {'solution-code', 'd-none'}))
    local codeblock = pandoc.CodeBlock(block.code, pandoc.Attr('', {'r', 'cell-code'}))
    return pandoc.Div(
      {
        InterpolatedRBlock(plaincode, false),
        InterpolatedRBlock(codeblock, true),
      },
      pandoc.Attr('',
        { 'webr-ojs-exercise', 'exercise-solution', 'd-none' },
        { exercise = block.attr.exercise }
      )
    )
  end


  -- Prepare OJS attributes
  local input = "{" .. table.concat(block.attr.input or {}, ", ") .. "}"
  local ojs_vars = {
    block_id = block_id,
    block_input = input,
  }

  -- Render appropriate OJS for the type of client-side block we're working with
  local ojs_source = nil
  if (block.attr.exercise) then
    -- Primary interactive exercise block
    ojs_source = "webr-exercise.ojs"
    ojs_vars["exercise_id"] = block.attr.exercise
  elseif (block.attr.edit) then
    -- Editable non-exercise sandbox block
    ojs_source = "webr-editor.ojs"
  else
    -- Non-interactive evaluation block
    ojs_source = "webr-evaluate.ojs"
  end

  append_ojs_template(ojs_source, ojs_vars)

  -- Render any HTMLWidgets after HTML output has been added to the DOM
  HTMLWidget(block_id)

  return pandoc.Div({
    pandoc.Div({}, pandoc.Attr("webr-" .. block_id)),
    pandoc.RawBlock(
      "html",
      "<script type=\"webr-" .. block_id .. "-contents\">\n" ..
      json_as_b64(block) .. "\n</script>"
    )
  })
end

function InterpolatedRBlock(block, highlight)
  block_id = block_id + 1

  -- Reactively render OJS variables in codeblocks
  file = io.open(quarto.utils.resolve_path("templates/webr-interpolate.ojs"), "r")
  assert(file)
  content = file:read("*a")

  -- Build map of OJS variable names to JS template literals
  local map = "{\n"
  for var in block.text:gmatch("${([a-zA-Z_$][%w_$]+)}") do
    map = map .. var .. ",\n"
  end
  map = map .. "}"

  -- We add this OJS block for its side effect of updating the HTML element
  content = string.gsub(content, "{{block_id}}", block_id)
  content = string.gsub(content, "{{def_map}}", map)
  content = string.gsub(content, "{{highlight}}", tostring(highlight))
  table.insert(ojs_definitions.contents, {
    methodName = "interpretQuiet",
    cellName = "webr-" .. block_id,
    inline = false,
    source = content,
  })

  block.identifier = "webr-interpolate-" .. block_id
  return block
end

function CodeBlock(code)
  if (code.classes:includes("{webr}") or code.classes:includes("webr")) then
    -- Client side R code block
    return WebRCodeBlock(code)
  end

  if (code.classes:includes("r") and string.match(code.text, "${[a-zA-Z_$][%w_$]+}")) then
    -- Non-interactive code block containing OJS variables
    return InterpolatedRBlock(code, true)
  end
end

function HTMLWidget(block_id)
  local file = io.open(quarto.utils.resolve_path("templates/webr-widget.ojs"), "r")
  assert(file)
  content = file:read("*a")

  table.insert(ojs_definitions.contents, 1, {
    methodName = "interpretQuiet",
    cellName = "webr-widget-" .. block_id,
    inline = false,
    source = string.gsub(content, "{{block_id}}", block_id),
  })
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
  local webr = doc.meta.webr or {}
  local packages = webr.packages or {}
  local repos = webr.repos or {}

  local file = io.open(quarto.utils.resolve_path("templates/webr-setup.ojs"), "r")
  assert(file)
  local content = file:read("*a")

  local webr_packages = {
    pkgs = {"evaluate", "knitr", "htmltools"},
    repos = {}
  }
  for _, pkg in pairs(packages) do
    table.insert(webr_packages.pkgs, pandoc.utils.stringify(pkg))
  end
  for _, repo in pairs(repos) do
    table.insert(webr_packages.repos, pandoc.utils.stringify(repo))
  end

  table.insert(ojs_definitions.contents, {
    methodName = "interpretQuiet",
    cellName = "webr-prelude",
    inline = false,
    source = content,
  })

  -- List of webR R packages and repositories to install
  doc.blocks:insert(pandoc.RawBlock(
    "html",
    "<script type=\"webr-packages\">\n" .. json_as_b64(webr_packages) .. "\n</script>"
  ))

  -- OJS block definitions
  doc.blocks:insert(pandoc.RawBlock(
    "html",
    "<script type=\"ojs-module-contents\">\n" .. json_as_b64(ojs_definitions) .. "\n</script>"
  ))

  -- Loading indicator
  doc.blocks:insert(
    pandoc.Div(
      pandoc.Div({
        pandoc.Div({}, pandoc.Attr("exercise-loading-status")),
        pandoc.Div({}, pandoc.Attr("", {"spinner-grow", "spinner-grow-sm"})),
      }, pandoc.Attr("", {"d-flex", "align-items-center", "gap-2"})),
      pandoc.Attr("exercise-loading-indicator", {"exercise-loading-indicator"})
    )
  )

  -- Exercise runtime dependencies
  quarto.doc.add_html_dependency({
    name = 'interactive-runtime',
    scripts = {
      "resources/interactive-runtime.js"
    },
    stylesheets = {
      "resources/highlighting.css",
      "resources/interactive-runtime.css"
    }
  })

  -- Copy resources for upload to VFS at runtime
  local vfs_files = {}
  if (webr.resources) then
    resource_list = webr.resources
  else
    resource_list = doc.meta.resources
  end

  if (type(resource_list) ~= "table") then
    resource_list = { resource_list }
  end

  if (resource_list) then
    for _, files in pairs(resource_list) do
      if (type(files) ~= "table") then
        files = { files }
      end
      for _, file in pairs(files) do
        local filetree = tree(pandoc.utils.stringify(file))
        for _, path in pairs(filetree) do
          table.insert(vfs_files, path)
        end
      end
    end
  end
  doc.blocks:insert(pandoc.RawBlock(
    "html",
    "<script type=\"webr-vfs-file\">\n" .. json_as_b64(vfs_files) .. "\n</script>"
  ))
  return doc
end

function Meta(meta)
  local webr = meta.webr or {}
  local cell_options = webr["cell-options"] or {}

  for k, v in pairs(cell_options) do
    if (type(v) == "table") then
      webr_cell_options[k] = pandoc.utils.stringify(v)
    else
      webr_cell_options[k] = v
    end
  end
end

return {
  { Meta = Meta },
  {
    Div = Div,
    Proof = Proof,
    CodeBlock = CodeBlock,
    Pandoc = Pandoc,
  },
}
