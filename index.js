(() => {
  "use strict";

  /* ---------------------------------------------
     State
  --------------------------------------------- */
  let queue = [];           // { file, path, size }
  const seenKeys = new Set(); // path+size+lastModified, avoid dup adds

  const dropzone   = document.getElementById("dropzone");
  const fileInput  = document.getElementById("fileInput");
  const folderInput= document.getElementById("folderInput");
  const pickFilesBtn  = document.getElementById("pickFiles");
  const pickFolderBtn = document.getElementById("pickFolder");

  const manifest     = document.getElementById("manifest");
  const manifestList = document.getElementById("manifestList");
  const fileCountEl  = document.getElementById("fileCount");
  const totalSizeEl  = document.getElementById("totalSize");
  const zipNameInput = document.getElementById("zipName");
  const clearAllBtn  = document.getElementById("clearAll");
  const packBtn      = document.getElementById("packBtn");

  const progressWrap = document.getElementById("progressWrap");
  const progressFill = document.getElementById("progressFill");
  const progressPct  = document.getElementById("progressPct");

  const stampToast  = document.getElementById("stampToast");
  const stampDetail = document.getElementById("stampDetail");

  const statFilesEl = document.getElementById("statFiles");
  const statZipsEl  = document.getElementById("statZips");

  /* ---------------------------------------------
     Daily local counters (no server — this device only)
  --------------------------------------------- */
  const STORAGE_KEY = "zipyard_stats_v1";

  function todayKey(){
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  }

  function loadStats(){
    let raw;
    try{ raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); }catch(e){ raw = null; }
    if(!raw || raw.day !== todayKey()){
      raw = { day: todayKey(), files: 0, zips: 0 };
    }
    return raw;
  }

  let stats = loadStats();

  function saveStats(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  }

  function setOdometer(el, value){
    const digits = String(value).padStart(el.children.length, "0").slice(-el.children.length);
    [...el.children].forEach((digitEl, i) => {
      if(digitEl.textContent !== digits[i]){
        digitEl.textContent = digits[i];
        digitEl.classList.remove("roll");
        void digitEl.offsetWidth; // restart animation
        digitEl.classList.add("roll");
      }
    });
  }

  function renderStats(){
    setOdometer(statFilesEl, stats.files);
    setOdometer(statZipsEl, stats.zips);
  }
  renderStats();

  function bumpFiles(n){
    stats = loadStats();
    stats.files += n;
    saveStats();
    renderStats();
  }
  function bumpZips(){
    stats = loadStats();
    stats.zips += 1;
    saveStats();
    renderStats();
  }

  /* ---------------------------------------------
     Helpers
  --------------------------------------------- */
  function formatBytes(bytes){
    if(bytes === 0) return "0 KB";
    const units = ["B","KB","MB","GB"];
    const i = Math.min(Math.floor(Math.log(bytes)/Math.log(1024)), units.length-1);
    const val = bytes / Math.pow(1024, i);
    return `${i === 0 ? val : val.toFixed(1)} ${units[i]}`;
  }

  function pathFor(file){
    return file.webkitRelativePath && file.webkitRelativePath.length
      ? file.webkitRelativePath
      : file.name;
  }

  function keyFor(file){
    return `${pathFor(file)}::${file.size}::${file.lastModified}`;
  }

  function addFiles(fileList){
    let added = 0;
    for(const file of fileList){
      const k = keyFor(file);
      if(seenKeys.has(k)) continue;
      seenKeys.add(k);
      queue.push({ file, path: pathFor(file), size: file.size });
      added++;
    }
    if(added > 0) bumpFiles(added);
    renderManifest();
  }

  function removeAt(index){
    const item = queue[index];
    if(item) seenKeys.delete(keyFor(item.file));
    queue.splice(index, 1);
    renderManifest();
  }

  function clearQueue(){
    queue = [];
    seenKeys.clear();
    renderManifest();
  }

  /* ---------------------------------------------
     Rendering the packing list
  --------------------------------------------- */
  function renderManifest(){
    if(queue.length === 0){
      manifest.hidden = true;
      return;
    }
    manifest.hidden = false;

    manifestList.innerHTML = "";
    const frag = document.createDocumentFragment();
    let totalSize = 0;

    queue.forEach((item, idx) => {
      totalSize += item.size;
      const li = document.createElement("li");

      const pathSpan = document.createElement("span");
      pathSpan.className = "m-path";
      pathSpan.textContent = item.path;
      pathSpan.title = item.path;

      const sizeSpan = document.createElement("span");
      sizeSpan.className = "m-size";
      sizeSpan.textContent = formatBytes(item.size);

      const removeBtn = document.createElement("button");
      removeBtn.className = "m-remove";
      removeBtn.setAttribute("aria-label", `Remove ${item.path}`);
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => removeAt(idx));

      li.append(pathSpan, sizeSpan, removeBtn);
      frag.appendChild(li);
    });

    manifestList.appendChild(frag);
    fileCountEl.textContent = `${queue.length} file${queue.length === 1 ? "" : "s"}`;
    totalSizeEl.textContent = formatBytes(totalSize);
    packBtn.disabled = false;
  }

  /* ---------------------------------------------
     Drag & drop + folder traversal
  --------------------------------------------- */
  function traverseEntry(entry, pathPrefix = ""){
    return new Promise((resolve) => {
      if(entry.isFile){
        entry.file((file) => {
          // attach a synthetic relative path for nested drops
          Object.defineProperty(file, "webkitRelativePath", {
            value: pathPrefix + file.name,
            configurable: true
          });
          resolve([file]);
        }, () => resolve([]));
      } else if(entry.isDirectory){
        const reader = entry.createReader();
        const allEntries = [];
        const readBatch = () => {
          reader.readEntries(async (entries) => {
            if(!entries.length){
              const nested = await Promise.all(
                allEntries.map(e => traverseEntry(e, pathPrefix + entry.name + "/"))
              );
              resolve(nested.flat());
            } else {
              allEntries.push(...entries);
              readBatch();
            }
          }, () => resolve([]));
        };
        readBatch();
      } else {
        resolve([]);
      }
    });
  }

  async function handleDataTransfer(dataTransfer){
    const items = dataTransfer.items;
    if(items && items.length && items[0].webkitGetAsEntry){
      const entries = [...items].map(i => i.webkitGetAsEntry()).filter(Boolean);
      const results = await Promise.all(entries.map(e => traverseEntry(e)));
      addFiles(results.flat());
    } else {
      addFiles(dataTransfer.files);
    }
  }

  ["dragenter","dragover"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragging");
    });
  });
  ["dragleave","drop"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragging");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    handleDataTransfer(e.dataTransfer);
  });

  dropzone.addEventListener("click", (e) => {
    if(e.target === pickFilesBtn || e.target === pickFolderBtn) return;
    fileInput.click();
  });
  dropzone.addEventListener("keydown", (e) => {
    if(e.key === "Enter" || e.key === " "){
      e.preventDefault();
      fileInput.click();
    }
  });

  pickFilesBtn.addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
  pickFolderBtn.addEventListener("click", (e) => { e.stopPropagation(); folderInput.click(); });

  fileInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });
  folderInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });

  clearAllBtn.addEventListener("click", clearQueue);

  /* ---------------------------------------------
     Packing into a .zip
  --------------------------------------------- */
  packBtn.addEventListener("click", async () => {
    if(queue.length === 0 || typeof JSZip === "undefined") return;

    packBtn.disabled = true;
    progressWrap.hidden = false;
    progressFill.style.width = "0%";
    progressPct.textContent = "0%";

    const zip = new JSZip();
    queue.forEach(item => {
      zip.file(item.path, item.file);
    });

    try{
      const blob = await zip.generateAsync(
        { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
        (metadata) => {
          const pct = Math.round(metadata.percent);
          progressFill.style.width = `${pct}%`;
          progressPct.textContent = `${pct}%`;
        }
      );

      const rawName = (zipNameInput.value || "zipyard-archive").trim().replace(/\.zip$/i, "");
      const finalName = `${rawName || "zipyard-archive"}.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      bumpZips();
      showStamp(queue.length, blob.size, finalName);
    } catch(err){
      console.error("Zipyard: failed to build archive", err);
      alert("Something went wrong while building the archive. Please try again.");
    } finally{
      packBtn.disabled = false;
      setTimeout(() => { progressWrap.hidden = true; }, 900);
    }
  });

  function showStamp(count, size, name){
    stampDetail.textContent = `${count} file${count === 1 ? "" : "s"} · ${formatBytes(size)} → ${name}`;
    stampToast.hidden = false;
    stampToast.style.animation = "none";
    void stampToast.offsetWidth;
    stampToast.style.animation = "";
    clearTimeout(showStamp._t);
    showStamp._t = setTimeout(() => { stampToast.hidden = true; }, 5000);
  }

})();
