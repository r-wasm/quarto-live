import { parser as r } from "lezer-r"
import { parser as python } from "@lezer/python"
import { highlightCode, tagHighlighter, tags } from "@lezer/highlight"

export const tagHighlighterTok = tagHighlighter([
  { tag: tags.keyword, class: "tok-keyword" },
  { tag: tags.operator, class: "tok-operator" },
  { tag: tags.definitionOperator, class: "tok-definitionOperator" },
  { tag: tags.compareOperator, class: "tok-compareOperator" },
  { tag: tags.attributeName, class: "tok-attributeName" },
  { tag: tags.controlKeyword, class: "tok-controlKeyword" },
  { tag: tags.comment, class: "tok-comment" },
  { tag: tags.string, class: "tok-string" },
  { tag: tags.regexp, class: "tok-string2" },
  { tag: tags.variableName, class: "tok-variableName" },
  { tag: tags.bool, class: "tok-bool" },
  { tag: tags.separator, class: "tok-separator" },
  { tag: tags.literal, class: "tok-literal" },
  { tag: [tags.number, tags.integer], class: "tok-number" },
  { tag: tags.function(tags.variableName), class: "tok-function-variableName" },
  { tag: tags.function(tags.attributeName), class: "tok-function-attributeName" },
]);

export function highlightR(code: string) {
  let result = document.createElement("code");
  result.className = "sourceCode r";

  function emit(text: string, classes: string) {
    let node: HTMLElement | Text = document.createTextNode(text);
    if (classes) {
      let span = document.createElement("span");
      span.appendChild(node);
      span.className = classes;
      node = span;
    }
    result.appendChild(node);
  }

  function emitBreak() {
    result.appendChild(document.createTextNode("\n"));
  }

  highlightCode(code, r.parse(code), tagHighlighterTok, emit, emitBreak);
  return result;
}

export function highlightPython(code: string) {
  let result = document.createElement("code");
  result.className = "sourceCode python";

  function emit(text: string, classes: string) {
    let node: HTMLElement | Text = document.createTextNode(text);
    if (classes) {
      let span = document.createElement("span");
      span.appendChild(node);
      span.className = classes;
      node = span;
    }
    result.appendChild(node);
  }

  function emitBreak() {
    result.appendChild(document.createTextNode("\n"));
  }

  highlightCode(code, python.parse(code), tagHighlighterTok, emit, emitBreak);
  return result;
}

// Traverse a HTMLElement tree and replace text with highlighted replacement
export function interpolate(
  el: Element,
  search: string,
  replace: string | number,
  language: "none" | "r" | "python",
) {
  if (typeof replace === "number") replace = replace.toLocaleString();
  if (el.textContent.includes(search)) {
    let found = false;
    for (let child of el.children) {
      found ||= interpolate(child, search, replace, language);
    }
    // If `search` not found in children, replace this entire node.
    // `search` could span several syntax spans, so we re-highlight replacement
    if (!found) {
      el.textContent = el.textContent.replaceAll(search, () => replace);
      switch (language) {
        case "none":
          break;
        case "r":
          el.innerHTML = highlightR(el.textContent).innerHTML;
          break;
        case "python":
          el.innerHTML = highlightPython(el.textContent).innerHTML;
          break;
        default:
          throw new Error(
            `Can't highlight interpolation, unknown language \`${language}\`.`
          );
      }
    }
    return true;
  }
  return false;
}
