import 'dotenv/config';
import { closeDatabase, initMigrationDatabase } from './connection.js';
import { migrate } from './schema.js';

async function main() {
    await initMigrationDatabase();
    try {
        await migrate();
    } finally {
        await closeDatabase();
    }
    process.exit(0);
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
