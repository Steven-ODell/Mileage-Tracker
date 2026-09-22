import { registerRootComponent } from 'expo';

// Defines the background location task. Must load before anything else so a
// headless start (screen off, UI gone) finds the task registered.
import './src/tracking';

import App from './App';

registerRootComponent(App);
