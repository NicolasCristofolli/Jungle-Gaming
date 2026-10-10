import { Global, Module } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import config from './mikro-orm.config';
import { CreateWalletUseCase } from '../../application/create-wallet.use-case';
import { SubmitWagerTransactionUseCase } from '../../application/submit-wager-transaction.use-case';

@Global()
@Module({
  providers: [
    {
      // "quando alguém pedir MikroORM, crie assim" (uma vez só, e reaproveite)
      provide: MikroORM,
      useFactory: () => MikroORM.init(config),
    },
    {
      provide: CreateWalletUseCase,
      useFactory: (orm: MikroORM) => new CreateWalletUseCase(orm),
      inject: [MikroORM],
    },
    {
      provide: SubmitWagerTransactionUseCase,
      useFactory: (orm: MikroORM) => new SubmitWagerTransactionUseCase(orm),
      inject: [MikroORM],
    },
  ],
  exports: [MikroORM, CreateWalletUseCase, SubmitWagerTransactionUseCase],
})
export class DatabaseModule {}