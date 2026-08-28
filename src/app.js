// src/app.js — SPA entry point
// Imports all page modules and mounts the shared nav.

import { mountNav } from './lib/nav.js';

// Import page modules — their top-level code initializes DOM elements,
// event listeners, and list rendering for all three views.
import './pages/capture.js';
import './pages/demos.js';
import './pages/lyrics.js';

// Mount the shared navigation and show the initial view.
mountNav('capture');
