import { Controller, Delete, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { GameService } from './game.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly gameService: GameService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Delete('players')
  async removeAllPlayers(): Promise<{ deletedCount: number; message: string }> {
    const result = await this.gameService.removeAllPlayers();
    return {
      ...result,
      message: `Удалено игроков: ${result.deletedCount}`,
    };
  }

  // Альтернативный эндпоинт через POST (на случай проблем с DELETE)
  @Post('players/delete-all')
  async removeAllPlayersPost(): Promise<{ deletedCount: number; message: string }> {
    const result = await this.gameService.removeAllPlayers();
    return {
      ...result,
      message: `Удалено игроков: ${result.deletedCount}`,
    };
  }

  // Перегенерировать карту (удалить все клетки)
  @Post('map/regenerate')
  async regenerateMap(): Promise<{ deletedCount: number; message: string }> {
    const result = await this.gameService.regenerateMap();
    return {
      ...result,
      message: `Удалено клеток: ${result.deletedCount}. Карта будет перегенерирована при следующем обращении к клеткам.`,
    };
  }

  // Альтернативный эндпоинт через DELETE
  @Delete('map')
  async regenerateMapDelete(): Promise<{ deletedCount: number; message: string }> {
    const result = await this.gameService.regenerateMap();
    return {
      ...result,
      message: `Удалено клеток: ${result.deletedCount}. Карта будет перегенерирована при следующем обращении к клеткам.`,
    };
  }
}
