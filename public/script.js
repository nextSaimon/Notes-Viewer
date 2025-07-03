let allFiles = []; // Stores references to file objects for quick lookup
let currentFolderFiles = []; // Paths of files in the currently visible folder
let currentIndex = -1; // Index in currentFolderFiles for navigation
let activeFileElement = null; // DOM element of the currently highlighted file
let currentObjectURL = null; // To manage URL.createObjectURL cleanup
let isMediaPlaying = false; // Flag to track if a media file is playing

// Utility to join path parts (for browser environment)
const browserPathJoin = (...parts) => parts.filter((p) => p).join("/");

// Supported extensions for preview (added common video formats)
const supportedExtensions =
  /\.(jpe?g|png|webp|pdf|txt|md|log|html|css|js|mp4|webm|ogg|mkv|avi|mov|flv|wmv|3gp|ts)$/i; // Added more video formats

// Function to build the tree structure from FileList
function buildTreeFromFiles(fileList) {
  const structure = [];
  const pathMap = new Map(); // Helps in quickly finding existing folders

  // Debug: Log the FileList to verify files are being received
  console.log(
    "FileList received:",
    Array.from(fileList).map((f) => f.webkitRelativePath)
  );

  for (const file of fileList) {
    const parts = file.webkitRelativePath.split("/");
    let currentLevel = structure;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      currentPath = browserPathJoin(currentPath, name); // Build cumulative path

      let existingEntry = pathMap.get(currentPath);

      if (!existingEntry) {
        if (isFile) {
          existingEntry = {
            type: "file",
            name: name,
            path: currentPath,
            fileObject: file,
            isSupported: supportedExtensions.test(name), // Mark if file is supported
          };
        } else {
          // If it's a folder part, create a folder entry
          existingEntry = { type: "folder", name: name, children: [] };
        }
        currentLevel.push(existingEntry);
        pathMap.set(currentPath, existingEntry);
      }

      if (!isFile) {
        // Move to the children array of the current folder
        currentLevel = existingEntry.children;
      }
    }
  }

  // Function to sort folders first, then alphabetically for both
  function sortStructure(arr) {
    arr.sort((a, b) => {
      if (a.type === "folder" && b.type === "file") return -1;
      if (a.type === "file" && b.type === "folder") return 1;
      return a.name.localeCompare(b.name, "en", { numeric: true });
    });
    arr.forEach((item) => {
      if (item.type === "folder") {
        sortStructure(item.children);
      }
    });
  }

  sortStructure(structure);

  // Debug: Log the resulting structure
  console.log("Tree structure:", structure);

  return structure;
}

// Function to create and render the HTML tree
function createTree(structure, container) {
  structure.forEach((item) => {
    const el = document.createElement("div");
    el.className = "tree-node-wrapper";

    if (item.type === "folder") {
      const folderHeader = document.createElement("div");
      folderHeader.className =
        "tree-node-content cursor-pointer text-blue-600 hover:text-blue-800 font-semibold break-words whitespace-normal w-full py-1";

      const folderIcon = document.createElement("span");
      folderIcon.className = "mr-2";
      folderIcon.textContent = "📁"; // Closed folder emoji

      const folderName = document.createElement("span");
      folderName.textContent = item.name;

      folderHeader.appendChild(folderIcon);
      folderHeader.appendChild(folderName);

      const children = document.createElement("div");
      children.className = "tree-children-container hidden";

      folderHeader.onclick = () => {
        children.classList.toggle("hidden");
        if (children.classList.contains("hidden")) {
          folderIcon.textContent = "📁";
        } else {
          folderIcon.textContent = "📂";
          currentFolderFiles = []; // Reset and populate when folder opens
          getAllSupportedFiles(item.children, currentFolderFiles);
        }
      };

      el.appendChild(folderHeader);
      createTree(item.children, children); // Recursively create children
      el.appendChild(children);
    } else if (item.type === "file") {
      const file = document.createElement("div");
      file.className = item.isSupported
        ? "tree-node-content cursor-pointer text-gray-700 hover:text-blue-600 break-words whitespace-normal w-full py-1 pr-2 rounded-md"
        : "tree-node-content text-gray-400 break-words whitespace-normal w-full py-1 pr-2 rounded-md"; // Dim unsupported files

      const fileIcon = document.createElement("span");
      fileIcon.className = "mr-2";
      fileIcon.textContent = "📄"; // Generic file icon

      const fileName = document.createElement("span");
      fileName.textContent = item.name;

      file.appendChild(fileIcon);
      file.appendChild(fileName);

      if (item.isSupported) {
        file.onclick = () => {
          currentFolderFiles = getSiblingFiles(el.parentElement);
          displayFile(item.path, file); // Pass the path and the DOM element
        };
      } else {
        file.title = "File type not supported for preview";
      }

      el.appendChild(file);
      // Store the file object reference for supported files
      if (item.isSupported) {
        allFiles.push({
          path: item.path,
          element: file,
          fileObject: item.fileObject,
        });
      }
    }

    container.appendChild(el);
  });
}

// Helper to get all supported file paths within a given branch of the structure
function getAllSupportedFiles(items, out) {
  items.forEach((item) => {
    if (item.type === "file" && item.isSupported) {
      out.push(item.path);
    } else if (item.type === "folder") {
      getAllSupportedFiles(item.children, out);
    }
  });
}

// Helper to get all supported file paths of siblings in the same folder
function getSiblingFiles(container) {
  const files = [];
  // Select only direct children that are 'tree-node-wrapper' and contain 'tree-node-content'
  container
    .querySelectorAll(":scope > .tree-node-wrapper > .tree-node-content")
    .forEach((div) => {
      const iconSpan = div.querySelector("span:first-child");
      // Ensure it's a file,System: file by checking its icon and if it's in allFiles
      if (iconSpan && iconSpan.textContent === "📄") {
        const match = allFiles.find((f) => f.element === div);
        if (match) files.push(match.path);
      }
    });
  return files;
}

// Main function to display file content in the preview panel
async function displayFile(path, fileElement = null) {
  currentIndex = currentFolderFiles.indexOf(path);
  const preview = document.getElementById("preview-content");
  const ext = path.split(".").pop().toLowerCase();

  // Find the fileObject from our allFiles array
  const fileItem = allFiles.find((f) => f.path === path);

  if (!fileItem || !fileItem.fileObject) {
    preview.innerHTML = `<div class="text-gray-500 text-center">File not found or not supported for preview.</div>`;
    return;
  }

  // Clear previous object URL if any, to free memory
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }
  // Reset media playing flag
  isMediaPlaying = false;

  // Highlight the active file (do this first to ensure it's not skipped in async flow)
  if (activeFileElement) {
    activeFileElement.classList.remove("bg-blue-100", "text-blue-700");
  }
  if (fileElement) {
    fileElement.classList.add("bg-blue-100", "text-blue-700");
    activeFileElement = fileElement;
  } else {
    // Fallback for keyboard navigation or other cases
    const found = allFiles.find((f) => f.path === path);
    if (found?.element) {
      found.element.classList.add("bg-blue-100", "text-blue-700");
      activeFileElement = found.element;
    }
  }

  let content = "";
  const fileObj = fileItem.fileObject;

  if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
    currentObjectURL = URL.createObjectURL(fileObj);
    content = `<img src="${currentObjectURL}" class="max-w-full max-h-full object-contain rounded" />`;
  } else if (ext === "pdf") {
    currentObjectURL = URL.createObjectURL(fileObj);
    content = `<iframe src="${currentObjectURL}" class="w-full h-full" type="application/pdf"></iframe>`;
  } else if (
    [
      "mp4",
      "webm",
      "ogg",
      "mkv",
      "avi",
      "mov",
      "flv",
      "wmv",
      "3gp",
      "ts",
    ].includes(ext)
  ) {
    currentObjectURL = URL.createObjectURL(fileObj);
    content = `<video controls src="${currentObjectURL}" class="max-w-full max-h-full rounded"></video>`;
    // Add event listeners to set/unset isMediaPlaying flag
    preview.innerHTML = content; // Render video element immediately to attach listeners
    const videoElement = preview.querySelector("video");
    if (videoElement) {
      videoElement.onplay = () => (isMediaPlaying = true);
      videoElement.onpause = () => (isMediaPlaying = false);
      videoElement.onended = () => (isMediaPlaying = false);
    }
    return; // Return here as content is set and listeners attached
  } else if (["mp3", "wav", "ogg"].includes(ext)) {
    currentObjectURL = URL.createObjectURL(fileObj);
    content = `<audio controls src="${currentObjectURL}" class="w-full"></audio>`;
    // Add event listeners to set/unset isMediaPlaying flag
    preview.innerHTML = content; // Render audio element immediately to attach listeners
    const audioElement = preview.querySelector("audio");
    if (audioElement) {
      audioElement.onplay = () => (isMediaPlaying = true);
      audioElement.onpause = () => (isMediaPlaying = false);
      audioElement.onended = () => (isMediaPlaying = false);
    }
    return; // Return here as content is set and listeners attached
  } else if (["txt", "md", "log", "css", "js"].includes(ext)) {
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `<pre class="whitespace-pre-wrap text-sm overflow-y-auto w-full h-full p-4">${e.target.result}</pre>`;
    };
    reader.onerror = (e) => {
      console.error("Error reading file:", e);
      preview.innerHTML = `<div class="text-gray-500 text-center">Error reading file content.</div>`;
    };
    reader.readAsText(fileObj);
    return; // Return here as content is set asynchronously
  } else if (ext === "html") {
    const reader = new FileReader();
    reader.onload = async (e) => {
      let htmlContent = e.target.result;

      // Create a temporary DOM element to parse the HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, "text/html");

      // Handle <img> tags
      const imgTags = doc.querySelectorAll("img");
      for (const img of imgTags) {
        const src = img.getAttribute("src");
        if (src) {
          // Resolve the image path relative to the HTML file's path
          const htmlDir = path.substring(0, path.lastIndexOf("/"));
          const imgPath = browserPathJoin(htmlDir, src.replace(/^\.\//, ""));

          // Find the image file in allFiles
          const imgFileItem = allFiles.find((f) => f.path === imgPath);
          if (imgFileItem && imgFileItem.fileObject) {
            try {
              // Convert the image to a data URI
              const imgDataUri = await fileToDataUri(imgFileItem.fileObject);
              // Replace the src with the data URI
              img.setAttribute("src", imgDataUri);
            } catch (error) {
              console.error(
                `Error converting image ${imgPath} to data URI:`,
                error
              );
            }
          }
        }
      }

      // Handle <iframe> tags
      const iframeTags = doc.querySelectorAll("iframe");
      for (const iframe of iframeTags) {
        const src = iframe.getAttribute("src");
        if (src) {
          // Resolve the iframe source path relative to the HTML file's path
          const htmlDir = path.substring(0, path.lastIndexOf("/"));
          const iframePath = browserPathJoin(htmlDir, src.replace(/^\.\//, ""));

          // Find the iframe source file in allFiles
          const iframeFileItem = allFiles.find((f) => f.path === iframePath);
          if (iframeFileItem && iframeFileItem.fileObject) {
            try {
              // Read the iframe's HTML content
              const iframeContent = await fileToText(iframeFileItem.fileObject);
              // Convert to data URI
              const iframeDataUri = `data:text/html;charset=utf-8,${encodeURIComponent(
                iframeContent
              )}`;
              // Replace the src with the data URI
              iframe.setAttribute("src", iframeDataUri);
            } catch (error) {
              console.error(
                `Error converting iframe source ${iframePath} to data URI:`,
                error
              );
            }
          }
        }
      }

      // Serialize the modified HTML
      htmlContent = doc.documentElement.outerHTML;

      // Create a data URI for the HTML content
      const dataUri = `data:text/html;charset=utf-8,${encodeURIComponent(
        htmlContent
      )}`;
      preview.innerHTML = `<iframe src="${dataUri}" class="w-full h-full border-0"></iframe>`;
    };
    reader.onerror = (e) => {
      console.error("Error reading HTML file:", e);
      preview.innerHTML = `<div class="text-gray-500 text-center">Error reading HTML file content.</div>`;
    };
    reader.readAsText(fileObj);
    return; // Return here as content is set asynchronously
  } else {
    content = `<div class="text-gray-500 text-center">Cannot preview this file type.</div>`;
  }

  // Set the preview content (for synchronous types)
  preview.innerHTML = content;
}

// Helper function to convert a file to a data URI
function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

// Helper function to read file as text
function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
    reader.readAsText(file);
  });
}

// Navigation logic for arrow keys
function navigate(offset) {
  // If media is playing, do not navigate
  if (isMediaPlaying) {
    return;
  }

  if (currentFolderFiles.length === 0 && allFiles.length > 0) {
    // If no folder is open, initialize currentFolderFiles with all browsed files
    // For now, it will include all supported files from the entire browsed selection.
    currentFolderFiles = allFiles
      .filter((f) => supportedExtensions.test(f.fileObject.name))
      .map((f) => f.path);

    // Sort currentFolderFiles to ensure consistent navigation
    currentFolderFiles.sort((a, b) => a.localeCompare(b));

    // Find the index of the currently active file, if any
    const activeFilePath = activeFileElement
      ? allFiles.find((f) => f.element === activeFileElement)?.path
      : null;
    currentIndex = activeFilePath
      ? currentFolderFiles.indexOf(activeFilePath)
      : -1;
  }

  const newIndex = currentIndex + offset;
  if (newIndex >= 0 && newIndex < currentFolderFiles.length) {
    displayFile(currentFolderFiles[newIndex]);
  }
}

// Event listeners for keyboard navigation
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") {
    e.preventDefault(); // Prevent default browser scroll
    navigate(-1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault(); // Prevent default browser scroll
    navigate(1);
  }
});

// --- Handle Folder Selection ---
const folderInput = document.getElementById("folder-input");
const browseFolderBtn = document.getElementById("browse-folder-btn");
const treeContainer = document.getElementById("tree-container");
const previewContent = document.getElementById("preview-content");

browseFolderBtn.addEventListener("click", () => {
  folderInput.click(); // Trigger the hidden file input click
});

folderInput.addEventListener("change", (event) => {
  const files = event.target.files; // FileList object

  // Debug: Log number of files
  console.log(`Number of files uploaded: ${files.length}`);

  // Extract the first folder name from the first file's webkitRelativePath
  const firstFile = files[0];
  const firstFolderName =
    firstFile?.webkitRelativePath.split("/")[0] || "Browsed Notes";
  document.title = `${firstFolderName} - Notes Viewer`;

  // Reset internal state before building new tree
  allFiles = [];
  currentFolderFiles = [];
  currentIndex = -1;
  if (activeFileElement)
    activeFileElement.classList.remove("bg-blue-100", "text-blue-700");
  activeFileElement = null;
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  } // Clear any open URLs
  isMediaPlaying = false; // Reset media playing flag

  // Build the tree structure and render it
  const structure = buildTreeFromFiles(files);
  treeContainer.innerHTML = ""; // Clear existing tree

  if (structure.length === 0) {
    treeContainer.innerHTML =
      '<span class="text-gray-500">No files or folders found in the selected folder.</span>';
  } else {
    createTree(structure, treeContainer);
  }

  // Reset the preview panel
  previewContent.innerHTML =
    '<span class="text-gray-500 text-center">Select a file to preview</span>';

  // Clear the input value to allow selecting the same folder again if needed
  event.target.value = null;
});

// Initial instruction in the tree view (optional, but good UX)
treeContainer.innerHTML =
  '<span class="text-gray-500">Click "Browse Folder" to load your notes.</span>';

// --- Add beforeunload event listener ---
window.addEventListener("beforeunload", (event) => {
  const confirmationMessage =
    "Are you sure you want to leave or reload this page? Your current session might be lost.";
  event.returnValue = confirmationMessage; // For older browsers
  return confirmationMessage; // For modern browsers
});
