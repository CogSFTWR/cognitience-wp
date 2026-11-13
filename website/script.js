(function () {
  var iso = window.SILICAOS_ISO;
  if (!iso) return;

  var filename = document.getElementById("iso-filename");
  var size = document.getElementById("iso-size");
  var label = document.getElementById("iso-label");
  var sha = document.getElementById("iso-sha");
  var status = document.getElementById("iso-status");
  var download = document.getElementById("iso-download");
  var copy = document.getElementById("copy-sha");

  if (filename) filename.textContent = iso.filename;
  if (size) {
    var bytes = iso.sizeBytes
      ? " · " + Number(iso.sizeBytes).toLocaleString("en-US") + " bytes"
      : "";
    size.textContent = iso.sizeLabel + bytes;
  }
  if (label) label.textContent = iso.label;
  if (sha) sha.textContent = iso.sha256;

  var url = (iso.url || "").trim();
  if (url) {
    download.href = url;
    download.setAttribute("download", iso.filename);
    download.removeAttribute("aria-disabled");
    download.textContent = "Download ISO";
    status.hidden = true;
    status.textContent = "";
  } else {
    download.href = "#";
    download.setAttribute("aria-disabled", "true");
    download.textContent = "ISO not published yet";
    status.hidden = false;
    status.textContent =
      "The public download URL is not set yet. Set SILICAOS_ISO.url in config.js.";
  }

  if (copy) {
    copy.addEventListener("click", function () {
      var text = iso.sha256;
      var done = function () {
        copy.textContent = "Copied";
        setTimeout(function () {
          copy.textContent = "Copy";
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          window.prompt("SHA-256", text);
        });
      } else {
        window.prompt("SHA-256", text);
      }
    });
  }
})();
