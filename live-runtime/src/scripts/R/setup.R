# Create environment to hold variables exported with ojs_define
.webr_ojs <- new.env()
ojs_define <- function(...) {
  args <- list(...)
  names(args) <- quote(match.call(expand.dots=TRUE)[1:length(args) + 1])
  .webr_ojs <<- list2env(args, envir = .webr_ojs)
}

# webR graphics device settings
options(webr.fig.width = 7, webr.fig.height = 5)
if (webr::eval_js('typeof OffscreenCanvas !== "undefined"')) {
  options(device = function(...) {
    args <- list(bg = "white", ...)
    args <- args[!duplicated(names(args))]
    do.call(webr::canvas, args)
  })
}

# Custom pager for displaying e.g. help pages
options(pager = function(files, ...) {
  writeLines(gsub(".[\b]", "", readLines(files)))
})

# Custom value handler and rendering for evaluate and knitr
options("webr.evaluate.handler" = evaluate::new_output_handler(
  value = function(x, visible) {
    knit_options = list(screenshot.force = FALSE)
    res <- if (visible) {
      withVisible(
        knitr::knit_print(
          if (inherits(x, "data.frame")) {
            switch(
              getOption("webr.render.df", "default"),
              "kable" = knitr::kable(x),
              "dt" = DT::datatable(x),
              "paged-table" = rmarkdown::paged_table(x),
              "gt" = gt::gt(x),
              "gt-interactive" = gt::opt_interactive(gt::gt(x)),
              "reactable" = reactable::reactable(x),
              x
            )
          } else x,
        options = knit_options)
      )
    } else list(value = x, visible = FALSE)
    res$class <- class(res$value)
    class(res) <- "result"
    res
  }
))

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
  }, error = function(e) {
    list(
      message = paste0("Error in checking code for `", label, "`: ", e$message),
      correct = FALSE,
      location = "append",
      type = "warning"
    )
  })
})
