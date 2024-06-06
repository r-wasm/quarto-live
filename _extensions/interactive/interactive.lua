local tinyyaml = require "resources/tinyyaml"

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
  local attr = { edit = false, exercise = false }
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
    param_attr = tinyyaml.parse(param_yaml)
    for k, v in pairs(param_attr) do
      attr[k] = v
    end
  end

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

function WebRCodeHint(block)
  -- Build a simple code block from the R source
  local hint = pandoc.CodeBlock(block.code, pandoc.Attr('', {'r', 'cell-code'}))

  -- Wrap codeblock in a div and process as a markdown exercise hint/solution
  local container = nil
  if (block.attr.hint) then
    container = pandoc.Div(
      {
        pandoc.Strong({"Hint:"}),
        pandoc.Div({hint}, pandoc.Attr('', {'p-0'})),
      },
      pandoc.Attr('', {'hint'}, {exercise = block.attr.exercise})
    )
  else
    container = pandoc.Div(
      pandoc.Div({hint}, pandoc.Attr('', {'p-0'})),
      pandoc.Attr('', {'solution'}, {exercise = block.attr.exercise})
    )
  end

  return Div(container)
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

  -- Parse codeblock contents for YAML header and R code body
  local block = WebRParseBlock(code)

  if (block.attr.output == "asis") then
    quarto.log.warning(
      "Execution option `output: asis` is unsupported for `webr` code blocks."
    )
  end

  -- If this is a hint return a non-interactive block
  if (block.attr.exercise and (block.attr.hint or block.attr.solution)) then
    return WebRCodeHint(block)
  end

  -- If this is an exercise setup or check block, store code for runtime eval
  if (block.attr.exercise and block.attr.setup) then
    return pandoc.RawBlock(
        "html",
        "<script type=\"webr-setup-" .. block.attr.exercise .. "-contents\">\n" ..
        json_as_b64(block) .. "\n</script>"
      )
  elseif (block.attr.exercise and block.attr.check) then
    return pandoc.RawBlock(
        "html",
        "<script type=\"webr-check-" .. block.attr.exercise .. "-contents\">\n" ..
        json_as_b64(block) .. "\n</script>"
      )
  end

  -- Render appropriate OJS for the type of client-side block we're working with
  local ojs_source = "webr-evaluate.ojs"
  local input = "{" .. table.concat(block.attr.input or {}, ", ") .. "}"
  local ojs_vars = {
    block_id = block_id,
    block_input = input,
  }

  if (block.attr.exercise) then
    ojs_source = "webr-exercise.ojs"
    ojs_vars["exercise_id"] = block.attr.exercise
  elseif (block.attr.edit) then
    ojs_source = "webr-editor.ojs"
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

function InterpolatedRBlock(code)
  block_id = block_id + 1

  -- Reactively render OJS variables in codeblocks
  file = io.open(quarto.utils.resolve_path("templates/webr-interpolate.ojs"), "r")
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

return {
  Div = Div,
  Proof = Proof,
  CodeBlock = CodeBlock,
  Pandoc = Pandoc
}
