// Minimal progressive enhancement. The app works without JS; this only adds
// conveniences (client-side file → textarea for imports, confirm prompts).
(function () {
  "use strict";

  // Import page: read a chosen CSV/JSON file into the paste textarea so users
  // can "upload" without any multipart handling on the server.
  var fileInput = document.querySelector("[data-file-into]");
  if (fileInput) {
    fileInput.addEventListener("change", function () {
      var target = document.querySelector(fileInput.getAttribute("data-file-into"));
      var file = fileInput.files && fileInput.files[0];
      if (!file || !target) return;
      var reader = new FileReader();
      reader.onload = function () {
        target.value = String(reader.result || "");
        // Guess the format from the extension.
        var fmt = /\.json$/i.test(file.name) ? "json" : "csv";
        var sel = document.querySelector('[name="format"]');
        if (sel) sel.value = fmt;
      };
      reader.readAsText(file);
    });
  }

  // Confirm destructive/finalizing actions.
  document.querySelectorAll("[data-confirm]").forEach(function (el) {
    el.addEventListener("submit", function (e) {
      if (!window.confirm(el.getAttribute("data-confirm"))) e.preventDefault();
    });
  });
})();
