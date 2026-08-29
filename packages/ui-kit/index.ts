import * as path from 'path';
import { fileURLToPath } from 'url';

/** Absolute path to the shared browser assets. */
export const UI_KIT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Mount descriptor for `startService({ mounts: [uiKitMount()] })`. */
export const uiKitMount = (prefix = '/ui-kit') => ({ prefix, dir: UI_KIT_DIR });
