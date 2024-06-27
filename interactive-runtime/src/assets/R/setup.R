# Create environment to hold variables exported with ojs_define
.webr_ojs <- new.env()
ojs_define <- function(...) {
  args <- list(...)
  names(args) <- quote(match.call(expand.dots=TRUE)[1:length(args) + 1])
  .webr_ojs <<- list2env(args, envir = .webr_ojs)
}

# webR graphics device settings
options(webr.fig.width = 7, webr.fig.height = 5)
options(device = function(...) {
  args <- list(bg = "white", ...)
  args <- args[!duplicated(names(args))]
  do.call(webr::canvas, args)
})

# Custom pager for displaying e.g. help pages
options(pager = function(files, ...) {
  writeLines(gsub(".[\b]", "", readLines(files)))
})

# Additional package options
options(knitr.table.format = "html")
options(rgl.printRglwidget = TRUE)

# Default exercise grader
# TODO: handle error_check & code_check stages
options(webr.exercise.checker = function(
  label, user_code, solution_code, check_code, envir_result, evaluate_result,
  envir_prep, last_value, engine, stage, ...
) {
  # Setup environment
  .label <- label
  .user_code <- user_code
  .solution_code <- solution_code
  .check_code <- check_code
  .envir_result <- envir_result
  .evaluate_result <- evaluate_result
  .envir_prep <- envir_prep
  .last_value <- last_value
  .result <- last_value
  .user <- last_value
  .engine <- engine
  .stage <- stage

  if (is.null(.check_code)) {
    # No grading code, so just skip grading
    return(invisible(NULL))
  }

  tryCatch({
    # Parse provided check code
    parsed_check_code <- parse(text = check_code)

    # Evaluate provided check code
    eval(parsed_check_code)
  }, on_error = function(e) {
    list(
      message = "Error while checking `", label, "`: ", e,
      correct = FALSE,
      location = "append",
      type = "error"
    )
  })
})
