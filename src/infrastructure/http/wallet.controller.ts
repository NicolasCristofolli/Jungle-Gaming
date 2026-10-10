import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { MikroORM } from '@mikro-orm/postgresql';
import { CreateWalletUseCase } from '../../application/create-wallet.use-case';
import { WalletRepository } from '../persistence/wallet.repository';
import type { Wallet } from '../../domain/wallet';

// o formato que o body PRECISA ter (o zod valida e dá erro 400 se não bater)
const CreateWalletBody = z.object({
  playerId: z.string().uuid(),
  initialBalance: z.object({
    amount: z.string(),
    currency: z.string(),
  }),
});

// transforma a Wallet do domínio no JSON da resposta (formato da seção 9 do enunciado)
function toResponse(wallet: Wallet) {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}

@Controller('wallets')
export class WalletController {
  private readonly wallets = new WalletRepository();

  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly orm: MikroORM,
  ) {}

  // POST /wallets  → 201
  @Post()
  async create(@Body() body: unknown) {
    const input = CreateWalletBody.parse(body);
    const wallet = await this.createWallet.execute(input);
    return toResponse(wallet);

  }

  // GET /wallets/:walletId  → 200 ou 404
  @Get(':walletId')
  async findOne(@Param('walletId') walletId: string) {
    const wallet = await this.wallets.findById(this.orm.em.fork(), walletId);
    if (!wallet){
        throw new NotFoundException();
    }
    return toResponse(wallet);
  }
}