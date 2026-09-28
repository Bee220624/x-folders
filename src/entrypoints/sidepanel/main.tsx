import { render } from 'preact';
import { SidePanelApp } from '@/sidepanel/SidePanelApp';
import { mountSidePanelStyles } from '@/sidepanel/styles';
import { FolderStore } from '@/state/FolderStore';
import { CleanupRegistry } from '@/utils/cleanup';
import { applyStoredLogLevel } from '@/utils/logger';

void applyStoredLogLevel();

const registry = new CleanupRegistry();
const store = new FolderStore();
// Same change channel the content scripts use, so a save in any X tab shows
// up here without a refresh.
store.attach(registry);
mountSidePanelStyles(document);

const app = document.getElementById('app');
if (app !== null) render(<SidePanelApp store={store} />, app);

window.addEventListener('pagehide', () => registry.dispose());
