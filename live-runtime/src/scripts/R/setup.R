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

# Custom value handler and rendering for evaluate and knitr
options("webr.evaluate.handler" = evaluate::new_output_handler(
  value = function(x, visible) {
    knit_options = list(screenshot.force = FALSE)
    knit_print.df <- function (x) {
      method <- getOption("webr.render.df")
      if (method == "kable") {
        knitr::knit_print(knitr::kable(x))
      } else if (method == "paged-table") {
        knitr::knit_print(rmarkdown::paged_table(x))
      } else if (method == "gt") {
        knitr::knit_print(gt::gt(x))
      } else if (method == "gt-interactive") {
        knitr::knit_print(x |> gt::gt() |> gt::opt_interactive())
      } else if (method == "reactable") {
        knitr::knit_print(reactable::reactable(x), options = knit_options)
      } else {
        knitr::knit_print(x, options = knit_options)
      }
    }

    res <- if (visible) {
      withVisible(if ("data.frame" %in% class(x)) {
        knit_print.df(x)
      } else {
        knitr::knit_print(x, options = knit_options)
      })
    } else list(value = x, visible = FALSE)
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
