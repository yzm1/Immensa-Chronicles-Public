import { startExplorer, element } from "./explorer-core.js";

function renderCleanExtras({ target, selection }) {
  if (selection.type === "node" && selection.node.identity_status.startsWith("SOURCE_SCOPED")) {
    target.append(
      element("div", { class: "status-card warning" }, [
        element("strong", { text: "Source-scoped identity" }),
        element("div", { text: "This identity remains distinct in the governed graph. Similar wording elsewhere is not silently merged." }),
      ]),
    );
  }
}

startExplorer({ mode: "clean", renderModeExtras: renderCleanExtras }).catch((error) => {
  console.error(error);
  document.body.dataset.ready = "error";
  const target = document.getElementById("details-content");
  target.replaceChildren(
    element("h2", { text: "Explorer failed to load" }),
    element("p", { text: error.message }),
  );
});
