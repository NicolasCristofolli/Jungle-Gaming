import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { Migration20261010000000Initial } from './migrations/Migration20261010000000Initial';

export default defineConfig({
  clientUrl: process.env.DATABASE_URL ?? 'postgres://wagering:wagering@localhost:5436/wagering',
  entities: [],
  discovery: { warnWhenNoEntities: false },
  extensions: [Migrator],
  migrations: {
    migrationsList: [
      { name: 'Migration20261010000000Initial', class: Migration20261010000000Initial },
    ],
  },
});
