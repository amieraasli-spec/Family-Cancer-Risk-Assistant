/** Entry point for the prototype API server. */
import { createApp } from './http/app.ts';
import { db, migrate } from './db/database.ts';
import { settings } from './config/settings.ts';

const config = settings();
const applied = migrate(db());
if (applied.length > 0) console.log(`applied migrations: ${applied.join(', ')}`);

const app = createApp();
app.listen(config.port, () => {
  console.log(`IKN report tracking API listening on http://localhost:${config.port}`);
  console.log(`data class: ${config.dataClass}; messaging: ${config.notifyProvider}`);
  if (config.dataClass === 'SYNTHETIC') {
    console.log('Demonstration data — not actual IKN performance.');
  }
});
