import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/infrastructure/persistence/mikro-orm.config';

const direction = process.argv[2] === 'down' ? 'down' : 'up';
const orm = await MikroORM.init(config);
try {
  if (direction === 'up') {
    await orm.migrator.up();
  } else {
    await orm.migrator.down();
  }
  console.log(`migrations ${direction}: ok`);
} finally {
  await orm.close(true);
}
