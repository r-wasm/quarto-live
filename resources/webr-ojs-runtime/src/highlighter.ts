import { parser as r } from "lezer-r"
import { highlightCode, tagHighlighter, tags } from "@lezer/highlight"

const tagHighlighterR = tagHighlighter([
  { tag: tags.keyword, class: "tok-keyword" },
  { tag: tags.operator, class: "tok-operator" },
  { tag: tags.attributeName, class: "tok-attributeName"},
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

  highlightCode(code, r.parse(code), tagHighlighterR, emit, emitBreak);
  return result;
}
