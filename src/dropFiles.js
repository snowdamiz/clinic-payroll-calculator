export async function filesFromDataTransfer(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);

  if (entries.length === 0) return [...(dataTransfer?.files || [])];

  const files = [];
  for (const entry of entries) {
    files.push(...(await filesFromEntry(entry)));
  }
  return files;
}

async function filesFromEntry(entry) {
  if (entry.isFile) {
    return [await fileFromEntry(entry)];
  }

  if (!entry.isDirectory) return [];

  const childEntries = await readDirectoryEntries(entry);
  const nestedFiles = await Promise.all(childEntries.map(filesFromEntry));
  return nestedFiles.flat();
}

function fileFromEntry(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readDirectoryEntries(directoryEntry) {
  const reader = directoryEntry.createReader();
  const entries = [];

  while (true) {
    const batch = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
}
