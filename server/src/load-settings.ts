// Imported first by the entry point, so the saved settings are in the
// environment before any other module reads it at import time.
import { loadSettingsFile, settingsFile } from './settings-file.js';

const applied = loadSettingsFile();
if (applied.length) console.log(`[Settings] ${applied.length} saved setting(s) from ${settingsFile()}`);
