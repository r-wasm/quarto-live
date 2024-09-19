local tinyyaml = require "resources/tinyyaml"

local cell_options = {
  webr = { eval = true },
  pyodide = { eval = true },
}

local live_options = {
  ["show-solutions"] = true,
  ["show-hints"] = true,
  ["grading"] = true,
}

local ojs_definitions = {
  contents = {},
}
local block_id = 0

local include_webr = false
local include_pyodide = false

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

function ParseBlock(block, engine)
  local attr = {}
  local param_lines = {}
  local code_lines = {}
  for line in block.text:gmatch("([^\r\n]*)[\r\n]?") do
    local param_line = string.find(line, "^#|")
    if (param_line ~= nil) then
      table.insert(param_lines, string.sub(line, 4))
    else
      table.insert(code_lines, line)
    end
  end
  local code = table.concat(code_lines, "\n")

  -- Include cell-options defaults
  for k, v in pairs(cell_options[engine]) do
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
  for k, v in pairs(block.attributes) do
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

  -- When echo: false: disable the editor
  if (attr.echo == false) then
    attr.edit = false
  end

  -- When `include: false`: disable the editor, source block echo, and output
  if (attr.include == false) then
    attr.edit = false
    attr.echo = false
    attr.output = false
  end

  -- If we're not executing anything, there's no point showing an editor
  if (attr.edit == nil) then
    attr.edit = attr.eval
  end

  return {
    code = code,
    attr = attr
  }
end

local exercise_keys = {}
function assertUniqueExercise(key)
  if (exercise_keys[key]) then
    error("Document contains multiple exercises with key `" .. tostring(key) ..
      "`." .. "Exercise keys must be unique.")
  end
  exercise_keys[key] = true
end

function assertBlockExercise(type, engine, block)
  if (not block.attr.exercise) then
    error("Can't create `" .. engine .. "` " .. type ..
      " block, `exercise` not defined in cell options.")
  end
end

function ExerciseDataBlocks(btype, block)
  local ex = block.attr.exercise
  if (type(ex) ~= "table") then
    ex = { ex }
  end

  local blocks = {}
  for idx, ex_id in pairs(ex) do
    blocks[idx] = pandoc.RawBlock(
      "html",
      "<script type=\"exercise-" .. btype .. "-" .. ex_id .. "-contents\">\n" ..
      json_as_b64(block) .. "\n</script>"
    )
  end
  return blocks
end

function PyodideCodeBlock(code)
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
      cellName = "pyodide-" .. block_id,
      inline = false,
      source = content,
    })
  end

  -- Parse codeblock contents for YAML header and Python code body
  local block = ParseBlock(code, "pyodide")

  if (block.attr.output == "asis") then
    quarto.log.warning(
      "For `pyodide` code blocks, using `output: asis` renders Python output as HTML.",
      "Markdown rendering is not currently supported."
    )
  end

  -- Supplementary execise blocks: setup, check, hint, solution
  if (block.attr.setup) then
    assertBlockExercise("setup", "pyodide", block)
    return ExerciseDataBlocks("setup", block)
  end

  if (block.attr.check) then
    assertBlockExercise("check", "pyodide", block)
    if live_options["grading"] then
      return ExerciseDataBlocks("check", block)
    else
      return {}
    end
  end

  if (block.attr.hint) then
    assertBlockExercise("hint", "pyodide", block)
    if live_options["show-hints"] then
      return pandoc.Div(
        InterpolatedBlock(
          pandoc.CodeBlock(block.code, pandoc.Attr('', { 'python', 'cell-code' })),
          "python"
        ),
        pandoc.Attr('',
          { 'pyodide-ojs-exercise', 'exercise-hint', 'd-none' },
          { exercise = block.attr.exercise }
        )
      )
    end
    return {}
  end

  if (block.attr.solution) then
    assertBlockExercise("solution", "pyodide", block)
    if live_options["show-solutions"] then
      local plaincode = pandoc.Code(block.code, pandoc.Attr('', { 'solution-code', 'd-none' }))
      local codeblock = pandoc.CodeBlock(block.code, pandoc.Attr('', { 'python', 'cell-code' }))
      return pandoc.Div(
        {
          InterpolatedBlock(plaincode, "none"),
          InterpolatedBlock(codeblock, "python"),
        },
        pandoc.Attr('',
          { 'pyodide-ojs-exercise', 'exercise-solution', 'd-none' },
          { exercise = block.attr.exercise }
        )
      )
    end
    return {}
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
    assertUniqueExercise(block.attr.exercise)
    ojs_source = "pyodide-exercise.ojs"
  elseif (block.attr.edit) then
    -- Editable non-exercise sandbox block
    ojs_source = "pyodide-editor.ojs"
  else
    -- Non-interactive evaluation block
    ojs_source = "pyodide-evaluate.ojs"
  end

  append_ojs_template(ojs_source, ojs_vars)

  return pandoc.Div({
    pandoc.Div({}, pandoc.Attr("pyodide-" .. block_id, { 'exercise-cell' })),
    pandoc.RawBlock(
      "html",
      "<script type=\"pyodide-" .. block_id .. "-contents\">\n" ..
      json_as_b64(block) .. "\n</script>"
    )
  })
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
  local block = ParseBlock(code, "webr")

  if (block.attr.output == "asis") then
    quarto.log.warning(
      "For `webr` code blocks, using `output: asis` renders R output as HTML.",
      "Markdown rendering is not currently supported."
    )
  end

  -- Supplementary execise blocks: setup, check, hint, solution
  if (block.attr.setup) then
    assertBlockExercise("setup", "webr", block)
    return ExerciseDataBlocks("setup", block)
  end

  if (block.attr.check) then
    assertBlockExercise("check", "webr", block)
    if live_options["grading"] then
      return ExerciseDataBlocks("check", block)
    else
      return {}
    end
  end

  if (block.attr.hint) then
    assertBlockExercise("hint", "webr", block)
    if live_options["show-hints"] then
      return pandoc.Div(
        InterpolatedBlock(
          pandoc.CodeBlock(block.code, pandoc.Attr('', { 'r', 'cell-code' })),
          "r"
        ),
        pandoc.Attr('',
          { 'webr-ojs-exercise', 'exercise-hint', 'd-none' },
          { exercise = block.attr.exercise }
        )
      )
    end
    return {}
  end

  if (block.attr.solution) then
    assertBlockExercise("solution", "webr", block)
    if live_options["show-solutions"] then
      local plaincode = pandoc.Code(block.code, pandoc.Attr('', { 'solution-code', 'd-none' }))
      local codeblock = pandoc.CodeBlock(block.code, pandoc.Attr('', { 'r', 'cell-code' }))
      return pandoc.Div(
        {
          InterpolatedBlock(plaincode, "none"),
          InterpolatedBlock(codeblock, "r"),
        },
        pandoc.Attr('',
          { 'webr-ojs-exercise', 'exercise-solution', 'd-none' },
          { exercise = block.attr.exercise }
        )
      )
    end
    return {}
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
    assertUniqueExercise(block.attr.exercise)
    ojs_source = "webr-exercise.ojs"
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
    pandoc.Div({}, pandoc.Attr("webr-" .. block_id, { 'exercise-cell' })),
    pandoc.RawBlock(
      "html",
      "<script type=\"webr-" .. block_id .. "-contents\">\n" ..
      json_as_b64(block) .. "\n</script>"
    )
  })
end

function InterpolatedBlock(block, language)
  block_id = block_id + 1

  -- Reactively render OJS variables in codeblocks
  file = io.open(quarto.utils.resolve_path("templates/interpolate.ojs"), "r")
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
  content = string.gsub(content, "{{language}}", language)
  table.insert(ojs_definitions.contents, {
    methodName = "interpretQuiet",
    cellName = "interpolate-" .. block_id,
    inline = false,
    source = content,
  })

  block.identifier = "interpolate-" .. block_id
  return block
end

function CodeBlock(code)
  if (
        code.classes:includes("{webr}") or
        code.classes:includes("webr") or
        code.classes:includes("{webr-r}")
      ) then
    -- Client side R code block
    include_webr = true
    return WebRCodeBlock(code)
  end

  if (
        code.classes:includes("{pyodide}") or
        code.classes:includes("pyodide") or
        code.classes:includes("{pyodide-python}")
      ) then
    -- Client side Python code block
    include_pyodide = true
    return PyodideCodeBlock(code)
  end

  -- Non-interactive code block containing OJS variables
  if (string.match(code.text, "${[a-zA-Z_$][%w_$]+}")) then
    if (code.classes:includes("r")) then
      include_webr = true
      return InterpolatedBlock(code, "r")
    elseif (code.classes:includes("python")) then
      include_pyodide = true
      return InterpolatedBlock(code, "python")
    end
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
    if live_options["show-hints"] then
      block.classes:insert("webr-ojs-exercise")
      block.classes:insert("exercise-hint")
      block.classes:insert("d-none")
      return block
    else
      return {}
    end
  end
end

function Proof(block)
  -- Quarto wraps solution blocks in a Proof structure
  -- Dig into the expected shape and look for our own exercise solutions
  if (block["type"] == "Solution") then
    local content = block["__quarto_custom_node"]
    local container = content.c[1]
    if (container) then
      local solution = container.c[1]
      if (solution) then
        if (solution.attributes["exercise"] ~= nil) then
          if live_options["show-solutions"] then
            solution.classes:insert("webr-ojs-exercise")
            solution.classes:insert("exercise-solution")
            solution.classes:insert("d-none")
            return solution
          else
            return {}
          end
        end
      end
    end
  end
end

function setupPyodide(doc)
  local pyodide = doc.meta.pyodide or {}
  local packages = pyodide.packages or {}

  local file = io.open(quarto.utils.resolve_path("templates/pyodide-setup.ojs"), "r")
  assert(file)
  local content = file:read("*a")

  local pyodide_packages = {
    pkgs = { "pyodide_http", "micropip", "ipython" },
  }
  for _, pkg in pairs(packages) do
    table.insert(pyodide_packages.pkgs, pandoc.utils.stringify(pkg))
  end

  -- Initial Pyodide startup options
  local pyodide_options = {
    indexURL = "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/",
  }
  if (pyodide["engine-url"]) then
    pyodide_options["indexURL"] = pandoc.utils.stringify(pyodide["engine-url"])
  end

  local data = {
    packages = pyodide_packages,
    options = pyodide_options,
  }

  table.insert(ojs_definitions.contents, {
    methodName = "interpretQuiet",
    cellName = "pyodide-prelude",
    inline = false,
    source = content,
  })

  doc.blocks:insert(pandoc.RawBlock(
    "html",
    "<script type=\"pyodide-data\">\n" .. json_as_b64(data) .. "\n</script>"
  ))

  return pyodide
end

function setupWebR(doc)
  local webr = doc.meta.webr or {}
  local packages = webr.packages or {}
  local repos = webr.repos or {}

  local file = io.open(quarto.utils.resolve_path("templates/webr-setup.ojs"), "r")
  assert(file)
  local content = file:read("*a")

  -- List of webR R packages and repositories to install
  local webr_packages = {
    pkgs = { "evaluate", "knitr", "htmltools" },
    repos = {}
  }
  for _, pkg in pairs(packages) do
    table.insert(webr_packages.pkgs, pandoc.utils.stringify(pkg))
  end
  for _, repo in pairs(repos) do
    table.insert(webr_packages.repos, pandoc.utils.stringify(repo))
  end

  -- Data frame rendering
  local webr_render_df = "default"
  if (webr["render-df"]) then
    webr_render_df = pandoc.utils.stringify(webr["render-df"])
    local pkg = {
      ["paged-table"] = "rmarkdown",
      ["gt"] = "gt",
      ["gt-interactive"] = "gt",
      ["dt"] = "DT",
      ["reactable"] = "reactable",
    }
    if (pkg[webr_render_df]) then
      table.insert(webr_packages.pkgs, pkg[webr_render_df])
    end
  end

  -- Initial webR startup options
  local webr_options = {
    baseUrl = "https://webr.r-wasm.org/v0.4.1/"
  }
  if (webr["engine-url"]) then
    webr_options["baseUrl"] = pandoc.utils.stringify(webr["engine-url"])
  end

  local data = {
    packages = webr_packages,
    options = webr_options,
    render_df = webr_render_df,
  }

  table.insert(ojs_definitions.contents, {
    methodName = "interpretQuiet",
    cellName = "webr-prelude",
    inline = false,
    source = content,
  })

  doc.blocks:insert(pandoc.RawBlock(
    "html",
    "<script type=\"webr-data\">\n" .. json_as_b64(data) .. "\n</script>"
  ))

  return webr
end

function Pandoc(doc)
  local webr = nil
  local pyodide = nil
  if (include_webr) then
    webr = setupWebR(doc)
  end
  if (include_pyodide) then
    pyodide = setupPyodide(doc)
  end

  -- OJS block definitions
  doc.blocks:insert(pandoc.RawBlock(
    "html",
    "<script type=\"ojs-module-contents\">\n" .. json_as_b64(ojs_definitions) .. "\n</script>"
  ))

  -- Loading indicator
  doc.blocks:insert(
    pandoc.Div({
      pandoc.Div({}, pandoc.Attr("exercise-loading-status", { "d-flex", "gap-2" })),
      pandoc.Div({}, pandoc.Attr("", { "spinner-grow", "spinner-grow-sm" })),
    }, pandoc.Attr(
      "exercise-loading-indicator",
      { "exercise-loading-indicator", "d-none", "d-flex", "align-items-center", "gap-2" }
    ))
  )

  -- Exercise runtime dependencies
  quarto.doc.add_html_dependency({
    name = 'live-runtime',
    scripts = {
      { path = "resources/live-runtime.js", attribs = { type = "module" } },
    },
    resources = { "resources/pyodide-worker.js" },
    stylesheets = { "resources/live-runtime.css" },
  })

  -- Copy resources for upload to VFS at runtime
  local vfs_files = {}
  if (webr and webr.resources) then
    resource_list = webr.resources
  elseif (pyodide and pyodide.resources) then
    resource_list = pyodide.resources
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
    "<script type=\"vfs-file\">\n" .. json_as_b64(vfs_files) .. "\n</script>"
  ))
  return doc
end

function Meta(meta)
  local webr = meta.webr or {}

  for k, v in pairs(webr["cell-options"] or {}) do
    if (type(v) == "table") then
      cell_options.webr[k] = pandoc.utils.stringify(v)
    else
      cell_options.webr[k] = v
    end
  end

  local pyodide = meta.pyodide or {}

  for k, v in pairs(pyodide["cell-options"] or {}) do
    if (type(v) == "table") then
      cell_options.pyodide[k] = pandoc.utils.stringify(v)
    else
      cell_options.pyodide[k] = v
    end
  end

  local live = meta.live or {}
  if (type(live) == "table") then
    for k, v in pairs(live) do
      live_options[k] = v
    end
  else
    quarto.log.error("Invalid value for document yaml key: `live`.")
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
